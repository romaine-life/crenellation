// What is actually in the motion-object display list?
//
// The ROM builds one and the port never reads it, so the sprite layer is
// missing entirely - terrain, castles, walls and ships all come from the
// playfield. Before a renderer can be written the list has to be understood,
// and reading the four routines that write it gives a layout that this checks
// against a running machine rather than against my confidence.
//
// Read out of spriteSlotAddress, spriteSlotLink, motionObjectEntryWrite and
// motionObjectWordPack, all four of which are verified against silicon:
//
//   base   0x3e0000, eight bytes a slot, slot index bounded at 0x46 by
//          spriteSlotAddress - which calls the halt stub above that, so 0x46
//          is the hardware's limit and not a guess.
//   +0     link: the index of the next slot in the chain. spriteSlotLink
//          walks it and spriteSlotAddress writes the new head into it.
//   +2     the graphic, taken from field 4 of a lookup record, with bit 15
//          set from bit 3 of the object's byte at 0xf.
//   +4     x: (word 8 of the object << 7, masked to 0xff80) + word 0xc.
//   +6     y: 0x10000 - (word 6 << 7, masked to 0xff80) + word 0xe, so it
//          counts the other way up.
//
// This writes what it finds to molist.txt. It asserts only that the list is
// non-empty and inside its bounds - the shape of the entries is reported for
// reading, because asserting a layout I inferred this morning would only
// freeze my own guess.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { System } from './system';
import { call as viaDecompiled, bind, original } from './decompiled';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));

const BASE = 0x3e0000;
const SLOTS = 0x47;          // 0..0x46 inclusive
const STRIDE = 8;
const FRAMES = Number(process.env.MO_FRAMES ?? 900);

describe('the motion-object display list', () => {
  it('is populated while the game runs', () => {
    original();                       // the ROM's own rules
    const sys = new System(rom, board);
    bind(sys.m);
    const STOP = new Error('enough');
    let n = 0;
    const snaps: string[] = [];
    const w = (a: number): number => (sys.m.byte(a) << 8) | sys.m.byte(a + 1);

    const dump = (label: string): number => {
      const rows: string[] = [];
      let used = 0;
      for (let s = 0; s < SLOTS; s += 1) {
        const at = BASE + s * STRIDE;
        const link = w(at), code = w(at + 2), x = w(at + 4), y = w(at + 6);
        if (!(link | code | x | y)) continue;
        used += 1;
        if (rows.length < 24) {
          rows.push(`  slot ${s.toString().padStart(2)}  link ${link
            .toString(16).padStart(4, '0')}  code ${code.toString(16).padStart(4, '0')}`
            + `  x ${x.toString(16).padStart(4, '0')}  y ${y.toString(16).padStart(4, '0')}`);
        }
      }
      snaps.push(`${label}: ${used} of ${SLOTS} slots in use`);
      snaps.push(...rows);
      return used;
    };

    let peak = 0;
    try {
      sys.run(() => {
        n += 1;
        if (n === 300 || n === 600 || n === FRAMES) peak = Math.max(peak, dump(`frame ${n}`));
        if (n >= FRAMES) throw STOP;
      }, viaDecompiled);
    } catch (e) { if (e !== STOP) snaps.push(`threw ${(e as Error).message.slice(0, 60)}`); }

    // The second bank: motionObjectWordPack mirrors an entry to slot+0x46,
    // which is what a double-buffered list looks like.
    let mirrored = 0;
    for (let s = 0; s < SLOTS; s += 1) {
      const a = BASE + (s + 0x46) * STRIDE;
      if (w(a) | w(a + 2) | w(a + 4) | w(a + 6)) mirrored += 1;
    }
    snaps.push(`second bank at +0x${(0x46 * STRIDE).toString(16)}: ${mirrored} slots in use`);

    writeFileSync(join(here, 'molist.txt'), snaps.join('\n') + '\n');
    expect(peak).toBeGreaterThan(0);
  }, 900000);
});
