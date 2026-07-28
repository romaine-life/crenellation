// Every decompiled routine must do exactly what the recompiled one does.
//
// The recompilation is the oracle. It was checked instruction by instruction
// against real silicon, so "the decompiled version agrees with it" is a real
// claim about the ROM, not two guesses agreeing with each other.
//
// Each routine is run twice from identical machines: once through the
// dispatcher, which executes the transliterated instructions, and once as the
// decompiled function with the same arguments. Then the memory both could have
// touched is compared byte for byte. A decompiled routine that differs
// anywhere is not decompiled, it is wrong.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Machine } from './machine';
import { call } from './dispatch';
import { DECOMPILED, bind, call as viaDecompiled, useCallee } from './decompiled';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const ramBaseline = new Uint8Array(readFileSync(join(here, 'ram-baseline.bin')));

const RAM_LO = 0x3e0000;
const SCRATCH = 0x3e4000;
const SCRATCH_LEN = 0x800;
const STACK = 0x3e6000;
const SENTINEL = 0x3e7000;

function fresh(seed: number): Machine {
  const m = new Machine(rom);
  for (let i = 0; i < ramBaseline.length; i += 1) m.setByte(RAM_LO + i, ramBaseline[i]);
  let s = seed >>> 0;
  const next = (): number => {
    s = (s ^ (s << 13)) >>> 0; s = (s ^ (s >>> 17)) >>> 0; s = (s ^ (s << 5)) >>> 0;
    return s;
  };
  // Even bytes only. Routines load pointers out of this scratch and access
  // through them; a random odd byte makes an odd pointer, the machine takes an
  // address error and vectors, and the comparison ends up measuring the
  // exception path instead of the routine.
  for (let i = 0; i < SCRATCH_LEN; i += 1) m.setByte(SCRATCH + i, (next() % 256) & 0xfe);
  for (let k = 0; k < 7; k += 1) {
    (m as never as Record<string, number>)[`a${k}`] = SCRATCH + (next() % 0x100) * 2;
  }
  m.sr = 0x2700;
  m.budget = 200_000;
  m.stubMissing = true;
  return m;
}

/**
 * A value for one parameter. Everything is an even pointer into scratch: a
 * routine that takes a struct gets somewhere real to write, and one that takes
 * a number is not upset by being handed a large even one. Odd values would
 * fault on a word access and prove nothing about the lifting.
 */
function valueFor(i: number, seed: number): number {
  let s = (seed + i * 2654435761) >>> 0;
  s = (s ^ (s << 13)) >>> 0; s = (s ^ (s >>> 17)) >>> 0; s = (s ^ (s << 5)) >>> 0;
  return SCRATCH + 0x200 + (s % 0x40) * 8;
}

/** Everything either version could have written. */
function window(m: Machine): Uint8Array {
  const out = new Uint8Array(SCRATCH_LEN + 0x4000);
  for (let i = 0; i < SCRATCH_LEN; i += 1) out[i] = m.byte(SCRATCH + i);
  for (let i = 0; i < 0x4000; i += 1) out[SCRATCH_LEN + i] = m.byte(0x3e0000 + i);
  return out;
}

describe('decompiled routines against the recompiled oracle', () => {
  it('does exactly what the machine does', () => {
    // Calls made from inside a decompiled routine go to the recompiler, so
    // this proves one routine at a time. Whether they work together is
    // compose.test.ts's question, and a different one.
    useCallee(call);
    const bad: string[] = [];
    let checked = 0;

    // A range filter, so a hunt can ask about the routines it cares about
    // rather than waiting for all thousand. `DECOMP_ONLY=13000-14000`.
    const only = (process.env.DECOMP_ONLY ?? '').split('-').map((x) => parseInt(x, 16));
    for (const { at: addr, fn, params } of DECOMPILED) {
      if (only.length === 2 && !Number.isNaN(only[0])
          && (addr < only[0] || addr > only[1])) continue;
      for (let trial = 0; trial < 4; trial += 1) {
        const seed = (0x1234567 + trial * 7919 + addr) >>> 0;
        const args = params.map((_, i) => valueFor(i, seed));
        const regParams: Array<[string, number]> = [];

        // The oracle takes its arguments where the ROM expects them: some in
        // registers, some on the stack, as the routine itself decided.
        const a = fresh(seed);
        // Each stack argument at the offset the routine reads it from, not
        // packed from 4 upwards. A routine whose only argument is at 0xC gets
        // it at 0xC; pushing it at 4 instead leaves the machine reading
        // whatever happens to be there, and the comparison then measures the
        // harness rather than the lifting.
        const stack = params
          .map((p, i) => ({ p, v: args[i] }))
          .filter((x) => x.p.from === 'stack');
        const sp = STACK - 0x40;
        a.a7 = sp;
        a.store(sp, SENTINEL, 32);
        for (const { p, v } of stack) a.store(sp + (p as { off: number }).off, v, 32);
        a.store(SENTINEL, 0x4e75, 16);      // rts, so a stray return lands somewhere valid
        // Both machines. The oracle reads register arguments out of registers,
        // and so does any ROM routine the decompiled version calls or jumps
        // into - setting them only on the oracle makes the lifted side look
        // wrong for a reason that is entirely the harness's.
        params.forEach((p, i) => {
          if (p.from !== 'reg') return;
          (a as never as Record<string, number>)[p.name] = args[i];
          regParams.push([p.name, args[i]]);
        });

        let oracleFailed = '';
        try { call(addr, a); } catch (e) { oracleFailed = (e as Error).message.slice(0, 40); }

        // the decompiled version: same machine, arguments passed as arguments
        // The same stack, not just the same stack pointer. A lifted routine
        // that jumps into ROM code hands it this frame, and that code reads
        // the arguments and the return address out of it.
        const b = fresh(seed);
        b.a7 = sp;
        b.store(sp, SENTINEL, 32);
        for (const { p, v } of stack) b.store(sp + (p as { off: number }).off, v, 32);
        b.store(SENTINEL, 0x4e75, 16);
        for (const [name, v] of regParams) (b as never as Record<string, number>)[name] = v;
        // Through the dispatcher, not by calling the function: a tail jump is
        // recorded for the dispatcher to carry on with, so calling directly
        // stops at the jump and never runs what it jumped to.
        bind(b);
        let liftedFailed = '';
        try { viaDecompiled(addr, b); } catch (e) { liftedFailed = (e as Error).message.slice(0, 40); }

        if (oracleFailed) continue;          // the oracle could not run it; nothing to compare
        // The oracle survived a bad pointer by vectoring an address error, the
        // way the chip does. The decompiled routines have no exception path -
        // they are the routine, not the CPU - so this trial is measuring the
        // handler, not the lifting. It only happens on arguments outside the
        // routine's domain, which the harness invents and the game does not.
        if (a.addressErrors > 0) continue;
        checked += 1;
        if (liftedFailed) {
          bad.push(`0x${addr.toString(16)} trial ${trial}: decompiled threw - ${liftedFailed}`);
          continue;
        }
        // Results come back in registers as well as memory, so both are compared.
        const regs = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
                      'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
        const ra = a as never as Record<string, number>;
        const rb = b as never as Record<string, number>;
        const wrong = regs.find((r) => (ra[r] >>> 0) !== (rb[r] >>> 0));
        if (wrong && bad.length < 400) {
          bad.push(`0x${addr.toString(16)} trial ${trial}: ${wrong} differs`
            + ` - machine 0x${(ra[wrong] >>> 0).toString(16)},`
            + ` decompiled 0x${(rb[wrong] >>> 0).toString(16)}`);
          continue;
        }
        const wa = window(a);
        const wb = window(b);
        let off = -1;
        for (let i = 0; i < wa.length; i += 1) if (wa[i] !== wb[i]) { off = i; break; }
        if (off >= 0 && bad.length < 400) {
          const where = off < SCRATCH_LEN ? SCRATCH + off : 0x3e0000 + (off - SCRATCH_LEN);
          bad.push(`0x${addr.toString(16)} trial ${trial}: memory differs at 0x${where.toString(16)}`
            + ` - machine ${wa[off]}, decompiled ${wb[off]}`);
        }
      }
    }

    const note = [
      `${DECOMPILED.length} decompiled routines, ${checked} comparisons against the machine`,
      bad.length ? `${bad.length} disagree:` : 'all identical',
      ...bad.slice(0, 12),
      bad.length > 12 ? `  ... and ${bad.length - 12} more` : '',
    ].join('\n');
    // eslint-disable-next-line no-console
    console.log(note);
    writeFileSync(join(here, 'decomp.txt'), note);
    // The full list, for classifying what is left. The report above stays
    // short because a 200-line console dump is unreadable; this file is what
    // gets grouped by cause to decide which fix is worth the most routines.
    writeFileSync(join(here, 'decomp-all.txt'), bad.join('\n'));
    // Addresses that did not agree, for the lifter to stop emitting. A routine
    // that disagrees with the machine is not decompiled, and shipping it
    // because it looks plausible is exactly the failure this whole harness
    // exists to prevent.
    // Added to, not replaced. Each run only sees the routines currently in the
    // module, so overwriting swaps one set of failures for the next and the
    // list never grows.
    const listPath = join(here, '..', '..', '..', 'romlab', 'out', 'unproven.json');
    const already: number[] = existsSync(listPath)
      ? (JSON.parse(readFileSync(listPath, 'utf8')) as number[]) : [];
    const failing = new Set<number>(already);
    for (const b of bad) failing.add(parseInt(b.split(' ')[0], 16));
    writeFileSync(listPath, JSON.stringify([...failing].sort((x, y) => x - y)));

    expect(checked).toBeGreaterThan(0);
    // A decompiled routine that differs from the machine is simply wrong, so
    // unlike the capture harnesses this one has no floor to sit above.
    expect(bad).toEqual([]);
  }, 600000);
});
