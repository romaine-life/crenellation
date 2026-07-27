// Localise a divergence to a span of instructions.
//
// The capture takes a snapshot at 2, 3, 5, 10, 20, 60 and 200 instructions. If
// the port matches at 5 and not at 10, whatever is wrong happens in those five
// instructions - which is a far smaller thing to read than a whole routine.
// This reports, per routine, the last stopping point that matched and the
// first that did not.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'vitest';

import { Machine } from './machine';
import { call } from './dispatch';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const ramBaseline = new Uint8Array(readFileSync(join(here, 'step-ram-baseline.bin')));
const pfBaseline = new Uint8Array(readFileSync(join(here, 'step-pf-baseline.bin')));

type Case = { entry: number; shape: number; steps: number; pc: number; regs: number[]; hash: number };
const cases: Case[] = [];
for (const line of readFileSync(join(here, 'stepstate.log'), 'utf8').split('\n')) {
  const p = line.trim().split(/\s+/);
  if (p[0] !== 'S') continue;
  const v = p.slice(4).map((x) => parseInt(x, 16));
  cases.push({ entry: parseInt(p[1], 16), shape: Number(p[2]), steps: Number(p[3]),
    pc: v[0], regs: v.slice(1, 16), hash: v[16] });
}

// Only the routines that actually diverge. Running all 753 with a budget large
// enough for the worst case takes longer than the answer is worth.
const verdicts = JSON.parse(readFileSync(join(here, 'verified.json'), 'utf8')) as {
  failing: number[]; conflicted: number[]; stepStateOnlyMismatch: number[];
};
const TARGETS = new Set<number>([...verdicts.failing, ...verdicts.conflicted,
  ...verdicts.stepStateOnlyMismatch]);

const entries: number[] = readFileSync(join(here, 'entries.txt'), 'utf8')
  .split('\n').map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 16));

const RAM_LO = 0x3e0000;
const PF_LO = 0x200000;
const SCRATCH = 0x3e4000;
const SCRATCH_LEN = 0x400;
const STACK = 0x3e5000;
const SENTINEL = 0x3e6000;
const STRUCTS = [0x3e0864, 0x3e1968, 0x3e1cf6, 0x3e1bc6, 0x3e0f48, 0x3e02d8, 0x3e4000];

class Rand {
  s = 0x12345678;
  next(): number {
    let x = this.s;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    this.s = x;
    return x;
  }
}

describe('where each divergence starts', () => {
  it('brackets it between two stopping points', () => {
    const byEntry = new Map<number, Case[]>();
    for (const c of cases) {
      const l = byEntry.get(c.entry);
      if (l) l.push(c); else byEntry.set(c.entry, [c]);
    }
    const rand = new Rand();
    const report: Array<{ entry: string; lastOk: number; firstBad: number; pc: string }> = [];

    for (const entry of entries) {
      const m = new Machine(rom);
      for (let i = 0; i < ramBaseline.length; i += 1) m.setByte(RAM_LO + i, ramBaseline[i]);
      for (let i = 0; i < pfBaseline.length; i += 1) m.setByte(PF_LO + i, pfBaseline[i]);
      m.store(SENTINEL, 0x60fe, 16);
      for (let i = 0; i < SCRATCH_LEN; i += 1) m.setByte(SCRATCH + i, rand.next() % 256);
      const d: number[] = [];
      for (let k = 0; k < 8; k += 1) d.push(rand.next() % 32);
      const a: number[] = [];
      for (let k = 0; k < 6; k += 1) a.push(STRUCTS[rand.next() % STRUCTS.length]);
      let sp = STACK;
      for (let k = 1; k <= 4; k += 1) {
        sp -= 4;
        const v = k % 2 === 0 ? rand.next() % 0x100
          : SCRATCH + (rand.next() % (SCRATCH_LEN - 0x80));
        m.store(sp, v, 32);
      }
      sp -= 4;
      m.store(sp, SENTINEL, 32);

      const all = (byEntry.get(entry) ?? []).filter((x) => x.shape === 1);
      if (!all.length || !TARGETS.has(entry)) continue;
      const cs = all.filter((x) => !((x.pc >= 0x1357c && x.pc < 0x1365c) || (x.pc >= 0x18548 && x.pc < 0x18680)))
        .sort((x, y) => x.steps - y.steps);
      if (cs.length < 2) continue;

      // one run, checking every stopping point it passes through
      const okAt = new Set<number>();
      const wanted = new Map<number, Case[]>();
      for (const x of cs) {
        const l = wanted.get(x.pc);
        if (l) l.push(x); else wanted.set(x.pc, [x]);
      }
      for (let k = 0; k < 8; k += 1) (m as never as Record<string, number>)[`d${k}`] = d[k];
      for (let k = 0; k < 6; k += 1) (m as never as Record<string, number>)[`a${k}`] = a[k];
      m.a7 = sp;
      m.a6 = STACK + 0x200;
      m.sr = 0x2700;
      m.stubMissing = true;
      m.budget = 20000;   // the furthest stopping point is 200 instructions
      // The capture's registers are the state *after* the instruction at the
      // recorded address has run, while CURPC still names it. Comparing when
      // the port arrives at that address compares one instruction too early,
      // so the comparison is made against the address just completed.
      let lastPc = -1;
      m.atPc = (cur: number) => {
        // both readings: the capture's CURPC sometimes names the instruction
        // about to run and sometimes the one just finished
        const prev = lastPc;
        lastPc = cur;
        for (const pc of prev >= 0 ? [cur, prev] : [cur]) {
        const l = wanted.get(pc);
        if (!l) continue;
        const got = [m.d0, m.d1, m.d2, m.d3, m.d4, m.d5, m.d6, m.d7,
                     m.a0, m.a1, m.a2, m.a3, m.a4, m.a5, m.a6].map((v) => v >>> 0);
        let hh = -1;
        for (const x of l) {
          if (!got.every((v, i) => v === (x.regs[i] >>> 0))) continue;
          if (hh < 0) {
            hh = 0;
            for (let i = 0; i < 0x2000; i += 1) hh = (hh * 31 + m.byte(SCRATCH + i)) >>> 0;
          }
          if (hh === (x.hash >>> 0)) okAt.add(x.steps);
        }
        }
      };
      try { call(entry, m); } catch { /* budget or missing */ }
      m.atPc = null;
      if (m.missingCalls.length) continue;

      const points = cs.map((x) => x.steps);
      const bad = points.filter((n) => !okAt.has(n));
      if (!bad.length || okAt.size === 0) continue;   // clean, or nothing matched at all
      const firstBad = Math.min(...bad);
      const lastOk = Math.max(...[...okAt].filter((n) => n < firstBad), 0);
      const pc = cs.find((x) => x.steps === firstBad)?.pc ?? 0;
      report.push({ entry: '0x' + entry.toString(16), lastOk, firstBad,
        pc: '0x' + pc.toString(16) });
    }

    report.sort((x, y) => (x.firstBad - x.lastOk) - (y.firstBad - y.lastOk));
    // eslint-disable-next-line no-console
    console.log(`bracketed ${report.length} divergences`);
    writeFileSync(join(here, 'localise.json'), JSON.stringify(report, null, 1));
  }, 900000);
});
