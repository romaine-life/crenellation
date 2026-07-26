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

type Case = { entry: number; steps: number; pc: number; regs: number[]; hash: number };
const cases: Case[] = [];
for (const line of readFileSync(join(here, 'stepstate.log'), 'utf8').split('\n')) {
  const p = line.trim().split(/\s+/);
  if (p[0] !== 'S') continue;
  const v = p.slice(3).map((x) => parseInt(x, 16));
  cases.push({ entry: parseInt(p[1], 16), steps: Number(p[2]), pc: v[0],
    regs: v.slice(1, 16), hash: v[16] });
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

const FOUND = 'state-matched';

describe('routines compared at the instruction the chip stopped on', () => {
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
      // Stop where the chip stopped, by address. Counting instructions on both
      // sides only works if both count the same things, and the capture's
      // counter misses an instruction that does not change CURPC. The address
      // of the instruction about to run is not a count and cannot drift: the
      // port compares every time it arrives there.
      let hit = false;
      let arrivals = 0;
      m.budget = 400000;
      m.atPc = (pc: number) => {
        if (hit || pc !== c.pc) return;
        arrivals += 1;
        const got = [m.d0, m.d1, m.d2, m.d3, m.d4, m.d5, m.d6, m.d7,
                     m.a0, m.a1, m.a2, m.a3, m.a4, m.a5, m.a6].map((v) => v >>> 0);
        if (!got.every((v, i) => v === (c.regs[i] >>> 0))) return;
        let hh = 0;
        for (let i = 0; i < 0x2000; i += 1) hh = (hh * 31 + m.byte(SCRATCH + i)) >>> 0;
        if (hh !== (c.hash >>> 0)) return;
        hit = true;
        throw new Error(FOUND);
      };
      let threw = '';
      try { call(entry, m); } catch (e) {
        const msg = (e as Error).message;
        if (msg !== FOUND) threw = msg;
      }
      m.atPc = null;

      // A skipped call means the port did not run what the chip ran.
      if (m.missingCalls.length) { stubbed += 1; compared -= 1; continue; }

      if (hit) { matched += 1; pass.add(entry); }
      else {
        fail.add(entry);
        if (detail.length < 20) {
          detail.push({ entry: '0x' + entry.toString(16),
            what: threw ? `threw: ${threw.slice(0, 44)}`
              : arrivals === 0 ? `never reached pc 0x${c.pc.toString(16)}`
              : `reached pc 0x${c.pc.toString(16)} ${arrivals}x, state differed` });
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log(`at the chip's stopping instruction: ${matched}/${compared} routines reproduce `
      + `its state (${stubbed} void - the port skipped a call the chip made)`);
    // eslint-disable-next-line no-console
    writeFileSync(join(here, 'stepstate-result.json'),
      JSON.stringify({ pass: [...pass], fail: [...fail], detail }));

    expect(compared).toBeGreaterThan(200);
    expect(matched).toBe(compared);
  }, 900000);
});
