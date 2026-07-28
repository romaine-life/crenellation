// Does the decompiled code compose?
//
// decomp.test.ts proves each routine in isolation on random machine states.
// That is not the same claim as "the game runs on them": routines call each
// other, share memory, and are entered at addresses the harness never picks.
// This boots the same ROM twice - once through the recompiled dispatcher, once
// through the decompiled one - and compares a digest of everything either
// could have touched, once per frame.
//
// The two runs cannot be interleaved. `run` never returns, because the game's
// main loop does not, and the nesting of `jsr` lives on the JavaScript stack -
// unwinding out of it to swap machines would leave a resumed `rts` with no
// caller. So each runs to completion and is compared by digest afterwards.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { System } from './system';
import { call as viaRecompiled } from './dispatch';
import { call as viaDecompiled, bind } from './decompiled';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));

const FRAMES = Number(process.env.COMPOSE_FRAMES ?? 120);
const REGS = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
  'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'];

/** FNV-1a over work RAM, the playfield and the registers. */
function digest(sys: System): number {
  const m = sys.m;
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (let a = 0x3e0000; a < 0x400000; a += 1) mix(m.byte(a));
  for (let a = 0x200000; a < 0x220000; a += 1) mix(m.byte(a));
  for (const r of REGS) {
    const v = (m as unknown as Record<string, number>)[r] >>> 0;
    mix(v); mix(v >>> 8); mix(v >>> 16); mix(v >>> 24);
  }
  return h >>> 0;
}

function digests(entry: (addr: number, m: Machine) => void): number[] {
  const sys = new System(rom, board);
  bind(sys.m);
  const out: number[] = [];
  const STOP = new Error('enough');
  try {
    sys.run(() => {
      out.push(digest(sys));
      if (out.length >= FRAMES) throw STOP;
    }, entry);
  } catch (e) {
    if (e !== STOP) throw e;
  }
  return out;
}

type Machine = System['m'];

describe('the decompiled routines compose', () => {
  it('runs the game identically to the recompiled ones', () => {
    const a = digests(viaRecompiled);
    const b = digests(viaDecompiled);
    let first = -1;
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
      if (a[i] !== b[i]) { first = i; break; }
    }
    const note = first < 0 && a.length === b.length
      ? `identical for ${a.length} frames`
      : `recompiled ${a.length} frames, decompiled ${b.length};`
        + ` first difference at frame ${first}`;
    writeFileSync(join(here, 'compose.txt'), note);
    expect(note).toBe(`identical for ${FRAMES} frames`);
  }, 900000);
});
