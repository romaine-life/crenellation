// Does the decompiled code compose?
//
// decomp.test.ts proves each routine in isolation on random machine states.
// That is not the same claim as "the game runs on them": routines call each
// other, share memory, and are entered at addresses the harness never picks.
// This boots the same ROM twice - once through the recompiled dispatcher, once
// through the decompiled one - and compares everything either could have
// touched, once per frame, for a whole game.
//
// The two runs cannot be interleaved. `run` never returns, because the game's
// main loop does not, and the nesting of `jsr` lives on the JavaScript stack -
// unwinding out of it to swap machines would leave a resumed `rts` with no
// caller. So each runs to completion and is compared afterwards.
//
// Comparison is by digest per frame, not by keeping the frames. A snapshot is
// 264 KB and a pattern runs thousands of frames: holding both runs' snapshots
// would be gigabytes. The digests say which frame first differs, and the two
// runs are then repeated to that frame to say which bytes.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { System } from './system';
import { call as viaRecompiled } from './dispatch';
import { call as viaDecompiled, bind } from './decompiled';
import { PATTERNS, type Pattern } from './patterns';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));

type Machine = System['m'];
type Entry = (addr: number, m: Machine) => void;

// Once a rule has been changed on purpose, "identical to the original" is the
// wrong question - the decompiled source is no longer trying to be the ROM. The
// matching decompilation projects handle this with a build flag; same idea.
const MODIFIED = process.env.MODIFIED === '1';

// A single pattern, by name, when chasing one divergence. Empty means all.
const ONLY = process.env.COMPOSE_ONLY ?? '';
// A cap, for a quick run. Zero means each pattern's own full length.
const CAP = Number(process.env.COMPOSE_FRAMES ?? 0);

/** Everything either run could have touched, for a byte-level comparison. */
function snapshot(sys: System): Uint8Array {
  const m = sys.m;
  // Memory only. The registers say where a run happened to be paused when the
  // frame boundary arrived, and the two pause at different instructions: the
  // recompiler charges cycles per instruction, the decompiled code per block.
  // That is a difference in when the snapshot was taken, not in what the game
  // did - and what the game did is entirely in memory.
  const out = new Uint8Array(0x20000 + 0x20000 + 0x800);
  let o = 0;
  for (let a = 0x3e0000; a < 0x400000; a += 1) out[o++] = m.byte(a);
  for (let a = 0x200000; a < 0x220000; a += 1) out[o++] = m.byte(a);
  // The palette. Leaving it out meant a run that drew the right playfield in
  // the wrong colours - or in none at all - compared equal for nine hundred
  // frames, which is exactly what happened.
  for (let a = 0x3c0000; a < 0x3c0800; a += 1) out[o++] = m.byte(a);
  return out;
}

/** Where a snapshot byte came from, so a difference names itself. */
function where(i: number): string {
  if (i < 0x20000) return `ram 0x${(0x3e0000 + i).toString(16)}`;
  i -= 0x20000;
  if (i < 0x20000) return `playfield 0x${(0x200000 + i).toString(16)}`;
  return `palette 0x${(0x3c0000 + i - 0x20000).toString(16)}`;
}

/** FNV-1a over a snapshot. */
function digestOf(s: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Run one pattern. `upto` stops at that frame and returns its snapshot;
 * otherwise the whole pattern runs and only digests come back.
 */
function play(p: Pattern, entry: Entry, upto = 0): {
  digests: number[]; frames: number; shot: Uint8Array | null; ended: string;
} {
  const sys = new System(rom, board);
  bind(sys.m);
  const digests: number[] = [];
  let shot: Uint8Array | null = null;
  const limit = CAP || p.frames;
  const STOP = new Error('enough');
  let frames = 0;
  let died = '';
  try {
    sys.run(() => {
      frames += 1;
      p.at(frames, sys);
      if (upto) {
        if (frames === upto) { shot = snapshot(sys); throw STOP; }
      } else {
        digests.push(digestOf(snapshot(sys)));
        if (frames >= limit) throw STOP;
      }
    }, entry);
  } catch (e) {
    if (e !== STOP) died = (e as Error).message.slice(0, 90);
  }
  return { digests, frames, shot,
    ended: `${frames} frames, stopped=${sys.m.stopped}${died ? `, died: ${died}` : ''}` };
}

/** The first frame whose digests differ, or -1. */
function firstDiff(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i + 1;
  return a.length === b.length ? -1 : n + 1;
}

function compare(p: Pattern): string {
  const a = play(p, viaRecompiled);
  const b = play(p, viaDecompiled);
  const f = firstDiff(a.digests, b.digests);
  if (f < 0) return `${p.name}: identical for ${a.frames} frames`;
  // Say which bytes, by replaying both to that frame. Only then is a snapshot
  // worth keeping.
  const sa = play(p, viaRecompiled, f).shot;
  const sb = play(p, viaDecompiled, f).shot;
  if (!sa || !sb) {
    return `${p.name}: diverges at frame ${f} (${a.frames} vs ${b.frames} frames run)`;
  }
  const diffs: string[] = [];
  let total = 0;
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] !== sb[i]) {
      total += 1;
      if (diffs.length < 6) diffs.push(`${where(i)} ${sa[i]}!=${sb[i]}`);
    }
  }
  return `${p.name}: frame ${f} of ${a.frames}, ${total} bytes differ - ${diffs.join(' ')}`;
}

describe('the decompiled routines compose', () => {
  const chosen = PATTERNS.filter((p) => !ONLY || p.name.includes(ONLY));

  it.skipIf(MODIFIED)('runs the game identically to the recompiled ones', () => {
    const lines = chosen.map(compare);
    writeFileSync(join(here, 'compose.txt'), lines.join('\n') + '\n');
    const bad = lines.filter((l) => !l.includes('identical'));
    expect(bad).toEqual([]);
  }, 3600000);

  // With a rule changed, the useful claim is the opposite one: the change is
  // actually in the running game rather than in a file nothing reads. Walls
  // first exist when the demo lays them, which is why this needs a pattern
  // that plays rather than the first frames of boot.
  it.skipIf(!MODIFIED)('differs from the original where it was changed', () => {
    const p = chosen[0];
    const a = play(p, viaRecompiled);
    const b = play(p, viaDecompiled);
    expect(firstDiff(a.digests, b.digests)).toBeGreaterThan(0);
  }, 3600000);
});
