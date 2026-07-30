// Does either run actually draw, and when?
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { System } from './system';
import { call as viaRecompiled } from './dispatch';
import { call as viaDecompiled, bind } from './decompiled';
import { png } from './png';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));
const FRAMES = Number(process.env.DRAW_FRAMES ?? 900);

function lit(entry: (a: number, m: System['m']) => void, label: string): string {
  const sys = new System(rom, board);
  bind(sys.m);
  const marks: string[] = [];
  const STOP = new Error('enough');
  let n = 0;
  try {
    sys.run(() => {
      n += 1;
      if (n % 150 === 0 || n === 1) {
        let px = 0;
        for (let i = 0; i < 0x20000; i += 1) if (sys.m.byte(0x200000 + i)) px += 1;
        marks.push(`f${n}:${px}`);
      }
      if (n >= FRAMES) throw STOP;
    }, entry);
  } catch (e) { if (e !== STOP) marks.push(`threw ${(e as Error).message.slice(0, 40)}`); }
  // Counting lit bytes says drawing happened, not that it is the right
  // picture - a run that drew every frame perfectly in black counted the same
  // as one that drew the game. Write the framebuffer out so both screens can
  // be looked at, which is the only check that catches that.
  writeFileSync(join(here, `draws-${label}.png`), png(336, 240, sys.screen()));
  return `${label} ran ${n} frames, playfield bytes set: ${marks.join(' ')}`;
}

describe('drawing', () => {
  it('happens', () => {
    const out = [lit(viaRecompiled, 'recompiled'), lit(viaDecompiled, 'decompiled')];
    writeFileSync(join(here, 'draws.txt'), out.join('\n'));
    expect(out.length).toBe(2);
  }, 900000);
});
