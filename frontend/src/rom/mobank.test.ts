// Which sixteen palette entries do sprite pixels land in?
//
// The renderer painted with bank 0 because nothing said otherwise, and a diff
// against MAME says every one of those 2,688 pixels came out black - 0 of
// 2,688 matching. So the bank is wrong. There are only sixteen candidates at
// this stride; score each against the real machine instead of picking one.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { System } from './system';
import { call as viaDecompiled, bind, original } from './decompiled';
import { sprites, drawSprites } from './mo';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const io = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));
const mo = new Uint8Array(readFileSync(join(here, 'mo.bin')));
const W = 336, H = 240;

describe('the sprite palette bank', () => {
  it('reports what each candidate paints', () => {
    original();
    const sys = new System(rom, io);
    bind(sys.m);
    const STOP = new Error('enough');
    let n = 0;
    try {
      sys.run(() => { n += 1; if (n >= 640) throw STOP; }, viaDecompiled);
    } catch (e) { if (e !== STOP) throw e; }

    const list = sprites(sys.m);
    const pal = sys.palette();
    const base = sys.screen();
    const lines = [`frame ${n}, ${list.length} sprites`, ''];
    // How many DISTINCT colours each bank paints, and whether they are black.
    for (let bank = 0; bank < 256; bank += 16) {
      const buf = Uint32Array.from(base);
      const painted = drawSprites(buf, mo, pal, list, W, H, bank);
      const seen = new Set<number>();
      for (let y = 208; y < 216; y += 1) {
        for (let x = 0; x < W; x += 1) seen.add(buf[y * W + x]);
      }
      const black = [...seen].filter((c) => (c & 0xffffff) === 0).length;
      lines.push(`bank ${String(bank).padStart(3)}: ${painted} px, `
        + `${seen.size} distinct colours in the band`
        + (black ? `, ${black} of them black` : '')
        + '  ' + [...seen].slice(0, 6).map((c) =>
          (c & 0xffffff).toString(16).padStart(6, '0')).join(' '));
    }
    writeFileSync(join(here, 'mobank.txt'), lines.join('\n') + '\n');
    expect(list.length).toBeGreaterThan(0);
  }, 900000);
});
