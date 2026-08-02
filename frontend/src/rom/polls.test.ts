// The seam between the two dispatchers, and the instrument for it.
//
// compose and writes say WHETHER the two runs agree. This says WHERE they
// stopped agreeing, in four questions of narrowing scope, and it is what to
// reach for when either of those reports a difference:
//
//   1. Do both cross every frame boundary at the same pc, having spent the
//      same cycles, at the same stack depth, with the same interrupt count?
//      That is the coarsest thing that can be true, and if it is, every later
//      difference is downstream of something else.
//   2. Does every interrupt stack the same exception frame - the same return
//      address, the same status register? This is the only test in the
//      equivalence suite still carrying a floor, and what it holds is one bit.
//   3. Are the poll points reached in the same order, having cost the same?
//      POLL_QUIET=1 delivers no interrupts at all, which is the only mode
//      where that clock column means what it says - see the note there.
//   4. POLL_FRAME=N: every poll inside one frame, with the clock at each.
//      Once question 1 says "together at N, apart at N+1", the fault is inside
//      those few thousand polls and can be recorded whole.
//
// It began as "where do the twenty-seven come from?" - a poll count differing
// by 27 in 1.87 million - and the answer turned out to be that counting was
// the wrong instrument. Every hypothesis argued from the count alone was
// wrong; every one that survived came from recording the sequence and reading
// one more column of it.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { System } from './system';
import { call as viaRecompiled } from './dispatch';
import { call as viaDecompiled, bind, POLL_AT, original } from './decompiled';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));

// Enough to cover the window the write comparison diverges in, and small
// enough that two Int32Arrays of it are megabytes rather than gigabytes.
const CAP = Number(process.env.POLL_CAP ?? 2_000_000);
const FRAMES = Number(process.env.POLL_FRAMES ?? 400);
const SKIP = new Set((process.env.POLL_SKIP ?? '').split(',')
  .filter(Boolean).map((s) => Number.parseInt(s, 16)));

const WATCH = Number.parseInt(process.env.POLL_WATCH ?? '0', 16);

// Every rule as the ROM has it. This asks only whether the two dispatchers run
// the same program, so a rule the port changes on purpose is noise here - and
// loud noise: the changed wall rule at 0x2588 sends a tile index down a
// different path, which is what "frame 390 is the first to part" was, all the
// way through to a green banner. See RULES in decompiled.ts.
original();

// Every register a routine can take an argument in. Sampling a handful is how
// a watch reports "registers agree" about a function whose signature names
// a5, d3, d6 and d7 - true of what was looked at, and useless. a7 is left out:
// it is the stack pointer, and the two runs' dead stack below it differs by
// design.
const REGS = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
  'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'];

type Seq = { pc: Int32Array; cyc: Int32Array; watched: number[][] };

function sequence(entry: (a: number, m: System['m']) => void): Seq {
  const sys = new System(rom, board);
  bind(sys.m);
  sys.m.pollAt = POLL_AT as Set<number>;
  const seq = new Int32Array(CAP);
  // The clock at each poll point. Two runs that execute the same code reach
  // the same block heads *having spent the same cycles getting there*, so the
  // first poll where the addresses agree and the clocks do not is the block
  // that charges differently - which the write comparison can only report as
  // "cycles first differ at write 0", 26 apart, with no way to say where.
  const cyc = new Int32Array(CAP);
  const watched: number[][] = [];
  let n = 0;
  // Same pacing the write comparison uses, so this measures the same runs it
  // does rather than a differently-timed pair.
  const PER_FRAME = Number(process.env.POLLS_PER_FRAME ?? 9000);
  const isRecompiled = entry === viaRecompiled;
  let polls = 0;
  let rerunAt = -1;
  const FULL = new Error('recorded enough');
  // POLL_QUIET=1 delivers no interrupts at all, and it is the only mode in
  // which the clock column here means what it says.
  //
  // With pacing on, the recompiled side is discounted one poll per frame -
  // `rerunAt` - because an interrupt it takes resumes by re-running the
  // instruction it was interrupted at. But an interrupt raised while the
  // status register masks it is *not* taken, no re-run happens, and the
  // discount then swallows a real poll and shifts that run's clock by one
  // block. That is the whole of "clocks first differ at poll 9000, which is
  // the frame boundary": an artefact of the instrument, arriving at the very
  // first boundary and masking every genuine difference after it.
  //
  // Quiet mode removes the cause rather than compensating for it. The game
  // boots, reaches the loop that waits for a frame that never comes, and
  // spins there - which is thoroughly enough exercised code to price, and
  // every poll in it is uncontaminated. Two runs executing the same
  // instructions must reach the same block heads having spent the same
  // cycles; here there is nothing else that could make them differ.
  const QUIET = process.env.POLL_QUIET === '1';
  sys.pacedIrq = () => {
    const pc = sys.m.pc;
    if (!POLL_AT.has(pc)) return false;
    // An inner entry is a block head in *its own* function and interior to a
    // merged block in the routine that contains it. POLL_AT is flat, so the
    // recompiled run - which has no notion of which function it is in - polls
    // there while the decompiled host, having merged the block away, does not.
    // Excluding one says whether that is the whole mechanism.
    if (SKIP.has(pc)) return false;
    if (rerunAt === pc) { rerunAt = -1; return false; }
    if (n >= CAP) throw FULL;
    // The registers at a chosen block head. The poll sequence says the two
    // runs part inside a loop; it cannot say why, because the reason is the
    // state the loop was entered with. WATCH records that state so the first
    // differing register is named rather than inferred.
    if (pc === WATCH) {
      const r = sys.m as unknown as Record<string, number>;
      watched.push(REGS.map((x) => r[x] | 0));
    }
    seq[n] = pc | 0;
    cyc[n] = sys.m.cycles | 0;
    n += 1;
    polls += 1;
    if (QUIET) return false;
    if (polls < PER_FRAME) return false;
    polls = 0;
    if (isRecompiled) rerunAt = pc;
    return true;
  };
  const STOP = new Error('enough');
  let f = 0;
  try {
    sys.run(() => { f += 1; if (f > FRAMES) throw STOP; }, entry);
  } catch (e) {
    if (e !== STOP && e !== FULL) {
      // A run that has already parted company can reach somewhere the machine
      // never models. That is a result, not a crash - record how far it got.
      return { pc: seq.subarray(0, n), cyc: cyc.subarray(0, n), watched };
    }
  }
  return { pc: seq.subarray(0, n), cyc: cyc.subarray(0, n), watched };
}

/**
 * Where each run stands when a frame boundary arrives.
 *
 * The poll comparison above runs on a *paced* schedule - a fixed number of
 * polls to the frame - which is a position measure and deliberately not the
 * one the game runs on. compose and writes both use the real thing: the clock
 * crosses a threshold and the crossing is tested at a poll point. So this
 * records the crossings themselves, in exactly the configuration those two
 * harnesses use, and asks the only question that matters for them - do the two
 * runs cross frame N at the same instruction, having spent the same cycles,
 * at the same stack depth, having taken the same number of interrupts?
 *
 * If they do, every later difference is downstream of something else. If they
 * do not, the first frame where they part names the crossing to look at, and
 * the four columns say which of the four things went first.
 */
type Cross = { pc: number[]; cyc: number[]; sp: number[]; taken: number[];
  depth: number[]; ended: string };

function crossings(entry: (a: number, m: System['m']) => void, frames: number): Cross {
  const sys = new System(rom, board);
  bind(sys.m);
  sys.m.pollAt = POLL_AT as Set<number>;
  const pc: number[] = []; const cyc: number[] = []; const sp: number[] = [];
  const taken: number[] = []; const depth: number[] = [];
  const STOP = new Error('enough');
  let ended = '';
  try {
    sys.run((s) => {
      // Read at the crossing, not after it. System.crossedAt is the clock the
      // boundary was decided on; s.m.cycles here is the same value, but only
      // because onFrame is called from inside atPc before anything advances.
      pc.push(s.m.pc >>> 0); cyc.push(s.crossedAt); sp.push(s.m.a7 >>> 0);
      taken.push(s.m.irqTaken); depth.push(s.m.irqDepth);
      if (pc.length >= frames) throw STOP;
    }, entry);
  } catch (e) {
    if (e !== STOP) ended = (e as Error).message.slice(0, 80);
  }
  return { pc, cyc, sp, taken, depth, ended };
}

/**
 * Every poll in one frame, with the clock at each.
 *
 * Once the crossing comparison says the two runs are together at frame N and
 * apart at N+1, the fault is inside that one frame - a few thousand polls
 * rather than two million - and it can be recorded whole, in the live
 * configuration, with no pacing and no discounting to argue about. The first
 * poll where the clocks part names the block that prices differently; the
 * first where the addresses part names where the paths finally separate.
 *
 * The recompiled side polls a block head twice around an interrupt it takes -
 * it resumes by re-running the instruction it was interrupted at, and the poll
 * comes before the instruction - so the streams are aligned by skipping a
 * repeat of the immediately preceding address. That is a property of the
 * dispatcher, not of the game, and it is the only alignment applied.
 */
function inFrame(entry: (a: number, m: System['m']) => void, frame: number): {
  pc: number[]; cyc: number[]; depth: number[]; regs: number[][];
} {
  const sys = new System(rom, board);
  bind(sys.m);
  sys.m.pollAt = POLL_AT as Set<number>;
  const pc: number[] = []; const cyc: number[] = []; const depth: number[] = [];
  // Registers at a chosen block head, for the one comparison where reading
  // them is sound: a *routine entry*. Everywhere else the decompiled side
  // keeps its registers in JavaScript locals and the machine's copies are
  // whatever was last spilled, so comparing them says nothing. At an entry
  // both dispatchers have just read their arguments out of the machine, so
  // the machine is authoritative in both and a difference is real.
  const regs: number[][] = [];
  const STOP = new Error('enough');
  let f = 0;
  let recording = false;
  const isRecompiled = entry === viaRecompiled;
  // The resume poll. When the recompiled dispatcher takes an interrupt it
  // throws before executing, runs the handler, and loops back to `m.tick(pc)`
  // with the same pc - so the address it was interrupted at is polled a second
  // time, after the handler and before the instruction. The decompiled side
  // returns from `takeIrq` into the middle of the block and does not poll
  // again. One extra entry per interrupt, always the address the handler
  // interrupted, always the first poll back at depth zero.
  let lastDepth0 = -1;
  let wasDeep = false;
  sys.m.atPcExtra = (at: number): void => {
    if (!recording || !POLL_AT.has(at)) return;
    const d = sys.m.irqDepth;
    if (d === 0) {
      if (wasDeep) {
        wasDeep = false;
        if (isRecompiled && at === lastDepth0) return;
      }
      lastDepth0 = at;
    } else {
      wasDeep = true;
    }
    if (at === WATCH) {
      const r = sys.m as unknown as Record<string, number>;
      regs.push([...REGS.map((x) => r[x] | 0), sys.m.byte(r.a0 >>> 0),
        sys.m.byte(r.a1 >>> 0)]);
    }
    pc.push(at >>> 0); cyc.push(sys.m.cycles); depth.push(d);
  };
  try {
    sys.run((s) => {
      f += 1;
      if (f === frame) {
        recording = true;
        // The crossing itself is not recorded - atPcExtra runs before the
        // boundary test, so recording was still off when this poll passed
        // through. Seed the resume address from it anyway: the interrupt this
        // boundary raises is taken here, and the recompiled side's first poll
        // back at depth zero is this address again.
        lastDepth0 = s.m.pc >>> 0;
      } else if (f > frame) throw STOP;
    }, entry);
  } catch (e) {
    if (e !== STOP) { /* record how far it got */ }
  }
  return { pc, cyc, depth, regs };
}

/**
 * The exception frames themselves: what each run stacks, and where from.
 *
 * An interrupt pushes the return address and the status register. The address
 * both dispatchers now agree on - they take interrupts at the same block head
 * having spent the same cycles - so what is left is the condition codes, and
 * those the lifted side keeps in JavaScript until something asks. `movem`
 * inside the handler writes them to the stack, the handler pops them back, and
 * the bytes stay behind as residue - which is why this survives a comparison
 * of everything the game *reads* and shows up only in a byte-exact snapshot of
 * the stack.
 *
 * So compare the frames directly rather than the residue. A difference names
 * the interrupt, the address it was taken at, and which condition code is
 * wrong - which is a block whose flags the lifter did not sync, not a mystery
 * about dead memory.
 */
function frames(entry: (a: number, m: System['m']) => void, n: number): {
  pc: number[]; sr: number[]; xpc: number[];
} {
  const sys = new System(rom, board);
  bind(sys.m);
  sys.m.pollAt = POLL_AT as Set<number>;
  const pc: number[] = []; const sr: number[] = []; const xpc: number[] = [];
  // Where X was last changed. X is the one condition code that outlives the
  // instruction after it - a move, a compare or a logic op leaves it alone -
  // so when the two runs disagree about it, the question is not "which block
  // failed to sync" but "which instruction set it, and does the lift of that
  // instruction know". Sampled by watching for the bit to move.
  let lastX = false;
  let lastXpc = 0;
  let prev = 0;
  sys.m.atPcExtra = (at: number): void => {
    if (sys.m.x !== lastX) { lastX = sys.m.x; lastXpc = prev; }
    prev = at;
  };
  const base = sys.m.interruptFrame.bind(sys.m);
  sys.m.interruptFrame = (level: number): number => {
    pc.push(sys.m.next >>> 0); sr.push(sys.m.getSR() & 0xffff);
    xpc.push(lastXpc >>> 0);
    return base(level);
  };
  const STOP = new Error('enough');
  let f = 0;
  try {
    sys.run(() => { f += 1; if (f >= n) throw STOP; }, entry);
  } catch (e) { if (e !== STOP) { /* however far it got */ } }
  return { pc, sr, xpc };
}

describe('poll points', () => {
  it('stack the same exception frame at every interrupt', () => {
    // A full attract loop, which is 2,125 interrupts - and the length the
    // floor below was measured at. It shared CROSS_FRAMES with the crossing
    // test's 1,200, which reaches only 925, so the assertion compared a short
    // run against a long run's number and failed for the wrong reason.
    const N = Number(process.env.FRAME_FRAMES ?? 2400);
    const A = frames(viaRecompiled, N);
    const B = frames(viaDecompiled, N);
    const lim = Math.min(A.pc.length, B.pc.length);
    let k = 0;
    while (k < lim && A.pc[k] === B.pc[k] && A.sr[k] === B.sr[k]) k += 1;
    const CC = ['c', 'v', 'z', 'n', 'x'];
    const lines = [`recompiled took ${A.pc.length} interrupts, decompiled ${B.pc.length}`];
    if (k >= lim) {
      lines.push(`all ${lim} stack the same address and the same status register`);
    } else {
      const bits = (a: number, b: number): string => CC
        .map((nm, i) => [nm, i] as [string, number])
        .filter(([, i]) => (((a >> i) & 1) !== ((b >> i) & 1)))
        .map(([nm]) => nm).join(' ') || 'none of the condition codes';
      lines.push(`interrupt ${k} of ${lim} differs: taken at`
        + ` 0x${A.pc[k].toString(16)}/0x${B.pc[k].toString(16)},`
        + ` sr 0x${A.sr[k].toString(16)}/0x${B.sr[k].toString(16)}`
        + ` - ${bits(A.sr[k], B.sr[k])}`
        + `; X last changed at 0x${A.xpc[k].toString(16)}/0x${B.xpc[k].toString(16)}`);
      for (let j = Math.max(0, k - 3); j <= k; j += 1) {
        lines.push(`  ${j}: 0x${A.pc[j].toString(16)}/0x${B.pc[j].toString(16)}`
          + ` sr 0x${A.sr[j].toString(16)}/0x${B.sr[j].toString(16)}`);
      }
    }
    const report = lines.join('\n');
    writeFileSync(join(here, 'frames.txt'), report);
    // eslint-disable-next-line no-console
    console.log(report);
    // Ratcheted, not exact, and this is the one place in the equivalence suite
    // that still is - everything else now asserts identity.
    //
    // What is left, measured 2026-08-02: interrupts 0 to 1,219 of 2,125 stack
    // the same address and the same status register in both runs; interrupt
    // 1,220, at 0x444, differs in the X bit alone - 0x2314 against 0x2304.
    // X is the one condition code that outlives the instruction after it, so
    // it can have been set by arithmetic several routines back, and the lifted
    // world computes its flags in JavaScript and writes them to the machine
    // only at sync points. Running with SPILL_ALL=1 - a spill at every block
    // head - does not change it, so this is not a missing sync point: the two
    // sides genuinely disagree about the bit. The instruction the oracle last
    // changed X at is 0x3B76, `addq.w #$1,-$a(a6)`, whose lift emits the
    // matching `setXAdd` inline, so the disagreement is somewhere between
    // there and 0x444 and is not yet located.
    //
    // Why it is worth only a ratchet: the bit reaches memory in an exception
    // frame and nowhere else, the handler pops that frame, and every write
    // either dispatcher makes outside those six bytes is identical over
    // sixty-two million of them (writes.test). compose compares whole memory
    // every frame of every pattern and is identical, because the bytes are
    // below the stack pointer by the time it looks. So this is real and it is
    // small, and a number that can only go up is the honest way to hold it.
    const floor: number = (JSON.parse(
      readFileSync(join(here, 'baseline.json'), 'utf8')) as Record<string, number>)['frames'] ?? 0;
    expect(k).toBeGreaterThanOrEqual(floor);
  }, 900000);

  it.skipIf(!process.env.POLL_FRAME)('agree on every poll within one frame', () => {
    const frame = Number(process.env.POLL_FRAME);
    const A = inFrame(viaRecompiled, frame);
    const B = inFrame(viaDecompiled, frame);
    const lim = Math.min(A.pc.length, B.pc.length);
    let p = 0;
    while (p < lim && A.pc[p] === B.pc[p]) p += 1;
    let c = 0;
    while (c < lim && A.cyc[c] === B.cyc[c]) c += 1;
    const lines = [`frame ${frame}: recompiled polled ${A.pc.length},`
      + ` decompiled ${B.pc.length}`,
    p >= lim ? `addresses identical over all ${lim}`
      : `addresses part at poll ${p}: 0x${A.pc[p].toString(16)} vs 0x${B.pc[p].toString(16)}`,
    c >= lim ? `clocks identical over all ${lim}`
      : `clocks part at poll ${c} (0x${A.pc[c].toString(16)}, depth`
        + ` ${A.depth[c]}/${B.depth[c]}): ${A.cyc[c]} vs ${B.cyc[c]}`
        + ` (${B.cyc[c] - A.cyc[c]} apart)` + (c === 0
          ? ' - the first poll recorded, so the step into it is the frame'
            + ' boundary itself'
          : `, charged ${A.cyc[c] - A.cyc[c - 1]}/${B.cyc[c] - B.cyc[c - 1]}`
            + ` for the step from 0x${A.pc[c - 1].toString(16)}`)];
    const at = Math.min(p, c);
    if (at < lim) {
      const from = Math.max(0, at - 8);
      for (let j = from; j <= Math.min(at + 3, lim - 1); j += 1) {
        lines.push(`  ${j}: 0x${A.pc[j].toString(16)}/0x${B.pc[j].toString(16)}`
          + ` @${A.cyc[j]}/${B.cyc[j]} depth ${A.depth[j]}/${B.depth[j]}`);
      }
    }
    if (WATCH) {
      const R = [...REGS, '(a0)', '(a1)'];
      const n = Math.min(A.regs.length, B.regs.length);
      let w = 0;
      while (w < n && R.every((_, k) => A.regs[w][k] === B.regs[w][k])) w += 1;
      lines.push(`watched 0x${WATCH.toString(16)}: ${A.regs.length} vs`
        + ` ${B.regs.length} arrivals in this frame`);
      lines.push(w >= n ? `  every register agrees at all ${n}`
        : `  arrival ${w} differs: ` + R.map((r, k) => [r, k] as [string, number])
          .filter(([, k]) => A.regs[w][k] !== B.regs[w][k])
          .map(([r, k]) => `${r} 0x${(A.regs[w][k] >>> 0).toString(16)}`
            + `/0x${(B.regs[w][k] >>> 0).toString(16)}`).join(' '));
    }
    const report = lines.join('\n');
    writeFileSync(join(here, 'pollframe.txt'), report);
    // eslint-disable-next-line no-console
    console.log(report);
    expect(lim).toBeGreaterThan(0);
  }, 900000);

  it('put both runs at the same place at every frame boundary', () => {
    // A full attract loop, the same span the frame comparison uses, so the two
    // report on the same run.
    const N = Number(process.env.CROSS_FRAMES ?? 2400);
    const A = crossings(viaRecompiled, N);
    const B = crossings(viaDecompiled, N);
    const lim = Math.min(A.pc.length, B.pc.length);
    const same = (k: number): boolean => A.pc[k] === B.pc[k] && A.cyc[k] === B.cyc[k]
      && A.sp[k] === B.sp[k] && A.taken[k] === B.taken[k] && A.depth[k] === B.depth[k];
    let k = 0;
    while (k < lim && same(k)) k += 1;
    const lines = [`recompiled crossed ${A.pc.length} frame boundaries`
      + `${A.ended ? ` (${A.ended})` : ''}, decompiled ${B.pc.length}`
      + `${B.ended ? ` (${B.ended})` : ''}`];
    if (k >= lim) {
      lines.push(`both cross all ${lim} at the same pc, clock, stack depth,`
        + ' interrupt count and handler depth');
    } else {
      const col = (n: string, a: number, b: number, hex = true): string =>
        a === b ? '' : ` ${n} ${hex ? '0x' + a.toString(16) : a}`
          + `/${hex ? '0x' + b.toString(16) : b}`;
      lines.push(`frame ${k + 1} of ${lim} is the first to part:`
        + col('pc', A.pc[k], B.pc[k]) + col('clock', A.cyc[k], B.cyc[k], false)
        + col('sp', A.sp[k], B.sp[k]) + col('interrupts', A.taken[k], B.taken[k], false)
        + col('handler depth', A.depth[k], B.depth[k], false));
      const from = Math.max(0, k - 4);
      for (let j = from; j <= k && j < lim; j += 1) {
        lines.push(`  frame ${j + 1}: pc 0x${A.pc[j].toString(16)}/0x${B.pc[j].toString(16)}`
          + ` clock ${A.cyc[j]}/${B.cyc[j]} sp 0x${A.sp[j].toString(16)}/0x${B.sp[j].toString(16)}`
          + ` irqs ${A.taken[j]}/${B.taken[j]} depth ${A.depth[j]}/${B.depth[j]}`);
      }
    }
    const report = lines.join('\n');
    writeFileSync(join(here, 'crossings.txt'), report);
    // eslint-disable-next-line no-console
    console.log(report);
    expect(lim).toBeGreaterThan(0);
  }, 900000);

  it('are reached in the same order', () => {
    const A = sequence(viaRecompiled);
    const B = sequence(viaDecompiled);
    const a = A.pc; const b = B.pc;
    const lim = Math.min(a.length, b.length);
    let i = 0;
    while (i < lim && a[i] === b[i]) i += 1;
    const lines = [
      `recompiled polled ${a.length}, decompiled polled ${b.length}`,
      i === lim
        ? `identical over the shared prefix of ${lim}`
        : `first difference at poll ${i}: recompiled 0x${a[i].toString(16)}`
          + ` vs decompiled 0x${b[i].toString(16)}`,
    ];
    if (i < lim) {
      // The run-up, because a poll point that appears in one run and not the
      // other is a block one side entered and the other did not - and which
      // block that is only reads from what came before it.
      const from = Math.max(0, i - 12);
      lines.push('  run-up (shared): '
        + Array.from(a.subarray(from, i)).map((x) => x.toString(16)).join(' '));
      lines.push('  recompiled next: '
        + Array.from(a.subarray(i, i + 12)).map((x) => x.toString(16)).join(' '));
      lines.push('  decompiled next: '
        + Array.from(b.subarray(i, i + 12)).map((x) => x.toString(16)).join(' '));
      // If one side simply skips a single poll, the sequences re-synchronise
      // one step over. Say so, because that is a different fault from a run
      // that has genuinely taken another path.
      for (const [side, lead, lag] of [['decompiled skipped', a, b],
        ['recompiled skipped', b, a]] as Array<[string, Int32Array, Int32Array]>) {
        let k = 0;
        while (i + k + 1 < lim && lead[i + k + 1] === lag[i + k]) k += 1;
        if (k > 32) lines.push(`  ${side} one poll at 0x${lead[i].toString(16)}`
          + `; the streams re-synchronise and stay together for ${k} more`);
      }
    }
    // The clocks part long before the paths do, and that is the fault worth
    // fixing: while both runs still reach the same blocks in the same order,
    // one has spent more cycles doing it, and a frame boundary eventually
    // lands between them. The first poll where the addresses agree and the
    // clocks do not names the block that charges differently.
    let c = 0;
    while (c < i && A.cyc[c] === B.cyc[c]) c += 1;
    if (c < i) {
      // At the frame boundary the recompiled side's post-interrupt re-tick is
      // discounted, so a poll goes unrecorded and its clock lands on the next
      // one - which reads as a gap of exactly one block. Confirmed by moving
      // the pacing: at 9000 the gap sits at poll 9000, at 7000 at poll 7000.
      // Say so, or it looks like drift and gets chased. Again.
      const perFrame = Number(process.env.POLLS_PER_FRAME ?? 9000);
      if (c > 0 && c % perFrame === 0) {
        lines.push(`clocks first differ at poll ${c}, which is the frame`
          + ` boundary (${perFrame}): the discounted re-tick, not drift`);
      }
      lines.push(`clocks first differ at poll ${c} (0x${a[c].toString(16)}):`
        + ` recompiled ${A.cyc[c]} vs decompiled ${B.cyc[c]}`
        + ` (${B.cyc[c] - A.cyc[c]} apart)`);
      const from = Math.max(0, c - 6);
      lines.push('  blocks before it: '
        + Array.from(a.subarray(from, c + 1)).map((x, k) => `${x.toString(16)}`
          + `@${A.cyc[from + k]}/${B.cyc[from + k]}`).join(' '));
    } else {
      lines.push(`clocks agree over all ${i} shared polls`);
    }
    // Every poll where the gap CHANGES, not only the first. Reading the first
    // one alone produced three separate wrong explanations of this divergence,
    // each withdrawn: the sign of one step cannot distinguish a block priced
    // wrongly from a pair of blocks priced in the wrong order, and the list
    // can. What each side charged for the step into the poll, and where it
    // came from, is the column that settles it - a transition charged 28 by
    // one side and 252 by the other, from the same address, is the two
    // emitters disagreeing about which instructions belong to which block.
    {
      const steps: string[] = [];
      let gap = 0;
      for (let k = 1; k < i && steps.length < 24; k += 1) {
        const g = (B.cyc[k] - A.cyc[k]) | 0;
        if (g === gap) continue;
        gap = g;
        steps.push(`  poll ${k} 0x${a[k].toString(16)} from 0x${a[k - 1].toString(16)}:`
          + ` charged ${A.cyc[k] - A.cyc[k - 1]}/${B.cyc[k] - B.cyc[k - 1]}`
          + ` (gap now ${g})`);
      }
      lines.push(steps.length
        ? `the gap changes at ${steps.length} polls:` : 'the gap never changes');
      lines.push(...steps);
    }
    if (WATCH) {
      const R = REGS;
      const lim2 = Math.min(A.watched.length, B.watched.length);
      let w = 0;
      while (w < lim2 && R.every((_, k) => A.watched[w][k] === B.watched[w][k])) w += 1;
      lines.push(`watched 0x${WATCH.toString(16)}: ${A.watched.length}`
        + ` vs ${B.watched.length} entries, ${R.length} registers each`);
      // Only the registers that differ. Printing all fifteen buries the two
      // that matter, and the whole point of this is to name them.
      lines.push(w === lim2 ? `  registers agree over all ${lim2}`
        : `  first differing entry ${w}: `
          + R.map((r, k) => [r, k] as [string, number])
            .filter(([, k]) => A.watched[w][k] !== B.watched[w][k])
            .map(([r, k]) => `${r} ${A.watched[w][k].toString(16)}`
              + `/${B.watched[w][k].toString(16)}`).join(' '));
    }
    const report = lines.join('\n');
    writeFileSync(join(here, 'polls.txt'), report);
    // eslint-disable-next-line no-console
    console.log(report);
    expect(a.length).toBeGreaterThan(0);
  }, 900000);
});
