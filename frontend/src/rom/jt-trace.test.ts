// Trace the table read behind a computed jump that lands on its own base.
//
// Six routines fail by jumping to the base of a jump table, which means the
// offset they read came out as zero. Every entry in those tables is non-zero,
// so either the read address is wrong or the index is. Logging the reads in
// the table's neighbourhood says which, without guessing.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'vitest';

import { Machine } from './machine';
import { call } from './dispatch';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const baseline = new Uint8Array(readFileSync(join(here, 'replay-baseline.bin')));
const pfBaseline = new Uint8Array(readFileSync(join(here, 'replay-pf-baseline.bin')));
const cases = JSON.parse(readFileSync(join(here, 'replay.json'), 'utf8')) as Array<{
  entry: number; din: number[]; ain: number[]; stk: number[]; out: number[]; hash: string;
}>;

const RAM_LO = 0x3e0000;
const PF_LO = 0x200000;
const STACK = 0x3e5000;
const SENTINEL = 0x3e6000;

// entry to trace, and the window of ROM addresses whose reads matter
const TARGETS: Array<[number, number, number]> = [
  [0xcfda, 0xd000, 0xd040],
  [0x272e, 0x2750, 0x2790],
  [0x74fa, 0x7510, 0x7560],
];

describe('computed jump landing on its table base', () => {
  const out: string[] = [];
  it('logs the table reads', () => {
    for (const [entry, lo, hi] of TARGETS) {
      const c = cases.find((x) => x.entry === entry);
      if (!c) { console.log(`${entry.toString(16)}: no replay case`); continue; }
      const m = new Machine(rom);
      for (let i = 0; i < baseline.length; i += 1) m.setByte(RAM_LO + i, baseline[i]);
      for (let i = 0; i < pfBaseline.length; i += 1) m.setByte(PF_LO + i, pfBaseline[i]);
      m.store(SENTINEL, 0x60fe, 16);
      let sp = STACK;
      for (let k = 7; k >= 0; k -= 1) { sp -= 4; m.store(sp, c.stk[k] ?? 0, 32); }
      sp -= 4;
      m.store(sp, SENTINEL, 32);
      for (let k = 0; k < 8; k += 1) (m as never as Record<string, number>)[`d${k}`] = c.din[k];
      for (let k = 0; k < 6; k += 1) (m as never as Record<string, number>)[`a${k}`] = c.ain[k];
      m.a7 = sp;
      m.a6 = STACK + 0x200;
      m.sr = 0x2700;
      m.stubMissing = true;

      const log: string[] = [];
      const origLoad = m.load.bind(m);
      (m as never as Record<string, unknown>).load = (addr: number, bits: number) => {
        const v = origLoad(addr, bits);
        if (addr >= lo && addr < hi && log.length < 12) {
          log.push(`load ${addr.toString(16)}.${bits} = ${v.toString(16)}`);
        }
        return v;
      };
      let err = '';
      try { call(entry, m); } catch (e) { err = (e as Error).message.slice(0, 50); }
      out.push(`${entry.toString(16)}: ${log.join(' | ') || '(no reads in window)'}  ${err}`);
    }
    writeFileSync(join(here, 'jt-trace.txt'), out.join('\n'));
  }, 120000);
});
