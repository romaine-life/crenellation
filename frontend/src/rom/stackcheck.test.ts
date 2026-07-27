// Which routine leaves the stack pointer somewhere it should not.
//
// Booting the machine gets four seconds in and then calls through a function
// pointer that holds an argument value instead - a2 restored by `movem.l
// (a7)+, d2-d4/a2` came back wrong, so the saved registers and the pushed
// arguments have got mixed up. That is a stack imbalance, and this finds which
// routine causes it: every call records the stack pointer on the way in, and
// checks it on the way out.
//
// A routine is allowed to move it deliberately - the argument-dropping idiom
// `move.l (a7),12(a7); lea 12(a7),a7; rts` ends higher on purpose - so what is
// reported is the first difference per routine, not every one.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'vitest';

import { System } from './system';


const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));

describe('stack balance across calls', () => {
  it('names the routines that move it', () => {
    const sys = new System(rom, board);
    const drift = new Map<number, { at: number; by: number; n: number }>();
    const calls512: string[] = [];

    // a call pushes four bytes of return address and the matching rts takes
    // them back, so a balanced routine ends four higher than it started
    sys.m.onCall = (addr: number, before: number, after: number) => {
      const by = (after - before) | 0;
      if (addr === 0x512 && calls512.length < 8) {
        calls512.push(`in 0x${(before >>> 0).toString(16)} out 0x${(after >>> 0).toString(16)} by ${by}`);
      }
      if (by === 4) return;
      if (addr === 0x512 && calls512.length < 8) {
        calls512.push(`in 0x${(before >>> 0).toString(16)} out 0x${(after >>> 0).toString(16)} by ${by}`);
      }
      const e = drift.get(addr);
      if (e) e.n += 1;
      else drift.set(addr, { at: addr, by, n: 1 });
    };

    // the stack pointer at each instruction of 0x450C, on its last pass
    const trace: string[] = [];
    const WATCH = new Set([0x450c, 0x4510, 0x4514, 0x4516, 0x4518, 0x451a,
                           0x4520, 0x4524, 0x4528, 0x452c]);
    sys.m.atPcExtra = (pc: number) => {
      if (!WATCH.has(pc)) return;
      if (pc === 0x450c) trace.length = 0;
      trace.push(`0x${pc.toString(16)}:a7=0x${(sys.m.a7 >>> 0).toString(16)}`);
    };

    let stopped = '';
    try {
      sys.run((s) => { if (s.frames >= 300) throw new Error('enough'); });
    } catch (e) {
      stopped = (e as Error).message;
    }

    const rows = [...drift.values()].sort((a, b) => b.n - a.n).slice(0, 20);
    const notes = [
      `frames: ${sys.frames}   instructions: ${sys.m.steps}   stopped: ${stopped}`,
      `routines whose stack use is not a plain call and return: ${drift.size}`,
      'last pass through 0x450C: ' + trace.join(' '),
      'calls to 0x512: ' + calls512.join(' | '),
      ...rows.map((r) => `   0x${r.at.toString(16)}  moves a7 by ${r.by}  (${r.n} times)`),
    ];
    // eslint-disable-next-line no-console
    console.log(notes.join('\n'));
    writeFileSync(join(here, 'stackcheck.txt'), notes.join('\n'));
  }, 300000);
});
