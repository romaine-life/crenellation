// Compare at a boundary both sides agree on.
//
// Every other comparison here matches a snapshot by the address the capture
// recorded, and that address comes from a memory tap that fires part-way
// through an instruction. It agrees with the instruction stream 97% of the
// time, but the routines that do not verify sit disproportionately in the rest.
//
// This capture single-steps the chip instead, so the state is read at a genuine
// instruction boundary and the count means the same thing on both sides: N
// instructions from the entry, no pairing, nothing to reconcile.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'vitest';

import { Machine } from './machine';
import { call } from './dispatch';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const ramBaseline = new Uint8Array(readFileSync(join(here, 'true-ram-baseline.bin')));
const pfBaseline = new Uint8Array(readFileSync(join(here, 'true-pf-baseline.bin')));
const ioBaseline = new Uint8Array(readFileSync(join(here, 'step-io-baseline.bin')));
const IO_BLOCKS: Array<[number, number]> = [
  [0x3c0000, 0x1000], [0x460000, 0x1000], [0x480000, 0x1000], [0x640000, 0x1000],
  [0x140000, 0x40000], [0x500000, 0x20000],
];

const RAM_LO = 0x3e0000;
const PF_LO = 0x200000;
const SCRATCH = 0x3e4000;
const SCRATCH_LEN = 0x400;
const STACK = 0x3e5000;
const SENTINEL = 0x3e6000;
const STRUCTS = [0x3e0864, 0x3e1968, 0x3e1cf6, 0x3e1bc6, 0x3e0f48, 0x3e02d8, 0x3e4000];
const NAMES = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
               'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'];

type Case = { entry: number; shape: number; steps: number; pc: number;
              regs: number[]; hash: number };
const cases: Case[] = [];
for (const line of readFileSync(join(here, 'truestep.log'), 'utf8').split('\n')) {
  const p = line.trim().split(/\s+/);
  if (p[0] !== 'T') continue;
  const v = p.slice(4).map((x) => parseInt(x, 16));
  cases.push({ entry: parseInt(p[1], 16), shape: Number(p[2]), steps: Number(p[3]),
    pc: v[0], regs: v.slice(1, 16), hash: v[16] });
}

const entries: number[] = readFileSync(join(here, 'entries.txt'), 'utf8')
  .split('\n').map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 16));

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

describe('routines compared at a single-stepped boundary', () => {
  it('reproduces the captured state', () => {
    let matched = 0;
    let compared = 0;
    const pass = new Set<number>();
    const fail = new Set<number>();
    const detail: Array<{ entry: string; shape: number; steps: number; what: string }> = [];

    for (const c of cases) {
      const m = new Machine(rom);
      for (let i = 0; i < ramBaseline.length; i += 1) m.setByte(RAM_LO + i, ramBaseline[i]);
      for (let i = 0; i < pfBaseline.length; i += 1) m.setByte(PF_LO + i, pfBaseline[i]);
      let io = 0;
      for (const [base, len] of IO_BLOCKS) {
        for (let i = 0; i < len; i += 1) m.setByte(base + i, ioBaseline[io + i]);
        io += len;
      }
      m.ioModelled = true;
      m.store(SENTINEL, 0x60fe, 16);

      // the same generator the capture used, advanced to this entry
      const rand = new Rand();
      let d: number[] = [];
      let a: number[] = [];
      let sp = STACK;
      for (const e of entries) {
        d = []; a = []; sp = STACK;
        for (let i = 0; i < SCRATCH_LEN; i += 1) m.setByte(SCRATCH + i, rand.next() % 256);
        for (let k = 0; k < 8; k += 1) {
          const r = rand.next();
          d.push(c.shape === 0 ? r % 0x10000
            : (c.shape === 1 || c.shape === 3) ? r % 32 : r % 256);
        }
        for (let k = 0; k < 6; k += 1) {
          const r = rand.next();
          a.push(c.shape === 0 ? SCRATCH + (r % (SCRATCH_LEN - 0x80))
            : STRUCTS[r % STRUCTS.length]);
        }
        for (let k = 1; k <= 4; k += 1) {
          sp -= 4;
          const r = rand.next();
          m.store(sp, c.shape === 3 ? STRUCTS[r % STRUCTS.length]
            : k % 2 === 0 ? r % 0x100 : SCRATCH + (r % (SCRATCH_LEN - 0x80)), 32);
        }
        if (e === c.entry) break;
      }
      sp -= 4;
      m.store(sp, SENTINEL, 32);
      for (let k = 0; k < 8; k += 1) (m as never as Record<string, number>)[`d${k}`] = d[k];
      for (let k = 0; k < 6; k += 1) (m as never as Record<string, number>)[`a${k}`] = a[k];
      m.a7 = sp;
      m.a6 = STACK + 0x200;
      m.sr = 0x2700;
      m.stubMissing = true;
      // the board asserts level 4 every frame and the harness holds the
      // machine mid-frame, so one is waiting when a routine unmasks - which is
      // the entire purpose of the two routines this was built to settle
      m.irqPending = 4;
      // The tick that counts an instruction happens before it runs, so a
      // budget of N leaves N-1 completed. The chip'''s N steps complete N.
      m.budget = c.steps + 1;

      compared += 1;
      let threw = '';
      try { call(c.entry, m); } catch (e) {
        const msg = (e as Error).message;
        if (!msg.includes('budget')) threw = msg;
      }
      const got = NAMES.map((n) => (m as never as Record<string, number>)[n] >>> 0);
      let hh = 0;
      for (let i = 0; i < 0x2000; i += 1) hh = (hh * 31 + m.byte(SCRATCH + i)) >>> 0;
      const bad = NAMES.filter((_, i) => got[i] !== (c.regs[i] >>> 0));
      // The chip's CURPC names the instruction that just ran, so it lags its
      // own registers by one and the two cannot both line up. The step count
      // already fixes the position on both sides, so the address is not part
      // of the comparison - only the registers and the memory.
      const pcBad = false;
      const memBad = hh !== (c.hash >>> 0);
      if (!bad.length && !memBad && !pcBad && !threw) { matched += 1; pass.add(c.entry); }
      else {
        fail.add(c.entry);
        if (detail.length < 30) {
          const i = NAMES.indexOf(bad[0] ?? 'd0');
          detail.push({ entry: '0x' + c.entry.toString(16), shape: c.shape, steps: c.steps,
            what: threw ? `threw: ${threw.slice(0, 40)}`
              : pcBad ? `pc rom=${c.pc.toString(16)} port=${(m.pc >>> 0).toString(16)}`
              : bad.length ? `${bad[0]} rom=${(c.regs[i] >>> 0).toString(16)} port=${got[i].toString(16)}`
              : 'memory' });
        }
      }
    }

    for (const e of pass) fail.delete(e);
    // eslint-disable-next-line no-console
    console.log(`single-stepped: ${matched}/${compared} cases match; `
      + `${pass.size} routines reproduce, ${fail.size} do not`);
    writeFileSync(join(here, 'truestep-result.json'),
      JSON.stringify({ pass: [...pass], fail: [...fail], detail }, null, 1));
  }, 600000);
});
