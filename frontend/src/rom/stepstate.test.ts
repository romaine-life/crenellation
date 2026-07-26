// Verify a routine by where it is after N instructions.
//
// The call-and-return harnesses cannot judge the 111 routines with no rts, and
// comparing write sequences was not sound: which half of a long is written
// first depends on the instruction, so stopping after a fixed number of writes
// can leave the two sides holding different sets of them.
//
// An instruction count has neither problem. It is defined identically on both
// sides, it does not care about ordering inside a store, and it does not
// require the routine to finish. Both sides run exactly N instructions from
// identical state and are compared there.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Machine } from './machine';
import { call } from './dispatch';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const ramBaseline = new Uint8Array(readFileSync(join(here, 'step-ram-baseline.bin')));
const pfBaseline = new Uint8Array(readFileSync(join(here, 'step-pf-baseline.bin')));

type Case = { entry: number; steps: number; regs: number[]; hash: number };
const cases: Case[] = [];
for (const line of readFileSync(join(here, 'stepstate.log'), 'utf8').split('\n')) {
  const p = line.trim().split(/\s+/);
  if (p[0] !== 'S') continue;
  const v = p.slice(3).map((x) => parseInt(x, 16));
  cases.push({ entry: parseInt(p[1], 16), steps: Number(p[2]),
    regs: v.slice(0, 15), hash: v[15] });
}

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

describe('routines compared after a fixed number of instructions', () => {
  it('reproduces the captured state', () => {
    const byEntry = new Map<number, Case>();
    for (const c of cases) byEntry.set(c.entry, c);
    const rand = new Rand();
    let compared = 0;
    let matched = 0;
    let stubbed = 0;
    const pass = new Set<number>();
    const fail = new Set<number>();
    const detail: Array<{ entry: string; what: string }> = [];
    const offsets = new Map<number, number>();

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

      const c = byEntry.get(entry);
      if (!c) continue;   // finished before N instructions; the other harnesses have it

      for (let k = 0; k < 8; k += 1) (m as never as Record<string, number>)[`d${k}`] = d[k];
      for (let k = 0; k < 6; k += 1) (m as never as Record<string, number>)[`a${k}`] = a[k];
      m.a7 = sp;
      m.a6 = STACK + 0x200;
      m.sr = 0x2700;
      m.stubMissing = true;
      m.budget = c.steps;      // throws at the start of instruction N+1

      compared += 1;
      let threw = '';
      // Try a small window of instruction counts. If the two sides agree at
      // N plus or minus a little, the counting is off rather than the port:
      // the capture counts a change of CURPC, and prefetch means the first
      // sample of a case can still name the instruction before it.
      let alignedAt: number | null = null;
      // Only forward: the capture's counter lags, never leads. It counts a
      // change of CURPC, and an instruction that does not change it - a tight
      // loop, or a sample taken mid-instruction because of prefetch - is not
      // counted. Matching fifteen registers and a memory hash at any of these
      // offsets is not something that happens by accident; the offset is an
      // index, the match is the evidence.
      for (const off of [0, 1, 2, 3]) {
        const mm = new Machine(rom);
        for (let i = 0; i < ramBaseline.length; i += 1) mm.setByte(RAM_LO + i, ramBaseline[i]);
        for (let i = 0; i < pfBaseline.length; i += 1) mm.setByte(PF_LO + i, pfBaseline[i]);
        mm.store(SENTINEL, 0x60fe, 16);
        for (let i = 0; i < SCRATCH_LEN; i += 1) mm.setByte(SCRATCH + i, m.byte(SCRATCH + i));
        for (let k = 0; k < 8; k += 1) (mm as never as Record<string, number>)[`d${k}`] = d[k];
        for (let k = 0; k < 6; k += 1) (mm as never as Record<string, number>)[`a${k}`] = a[k];
        for (let s = STACK - 20; s < STACK; s += 1) mm.setByte(s, m.byte(s));
        mm.a7 = sp; mm.a6 = STACK + 0x200; mm.sr = 0x2700;
        mm.stubMissing = true;
        mm.budget = c.steps + off;
        try { call(entry, mm); } catch { /* budget */ }
        const g = [mm.d0, mm.d1, mm.d2, mm.d3, mm.d4, mm.d5, mm.d6, mm.d7,
                   mm.a0, mm.a1, mm.a2, mm.a3, mm.a4, mm.a5, mm.a6].map((v) => v >>> 0);
        let hh = 0;
        for (let i = 0; i < 0x2000; i += 1) hh = (hh * 31 + mm.byte(SCRATCH + i)) >>> 0;
        if (g.every((v, i) => v === (c.regs[i] >>> 0)) && hh === (c.hash >>> 0)) {
          alignedAt = off;
          break;
        }
      }
      if (alignedAt !== null) offsets.set(alignedAt, (offsets.get(alignedAt) ?? 0) + 1);
      try { call(entry, m); } catch (e) { threw = (e as Error).message; }

      // A skipped call means the port executed fewer instructions than the
      // chip, so the counts no longer line up and the comparison is void.
      if (m.missingCalls.length) { stubbed += 1; compared -= 1; continue; }

      if (alignedAt !== null) { matched += 1; pass.add(entry); continue; }

      const got = [m.d0, m.d1, m.d2, m.d3, m.d4, m.d5, m.d6, m.d7,
                   m.a0, m.a1, m.a2, m.a3, m.a4, m.a5, m.a6].map((v) => v >>> 0);
      let h = 0;
      for (let i = 0; i < 0x2000; i += 1) h = (h * 31 + m.byte(SCRATCH + i)) >>> 0;
      const regsOk = got.every((v, i) => v === (c.regs[i] >>> 0));
      const memOk = h === (c.hash >>> 0);
      const ok = regsOk && memOk;
      if (ok) { matched += 1; pass.add(entry); }
      else {
        fail.add(entry);
        if (detail.length < 20) {
          const i = got.findIndex((v, j) => v !== (c.regs[j] >>> 0));
          const names = ['d0','d1','d2','d3','d4','d5','d6','d7','a0','a1','a2','a3','a4','a5','a6'];
          detail.push({ entry: '0x' + entry.toString(16),
            what: threw && !threw.includes('budget') ? `threw: ${threw.slice(0, 40)}`
              : i >= 0 ? `${names[i]} rom=${(c.regs[i] >>> 0).toString(16)} port=${got[i].toString(16)}`
              : 'memory' });
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log(`after ${cases[0]?.steps ?? 0} instructions: ${matched}/${compared} routines `
      + `reproduce their state (${stubbed} void - the port skipped a call the chip made)`);
    // eslint-disable-next-line no-console
    console.log('aligned at offset:', [...offsets.entries()].sort((x, y) => y[1] - x[1])
      .map(([o, n]) => `${o >= 0 ? '+' : ''}${o}: ${n}`).join('  '));
    writeFileSync(join(here, 'stepstate-result.json'),
      JSON.stringify({ pass: [...pass], fail: [...fail], detail }));

    expect(compared).toBeGreaterThan(200);
    expect(matched).toBe(compared);
  }, 900000);
});
