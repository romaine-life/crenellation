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
    for (let i = 0; i < a.screen.length; i += 1) {
      if (a.screen[i] !== b.screen[i]) differs += 1;
    }
    const lines = [a.note, b.note,
      differs ? `screens differ in ${differs} of ${a.screen.length} pixels`
        : `screens identical: ${a.screen.length} pixels`];
    writeFileSync(join(here, 'draws.txt'), lines.join('\n'));
    if (MODIFIED) expect(differs).toBeGreaterThan(0);
    else expect(differs).toBeLessThanOrEqual(floorPx);
  }, 900000);
});
