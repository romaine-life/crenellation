// The motion-object layer: what a chip on the board drew and the port did not.
//
// The ROM builds a display list and never reads it back - a dedicated Atari
// part consumed it and painted sprites over the playfield. There is no code in
// the ROM to translate for that, so this is written from what the hardware was
// measured to do, not lifted.
//
// Everything here is checked against a real machine (romlab/mosnap.lua takes a
// MAME snapshot and dumps the list at the same instant):
//
//   list    0x3e0000, eight bytes a slot, 0x47 slots, double-buffered at
//           +0x230. spriteSlotAddress calls the halt stub above 0x46, so that
//           bound is the hardware's.
//   +0      link to the next slot
//   +2      tile index, twelve bits. Nothing above bit 11 is ever set.
//   +4      x << 7, with the height in tiles less one in bits 0-3
//   +6      y << 7, with the width in tiles less one in bits 4-6
//
// The size reading is the best-supported one rather than a proof: at frame 600
// it puts five sprites 64 pixels wide and one 16 wide at x 0 through 320,
// which is 336 exactly - the screen, edge to edge - and one tile tall, which
// is the eight rows the snapshot has. Every attribute value seen in a game
// gives a sane size under it.
import type { Machine } from './machine';

export const MO_LIST = 0x3e0000;
export const MO_SLOTS = 0x47;
/** 8x8 tiles, 4bpp packed nibbles, 32 bytes each - 4,096 of them in mo.bin. */
export const TILE_BYTES = 32;

/** The rows between what the y word counts and what the screen shows. */
export const Y_BIAS = Number(process.env.MO_YBIAS ?? 18);

export type Sprite = {
  slot: number; code: number; x: number; y: number; w: number; h: number;
};

/** Every populated slot, decoded. Reads the list, decides nothing. */
export function sprites(m: Machine): Sprite[] {
  const w16 = (a: number): number => (m.byte(a) << 8) | m.byte(a + 1);
  const out: Sprite[] = [];
  for (let s = 0; s < MO_SLOTS; s += 1) {
    const at = MO_LIST + s * 8;
    const code = w16(at + 2);
    if (!code) continue;
    const xw = w16(at + 4);
    const yw = w16(at + 6);
    out.push({
      slot: s,
      code: code & 0xfff,
      x: xw >> 7,
      y: (yw >> 7) - Y_BIAS,
      h: (xw & 0xf) + 1,
      w: ((yw >> 4) & 7) + 1,
    });
  }
  return out;
}

/**
 * Paint the sprites over a frame already holding the playfield.
 *
 * `pal` indexes colour; sprite pixels are four bits, so which sixteen entries
 * they land in is a bank this does not yet know - `bank` is the parameter that
 * makes that testable rather than assumed. Colour zero is transparent, which
 * is the one universal in every sprite system.
 */
export function drawSprites(
  out: Uint32Array, mo: Uint8Array, pal: Uint32Array, list: Sprite[],
  screenW: number, screenH: number, bank = 0,
): number {
  let painted = 0;
  for (const s of list) {
    for (let ty = 0; ty < s.h; ty += 1) {
      for (let tx = 0; tx < s.w; tx += 1) {
        // Tile order within a sprite is column-major on Atari parts: the
        // index walks down a column then across. Marked because it is the
        // next thing a diff against MAME would confirm or refute.
        const t = (s.code + tx * s.h + ty) & 0xfff;
        const base = t * TILE_BYTES;
        for (let py = 0; py < 8; py += 1) {
          const sy = s.y + ty * 8 + py;
          if (sy < 0 || sy >= screenH) continue;
          for (let px = 0; px < 8; px += 1) {
            const sx = s.x + tx * 8 + px;
            if (sx < 0 || sx >= screenW) continue;
            const b = mo[base + py * 4 + (px >> 1)];
            const v = (px & 1) ? (b & 0xf) : (b >> 4);
            if (!v) continue;                     // colour zero is see-through
            out[sy * screenW + sx] = pal[(bank + v) & 0xff];
            painted += 1;
          }
        }
      }
    }
  }
  return painted;
}
