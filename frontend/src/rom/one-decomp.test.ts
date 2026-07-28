// Scratch harness: run one decompiled routine beside the machine and print
// where they part company. Not a check - a probe. PROBE picks the routine.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'vitest';

import { Machine } from './machine';
import { call } from './dispatch';
import { DECOMPILED, bind } from './decompiled';

// Opt-in: `PROBE=0xea7a npx vitest run src/rom/one-decomp.test.ts`. Without it
// there is nothing to look at, so the suite skips it.
const PROBE = Number(process.env.PROBE ?? 0);

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

const REGS = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
  'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'];

describe('probe', () => {
  it.skipIf(!PROBE)('runs one routine both ways', () => {
    const found = DECOMPILED.find((d) => d.at === PROBE);
    if (!found) throw new Error(`0x${PROBE.toString(16)} is not emitted - it bails at lift`);
    const { fn, params } = found;
    const out: string[] = [];
    for (let trial = 0; trial < 4; trial += 1) {
      const seed = (0x1234567 + trial * 7919 + PROBE) >>> 0;
      const args = params.map((_, i) => valueFor(i, seed));
      const regParams: Array<[string, number]> = [];
      const a = fresh(seed);
      const stack = params.map((p, i) => ({ p, v: args[i] })).filter((x) => x.p.from === 'stack');
      const sp = STACK - 0x40;
      a.a7 = sp;
      a.store(sp, SENTINEL, 32);
      for (const { p, v } of stack) a.store(sp + (p as { off: number }).off, v, 32);
      a.store(SENTINEL, 0x4e75, 16);
      params.forEach((p, i) => {
        if (p.from !== 'reg') return;
        (a as never as Record<string, number>)[p.name] = args[i];
        regParams.push([p.name, args[i]]);
      });
      let oracleFailed = '';
      try { call(PROBE, a); } catch (e) { oracleFailed = (e as Error).message.slice(0, 60); }
      const b = fresh(seed);
      b.a7 = sp;
      b.store(sp, SENTINEL, 32);
      for (const { p, v } of stack) b.store(sp + (p as { off: number }).off, v, 32);
      b.store(SENTINEL, 0x4e75, 16);
      for (const [name, v] of regParams) (b as never as Record<string, number>)[name] = v;
      bind(b);
      let liftedFailed = '';
      try { fn(...args); } catch (e) { liftedFailed = (e as Error).message.slice(0, 60); }
      const ra = a as never as Record<string, number>;
      const rb = b as never as Record<string, number>;
      const diff = REGS.filter((r) => (ra[r] >>> 0) !== (rb[r] >>> 0))
        .map((r) => `${r} ${ra[r] >>> 0}!=${rb[r] >>> 0}`);
      const mem: string[] = [];
      for (let addr = 0x3e0000; addr < 0x3e8000; addr += 1) {
        if (a.byte(addr) !== b.byte(addr)) mem.push(`${addr.toString(16)}:${a.byte(addr)}/${b.byte(addr)}`);
        if (mem.length > 12) break;
      }
      out.push(`  params ${JSON.stringify(params)}`);
      out.push(`  args ${args.map((v) => v.toString(16)).join(' ')}`
        + ` | stack@sp+4 ${a.load(sp + 4, 32).toString(16)} @sp+8 ${a.load(sp + 8, 32).toString(16)}`);
      out.push(`  memory ${mem.join(' ') || 'equal'}`);
      out.push(`trial ${trial}: machine[${oracleFailed || 'ok'}] lifted[${liftedFailed || 'ok'}]`
        + ` a7 ${a.a7.toString(16)}/${b.a7.toString(16)} :: ${diff.join(' ') || 'regs equal'}`);
    }
    writeFileSync(join(here, 'probe.txt'), out.join('\n'));
  }, 120000);
});
