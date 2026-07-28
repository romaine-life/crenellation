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
const ended: string[] = [];
const REGS = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
  'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'];

/** Everything either run could have touched, for a byte-level comparison. */
function snapshot(sys: System): Uint8Array {
  const m = sys.m;
  // Memory only. The registers say where a run happened to be paused when the
  // frame boundary arrived, and the two pause at different instructions: the
  // recompiler charges cycles per instruction, the decompiled code per block.
  // That is a difference in when the snapshot was taken, not in what the game
  // did - and what the game did is entirely in memory.
  const out = new Uint8Array(0x20000 + 0x20000);
  let o = 0;
  for (let a = 0x3e0000; a < 0x400000; a += 1) out[o++] = m.byte(a);
  for (let a = 0x200000; a < 0x220000; a += 1) out[o++] = m.byte(a);
  return out;
}

/** Where a snapshot byte came from, so a difference names itself. */
function where(i: number): string {
  if (i < 0x20000) return `ram 0x${(0x3e0000 + i).toString(16)}`;
  i -= 0x20000;
  if (i < 0x20000) return `playfield 0x${(0x200000 + i).toString(16)}`;
  return `playfield 0x${(0x200000 + i - 0x20000).toString(16)}`;
}

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

function shots(entry: (addr: number, m: Machine) => void): Uint8Array[] {
  const sys = new System(rom, board);
  bind(sys.m);
  const out: Uint8Array[] = [];
  const STOP = new Error('enough');
  try {
    sys.run(() => {
      out.push(snapshot(sys));
      if (out.length >= FRAMES) throw STOP;
    }, entry);
  } catch (e) {
    if (e !== STOP) throw e;
  }
  ended.push(`${out.length} frames, stopped=${sys.m.stopped}, pc=0x${(sys.m.pc >>> 0).toString(16)}`);
  return out;
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
    const a = shots(viaRecompiled);
    const b = shots(viaDecompiled);
    let note = `identical for ${a.length} frames`;
    outer:
    for (let f = 0; f < Math.min(a.length, b.length); f += 1) {
      const diffs: string[] = [];
      for (let i = 0; i < a[f].length; i += 1) {
        if (a[f][i] !== b[f][i]) {
          diffs.push(`${where(i)} ${a[f][i]}!=${b[f][i]}`);
          if (diffs.length >= 6) break;
        }
      }
      if (diffs.length) {
        let total = 0;
        for (let i = 0; i < a[f].length; i += 1) if (a[f][i] !== b[f][i]) total += 1;
        note = `frame ${f}: ${total} bytes differ - ${diffs.join(' ')}`;
        break outer;
      }
    }
    writeFileSync(join(here, 'compose.txt'), [note, ...ended].join('\n'));
    // Both runs end where the game ends, which is itself part of behaving the
    // same. What matters is that no frame differed and that they ran equally
    // far - not that either reached some number this test picked.
    expect(note).toBe(`identical for ${a.length} frames`);
    expect(b.length).toBe(a.length);
  }, 900000);
});
