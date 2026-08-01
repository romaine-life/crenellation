// Where does the colour base come from?
//
// The decompiled run draws every player's panel green: d2's low word reaches
// the graphics decompressor as 0x80 where the oracle has 0x90, 0xA0 and 0xB0,
// so the per-player term is zero. d2 is a parameter all the way down the call
// chain and no routine in it assigns d2, which means the value is set further
// up than the ROM stack's return addresses show.
//
// So ask the oracle. The recompiled dispatcher keeps its registers in the
// machine, so watching d2 there is sound - which the decompiled side is not,
// its registers being JavaScript locals. Find the instruction that puts a
// player's bank into d2 and the lift of that same address is the suspect.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'vitest';
import { System } from './system';
import { call as viaRecompiled } from './dispatch';
import { call as viaDecompiled, bind } from './decompiled';
import { PATTERNS } from './patterns';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));

describe('colour base', () => {
  // Both dispatchers. The decompiled side keeps registers in JavaScript locals,
  // but it spills them to the machine at every block head, so sys.m.d2 is
  // readable there at block granularity - coarser than the oracle's
  // per-instruction view, but the COUNTS are what matter, not the instant.
  for (const [who, entry] of [['oracle', viaRecompiled], ['lift', viaDecompiled]] as const)
  it(`says where the ${who} sets it`, () => {
    const sys = new System(rom, board);
    if (who === 'lift') bind(sys.m);
    const pat = PATTERNS.find((p) => p.name.startsWith('two players'))!;
    const seen = new Map<string, number>();
    const STOP = new Error('enough');
    let n = 0;
    let prev = 0;
    let dumped = false;
    sys.m.atPcExtra = (pc: number): void => {
      // At the decompressor's entry ONLY. Watching d2 wherever it happens to
      // hold a bank byte was a mistake: screenDissolve counts down through
      // 0xF000 and its low byte passes through all four, evenly, which reads
      // exactly like enumerating them. Here d2 IS the colour base - the
      // routine adds it to every pixel - so the value means what it says.
      // The return address on top of the stack names who asked for it.
      // ONE address, not a range: 0x11F18 is where the oracle was seen holding
      // a bank, and sampling the whole routine caught d2 mid-computation.
      // And the CALLER is not the word at (a7) - that is the wrapper's own
      // return address - so walk the stack for ROM addresses the way
      // writes.test's romStack does, and keep the first few.
      // Two addresses, one per dispatcher, and that asymmetry is the point:
      // the recompiler reports every instruction so 0x11F18 is visible to it,
      // while the lift reports block heads and covers the same code at 0x11F2A.
      // Sampling only the oracle's address gives the lift nothing at all -
      // which looks like absence and is only a different reporting grain.
      // Every step of the chain the localisation named, so the step where the
      // value goes wrong is READ OFF rather than inferred. Hand-tracing this
      // path produced a story that did not hold - the one call site pushes
      // literals identical in both runs - so the source is not the way in.
      const STEP: Record<number, string> = {
        0x036a2: 'a fn_036a2 entry',
        0x000e82: 'b renderer entry',
        0x000eb0: 'c renderer, at the call',
        0x011eda: 'd tileset trampoline',
        0x011f08: 'e decompressor entry',
      };
      const step = STEP[pc];
      if (step) {
        const b = sys.m.d2 & 0xff;
        const kk = `${step}  d2.b=0x${b.toString(16)}`;
        seen.set(kk, (seen.get(kk) ?? 0) + 1);
      }
      // The colour at the first point it exists. d2 is a column counter all the
      // way down this chain; the decompressor's prologue sets it from arg8, a
      // stack argument of the wrapper at 0x11F08 - offset 36, per the entry
      // table. So read the stack there, and walk it for the caller: the word at
      // (a7) is only this wrapper's own return.
      if (pc === 0x11f08) {
        const a8 = sys.m.load((sys.m.a7 + 36) >>> 0, 32) >>> 0;
        // The caller, from the machine rather than from the stack. Walking the
        // stack for "ROM-looking" words accepts any even value in 0x400-0x20000,
        // so a coordinate or a packed field passes the filter and prints as a
        // return address - which is how 0x39AA came to be called a caller when
        // no call to it exists. The previous program counter is exact: it is
        // the instruction that transferred here.
        const kk = `ARG8=0x${(a8 & 0xffff).toString(16)} from 0x${prev.toString(16)}`;
        seen.set(kk, (seen.get(kk) ?? 0) + 1);
        // The whole frame, once. The trampoline pushes six longs and JUMPS, so
        // there is no return address and (a7) should be the last of the six.
        // If the lift's slots are shifted by one, every stack argument reads
        // its neighbour - which is the hypothesis this settles.
        if (!dumped) {
          dumped = true;
          const slots: string[] = [];
          for (let i = 0; i <= 40; i += 4) {
            slots.push(`+${i}=0x${(sys.m.load((sys.m.a7 + i) >>> 0, 32) >>> 0).toString(16)}`);
          }
          seen.set(`FRAME a7=0x${(sys.m.a7>>>0).toString(16)} arg8slot=0x${((sys.m.a7+36)>>>0).toString(16)} ${slots.join(' ')}`, 1);
        }
      }
      prev = pc;
      if (pc === 0x11f18 || pc === 0x11f2a) {
        const v = sys.m.d2 & 0xff;
        if (v === 0x80 || v === 0x90 || v === 0xa0 || v === 0xb0) {
          const chain: string[] = [];
          for (let i = 0; i < 160 && chain.length < 4; i += 2) {
            const w = sys.m.load((sys.m.a7 + i) >>> 0, 32) >>> 0;
            if (w >= 0x400 && w < 0x20000 && (w & 1) === 0) chain.push('0x' + w.toString(16));
          }
          const k = `d2.b=0x${v.toString(16)} via ${chain.join(' <- ')}`;
          seen.set(k, (seen.get(k) ?? 0) + 1);
        }
      }
    };
    try {
      sys.run(() => { n += 1; pat.at(n, sys); if (n >= 600) throw STOP; }, entry);
    } catch (e) { if (e !== STOP) { /* the run ends how it ends */ } }
    const rows = [...seen.entries()].sort((a, b) => b[1] - a[1]);
    writeFileSync(join(here, `colour-${who}.txt`),
      rows.map(([k, c]) => `${k}  x${c}`).join('\n'));
  }, 600000);
});
