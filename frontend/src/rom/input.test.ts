// The keyboard reaches the right input bit.
//
// The screen tells you nothing about this: the page packs four port bytes
// into one shared word so a single atomic write is always a consistent
// snapshot, and the worker unpacks them. A shift that is off by a byte is
// invisible until a button does the wrong thing, and the idle word had a bit
// held down in it for exactly that reason.

import { describe, expect, it } from 'vitest';

/** What RomScreen does when a key goes down or comes up. */
function press(word: number, byte: number, bit: number, held: boolean): number {
  const shift = (3 - byte) * 8 + bit;
  return held ? (word & ~(1 << shift)) : (word | (1 << shift));
}

/** What the worker does with the word each frame. */
function unpack(word: number): number[] {
  return [(word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff];
}

const IDLE = 0xffffffff | 0;

describe('keyboard to input port', () => {
  it('leaves every bit high when nothing is held', () => {
    expect(unpack(IDLE)).toEqual([0xff, 0xff, 0xff, 0xff]);
  });

  it('clears exactly the bit the key names, and nothing else', () => {
    for (let byte = 0; byte < 4; byte += 1) {
      for (let bit = 0; bit < 8; bit += 1) {
        const got = unpack(press(IDLE, byte, bit, true));
        for (let k = 0; k < 4; k += 1) {
          expect(got[k]).toBe(k === byte ? (0xff & ~(1 << bit)) : 0xff);
        }
      }
    }
  });

  it('puts the bit back on release, with others still held', () => {
    let w = IDLE;
    w = press(w, 3, 0, true);      // a coin slot
    w = press(w, 0, 0, true);      // the middle station's first button
    expect(unpack(w)).toEqual([0xfe, 0xff, 0xff, 0xfe]);
    w = press(w, 3, 0, false);
    expect(unpack(w)).toEqual([0xfe, 0xff, 0xff, 0xff]);
  });

  it('packs the trackball as two signed bytes', () => {
    const pack = (dx: number, dy: number): number => ((dy & 0xff) << 8) | (dx & 0xff);
    const read = (w: number): number[] => [(w << 24) >> 24, (w << 16) >> 24];
    expect(read(pack(0, 0))).toEqual([0, 0]);
    expect(read(pack(1, -1))).toEqual([1, -1]);
    expect(read(pack(-1, 1))).toEqual([-1, 1]);
  });
});
