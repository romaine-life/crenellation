// Which routine computes the wrong number?
//
// writes.test finds the first write that differs, which is one step too late:
// by then the value is already wrong and only being stored. The registers are
// where it goes wrong, and registers ARE comparable between the two
// dispatchers at the addresses both of them poll - POLL_AT, the decompiled
// side's block heads, which writes.test already relies on to keep the
// interrupt schedule from being the thing under test.
//
// Two passes, because 2.2 million polls of sixteen registers will not fit in
// memory twice: pass one hashes each poll's register state and finds the first
// index where the hashes part; pass two re-runs both to that index and prints
// the registers side by side. The program counter at that index names the
// routine, which is the whole point.
//
// EXCEPT IT DOES NOT WORK, AND THIS IS THE RECORD OF WHY. Measured 2026-07-31:
// it reports the runs parting at poll 1 of 2,074,054, at 0x1359a, with
// d0=0x8000/0x0, a0=0x3c0000/0x0, a1=0x3c07fc/0x0 - the decompiled side simply
// reading zero. That is not a divergence, it is the premise being false. The
// decompiled dispatcher keeps registers in JavaScript locals and writes them
// back into the Machine only where it has to: setReg before a callRom, and the
// setReg block in front of takeIrq. Between those points m.d0 is whatever it
// was at the last sync, so `the registers at a poll point` is a quantity only
// one of the two runs actually has. The recompiled dispatcher keeps them in
// the Machine at every instruction, which is exactly why it reads plausible
// values here and the other side reads zeros.
//
// So a register comparison has to sample where BOTH sides are known to have
// synced - the call boundaries - and not at poll points. That is a different
// instrument, and worth building; this file is kept as the measurement that
// says why the obvious version of it is wrong, because the obvious version
// looks like it is working right up until you read the values.
//
// Diagnostic, not a ratchet: it is skipped unless REGDIFF is set, because it
// runs the game four times.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { System } from './system';
import { call as viaRecompiled } from './dispatch';
import { call as viaDecompiled, bind, POLL_AT } from './decompiled';
import { PATTERNS } from './patterns';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));

const NAME = process.env.REGDIFF_PATTERN ?? 'attract';
const FRAMES = Number(process.env.REGDIFF_FRAMES ?? 500);
const CAP = Number(process.env.REGDIFF_CAP ?? 4_000_000);

const REGS = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
  'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'] as const;

type M = Record<string, number>;

/** Hash every poll's register state; or, past `dumpAt`, capture them whole. */
function scan(entry: (addr: number, m: System['m']) => void,
              dumpAt: number): { h: Int32Array; n: number; pc: number; regs: number[] } {
  const sys = new System(rom, board);
  bind(sys.m);
  sys.m.pollAt = POLL_AT as Set<number>;
  const h = new Int32Array(dumpAt < 0 ? CAP : 1);
  let n = 0, pc = 0;
  let regs: number[] = [];
  const m = sys.m as unknown as M;
  sys.m.atPcExtra = (at: number): void => {
    // Both dispatchers reach these and only these, in the same order.
    if (!(POLL_AT as Set<number>).has(at)) return;
    if (n === dumpAt) { pc = at; regs = REGS.map((r) => m[r] >>> 0); }
    if (dumpAt < 0) {
      // Cheap mix. A collision costs a wrong answer, not a wrong test - the
      // second pass prints the registers, so a false hit is visible at once.
      let x = at | 0;
      for (const r of REGS) x = (Math.imul(x, 0x01000193) ^ (m[r] | 0)) | 0;
      if (n < CAP) h[n] = x;
    }
    n += 1;
  };
  const pat = PATTERNS.find((p) => p.name.startsWith(NAME)) ?? PATTERNS[0];
  try {
    sys.run((s) => {
      pat.at(s, s.frames);
      if (s.frames >= FRAMES) throw new Error('done');
    }, entry);
  } catch { /* the frame limit, thrown from inside the machine */ }
  return { h, n, pc, regs };
}

describe('registers', () => {
  it.skipIf(!process.env.REGDIFF)('part at a poll point that names a routine', () => {
    const a = scan(viaRecompiled, -1);
    const b = scan(viaDecompiled, -1);
    const lim = Math.min(a.n, b.n, CAP);
    let at = -1;
    for (let i = 0; i < lim; i += 1) if (a.h[i] !== b.h[i]) { at = i; break; }
    let out = `${NAME}: ${a.n} vs ${b.n} polls over ${FRAMES} frames; `;
    if (at < 0) {
      out += `registers agree at every one of ${lim} compared`;
    } else {
      const ra = scan(viaRecompiled, at), rb = scan(viaDecompiled, at);
      const which = REGS.filter((_, i) => ra.regs[i] !== rb.regs[i]);
      out += `first differ at poll ${at} of ${lim}, pc 0x${ra.pc.toString(16)}`
        + ` (0x${rb.pc.toString(16)} on the other side)\n  differing: `
        + (which.length ? which.map((r, i) => `${r}=0x${ra.regs[REGS.indexOf(r)].toString(16)}`
            + `/0x${rb.regs[REGS.indexOf(r)].toString(16)}`).join(' ')
          : '(none - the hash collided, or the pc alone differs)');
    }
    writeFileSync(join(here, 'regdiff.txt'), out + '\n');
    console.log(out);
    expect(a.n).toBeGreaterThan(0);
  }, 900_000);
});
