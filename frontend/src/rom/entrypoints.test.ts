// Which addresses does the game actually enter routines at?
//
// The recompiled dispatcher can start a routine anywhere inside it - it is a
// program counter and a switch, so `FNS[found](m, a)` picks up at `a`. A
// decompiled function has one entry, its own first instruction. Before the
// dispatcher can be deleted, that gap has to be measured: every entry the
// running game uses which is not a routine's start needs a decompiled function
// of its own.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { System } from './system';
import { STARTS } from './dispatch';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));

describe('routine entry points', () => {
  it('records every address the running game enters at', () => {
    const sys = new System(rom, board);
    const starts = new Set<number>(STARTS);
    const entries = new Map<number, number>();
    sys.m.onCall = (a: number): void => {
      entries.set(a, (entries.get(a) ?? 0) + 1);
    };
    // `run` does not return - the game's main loop does not - so stop it the
    // way anything else would have to.
    const STOP = new Error('enough');
    let frames = 0;
    try {
      sys.run(() => { frames += 1; if (frames > 600) throw STOP; });
    } catch (e) { if (e !== STOP) throw e; }
    const inside = [...entries.entries()]
      .filter(([a]) => !starts.has(a))
      .sort((x, y) => y[1] - x[1]);
    const total = [...entries.values()].reduce((a, b) => a + b, 0);
    const insideCalls = inside.reduce((a, [, n]) => a + n, 0);
    const lines = [
      `${entries.size} distinct entry addresses, ${total} calls over 600 frames`,
      `${inside.length} of them are not a routine start, ${insideCalls} calls`,
      ...inside.slice(0, 40).map(([a, n]) => `  0x${a.toString(16)} x${n}`),
    ];
    writeFileSync(join(here, 'entrypoints.txt'), lines.join('\n'));
    expect(entries.size).toBeGreaterThan(0);
  }, 600000);
});
