// The generated routines have to produce the ROM's numbers, not merely compile.
//
// These run the emitted TypeScript against captures taken from the real 68000
// under emulation: the same inputs go in, and every output byte must match.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Machine } from './machine';
import { call, ROUTINE_COUNT } from './dispatch';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const fixtures = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8')) as {
  rng: number[][];
  cell: number[][];
  dist: number[][];
  screen: number[][];
  dir: number[][];
  rot: number[][];
  score: number[][];
};

const SEED = 0x3e0842;
const STACK = 0x3e2000;

/** Set a machine up the way the emulator harness did: arguments on the stack. */
function withArgs(args: number[]): Machine {
  const m = new Machine(rom);
  let sp = STACK;
  for (let i = args.length - 1; i >= 0; i -= 1) {
    sp -= 4;
    m.store(sp, args[i], 32);
  }
  sp -= 4;
  m.store(sp, 0, 32); // return address slot, unused by the ported form
  m.a7 = sp;
  return m;
}

describe('generated ROM routines', () => {
  it('emits every routine in the overlay', () => {
    // The map grew as executable code kept turning up that had been filed as
    // data: trampolines below the first routine, jump-table cases, pointer
    // targets. 593 was the count before any of that was found, 754 before the
    // game was run far enough to jump into the rest. The last 17 came from
    // running it: each is an address the dispatcher had no routine for when
    // the game jumped there, fed back through out/runtime-entries.json. One
    // of them, 0x140010, is not in the program ROM at all - it is in the
    // board ROM at 0x140000.
    expect(ROUTINE_COUNT).toBe(771);
  });

  it('reproduces the random number generator for all 96 captured cases', () => {
    let matched = 0;
    const failures: string[] = [];
    for (const [seed, n, ret, newseed] of fixtures.rng) {
      const m = withArgs([n >>> 0]);
      m.store(SEED, seed, 16);
      call(0x11e58, m);
      const gotRet = m.d0 >>> 0;
      const gotSeed = m.load(SEED, 16);
      if ((gotRet & 0xffff) === (ret & 0xffff) && gotSeed === newseed) {
        matched += 1;
      } else if (failures.length < 4) {
        failures.push(
          `seed ${seed.toString(16)} n ${n}: rom ret ${ret.toString(16)} seed ` +
            `${newseed.toString(16)}, port ret ${gotRet.toString(16)} seed ` +
            `${gotSeed.toString(16)}`,
        );
      }
    }
    expect(failures).toEqual([]);
    expect(matched).toBe(fixtures.rng.length);
  });

  it('reproduces the cell address routine', () => {
    for (const [x, y, want] of fixtures.cell) {
      const m = new Machine(rom);
      let sp = STACK - 4;
      m.store(sp, ((x & 0xff) << 24) | ((y & 0xff) << 16), 32);
      sp -= 4;
      m.store(sp, 0, 32);
      m.a7 = sp;
      call(0x11bd8, m);
      expect(m.d0 >>> 0).toBe(want >>> 0);
    }
  });

  it('reproduces the screen address routine', () => {
    for (const [x, y, want] of fixtures.screen) {
      const m = new Machine(rom);
      let sp = STACK - 4;
      m.store(sp, ((x & 0xff) << 24) | ((y & 0xff) << 16), 32);
      sp -= 4;
      m.store(sp, 0, 32);
      m.a7 = sp;
      call(0x11bec, m);
      expect(m.d0 >>> 0).toBe(want >>> 0);
    }
  });

  it('reproduces the distance approximation, including the overflow cases', () => {
    for (const [a, b, want] of fixtures.dist) {
      const m = withArgs([a >>> 0, b >>> 0]);
      call(0x11d5c, m);
      expect(m.d0 & 0xffff).toBe(want & 0xffff);
    }
  });

  it('reproduces the eight-way aiming direction', () => {
    for (const [a, b, want] of fixtures.dir) {
      const m = withArgs([a >>> 0, b >>> 0]);
      call(0x11cf8, m);
      expect(m.d0 & 0xffff).toBe(want & 0xffff);
    }
  });

  it('reproduces piece rotation across every slot in the table', () => {
    const SLOT = 0x3e2600;
    for (const [start, wantSlot, wantRet] of fixtures.rot) {
      const m = new Machine(rom);
      m.store(SLOT, start, 32);
      let sp = STACK - 4;
      m.store(sp, SLOT, 32);
      sp -= 4;
      m.store(sp, 0, 32);
      m.a7 = sp;
      call(0x5afc, m);
      expect(m.load(SLOT, 32) >>> 0).toBe(wantSlot >>> 0);
      expect(m.d0 & 0xff).toBe(wantRet & 0xff);
    }
  });

  it('reproduces territory scoring at every threshold', () => {
    // Scoring writes the score and then calls the "+N" popup, which is display
    // code expecting hardware state. The award is already stored by then, so
    // the popup is stubbed and asserted to be the only thing stubbed.
    const PLAYER = 0x3e2400;
    for (const [cells, wantScore] of fixtures.score) {
      const m = new Machine(rom);
      m.stubMissing = true;
      m.store(PLAYER + 0x58, cells, 16);
      m.store(PLAYER + 0x56, 1000, 16);
      let sp = STACK - 4;
      m.store(sp, PLAYER, 32);
      sp -= 4;
      m.store(sp, 0, 32);
      m.a7 = sp;
      call(0x865e, m);
      expect(m.load(PLAYER + 0x56, 16)).toBe(wantScore);
      // Everything stubbed must be outside the overlay - a call through an
      // uninitialised pointer, not a routine that failed to get ported.
      for (const addr of m.missingCalls) expect(addr).toBeGreaterThanOrEqual(0x20000);
    }
  });
});
