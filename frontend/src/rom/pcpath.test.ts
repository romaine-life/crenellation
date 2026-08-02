// Which block did the two dispatchers stop agreeing at?
//
// decomp.test says a routine's memory differs at the end. That names the
// routine and nothing inside it. For an arithmetic fault the next question is
// which value; for a control-flow fault it is which BRANCH, and the cheapest
// witness to a branch is the sequence of blocks actually entered.
//
// Registers are deliberately not compared. The lifted code keeps them in
// JavaScript locals and writes the machine's only when it spills, so sampling
// m.dN at a block head compares a live register against a stale mirror - the
// mistake regdiff.test.ts made, and the reason SPILL_ALL had to exist. A
// program counter has no such problem: both dispatchers really are at that
// address when they report it.
//
// Both runs poll at the same addresses by construction. The oracle reports
// every instruction, so it is filtered to POLL_AT - the lift's block heads,
// which are the only addresses it can report at all.
//
// PCPATH=b032 picks the routine. The control runs first and is the whole
// reason to trust the rest: the oracle against itself must produce identical
// sequences, and if it does not the instrument is measuring itself.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Machine } from './machine';
import { call } from './dispatch';
import { DECOMPILED, POLL_AT, bind, call as viaDecompiled, useCallee } from './decompiled';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const ramBaseline = new Uint8Array(readFileSync(join(here, 'ram-baseline.bin')));

// Identical to decomp.test.ts. Not shared through an import on purpose: this
// has to reproduce the exact machine that harness reports a failure on, and a
// helper that drifts would quietly compare a different trial.
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
  for (let i = 0; i < SCRATCH_LEN; i += 1) m.setByte(SCRATCH + i, (next() % 256) & 0xfe);
  for (let k = 0; k < 7; k += 1) {
    (m as never as Record<string, number>)[`a${k}`] = SCRATCH + (next() % 0x100) * 2;
  }
  m.sr = 0x2700;
  m.budget = 200_000;
  m.stubMissing = true;
  return m;
}

function valueFor(i: number, seed: number): number {
  let s = (seed + i * 2654435761) >>> 0;
  s = (s ^ (s << 13)) >>> 0; s = (s ^ (s >>> 17)) >>> 0; s = (s ^ (s << 5)) >>> 0;
  return SCRATCH + 0x200 + (s % 0x40) * 8;
}

type Params = ReadonlyArray<{ from: string; name?: string; off?: number }>;

/** Set up one trial's machine exactly as decomp.test.ts does. */
function stage(addr: number, params: Params, seed: number): Machine {
  const args = params.map((_, i) => valueFor(i, seed));
  const m = fresh(seed);
  const sp = STACK - 0x40;
  m.a7 = sp;
  m.store(sp, SENTINEL, 32);
  params.forEach((p, i) => {
    if (p.from === 'stack') m.store(sp + (p.off as number), args[i], 32);
  });
  m.store(SENTINEL, 0x4e75, 16);
  params.forEach((p, i) => {
    if (p.from === 'reg') (m as never as Record<string, number>)[p.name as string] = args[i];
  });
  return m;
}

/** Run it and give back the block heads entered, in order. */
function path(addr: number, params: Params, seed: number,
              entry: (a: number, m: Machine) => void, lifted: boolean): number[] {
  const m = stage(addr, params, seed);
  const seq: number[] = [];
  m.atPc = (pc: number): void => {
    // The oracle reports every instruction; only the block heads are common
    // ground. The lift reports nothing else, so this is a no-op there.
    if (POLL_AT.has(pc) && seq.length < 200_000) seq.push(pc | 0);
  };
  if (lifted) bind(m);
  try { entry(addr, m); } catch { /* a routine that faults still has a path */ }
  m.atPc = null;
  return seq;
}

describe('where the two dispatchers part', () => {
  it('names the block', () => {
    useCallee(call);
    const want = (process.env.PCPATH ?? 'b032').toLowerCase();
    const addr = parseInt(want, 16);
    const row = DECOMPILED.find((d) => d.at === addr);
    const out: string[] = [];
    if (!row) {
      writeFileSync(join(here, 'pcpath.txt'), `no decompiled routine at 0x${want}\n`);
      return;
    }
    const params = row.params as Params;
    for (let trial = 0; trial < 4; trial += 1) {
      const seed = (0x1234567 + trial * 7919 + addr) >>> 0;
      // THE CONTROL. The oracle against itself, same seed, same staging. If
      // these two ever differ the run is not reproducible and every comparison
      // below is noise - which is exactly how an earlier bisection produced
      // confident nonsense from a probe that never fired.
      const c1 = path(addr, params, seed, call, false);
      const c2 = path(addr, params, seed, call, false);
      let ctrl = -1;
      for (let i = 0; i < Math.max(c1.length, c2.length); i += 1) {
        if (c1[i] !== c2[i]) { ctrl = i; break; }
      }
      if (ctrl >= 0) {
        out.push(`trial ${trial}: CONTROL FAILED at ${ctrl} - the oracle is not`
          + ' reproducible here, so nothing below means anything');
        continue;
      }
      const b = path(addr, params, seed, viaDecompiled, true);
      let at = -1;
      for (let i = 0; i < Math.max(c1.length, b.length); i += 1) {
        if (c1[i] !== b[i]) { at = i; break; }
      }
      if (at < 0) {
        out.push(`trial ${trial}: same path, ${c1.length} blocks`
          + ` (control clean over ${c1.length})`);
        continue;
      }
      const from = Math.max(0, at - 6);
      const show = (v: number[]): string => v.slice(from, at + 4)
        .map((x, i) => `${from + i === at ? '>' : ''}${(x >>> 0).toString(16)}`).join(' ');
      out.push(`trial ${trial}: parts at block ${at} of ${c1.length}/${b.length}`
        + ` - last agreed 0x${(c1[at - 1] ?? 0).toString(16)},`
        + ` then oracle 0x${(c1[at] ?? 0).toString(16)} and lift 0x${(b[at] ?? 0).toString(16)}`
        + `\n  oracle: ${show(c1)}\n  lift:   ${show(b)}`);
    }
    writeFileSync(join(here, 'pcpath.txt'), `${out.join('\n')}\n`);
    // Diagnostic, like one.test.ts: it reports, it does not judge. The only
    // thing it insists on is that it ran.
    expect(out.length).toBeGreaterThan(0);
  }, 600000);
});
