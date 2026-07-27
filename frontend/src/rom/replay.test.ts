// Differential test driven by the arguments the game itself passed.
//
// The random-input test leaves 203 routines never returning, because garbage
// pointers make them loop or wander. These cases were recorded as the running
// game called each routine, so the structures behind the pointers are real and
// the paths taken are the ones the game actually uses.
//
// Inputs come straight from the fixture rather than a shared random sequence,
// so there is nothing to keep in step between the two sides.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Machine } from './machine';
import { call } from './dispatch';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const baseline = new Uint8Array(readFileSync(join(here, 'replay-baseline.bin')));
// The playfield bitmap is ordinary memory on the board; routines read it back.
const pfBaseline = new Uint8Array(readFileSync(join(here, 'replay-pf-baseline.bin')));
const PF_LO = 0x200000;
// what the devices held while the machine was frozen: the palette, the sound
// chips, the input ports, and the two regions the read probe found
const ioBaseline = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));
const IO_BLOCKS: Array<[number, number]> = [
  [0x3c0000, 0x1000], [0x460000, 0x1000], [0x480000, 0x1000], [0x640000, 0x1000],
  [0x140000, 0x40000], [0x500000, 0x20000],
];
const cases = JSON.parse(readFileSync(join(here, 'replay.json'), 'utf8')) as Array<{
  entry: number;
  din: number[];
  ain: number[];
  stk: number[];
  out: number[];
  hash: string;
}>;

const RAM_LO = 0x3e0000;
const STACK = 0x3e5000;
const SENTINEL = 0x3e6000;

function digest(m: Machine): string {
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < 0x2000; i += 1) {
    const b = m.byte(0x3e4000 + i);
    h1 = (h1 * 31 + b) >>> 0;
    h2 = (h2 ^ (b + i)) >>> 0;
  }
  return (
    h1.toString(16).toUpperCase().padStart(8, '0') +
    h2.toString(16).toUpperCase().padStart(8, '0')
  );
}

describe('routines replayed with the arguments the game passed', () => {
  it('reproduces the captured outputs', () => {
    let matched = 0;
    const bad = new Map<number, number>();

    for (const c of cases) {
      const m = new Machine(rom);
      for (let i = 0; i < baseline.length; i += 1) m.setByte(RAM_LO + i, baseline[i]);
    for (let i = 0; i < pfBaseline.length; i += 1) m.setByte(PF_LO + i, pfBaseline[i]);
    let io = 0;
    for (const [base, len] of IO_BLOCKS) {
      for (let i = 0; i < len; i += 1) m.setByte(base + i, ioBaseline[io + i]);
      io += len;
    }
    m.ioModelled = true;
      m.store(SENTINEL, 0x60fe, 16);

      let sp = STACK;
      for (let k = 7; k >= 0; k -= 1) {
        sp -= 4;
        m.store(sp, c.stk[k] ?? 0, 32);
      }
      sp -= 4;
      m.store(sp, SENTINEL, 32);

      m.d0 = c.din[0]; m.d1 = c.din[1]; m.d2 = c.din[2]; m.d3 = c.din[3];
      m.d4 = c.din[4]; m.d5 = c.din[5]; m.d6 = c.din[6]; m.d7 = c.din[7];
      m.a0 = c.ain[0]; m.a1 = c.ain[1]; m.a2 = c.ain[2];
      m.a3 = c.ain[3]; m.a4 = c.ain[4]; m.a5 = c.ain[5];
      m.a7 = sp;
      m.a6 = STACK + 0x200;
      m.sr = 0x2700;
      m.stubMissing = true;
      m.budget = 4_000_000;

      let ok = false;
      try {
        call(c.entry, m);
        const got = [m.d0, m.d1, m.d2, m.d3, m.d4, m.d5, m.d6, m.d7,
                     m.a0, m.a1, m.a2, m.a3].map((v) => v >>> 0);
        ok = got.every((v, i) => v === (c.out[i] >>> 0)) && digest(m) === c.hash;
      } catch {
        ok = false;
      }
      if (ok) matched += 1;
      else bad.set(c.entry, (bad.get(c.entry) ?? 0) + 1);
    }

    const routines = new Set(cases.map((c) => c.entry));
    const passing = [...routines].filter((e) => !bad.has(e));
    // eslint-disable-next-line no-console
    console.log(
      `replay: ${matched}/${cases.length} cases match; ` +
        `${passing.length}/${routines.size} routines fully correct`,
    );
    writeFileSync(
      join(here, 'replay-result.json'),
      JSON.stringify({ pass: passing, fail: [...bad.keys()] }),
    );

    expect(cases.length).toBeGreaterThan(500);
    expect(matched).toBe(cases.length);
  });
});
