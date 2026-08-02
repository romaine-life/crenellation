// Where does the lifted game take an address error the chip does not?
//
// The idle pattern parts from the oracle at frame 2796, and the reason turned
// out not to be a wrong value anywhere: the decompiled run VECTORS. Block
// 0x1E8D6 - the ROM's exception handler, which masks interrupts, saves every
// register, paints a dump and ends in `stop #$2700` - is entered 1,849,149
// times by the lift and never once by the recompiler. Everything visible
// downstream is that screen: the 0x8A8A fill, the 7,487 pixels of dump text at
// frame 2,850, the 79,946 by frame 4,000.
//
// An address error means a word or long access at an odd address, so somewhere
// the lift computes an address the chip does not. This says which block.
//
// The CONTROL is the recompiled run, which must report no address error at all.
// Without it a fault here could be the harness inventing an odd pointer rather
// than the lift computing one - and a probe that cannot fail is how an earlier
// hunt spent hours on a clean result that meant nothing.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PATTERNS, type Pattern } from './patterns';
import { System } from './system';
import { call as viaRecompiled } from './dispatch';
import { call as viaDecompiled, bind, POLL_AT } from './decompiled';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));

const FRAMES = Number(process.env.CRASH_FRAMES ?? 3000);
const RING = 24;

type Entry = (a: number, m: System['m']) => void;

function run(entry: Entry, p: Pattern): string {
  const sys = new System(rom, board);
  bind(sys.m);
  // The same poll points as compose and writes. Without this the two runs take
  // interrupts at different instructions and any difference found here could
  // be the seam rather than an address the lift got wrong.
  sys.m.pollAt = POLL_AT as Set<number>;
  const ring = new Int32Array(RING);
  let rn = 0;
  // atPcExtra, not atPc: the machine uses atPc itself and a test that takes it
  // gets an empty ring and no warning.
  // Snapshot the instant the count moves, not at the end of the frame. The
  // handler runs hundreds of thousands of blocks before the frame is out and
  // fills any ring with itself, which is what the first attempt reported: a
  // wall of 0x1E8D6 and nothing about what preceded it.
  let caught = '';
  sys.m.atPcExtra = (pc: number): void => {
    if (!caught && sys.m.addressErrors > 0) {
      const seen: string[] = [];
      for (let i = Math.max(0, rn - RING); i < rn; i += 1) {
        seen.push((ring[i % RING] >>> 0).toString(16));
      }
      const m = sys.m as unknown as Record<string, number>;
      const regs = ['d0', 'd1', 'd2', 'a0', 'a1', 'a2', 'a3']
        .map((r) => `${r}=0x${(m[r] >>> 0).toString(16)}`).join(' ');
      caught = `${(sys.m.faultWrite ? 'write' : 'read')} at`
        + ` 0x${(sys.m.faultAddr >>> 0).toString(16)} [${regs}] -- ${seen.join(' ')}`;
    }
    ring[rn % RING] = pc | 0;
    rn += 1;
  };
  let hit = '';
  let n = 0;
  const STOP = new Error('enough');
  try {
    sys.run(() => {
      n += 1;
      p.at(n, sys);
      if (!hit && sys.m.addressErrors > 0) {
        // Block heads only - that is all either dispatcher reports - so this
        // names the block the bad address was computed in, not the
        // instruction. The last entry is where control went; the ones before
        // it are the suspects.
        hit = `address error by frame ${n}, ${sys.m.addressErrors} of them;`
          + ` blocks before it: ${caught}`;
        throw STOP;
      }
      if (n >= FRAMES) throw STOP;
    }, entry);
  } catch (e) {
    if (e !== STOP) hit = hit || `threw at frame ${n}: ${(e as Error).message.slice(0, 80)}`;
  }
  return hit || `no address error in ${n} frames`;
}

describe('the lifted game vectors where the chip does not', () => {
  it('names the block', () => {
    const want = process.env.CRASH_PATTERN ?? 'no input';
    const p = PATTERNS.find((x) => x.name.includes(want));
    if (!p) throw new Error(`no pattern matching ${want}`);
    // Control first, and it has to be clean for the other line to mean
    // anything.
    const ctrl = run(viaRecompiled, p);
    const lift = run(viaDecompiled, p);
    writeFileSync(join(here, 'crash.txt'),
      `pattern: ${p.name}, ${FRAMES} frames\n  recompiled (CONTROL): ${ctrl}\n`
      + `  decompiled:           ${lift}\n`);
    expect(ctrl).toContain('no address error');
  }, 900000);
});
