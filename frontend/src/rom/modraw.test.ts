// Draw the sprite layer and look at it.
//
// Everything about the motion objects has been measured but nothing has ever
// been painted, so this renders a frame with sprites over the playfield and
// writes both pictures out. Looking is the test: a bar across the bottom that
// matches what MAME draws means the list, the tile format and the size reading
// are all right together, and a mess means one of them is not.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { System } from './system';
import { call as viaDecompiled, bind, original } from './decompiled';
import { sprites, drawSprites } from './mo';
import { png } from './png';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const io = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));
const mo = new Uint8Array(readFileSync(join(here, 'mo.bin')));

const W = 336, H = 240;
const FRAMES = Number(process.env.MO_FRAMES ?? 600);

describe('the sprite layer', () => {
  it('paints something and says what', () => {
    original();
    const sys = new System(rom, io);
    bind(sys.m);
    const STOP = new Error('enough');
    let n = 0;
    try {
      sys.run(() => { n += 1; if (n >= FRAMES) throw STOP; }, viaDecompiled);
    } catch (e) { if (e !== STOP) throw e; }

    const list = sprites(sys.m);
    const pal = sys.palette();
    const plain = sys.screen();
    writeFileSync(join(here, 'mo-playfield.png'), png(W, H, plain));

    const withMo = Uint32Array.from(plain);
    const painted = drawSprites(withMo, mo, pal, list, W, H,
                                Number(process.env.MO_BANK ?? 0));
    writeFileSync(join(here, 'mo-composited.png'), png(W, H, withMo));

    const note = [
      `frame ${n}, ${list.length} sprites, ${painted} pixels painted`,
      ...list.map((s) => `  slot ${s.slot.toString(16).padStart(2, '0')}`
        + `  code ${s.code.toString(16).padStart(3, '0')}`
        + `  at ${s.x},${s.y}  ${s.w}x${s.h} tiles`
        + `  = ${s.w * 8}x${s.h * 8} px`),
    ].join('\n');
    writeFileSync(join(here, 'mo-draw.txt'), note + '\n');
    expect(list.length).toBeGreaterThan(0);
  }, 900000);
});
