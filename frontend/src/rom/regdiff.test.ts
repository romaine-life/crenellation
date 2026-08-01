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
// SECOND ATTEMPT, and it narrows the problem without solving it. Sampling at
// routine entries instead - ENTRY below, every address in DECOMPILED - cuts
// 2,074,054 samples to 28,691 and is sound in principle: the caller syncs
// every live register immediately before callRom, and a callee takes its
// arguments as JS parameters rather than reading the Machine, so at the
// callee's first address the Machine still holds what the caller synced.
// Measured 2026-07-31 it still reports poll 1, at 0x135ba, still with the
// decompiled side reading zeros. That is not the premise failing again - it is
// that poll 1 is in early boot, before any callRom has happened at all, so
// there has never been a sync to read. The instrument needs to start
// comparing only once the decompiled side has synced at least once, and
// picking that point by hand is guesswork; the honest version detects it.
// THIRD ATTEMPT, which falsifies the fix the second one proposed. Detecting
// the first sync rather than guessing it - the latch below - reports both
// sides synced at sample 0, and sample 1 still reads zeros on the decompiled
// side. So "has synced" is not a latch at all: the Machine's registers are
// valid only at the particular call that synced them, and go stale again
// immediately, because ENTRY also contains entries reached by jumpRom and by
// direct dispatch where no setReg ran. There is no warm-up point that fixes
// this, detected or guessed, and that whole line of attack is closed.
//
// What would work needs a change inside the runtime rather than in this file:
// have setReg bump a counter, and compare only at samples where that counter
// moved during the current call. Then the sampled set is exactly the set the
// decompiled side actually populated, and the recompiled side can be sampled
// at the same addresses. That is the fourth attempt, and it is a change to
// generated code's runtime, so it belongs with handedits.py rather than here.
// FOURTH ATTEMPT, built and measured, and it does not work either - but it
// fails in a way I could not explain, which is worth more than a tidy stop.
// The accessor properties below make every write to a register observable
// from the test without changing generated code, and setReg really does write
// M[r] (decompiled.ts:29), so every sync should be visible. Only 2 of 28,691
// entries come back marked fresh. Those two facts do not fit together and the
// reason is NOT established - do not build on this until it is. The obvious
// suspects, none checked: bind() rebinding M between the two scans; the
// accessors being defined on sys.m while M points somewhere else by the time
// the run starts; or ENTRY addresses being reached overwhelmingly by paths
// that genuinely do not sync, which would make the sparsity real and the
// instrument simply inapplicable rather than broken.
//
// Four attempts is enough to say the shape of the problem out loud: comparing
// registers between these two dispatchers is not a small instrument, because
// they do not agree on where a register lives or when it is valid, and every
// version of the comparison founders on that rather than on a detail. The
// value of this file is now the four recorded failures, not the code.
// Left at exactly the state it was measured in.
//
// Diagnostic, not a ratchet: it is skipped unless REGDIFF is set, because it
// runs the game four times.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { System } from './system';
import { call as viaRecompiled } from './dispatch';
import { call as viaDecompiled, bind, POLL_AT, DECOMPILED } from './decompiled';
import { PATTERNS } from './patterns';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));

const NAME = process.env.REGDIFF_PATTERN ?? 'attract';
const FRAMES = Number(process.env.REGDIFF_FRAMES ?? 500);
const CAP = Number(process.env.REGDIFF_CAP ?? 4_000_000);

/** Every routine's first address. */
const ENTRY: Set<number> = new Set(DECOMPILED.map((e) => e.at));

const REGS = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
  'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'] as const;

type M = Record<string, number>;

/** Hash every poll's register state; or, past `dumpAt`, capture them whole. */
function scan(entry: (addr: number, m: System['m']) => void,
              dumpAt: number): { h: Int32Array; n: number; pc: number; regs: number[]; sync: number; fresh: Uint8Array } {
  const sys = new System(rom, board);
  bind(sys.m);
  sys.m.pollAt = POLL_AT as Set<number>;
  const h = new Int32Array(dumpAt < 0 ? CAP : 1);
  const fresh = new Uint8Array(dumpAt < 0 ? CAP : 1);
  let n = 0, pc = 0, sync = -1;
  let regs: number[] = [];
  const m = sys.m as unknown as M;
  // Count register writes without touching generated code. The Machine's
  // registers are plain fields, so an accessor property defined on the
  // instance shadows each one and every setReg becomes observable from out
  // here. This is what the third attempt lacked: not "has this side ever
  // synced" but "did it sync for THIS call", which is the only question that
  // makes a sample comparable.
  let ver = 0;
  for (const r of REGS) {
    let v = m[r] | 0;
    Object.defineProperty(m, r, {
      configurable: true,
      get: () => v,
      set: (x: number) => { v = x | 0; ver += 1; },
    });
  }
  let lastVer = -1;
  sys.m.atPcExtra = (at: number): void => {
    // Routine entries, not poll points. The decompiled side syncs every live
    // register into the Machine immediately before a callRom, and a callee
    // reads its arguments from JS parameters rather than from the Machine, so
    // at the callee's own first address the Machine still holds exactly what
    // the caller synced. That is the one place both dispatchers are known to
    // agree about what a register means. ENTRY is that set; POLL_AT is not,
    // which is what the header records.
    if (!ENTRY.has(at)) return;
    // When did this side first have registers at all? The Machine's copy
    // starts at zero and is only ever written by a sync, so the first sample
    // with anything non-zero in it is the first sample worth comparing. That
    // is detected, not a hand-picked warm-up: a constant here would produce a
    // confident answer with nothing behind it.
    // Synced for this call, not merely at some point in the past.
    if (ver !== lastVer) { if (sync < 0) sync = n; fresh[n] = 1; }
    lastVer = ver;
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
  return { h, n, pc, regs, sync, fresh };
}

describe('registers', () => {
  it.skipIf(!process.env.REGDIFF)('part at a poll point that names a routine', () => {
    const a = scan(viaRecompiled, -1);
    const b = scan(viaDecompiled, -1);
    const lim = Math.min(a.n, b.n, CAP);
    let at = -1, compared = 0;
    // Only where the decompiled side populated the Machine for that call.
    // Both runs walk the same entries in the same order, so index i is the
    // same call on both sides.
    const from = Math.max(a.sync, b.sync, 0);
    let cmp = 0;
    for (let i = from; i < lim; i += 1) {
      if (!b.fresh[i]) continue;
      cmp += 1;
      if (a.h[i] !== b.h[i]) { at = i; break; }
    }
    compared = cmp;
    let out = `${NAME}: ${a.n} vs ${b.n} entries over ${FRAMES} frames, comparing from ${Math.max(a.sync, b.sync, 0)} (synced at ${a.sync}/${b.sync}); `;
    if (at < 0) {
      out += `registers agree at every one of ${compared} comparable entries`;
    } else {
      const ra = scan(viaRecompiled, at), rb = scan(viaDecompiled, at);
      const which = REGS.filter((_, i) => ra.regs[i] !== rb.regs[i]);
      out += `first differ at entry ${at} of ${lim} (${compared} comparable), pc 0x${ra.pc.toString(16)}`
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
