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
    const regsAt = new Set<string>();
    let lastA0 = -1;
    let lastHead = 0;
    const a0seq: number[] = [];
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
      // Every register at the movem that spills the differing word. writes.test
      // named 0x11EFE by program counter as the instruction that writes
      // 0x3E3274, and it is a movem.l d1-d4/a0-a1,-(a7) - so one of those six
      // already differs on entry. With SPILL_ALL the lift's registers are in
      // the machine here, so this is a real comparison rather than a stale
      // mirror. Recorded once per distinct set, so a constant difference shows
      // as two rows rather than thousands.
      // Every change to a0, in order, with the address that made it. a0 is the
      // register measured eight low at 0x11EFE, and control flow is identical
      // between the runs, so these sequences line up and the first entry that
      // differs names the instruction. Recording changes rather than sampling
      // avoids the cap-and-dedupe mistake that hid this once already.
      // a0 - the compressed-source pointer - at every block head inside the
      // decompressor. It is measured two bytes ahead in the oracle at the
      // divergence, so whichever block first sees a different a0 is upstream of
      // the wrong colour: the run that consumed a different number of source
      // bytes went down a different branch there. Recorded in sequence, not
      // deduped, and only inside the routine, so the list stays short enough to
      // compare position by position.
      // KEYED BY PC, not by occurrence. The recompiled dispatcher reports every
      // instruction and the lifted one only block heads, so a sequence indexed
      // by position measures that difference rather than the program's - which
      // it did, four separate times. Recording (pc, value) pairs and comparing
      // per address instead is immune: an address either side reaches is
      // reached with whatever value it has, and addresses only one side reports
      // simply have no counterpart to disagree with.
      // Widened past the decompressor to its callers. Everything inside
      // 0x11F2A-0x12060 has been compared instruction by instruction and is
      // faithful, so the extra iteration is inherited - and a watch bounded to
      // that routine could never have seen where from.
      // The whole overlay. The stopping rule: widen until the first differing
      // transition STOPS MOVING. It has moved every time the range widened -
      // decompressor, then callers - which is the signature of a fault being
      // inherited rather than found.
      // Bounded by FRAMES, which both runs share, rather than by a sample
      // count, which they do not: the oracle emits one sample per instruction
      // and the lift one per block, so any sample bound compares different
      // amounts of program and reports truncation as agreement.
      // irqDepth === 0 drops everything inside a handler, and with it the
      // seam: the two dispatchers take interrupts at different instants by
      // design, so a path comparison that includes handler entry and rte
      // return finds that difference and nothing else. writes.test excludes
      // exception-frame writes for exactly this reason.
      if (n >= 380 && n < 392 && sys.m.irqDepth === 0
          && pc >= 0x00400 && pc < 0x20000) {
        // A checksum of all sixteen, so one pass covers every register without
        // a file of millions of numbers. Where the checksums first differ names
        // the address and the visit; which register it was is then one targeted
        // re-read away, and the code around that address usually says.
        // The PATH, not the registers. The lifted side reports only block
        // heads; the oracle reports every instruction, so filtering its stream
        // down to the addresses the lift reports makes the two sequences the
        // same kind of thing - the order of blocks executed. The first place
        // they differ is the mis-lifted branch itself rather than a shadow of
        // it several registers downstream.
        // a0 at 0x11F2A, per visit, plus the byte it points at. If a0 agrees
        // where the paths part then the runs load the same byte and the lift's
        // branch condition is wrong; if a0 differs, the branch is fine and the
        // pointer got there wrong.
        // a0 at EVERY block head, keyed by address and visit. The window is
        // between two visits to 0x11F2A and the paths are identical through it,
        // so whichever head first shows a different a0 contains the addressing
        // mode that advances it wrongly.
        // pc AND a0 on one timeline, so the block-path divergence and the
        // pointer divergence can be ordered against each other instead of
        // compared as two separate runs - which is how the causal direction
        // between the branch and the pointer came to be asserted unproven.
        // The TRANSITION, not the position. Two streams of different lengths
        // can be compared element-wise to find where they part, but not to say
        // which successor each side chose - that needs the predecessor too.
        // With both, the first differing (from -> to) pair IS the mis-lifted
        // branch, named rather than inferred.
        a0seq.push(lastHead, pc);
        lastHead = pc;
      }
      if (pc === 0x11efe && regsAt.size < 40) {
        const m2 = sys.m;
        regsAt.add(`d1=0x${(m2.d1 >>> 0).toString(16)} d2=0x${(m2.d2 >>> 0).toString(16)}`
          + ` d3=0x${(m2.d3 >>> 0).toString(16)} d4=0x${(m2.d4 >>> 0).toString(16)}`
          + ` a0=0x${(m2.a0 >>> 0).toString(16)} a1=0x${(m2.a1 >>> 0).toString(16)}`);
      }
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
    for (const r of regsAt) seen.set('REGS ' + r, 0);
    writeFileSync(join(here, `a0seq-${who}.txt`),
      a0seq.join(',').slice(0, 4000000));
    const rows = [...seen.entries()].sort((a, b) => b[1] - a[1]);
    writeFileSync(join(here, `colour-${who}.txt`),
      rows.map(([k, c]) => `${k}  x${c}`).join('\n'));
  }, 600000);
});
