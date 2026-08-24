// Which of the two display-list banks is the one being drawn?
//
// motionObjectWordPack mirrors each entry to slot+0x46, so there are two banks
// eight bytes apart at 0x3e0000 and 0x3e0230. Everything so far has read bank
// zero, which holds seven entries - but a diff against the real machine says
// the sprite layer covers rows 209 to 239, four tiles tall, where bank zero's
// entries claim one. The other bank had 36 slots in use the first time it was
// counted and was never looked at again.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { System } from './system';
import { call as viaDecompiled, bind, original } from './decompiled';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const io = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));

describe('the two display-list banks', () => {
  it('says what each holds at the frame the diff was taken', () => {
    original();
    const sys = new System(rom, io);
    bind(sys.m);
    const STOP = new Error('enough');
    let n = 0;
    try {
      sys.run(() => { n += 1; if (n >= 640) throw STOP; }, viaDecompiled);
    } catch (e) { if (e !== STOP) throw e; }
    const w = (a: number): number => (sys.m.byte(a) << 8) | sys.m.byte(a + 1);
    const lines: string[] = [`frame ${n}`];
    for (const [name, base] of [['bank 0', 0x3e0000], ['bank 1', 0x3e0230]] as const) {
      const rows: string[] = [];
      for (let s = 0; s < 0x47; s += 1) {
        const at = base + s * 8;
        const link = w(at), code = w(at + 2), x = w(at + 4), y = w(at + 6);
        if (!(link | code | x | y)) continue;
        if (!code) continue;                       // only entries with a graphic
        rows.push(`  slot ${s.toString(16).padStart(2, '0')}`
          + `  code ${code.toString(16).padStart(3, '0')}`
          + `  x ${(x >> 7).toString().padStart(3)}  y ${(y >> 7).toString().padStart(3)}`
          + `  xlow ${(x & 0x7f).toString(16).padStart(2, '0')}`
          + `  ylow ${(y & 0x7f).toString(16).padStart(2, '0')}`);
      }
      lines.push(`${name} at 0x${base.toString(16)}: ${rows.length} entries with a graphic`);
      lines.push(...rows.slice(0, 20));
    }
    writeFileSync(join(here, 'mobanks.txt'), lines.join('\n') + '\n');
    expect(n).toBe(640);
  }, 900000);
});
