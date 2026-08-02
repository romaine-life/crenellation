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

const WATCH: number[] = (process.env.WATCH ?? '').split(',')
  .map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 16));

function run(entry: Entry, p: Pattern): string {
  const watch = new Map<number, number>(WATCH.map((a) => [a, 0]));
  const first: string[] = [];
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
    // WATCH=19552,1946e counts entries to named blocks in BOTH runs. A block
    // the oracle never enters at all is the strongest signal there is - it is
    // how 0x1E8D6 was found - and a count is comparable where a first
    // difference is not, because the spin loop at 0x430 parts by design and
    // swallows any "first divergence" comparison before anything else.
    const w = watch.get(pc);
    if (w !== undefined) {
      watch.set(pc, w + 1);
      // Registers at the FIRST visit. Run this with SPILL_ALL=1 or the lifted
      // side reports a stale mirror: it keeps registers in JavaScript locals
      // and writes the machine's only when it spills. Even then the value is
      // the previous block head's, because tick calls atPc before the spill
      // runs - which is fine for anything set an instruction or two earlier,
      // and is why this prints the block it was sampled after.
      if (w === 0) {
        const r = sys.m as unknown as Record<string, number>;
        first.push(`${pc.toString(16)}@f? a0=0x${(r.a0 >>> 0).toString(16)}`
          + ` a1=0x${(r.a1 >>> 0).toString(16)} d0=0x${(r.d0 >>> 0).toString(16)}`
          + ` d1=0x${(r.d1 >>> 0).toString(16)}`);
      }
    }
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
        // irqTaken as well as the frame, because that is the clock writes.test
        // windows on - and after a `stop #$2700` the lifted run takes no more
        // interrupts, so asking for a later one silently compares against a
        // machine that has gone quiet.
        hit = `address error by frame ${n}, ${sys.m.addressErrors} of them,`
          + ` at irqTaken ${sys.m.irqTaken}; blocks before it: ${caught}`;
        throw STOP;
      }
      if (n >= FRAMES) throw STOP;
    }, entry);
  } catch (e) {
    if (e !== STOP) hit = hit || `threw at frame ${n}: ${(e as Error).message.slice(0, 80)}`;
  }
  const counts = WATCH.length
    ? ` | visits: ${WATCH.map((a) => `${a.toString(16)}=${watch.get(a)}`).join(' ')}`
      + `
      first: ${first.join(' ; ')}`
    : '';
  return (hit || `no address error in ${n} frames`) + counts;
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
