// An interrupt must leave the interrupted routine's result unchanged.
//
// Every harness that verified the 593 routines ran them with interrupts masked,
// so none of them says anything about what happens when one lands mid-routine.
// That is the one thing the booted machine does constantly and the one thing
// none of the verification covers.
//
// This needs no capture: a handler that saves what it touches and returns is
// transparent by definition, so running a routine with one injected at every
// instruction must give exactly the state that running it untouched gives. Any
// difference is the port's exception path corrupting the machine, not the
// routine being wrong.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Machine } from './machine';
import { call } from './dispatch';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const ramBaseline = new Uint8Array(readFileSync(join(here, 'ram-baseline.bin')));

const RAM_LO = 0x3e0000;
const SCRATCH = 0x3e4000;
const SCRATCH_LEN = 0x400;
// Below the scratch, not above it. A routine that walks a source pointer
// upward for tens of thousands of bytes runs over a stack placed above it and
// reads the six bytes the interrupt frame was pushed into - a real difference
// the chip would also show, but one made by where this harness put the stack
// rather than by the port.
const STACK = 0x3e1000;
const SENTINEL = 0x3e6000;
/** Somewhere to put a handler that does nothing but return. */
const HANDLER = 0x3e6100;
const NAMES = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
               'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'];

const entries: number[] = readFileSync(join(here, 'entries.txt'), 'utf8')
  .split(/\s+/).filter(Boolean).map((s) => parseInt(s, 16));

function fresh(entry: number, seed: number): Machine {
  const m = new Machine(rom);
  for (let i = 0; i < ramBaseline.length; i += 1) m.setByte(RAM_LO + i, ramBaseline[i]);
  let s = seed >>> 0;
  const next = (): number => {
    s = (s ^ (s << 13)) >>> 0; s = (s ^ (s >>> 17)) >>> 0; s = (s ^ (s << 5)) >>> 0;
    return s;
  };
  for (let i = 0; i < SCRATCH_LEN; i += 1) m.setByte(SCRATCH + i, next() % 256);
  for (let k = 0; k < 8; k += 1) (m as never as Record<string, number>)[`d${k}`] = next() % 32;
  for (let k = 0; k < 6; k += 1) {
    (m as never as Record<string, number>)[`a${k}`] = SCRATCH + (next() % 0x200);
  }
  let sp = STACK;
  for (let k = 0; k < 4; k += 1) { sp -= 4; m.store(sp, SCRATCH + (next() % 0x200), 32); }
  sp -= 4;
  m.store(sp, SENTINEL, 32);
  m.a7 = sp;
  m.a6 = STACK + 0x200;
  m.sr = 0x2000;                 // supervisor, mask 0 - as the game runs
  m.store(SENTINEL, 0x60fe, 16);
  // The handler has to be substituted here, not written to the vector table:
  // the vectors live in the first 256 bytes of ROM, so storing to 0x70 is
  // dropped and the interrupt goes to the game's real frame handler - which
  // does real work, and whose effects then look exactly like a port defect.
  // The frame is still stacked for real; only the address is swapped, for
  // 0x133EA, the rte ending that same handler: one instruction, no register
  // touched, and it returns.
  const stack = m.interruptFrame.bind(m);
  m.interruptFrame = (level: number): number => { stack(level); return 0x133ea; };
  m.stubMissing = true;
  m.budget = 60_000;
  void entry;
  return m;
}

function stateOf(m: Machine): string {
  const regs = NAMES.map((n) => ((m as never as Record<string, number>)[n] >>> 0).toString(16));
  let h = 0;
  for (let i = 0; i < SCRATCH_LEN; i += 1) h = (h * 31 + m.byte(SCRATCH + i)) >>> 0;
  return `${regs.join(',')}|${h.toString(16)}|${m.getSR().toString(16)}`;
}

describe('an interrupt taken mid-routine', () => {
  it('leaves the routine\'s result untouched', () => {
    const bad: string[] = [];
    let checked = 0;
    let deep = 0;

    for (const entry of entries) {
      // how far it runs undisturbed, and what it ends with
      const clean = fresh(entry, 0x12345678);
      let steps = 0;
      clean.atPc = () => { steps += 1; };
      let cleanEnded = true;
      try { call(entry, clean); } catch { cleanEnded = false; }
      const want = stateOf(clean);
      // Only routines that finish on their own. One that runs into the
      // instruction budget is cut off at a different point once the handler's
      // instructions are counted too, so it ends mid-loop with different
      // values - a difference made by the budget, not by the interrupt.
      // The undisturbed run has to be a real baseline. One that halts is not:
      // `stop #$2700` masks every interrupt the board can raise, so the machine
      // stays down and the rest is the unwind, not the routine's result. Nor is
      // one that throws - run in isolation on random inputs, some routines
      // recurse until the JavaScript stack gives out, and both runs then end
      // wherever they happened to run out, at different depths.
      if (steps < 4 || !cleanEnded || clean.stopped) continue;

      // then again, taking an interrupt at each of a few points inside it
      for (const at of [1, Math.floor(steps / 3), Math.floor(steps / 2), steps - 1]) {
        if (at < 1 || at >= steps) continue;
        const m = fresh(entry, 0x12345678);
        m.budget = clean.budget * 4;   // room for the handler as well
        let n = 0;
        m.atPc = () => { n += 1; if (n === at) m.irqPending = 4; };
        let ended = 'returned';
        try { call(entry, m); } catch (e) { ended = (e as Error).message.slice(0, 40); }
        // The dispatcher recurses natively, so a deep 68000 call chain is a
        // deep JavaScript one. A routine whose clean run sits just under the
        // limit goes over it once the handler's frames are added - and how
        // much room there is depends on what else is running, so this shows
        // up only under the full suite. Counted, not compared, and not hidden.
        if (ended.startsWith('Maximum call stack')) { deep += 1; continue; }
        checked += 1;
        const got = stateOf(m);
        if (got !== want && bad.length < 12) {
          const w = want.split('|')[0].split(',');
          const g = got.split('|')[0].split(',');
          const diff = NAMES.filter((_, i) => w[i] !== g[i]);
          bad.push(`0x${entry.toString(16)} interrupted at ${at}/${steps}`
            + ` [ran ${n}, ${ended}]: `
            + (diff.length ? diff.map((nm) => {
                const i = NAMES.indexOf(nm);
                return `${nm} ${w[i]}->${g[i]}`;
              }).join(' ') : 'memory or flags'));
        }
      }
    }

    const note = [
      `checked ${checked} interrupted runs across ${entries.length} routines`
        + (deep ? `; ${deep} skipped, the JavaScript stack ran out before the routine did` : ''),
      bad.length ? `${bad.length} left the machine different:` : 'all identical to the undisturbed run',
      ...bad,
    ].join('\n');
    // eslint-disable-next-line no-console
    console.log(note);
    writeFileSync(join(here, 'irqtransparent.txt'), note);
    expect(checked).toBeGreaterThan(50);
    // Unlike the capture harnesses, this one can be perfect and has to be:
    // a handler that touches nothing cannot change a result, so any
    // difference at all is the port's exception path corrupting the machine.
    expect(bad).toEqual([]);
  }, 900000);
});
