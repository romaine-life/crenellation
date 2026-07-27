// Differential test: every routine, run from randomised state on the real
// 68000 and again here, with every output compared.
//
// The inputs are not shipped in the fixture - they are regenerated from the
// same xorshift32 sequence the capture used, so the two sides are guaranteed
// to see byte-identical starting state. That also means the case order matters
// and must not be changed without re-capturing.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Machine } from './machine';
import { call } from './dispatch';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
// Work RAM as it stood when the capture began. Both sides must start from
// this, or a routine reading outside the randomised window compares the
// running game against zeroes.
const ramBaseline = new Uint8Array(readFileSync(join(here, 'ram-baseline.bin')));
const RAM_LO = 0x3e0000;
// The playfield bitmap is ordinary memory on the board, and routines read it.
// Without it, every drawing routine compared real pixels against zeroes.
const pfBaseline = new Uint8Array(readFileSync(join(here, 'pf-baseline.bin')));
const PF_LO = 0x200000;
// what the devices held while the machine was frozen: the palette, the sound
// chips, the input ports, and the two regions the read probe found
const ioBaseline = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));
const IO_BLOCKS: Array<[number, number]> = [
  [0x3c0000, 0x1000], [0x460000, 0x1000], [0x480000, 0x1000], [0x640000, 0x1000],
  [0x140000, 0x40000], [0x500000, 0x20000],
];
const fuzz = JSON.parse(readFileSync(join(here, 'fuzz.json'), 'utf8')) as {
  cases: Array<{
    entry: number;
    trial: number;
    din: number[];
    ain: number[];
    out: number[];
    hash: string;
  }>;
  noreturn: Record<string, number[]>;
};
const entries: number[] = readFileSync(join(here, 'entries.txt'), 'utf8')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => parseInt(s, 16));

const STRUCTS = [
  0x3e0864, 0x3e1968, 0x3e1cf6, 0x3e1bc6, 0x3e0f48, 0x3e02d8, 0x3e4000,
];
const SCRATCH = 0x3e4000;
const SCRATCH_LEN = 0x400;
const STACK = 0x3e5000;
const SENTINEL = 0x3e6000;
const TRIALS = 3;

/** The capture's generator, bit for bit. */
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

function scratchHash(m: Machine): string {
  let h1 = 0;
  let h2 = 0;
  // only the window the routines were pointed at: the game keeps running
  // between cases on the hardware side and mutates the rest of work RAM
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

describe('every routine against the real 68000', () => {
  it('reproduces the captured outputs', () => {
    const rand = new Rand();
    const byKey = new Map<string, (typeof fuzz.cases)[number]>();
    for (const c of fuzz.cases) byKey.set(`${c.entry}:${c.trial}`, c);

    let compared = 0;
    let matched = 0;
    const bad = new Map<number, number>();
    const examples: string[] = [];

    for (const entry of entries) {
      for (let trial = 0; trial < TRIALS; trial += 1) {
        // consume the generator in the capture's order whether or not this
        // case produced output, so later cases stay aligned
        const m = new Machine(rom);
        for (let i = 0; i < ramBaseline.length; i += 1) m.setByte(RAM_LO + i, ramBaseline[i]);
    for (let i = 0; i < pfBaseline.length; i += 1) m.setByte(PF_LO + i, pfBaseline[i]);
    let io = 0;
    for (const [base, len] of IO_BLOCKS) {
      for (let i = 0; i < len; i += 1) m.setByte(base + i, ioBaseline[io + i]);
      io += len;
    }
    m.ioModelled = true;
        for (let i = 0; i < SCRATCH_LEN; i += 1) m.setByte(SCRATCH + i, rand.next() % 256);
        const d: number[] = [];
        // trial 0 is noise; later trials hand the routine the structures the
        // game really passes and indices small enough to be in range, which is
        // the difference between a routine returning and wandering off
        // Several argument shapes: a routine that never returns yields nothing
        // to compare, and verification needs identical inputs on both sides,
        // not plausible ones. Same number of draws in every shape.
        for (let k = 0; k < 8; k += 1) {
          const r = rand.next();
          d.push(trial === 0 ? r % 0x10000 : trial === 1 ? r % 32
            : trial === 2 ? r % 256 : trial === 3 ? 0 : trial === 4 ? 1
            : trial === 5 ? r % 8 : trial === 6 ? 0xffff : r % 4);
        }
        const a: number[] = [];
        for (let k = 0; k < 6; k += 1) {
          const r = rand.next();
          a.push(trial === 0 ? SCRATCH + (r % (SCRATCH_LEN - 0x80))
            : trial === 3 || trial === 6 ? SCRATCH + 0x40 * k
            : trial === 4 ? STRUCTS[0]
            : trial === 7 ? STRUCTS[k % STRUCTS.length]
            : STRUCTS[r % STRUCTS.length]);
        }
        let sp = STACK;
        for (let k = 1; k <= 4; k += 1) {
          sp -= 4;
          const v =
            k % 2 === 0 ? rand.next() % 0x100 : SCRATCH + (rand.next() % (SCRATCH_LEN - 0x80));
          m.store(sp, v, 32);
        }
        sp -= 4;
        m.store(sp, SENTINEL, 32);

        const c = byKey.get(`${entry}:${trial}`);
        if (!c) continue; // the hardware did not return; nothing to compare

        m.d0 = d[0]; m.d1 = d[1]; m.d2 = d[2]; m.d3 = d[3];
        m.d4 = d[4]; m.d5 = d[5]; m.d6 = d[6]; m.d7 = d[7];
        m.a0 = a[0]; m.a1 = a[1]; m.a2 = a[2];
        m.a3 = a[3]; m.a4 = a[4]; m.a5 = a[5];
        m.a7 = sp;
        m.a6 = STACK + 0x200;
        m.sr = 0x2700;
        m.stubMissing = true;

        compared += 1;
        let ok = false;
        try {
          call(entry, m);
          const got = [m.d0, m.d1, m.d2, m.d3, m.d4, m.d5, m.d6, m.d7,
                       m.a0, m.a1, m.a2, m.a3].map((v) => v >>> 0);
          const wantRegs = c.out.map((v) => v >>> 0);
          ok =
            got.every((v, i) => v === wantRegs[i]) && scratchHash(m) === c.hash;
        } catch {
          ok = false;
        }
        if (ok) {
          matched += 1;
        } else {
          bad.set(entry, (bad.get(entry) ?? 0) + 1);
          if (examples.length < 8) examples.push(`0x${entry.toString(16)} trial ${trial}`);
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `differential: ${matched}/${compared} cases match across ` +
        `${new Set(fuzz.cases.map((c) => c.entry)).size} routines; ` +
        `${bad.size} routines with any mismatch`,
    );
    if (examples.length) console.log('first mismatches:', examples.join(', '));
    const okSet = new Set<number>();
    for (const c of fuzz.cases) if (!bad.has(c.entry)) okSet.add(c.entry);
    console.log('routines fully matching:', okSet.size);
    console.log('failing entries:', [...bad.keys()].slice(0, 40)
      .map((e) => '0x' + e.toString(16)).join(' '));

    // write the per-routine outcome so the failures can be analysed by which
    // instructions they use
    const okSet2 = new Set<number>();
    for (const c of fuzz.cases) if (!bad.has(c.entry)) okSet2.add(c.entry);
    writeFileSync(
      join(here, 'fuzz-result.json'),
      JSON.stringify({ pass: [...okSet2], fail: [...bad.keys()] }),
    );

    expect(compared).toBeGreaterThan(600);
    expect(matched).toBe(compared);
  });
});
