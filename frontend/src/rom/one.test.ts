// Look at a single routine at a single stopping point, in full.
//
// The bisector says 0x8B4 is clean at eighteen instructions and wrong at
// twenty. It does not say whether what differs is a register or the memory
// hash, and those point in different directions - a register means the
// arithmetic went another way, the hash means something was written that
// should not have been. This prints both.

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
const ioBaseline = new Uint8Array(readFileSync(join(here, 'step-io-baseline.bin')));
const IO_BLOCKS: Array<[number, number]> = [
  [0x3c0000, 0x1000], [0x460000, 0x1000], [0x480000, 0x1000], [0x640000, 0x1000],
  [0x140000, 0x40000], [0x500000, 0x20000],
];

const ENTRY = 0x8b4;
const SHAPE = 1;
const RAM_LO = 0x3e0000;
const PF_LO = 0x200000;
const SCRATCH = 0x3e4000;
const SCRATCH_LEN = 0x400;
const STACK = 0x3e5000;
const SENTINEL = 0x3e6000;
const STRUCTS = [0x3e0864, 0x3e1968, 0x3e1cf6, 0x3e1bc6, 0x3e0f48, 0x3e02d8, 0x3e4000];
const NAMES = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
               'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'];

const entries: number[] = readFileSync(join(here, 'entries.txt'), 'utf8')
  .split('\n').map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 16));

type Case = { steps: number; pc: number; regs: number[]; hash: number };
const cases: Case[] = [];
for (const line of readFileSync(join(here, 'stepstate.log'), 'utf8').split('\n')) {
  const p = line.trim().split(/\s+/);
  if (p[0] !== 'S' || parseInt(p[1], 16) !== ENTRY || Number(p[2]) !== SHAPE) continue;
  const v = p.slice(4).map((x) => parseInt(x, 16));
  cases.push({ steps: Number(p[3]), pc: v[0], regs: v.slice(1, 16), hash: v[16] });
}
cases.sort((a, b) => a.steps - b.steps);

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

describe('one routine, one stopping point', () => {
  it('says exactly what differs', () => {
    const rand = new Rand();
    const out: string[] = [];
    for (const entry of entries) {
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
      for (let i = 0; i < SCRATCH_LEN; i += 1) m.setByte(SCRATCH + i, rand.next() % 256);
      const d: number[] = [];
      for (let k = 0; k < 8; k += 1) d.push(rand.next() % 32);
      const a: number[] = [];
      for (let k = 0; k < 6; k += 1) a.push(STRUCTS[rand.next() % STRUCTS.length]);
      let sp = STACK;
      for (let k = 1; k <= 4; k += 1) {
        sp -= 4;
        const r = rand.next();
        m.store(sp, k % 2 === 0 ? r % 0x100 : SCRATCH + (r % (SCRATCH_LEN - 0x80)), 32);
      }
      sp -= 4;
      m.store(sp, SENTINEL, 32);
      if (entry !== ENTRY) continue;

      out.push(`value at 0x3E1960 before the call: 0x${m.load(0x3e1960, 32).toString(16)}`);
      for (let k = 0; k < 8; k += 1) (m as never as Record<string, number>)[`d${k}`] = d[k];
      for (let k = 0; k < 6; k += 1) (m as never as Record<string, number>)[`a${k}`] = a[k];
      m.a7 = sp;
      m.a6 = STACK + 0x200;
      m.sr = 0x2700;
      m.stubMissing = true;
      m.budget = 20000;

      const wanted = new Map<number, Case[]>();
      for (const c of cases) {
        const l = wanted.get(c.pc);
        if (l) l.push(c); else wanted.set(c.pc, [c]);
      }
      let lastPc = -1;
      m.atPc = (cur: number) => {
        const prev = lastPc;
        lastPc = cur;
        for (const pc of prev >= 0 ? [cur, prev] : [cur]) {
          const l = wanted.get(pc);
          if (!l) continue;
          const got = NAMES.map((n) => (m as never as Record<string, number>)[n] >>> 0);
          let hh = 0;
          for (let i = 0; i < 0x2000; i += 1) hh = (hh * 31 + m.byte(SCRATCH + i)) >>> 0;
          for (const c of l) {
            const bad = NAMES.filter((_, i) => got[i] !== (c.regs[i] >>> 0));
            const memBad = hh !== (c.hash >>> 0);
            out.push(`  step ${c.steps} pc ${pc.toString(16)}: `
              + (bad.length ? `regs differ [${bad.map((n) => {
                  const i = NAMES.indexOf(n);
                  return `${n} rom=${(c.regs[i] >>> 0).toString(16)} port=${got[i].toString(16)}`;
                }).join(', ')}] ` : 'regs match ')
              + (memBad ? 'memory differs' : 'memory matches'));
          }
        }
      };
      try { call(entry, m); } catch (e) { out.push(`  threw: ${(e as Error).message}`); }
      m.atPc = null;
      out.push(`value at 0x3E1960 after the call: 0x${m.load(0x3e1960, 32).toString(16)}`);
      break;
    }
    writeFileSync(join(here, 'one.txt'), out.join('\n'));
  }, 120000);
});
