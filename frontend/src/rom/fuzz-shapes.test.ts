// Differential test for the one-shape-per-run captures.
//
// The main fuzz capture drives each routine with three argument shapes in one
// pass. More shapes reach more routines - a routine that wanders off on random
// values may return cleanly on small ones - but running them all in one pass
// loses everything after whichever shape kills the emulator. Each shape gets
// its own run instead, so each is its own stream with its own draw sequence,
// and the generator is reset between them.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Machine } from './machine';
import { call } from './dispatch';

const here = dirname(fileURLToPath(import.meta.url));
const floor: number = (JSON.parse(
  readFileSync(join(here, 'baseline.json'), 'utf8')) as Record<string, number>)['fuzz-shapes'] ?? 0;
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const ramBaseline = new Uint8Array(readFileSync(join(here, 'ram-baseline.bin')));
const pfBaseline = new Uint8Array(readFileSync(join(here, 'pf-baseline.bin')));
const fixture = JSON.parse(readFileSync(join(here, 'fuzz-shapes.json'), 'utf8')) as {
  streams: Array<{ shape: number; cases: Array<{ entry: number; out: number[]; hash: string }> }>;
};
const entries: number[] = readFileSync(join(here, 'entries.txt'), 'utf8')
  .split('\n').map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 16));

const RAM_LO = 0x3e0000;
const PF_LO = 0x200000;
// what the devices held while the machine was frozen: the palette, the sound
// chips, the input ports, and the two regions the read probe found
const ioBaseline = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));
const IO_BLOCKS: Array<[number, number]> = [
  [0x3c0000, 0x1000], [0x460000, 0x1000], [0x480000, 0x1000], [0x640000, 0x1000],
  [0x140000, 0x40000], [0x500000, 0x20000],
];
const STRUCTS = [0x3e0864, 0x3e1968, 0x3e1cf6, 0x3e1bc6, 0x3e0f48, 0x3e02d8, 0x3e4000];
const SCRATCH = 0x3e4000;
const SCRATCH_LEN = 0x400;
const STACK = 0x3e5000;
const SENTINEL = 0x3e6000;

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
  for (let i = 0; i < 0x2000; i += 1) {
    const b = m.byte(0x3e4000 + i);
    h1 = (h1 * 31 + b) >>> 0;
    h2 = (h2 ^ (b + i)) >>> 0;
  }
  return h1.toString(16).toUpperCase().padStart(8, '0')
    + h2.toString(16).toUpperCase().padStart(8, '0');
}

describe('routines under one argument shape per run', () => {
  it('reproduces the captured outputs', () => {
    let compared = 0;
    let matched = 0;
    const pass = new Set<number>();
    const causes = new Map<number, string>();
    const fail = new Set<number>();

    for (const stream of fixture.streams) {
      const sh = stream.shape;
      const byEntry = new Map<number, (typeof stream.cases)[number]>();
      for (const c of stream.cases) byEntry.set(c.entry, c);
      const rand = new Rand();   // each run started the generator afresh

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
        for (let i = 0; i < SCRATCH_LEN; i += 1) m.setByte(SCRATCH + i, rand.next() % 256);

        const d: number[] = [];
        for (let k = 0; k < 8; k += 1) {
          const r = rand.next();
          d.push(sh === 0 ? r % 0x10000 : sh === 1 ? r % 32 : sh === 2 ? r % 256
            : sh === 3 ? 0 : sh === 4 ? 1 : sh === 5 ? r % 8 : sh === 6 ? 0xffff : r % 4);
        }
        const a: number[] = [];
        for (let k = 0; k < 6; k += 1) {
          const r = rand.next();
          a.push(sh === 0 ? SCRATCH + (r % (SCRATCH_LEN - 0x80))
            : sh === 3 || sh === 6 ? SCRATCH + 0x40 * k
            : sh === 4 ? STRUCTS[0]
            : sh === 7 ? STRUCTS[k % STRUCTS.length]
            : STRUCTS[r % STRUCTS.length]);
        }
        let sp = STACK;
        for (let k = 1; k <= 4; k += 1) {
          sp -= 4;
          const r = rand.next();
          // shape 8 puts structures on the stack as well. A routine handed a
          // random number where it wants a structure pointer never returns,
          // and the case is lost rather than compared.
          const v = sh === 8 ? STRUCTS[r % STRUCTS.length]
            : k % 2 === 0 ? r % 0x100
            : SCRATCH + (r % (SCRATCH_LEN - 0x80));
          m.store(sp, v, 32);
        }
        sp -= 4;
        m.store(sp, SENTINEL, 32);

        const c = byEntry.get(entry);
        if (!c) continue;   // the hardware did not return; nothing to compare

        for (let k = 0; k < 8; k += 1) (m as never as Record<string, number>)[`d${k}`] = d[k];
        for (let k = 0; k < 6; k += 1) (m as never as Record<string, number>)[`a${k}`] = a[k];
        m.a7 = sp;
        m.a6 = STACK + 0x200;
        m.sr = 0x2700;
        m.stubMissing = true;

        compared += 1;
        m.trackOffMap = true;
        let ok = false;
        let why = '';
        try {
          call(entry, m);
          m.trackOffMap = false;
          const got = [m.d0, m.d1, m.d2, m.d3, m.d4, m.d5, m.d6, m.d7,
                       m.a0, m.a1, m.a2, m.a3].map((v) => v >>> 0);
          const bad = got.map((v, i) => v !== (c.out[i] >>> 0)).filter(Boolean).length;
          const memBad = scratchHash(m) !== c.hash;
          ok = !bad && !memBad;
          if (!ok) {
            why = m.offMap
              ? `reads ${m.offMapAt.map((x) => '0x' + x.toString(16)).join(' ')} (not modelled)`
              : bad && memBad ? 'registers and memory' : bad ? 'registers' : 'memory';
          }
        } catch (e) {
          m.trackOffMap = false;
          why = m.offMap ? 'off-map then threw' : `threw: ${(e as Error).message.slice(0, 48)}`;
        }
        m.trackOffMap = false;
        if (ok) { matched += 1; pass.add(entry); }
        else { fail.add(entry); if (!causes.has(entry)) causes.set(entry, `shape ${sh}: ${why}`); }
      }
    }

    // eslint-disable-next-line no-console
    console.log(`shapes: ${matched}/${compared} cases match across ${fixture.streams.length} `
      + `streams; ${pass.size} routines pass, ${fail.size} fail`);
    writeFileSync(join(here, 'fuzz-shapes-result.json'),
      JSON.stringify({ pass: [...pass], fail: [...fail],
        causes: [...causes.entries()].map(([e, w]) => ({ entry: '0x' + e.toString(16), why: w })) }));

    expect(compared).toBeGreaterThan(1000);
    // Not "perfect" - this harness has never been perfect and saying so
    // every run makes the suite permanently red, which is how a test that
    // had stopped compiling went unread for several rounds. The bar is that
    // it does not get worse: the floor is committed in baseline.json and
    // raised deliberately when something improves.
    expect(matched).toBeGreaterThanOrEqual(floor);
  }, 900000);
});
