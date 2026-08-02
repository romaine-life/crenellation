// Does either run actually draw, and when?
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PATTERNS, type Pattern } from './patterns';
import { System } from './system';
import { call as viaRecompiled, useLift } from './dispatch';
import { call as viaDecompiled, bind, useOracle, useCallee } from './decompiled';
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

function lit(entry: (a: number, m: System['m']) => void, label: string,
             pat?: Pattern): { note: string; screen: Uint32Array } {
  const sys = new System(rom, board);
  // IRQ_PHASE shifts the first interrupt by N cycles. A lifting fault is
  // phase-independent; a seam effect is not - so if the differing-pixel count
  // moves with the phase, the difference is interrupt timing that has entered
  // game state rather than a mis-lifted instruction. The probe below is the
  // CONTROL: without evidence that the phase actually perturbs the run,
  // identical counts prove nothing, and an earlier attempt at this test failed
  // exactly there - its probe never fired and the clean numbers meant nothing.
  sys.irqPhase = Number(process.env.IRQ_PHASE ?? 0);
  // BISECT=N runs every routine at or above address N on the recompiled oracle
  // and everything below it on the lift. The sanity check is the whole point:
  // BISECT=0 puts everything on the oracle and MUST report zero differing
  // pixels, and BISECT=0x20000 puts everything on the lift and must report the
  // usual count. An earlier attempt at this hooked useCallee, which does not
  // govern the top-level dispatch, and failed that check by reporting the
  // lifted count for an all-oracle run.
  // ONLY=addr routes exactly ONE entry to the oracle, which separates a routine
  // from the continuation entries inside its own address range - `call` is
  // invoked with the entry address, so a single-address pick is enough. That
  // distinction is the one all of the source reading could not make: fn_1399C
  // and fn_139AE are different entries into the same code, and a fault in the
  // register-borne re-entry looks exactly like a fault in the routine.
  const split = process.env.BISECT === undefined ? -1 : Number(process.env.BISECT);
  const only = process.env.ONLY === undefined ? -1 : Number(process.env.ONLY);
  // ISOLATE=addr runs the WHOLE game on the oracle and routes exactly one
  // routine to the lift, with that routine's own callees handed straight back.
  // Both hooks are needed - useLift in the recompilation, useCallee in the lift
  // - because without them whichever dispatcher receives an address keeps
  // everything that address calls, which is how a subtree was reported as a
  // routine. Sanity check: an address no routine starts at must give 0 px.
  const iso = process.env.ISOLATE === undefined ? -1 : Number(process.env.ISOLATE);
  // ISOLATE=addr is a THRESHOLD: routines at or above it run lifted, and the
  // split applies recursively - a lifted routine's callees are routed by the
  // same rule, so useCallee must stay at its default. Forcing callees to the
  // oracle is right for isolating ONE routine and wrong here: it made the
  // all-lifted endpoint report 66,616 pixels where the plain decompiled run
  // reports 31,872, and an endpoint that disagrees with the baseline means the
  // bisection is measuring something else. ONLY=addr keeps the single-routine
  // form, with callees handed back.
  if (iso >= 0 && label.startsWith('dec')) {
    useLift({ pick: (a: number) => a >= iso, run: viaDecompiled });
  } else if (only >= 0 && label.startsWith('dec')) {
    useLift({ pick: (a: number) => a === only, run: viaDecompiled });
    useCallee(viaRecompiled);
  } else { useLift(null); }
  useOracle(!label.startsWith('dec') || (split < 0 && only < 0) ? null
    : only >= 0 ? { pick: (a: number) => a === only, run: viaRecompiled }
      : { pick: (a: number) => a >= split, run: viaRecompiled });
  bind(sys.m);
  const marks: string[] = [];
  const STOP = new Error('enough');
  let n = 0;
  try {
    sys.run(() => {
      if (n === 200 && process.env.IRQ_PHASE !== undefined) {
        writeFileSync(join(here, `draws-phase-${process.env.IRQ_PHASE}-${label}.txt`),
          `cycles ${sys.m.cycles} irqTaken ${sys.m.irqTaken} steps ${sys.m.steps}`);
      }
      n += 1;
      // Drive the pattern's inputs. Without this every run is attract, which
      // is why this test saw only one sixth of the game: the station-select
      // banner is not drawn at all until a coin goes in, so a fault in it
      // could not show here however many frames were run.
      if (pat) pat.at(n, sys);
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
  // Every pattern, not just attract. Recorded per pattern in baseline.json:
  // the two runs are known to differ on the gameplay ones, and the point of
  // listing the counts is that a NEW difference shows up as a changed number
  // rather than hiding inside a pass.
  it('happens on every pattern', () => {
    const seen: string[] = [];
    for (const p of PATTERNS) {
      // Sanitised: pattern names contain ':' and ',', and a colon is not legal in
      // a Windows filename - the PNGs came out extensionless and unopenable.
      const tag = p.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 16);
      const x = lit(viaRecompiled, `rec-${tag}`, p);
      const y = lit(process.env.ISOLATE === undefined ? viaDecompiled : viaRecompiled, `dec-${tag}`, p);
      let d = 0;
      for (let i = 0; i < x.screen.length; i += 1) if (x.screen[i] !== y.screen[i]) d += 1;
      seen.push(`${p.name}: ${d}`);
    }
    writeFileSync(join(here, 'draws-patterns.txt'), seen.join('\n'));
  }, 600000);

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
