// Would a shape whose address registers hold CODE let the pointer-dispatch
// routines run? Measured before capturing it, because the capture costs eight
// MAME runs and the answer is knowable from the port alone.
//
// Shapes 0-3 seed the address registers with either a scratch pointer or one
// of seven data structures. A routine that dispatches through an address
// register - `jmp (a4)` - therefore jumps into work RAM and executes whatever
// random bytes the harness wrote there. That is what voids 0x12222 and
// 0x122c6: the skipped calls are to 0x3e42b2 and 0x3e42ef, both inside the
// 0x3e4000 scratch block.
//
// This is a probe, not a claim about silicon. It only asks whether the port
// stops stubbing calls when the register points at real code.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Machine } from './machine';
import { call } from './dispatch';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));

const SCRATCH = 0x3e4000;
const STACK = 0x3e5000;
const SENTINEL = 0x3e6000;

// The decompressor's state handlers - the values its dispatch register is
// meant to hold. Every one of these was read and named this session.
const DECODER_STATES = [0x1228c, 0x1229e, 0x122ae, 0x122b2, 0x122bc,
                        0x12340, 0x12350, 0x12354, 0x1235e];

function run(entry: number, seedA: (k: number) => number): {
  missing: string[]; steps: number; threw: string;
} {
  const m = new Machine(rom);
  m.store(SENTINEL, 0x60fe, 16);
  for (let i = 0; i < 0x400; i += 1) m.setByte(SCRATCH + i, (i * 7 + 3) & 0xff);
  for (let k = 0; k < 8; k += 1) {
    (m as never as Record<string, number>)[`d${k}`] = k * 5;
  }
  for (let k = 0; k < 6; k += 1) {
    (m as never as Record<string, number>)[`a${k}`] = seedA(k);
  }
  let sp = STACK;
  for (let k = 0; k < 4; k += 1) { sp -= 4; m.store(sp, SCRATCH + k * 8, 32); }
  sp -= 4; m.store(sp, SENTINEL, 32);
  m.a7 = sp;
  m.a6 = STACK + 0x200;
  m.sr = 0x2700;
  m.stubMissing = true;
  let threw = '';
  try { call(entry, m); } catch (e) { threw = String(e).slice(0, 60); }
  return {
    missing: [...new Set(m.missingCalls)].map((a) => '0x' + a.toString(16)),
    steps: 0,
    threw,
  };
}

describe('a shape that puts code in the address registers', () => {
  it('says whether the pointer-dispatch routines stop stubbing calls', () => {
    const asData = (k: number) => [0x3e0864, 0x3e1968, 0x3e1cf6, 0x3e1bc6,
                                   0x3e0f48, 0x3e4000][k] ?? 0x3e4000;
    const asCode = (k: number) => DECODER_STATES[k % DECODER_STATES.length];

    const lines: string[] = [];
    for (const entry of [0x12222, 0x122c6, 0x561c, 0x19a1e]) {
      const d = run(entry, asData);
      const c = run(entry, asCode);
      lines.push(`0x${entry.toString(16)}`
        + `  data-> missing=[${d.missing.join(' ')}]${d.threw ? ' threw' : ''}`
        + `  code-> missing=[${c.missing.join(' ')}]${c.threw ? ' threw' : ''}`);
    }
    writeFileSync(join(here, 'shape4probe.txt'), lines.join('\n') + '\n');
    expect(lines.length).toBe(4);
  });
});
