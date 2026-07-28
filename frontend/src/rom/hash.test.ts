// A fingerprint of what the decompiled run leaves in memory, so an edit to the
// source can be shown to change the game rather than assumed to.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { System, SCREEN_W, SCREEN_H } from './system';
import { png } from './png';
import { call as viaDecompiled, bind } from './decompiled';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));
const FRAMES = Number(process.env.HASH_FRAMES ?? 1200);
const SHOT = Number(process.env.SHOT_AT ?? 500);

describe('fingerprint', () => {
  it('of the decompiled run', () => {
    const sys = new System(rom, board);
    bind(sys.m);
    const STOP = new Error('enough');
    let n = 0;
    const marks: string[] = [];
    try {
      // Attract, then a coin, then the join button - 0 means held. Without
      // this the run never leaves the attract loop and no gameplay rule is
      // ever consulted.
      sys.run(() => {
        n += 1;
        sys.inputs[3] = n > 500 && n < 515 ? 0xfe : 0xff;
        sys.inputs[0] = n > 540 && n < 555 ? 0xf6 : 0xf7;
        if (n % 100 === 0) {
          let h = 0x811c9dc5;
          let px = 0;
          for (let a = 0x3e0000; a < 0x400000; a += 1) {
            h = Math.imul(h ^ sys.m.byte(a), 0x01000193) >>> 0;
          }
          for (let i = 0; i < 0x20000; i += 1) {
            const v = sys.m.byte(0x200000 + i);
            if (v) px += 1;
            h = Math.imul(h ^ v, 0x01000193) >>> 0;
          }
          marks.push(`f${n} ${h.toString(16)} px=${px}`);
          if (n === SHOT) {
            writeFileSync(join(here, process.env.SHOT_NAME ?? 'shot.png'),
              png(SCREEN_W, SCREEN_H, sys.screen()));
          }
        }
        if (n >= FRAMES) throw STOP;
      }, viaDecompiled);
    } catch (e) { if (e !== STOP) throw e; }
    writeFileSync(join(here, 'hash.txt'), marks.join('\n'));
    expect(n).toBeGreaterThan(0);
  }, 900000);
});
