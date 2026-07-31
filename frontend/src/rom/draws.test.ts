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
const floorPx: number = (JSON.parse(
  readFileSync(join(here, 'baseline.json'), 'utf8')) as Record<string, number>)['draws'] ?? 0;
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));
// Once a rule has been changed on purpose the two runs are meant to draw
// different pictures, so this asks the same two questions compose does. The
// default stops before the demo lays a wall, where the only difference that
// could appear would be a fault; MODIFIED=1 runs on to where the changed
// rule shows and requires that it does.
const MODIFIED = process.env.MODIFIED === '1';
const FRAMES = Number(process.env.DRAW_FRAMES ?? (MODIFIED ? 900 : 600));

function lit(entry: (a: number, m: System['m']) => void, label: string):
    { note: string; screen: Uint32Array } {
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
  const screen = sys.screen();
  writeFileSync(join(here, `draws-${label}.png`), png(336, 240, screen));
  return { note: `${label} ran ${n} frames, playfield bytes set: ${marks.join(' ')}`,
    screen };
}

describe('drawing', () => {
  it('happens', () => {
    const a = lit(viaRecompiled, 'recompiled');
    const b = lit(viaDecompiled, 'decompiled');
    // The pixels, not the byte count. Counting lit bytes is what let a game
    // drawn entirely in black look healthy for nine hundred frames: 80,640
    // bytes are set whether or not the palette was ever written. Both screens
    // are rendered above; this asks whether they are the same picture.
    let differs = 0;
    // Where they differ, not just how many. A count cannot tell a mis-drawn
    // sprite from a shifted row from a wrong palette entry, and the bounding
    // box plus the first pixel says which straight away.
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, first = '';
    for (let i = 0; i < a.screen.length; i += 1) {
      if (a.screen[i] !== b.screen[i]) {
        differs += 1;
        const x = i % 336, y = (i / 336) | 0;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (!first) first = `first at (${x},${y}) ${a.screen[i].toString(16)} vs ${b.screen[i].toString(16)}`;
      }
    }
    if (differs) {
      writeFileSync(join(here, 'draws-where.txt'),
        `${differs} pixels differ, box x ${x0}..${x1} y ${y0}..${y1}`
        + ` (${x1 - x0 + 1} wide, ${y1 - y0 + 1} tall)\n${first}\n`);
    }
    const lines = [a.note, b.note,
      differs ? `screens differ in ${differs} of ${a.screen.length} pixels`
        : `screens identical: ${a.screen.length} pixels`];
    writeFileSync(join(here, 'draws.txt'), lines.join('\n'));
    // Not a floor. The two runs draw the *same picture*: regenerate without
    // handedits.py and this is `screens identical: 80640 pixels`, measured,
    // both ways. Every one of the 380 is the deliberate wallCellSet change -
    // d3 is a tile index and the edit picks a different wall tile, which is
    // why work RAM stays byte-identical while these pixels do not. They land
    // inside the wall glyphs, x 36..262 y 16..78, and nowhere else.
    //
    // So assert the exact count, not "no worse than". A floor here would
    // swallow a new fault as long as it stayed under the deliberate change's
    // footprint; an exact number fails on a real regression *and* on the
    // change being silently lost.
    if (MODIFIED) expect(differs).toBeGreaterThan(0);
    else expect(differs).toBe(floorPx);
  }, 900000);
});
