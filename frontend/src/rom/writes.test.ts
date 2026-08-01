// Which write differs first, and who made it?
//
// Comparing call sequences does not work: the recompiled dispatcher only sees
// calls that leave a routine's own switch, while the decompiled one routes
// every call through. Writes are comparable either way - the same behaviour
// writes the same bytes in the same order - so this records every write to work
// RAM from both runs, finds the first that differs, and then re-runs the
// decompiled side to capture the JavaScript stack at exactly that write.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { System } from './system';
import { call as viaRecompiled } from './dispatch';
import { call as viaDecompiled, bind, POLL_AT } from './decompiled';
import { PATTERNS, type Pattern } from './patterns';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));
// How far the two write streams agree before the first known divergence -
// today that is the sound sequencer's boot-tail state around frame 276, the
// one CLAUDE.md documents. The floor ratchets: a change that diverges earlier
// is a regression and fails; a change that pushes the divergence later (or to
// nothing) should raise the floor. It sat at 6139 - a palette write in the
// self test - until the self-test region was mapped and lifted properly.
const floor: number = (JSON.parse(
  readFileSync(join(here, 'baseline.json'), 'utf8')) as Record<string, number>)['writes'] ?? 0;
// Zero means each pattern's own full length.
const FRAMES = Number(process.env.WRITE_FRAMES ?? 0);
const LO = Number(process.env.W_LO ?? 0x3e0000);
const HI = Number(process.env.W_HI ?? 0x400000);
// How many writes to record before stopping the run. It is a bound on the
// instrument, not on the game: a divergence past it is out of this harness's
// reach, and the number is chosen to cover the whole boot and a good stretch
// of play - all six patterns part company at write 10,967, in the boot.
//
// It also bounds the cost, which is the reason it exists. At four million the
// suite ran for three and a half hours: each pattern executes the game twice
// with a hook on every store, and the recording continued long after both
// streams had said everything they had to say. A suite that takes an afternoon
// is a suite nobody runs, which is the same failure as one that can never be
// green.
// 600,000, because the runs are now measured to agree on 576,837 consecutive
// writes and a cap below that reports a floor while sounding like identity.
// Not higher: WRITE_CAP=3,000,000 kills the worker - five Int32Arrays that
// size - and 600,000 costs about 12MB and runs in thirteen seconds.
const CAP = Number(process.env.WRITE_CAP ?? 600_000);

// The interrupt-terminated rotate loop, from facts.json. Diagnostic only:
// WAIT_SKIP is off unless asked for, so the default run still measures every
// write the game makes.
const WAIT_LO = 0x00430;
const WAIT_HI = 0x00512;
const WAIT_SKIP = process.env.WAIT_SKIP === '1';
const FRAME_BYTES = process.env.FRAME_BYTES === '1';
// Diagnostic: compare the poll-address sequences of the two dispatchers.
const PC_SEQ = process.env.PC_SEQ === '1';
const PC_CAP = Number(process.env.PC_CAP ?? 3_000_000);
const seq: string[] = [];
console.log(`PC_SEQ=${JSON.stringify(process.env.PC_SEQ)} -> ${PC_SEQ}, cap ${PC_CAP}`);

type Run = { addr: Int32Array; val: Int32Array; cyc: Int32Array;
  irq: Int32Array; pol: Int32Array; a6: Int32Array; d2: Int32Array; n: number };

function record(p: Pattern, entry: (addr: number, m: System['m']) => void,
                stopAt = -1): { run: Run; stack: string; romStack: number[];
                                pcs: Int32Array | null; pn: number; cyc: Int32Array | null; srs: Int32Array | null; frs: Int32Array | null; fcyc: Int32Array | null; d2s: Int32Array | null; regs: Int32Array | null; early: Int32Array | null; io: number[]; hpoll: Int32Array; hidx: number; irqRegs: number[]; pend: Int32Array | null } {
  const sys = new System(rom, board);
  // Every input the machine observes, in order. The registers part at an input
  // read (0x196BE reads 0x640003), and input is the one thing here that is not
  // pure computation - so if the two runs ever SEE different bytes, no lifting
  // rule can make them agree and the origin is the harness. Ports and trackball
  // both, since the patterns step the trackball counters on a schedule.
  // Registers at the ONLY sound point. Both dispatchers call interruptFrame
  // once they have committed their state to the machine - the decompiled from
  // takeIrq, after its setReg spill; the recompiled because its registers are
  // always in the machine. Sampling anywhere else reads the decompiled side's
  // mirror one step early, which is what made three earlier register results
  // artefacts.
  const irqRegs: number[] = [];
  const baseFrame = sys.m.interruptFrame.bind(sys.m);
  sys.m.interruptFrame = (level: number): number => {
    const m2 = sys.m;
    if (irqRegs.length < 200000) {
      irqRegs.push(m2.d0 | 0, m2.d1 | 0, m2.d2 | 0, m2.d3 | 0,
                   m2.d4 | 0, m2.d5 | 0, m2.d6 | 0, m2.d7 | 0, m2.pc | 0, pn | 0, m2.cycles | 0);
    }
    return baseFrame(level);
  };
  const io: number[] = [];
  const baseIn = sys.m.inputAt, baseTr = sys.m.trackAt;
  sys.m.inputAt = (a: number): number => {
    const v = baseIn ? baseIn(a) : 0xff; if (io.length < 400000) io.push(a, v, sys.m.pc | 0); return v;
  };
  sys.m.trackAt = (a: number): number => {
    const v = baseTr ? baseTr(a) : 0; if (io.length < 400000) io.push(a, v, sys.m.pc | 0); return v;
  };
  // Shift the first interrupt. This is the discriminator for "is a value that
  // differs between the two runs a real quantity the game computed, or residue
  // of where the interrupt landed?" - move the phase and re-read the SAME
  // dispatcher's value. A quantity the game computed does not care what the
  // board's phase was; residue does. The board's own phase is not special, so
  // any answer that changes with it was never the game's answer.
  sys.irqPhase = Number(process.env.IRQ_PHASE ?? 0);
  bind(sys.m);
  // Both runs poll for interrupts at the same addresses - the decompiled
  // side's block heads, which is the only granularity it has. Without this
  // the recompiled run can take an interrupt between any two instructions
  // and a spin loop stops on a different iteration, so the comparison
  // measures the interrupt schedule rather than the code.
  sys.m.pollAt = POLL_AT as Set<number>;
  // Whether control is inside the wait loop, tracked at the same points the
  // interrupt poll uses, which is the finest granularity either dispatcher has.
  let inWait = false;
  const pcs: Int32Array | null = PC_SEQ ? new Int32Array(PC_CAP) : null;
  const cyc: Int32Array | null = PC_SEQ ? new Int32Array(PC_CAP) : null;
  const srs: Int32Array | null = PC_SEQ ? new Int32Array(PC_CAP) : null;
  const frs: Int32Array | null = PC_SEQ ? new Int32Array(PC_CAP) : null;
  const d2s: Int32Array | null = PC_SEQ ? new Int32Array(PC_CAP) : null;
  const pend: Int32Array | null = PC_SEQ ? new Int32Array(PC_CAP) : null;
  const regs: Int32Array | null = PC_SEQ ? new Int32Array(PC_CAP) : null;
  const early: Int32Array | null = PC_SEQ ? new Int32Array(12000 * 8) : null;
  const hpoll = new Int32Array(12000);
  let hidx = 0;
  const fcyc: Int32Array | null = PC_SEQ ? new Int32Array(4096) : null;
  let pn = 0;
  sys.m.atPcExtra = (pc: number): void => {
    inWait = pc >= WAIT_LO && pc < WAIT_HI;
    // PC_SEQ=1: record the sequence of poll addresses. Both dispatchers are
    // forced to poll at exactly POLL_AT, so this sequence is directly
    // comparable between them - unlike registers, which the decompiled side
    // syncs only partially, and unlike the JavaScript stack, which a
    // trampoline flattens. If the two sequences match, the runs take the same
    // path through the same blocks and whatever differs is a value computed
    // inside one; if they part, the index names the block. Built here rather
    // than in a new harness deliberately: this run loop is the one measured to
    // reach 2,225,794 polls and 115 interrupts, and a fresh harness that
    // silently drives the machine differently is exactly how regdiff.test.ts
    // produced confident nonsense.
    if (pcs && (sys.m.pollAt === null || sys.m.pollAt.has(pc))) {
      if (pn < pcs.length) { pcs[pn] = pc | 0; if (cyc) cyc[pn] = sys.m.cycles | 0;
        if (srs) srs[pn] = ((sys.m.getSR ? sys.m.getSR() : sys.m.sr) | 0);
        if (frs) frs[pn] = sys.frames | 0;
        if (pend) pend[pn] = ((sys.m.irqPending | 0) << 16) | ((sys.m.sr >> 8) & 7);
        if (d2s) d2s[pn] = sys.m.d2 | 0;
        // Only inside a handler. The decompiled dispatcher keeps its registers
        // in JavaScript locals and writes sys.m.dN only when it spills - before
        // takeIrq, and at setReg points. Sampling anywhere else compares the
        // recompiler's live register against a stale mirror and reports a
        // difference at the first block that touches any register, which is
        // what the withdrawn poll-3 result was. Inside a handler both have
        // spilled, so the files are genuinely comparable.
        if (regs && sys.m.irqDepth > 0) {
          const m2 = sys.m;
          const r = [m2.d0, m2.d1, m2.d2, m2.d3, m2.d4, m2.d5, m2.d6, m2.d7];
          let h = 0x811c9dc5;
          for (let k = 0; k < 8; k += 1) {
            h = (h ^ (r[k] | 0)) >>> 0;
            h = Math.imul(h, 0x01000193) >>> 0;
          }
          regs[pn] = h | 0;
          // The first hundred polls in full. The fingerprint says WHICH poll
          // parts; this says which register, and the answer is only useful
          // near the start - by poll 3 the run has executed three blocks.
          // Keyed by poll index so the two runs line up, but only for the
          // in-handler samples, which are a small fraction - a full d0-d7
          // record for every poll would be 45MB.
          if (early && hidx < 12000) {
            hpoll[hidx] = pn;
            for (let k = 0; k < 8; k += 1) early[hidx * 8 + k] = r[k] | 0;
            hidx += 1;
          }
        } }
      // Alignment-free: the cycle count at which each frame crossing happened.
      // Indexed by frame number, so it needs no assumption that poll index i
      // means the same event in both runs - which it may not, since a skipped
      // poll is also an unrecorded one.
      if (fcyc && sys.frames > 0 && sys.frames < fcyc.length && fcyc[sys.frames] === 0) {
        fcyc[sys.frames] = sys.crossedAt | 0;
      }
      pn += 1;
    }
  };
  const m = sys.m as unknown as {
    setByte(a: number, v: number): void; store(a: number, v: number, b: number): void;
  };
  const run: Run = { addr: new Int32Array(CAP), val: new Int32Array(CAP),
    cyc: new Int32Array(CAP), irq: new Int32Array(CAP),
    pol: new Int32Array(CAP), a6: new Int32Array(CAP), d2: new Int32Array(CAP), n: 0 };
  let stack = '';
  let romStack: number[] = [];
  const FULL = new Error('recorded enough');
  const note = (a: number, v: number, bits: number): void => {
    if (a < LO || a >= HI) return;
    // The exception frame is the seam, not the game - the two dispatchers take
    // an interrupt at different points within a block by design, so the
    // stacked program counter and condition codes differ there and nowhere
    // else. Skipping the six bytes measures what the game did.
    // FRAME_BYTES=1 stops skipping them, which is how to ask whether a value
    // the two runs disagree on was *read back* from a frame either of them
    // pushed. Every write outside the frames now matches for 300,000, so
    // anything still differing has to come from bytes this skip hides.
    if (sys.m.inFrame && !FRAME_BYTES) return;
    // The other face of the same seam. fn_00430 rotates four register patterns
    // until the frame handler sets 0x3E0802, and the two dispatchers resume
    // from an interrupt at different points inside a block - the chip at the
    // next instruction, the lifted code at the block head - so the loop stops
    // one rotation apart and pushes different patterns. Both runs enter it
    // with identical registers (measured, all 15, over every call), so nothing
    // about the game differs here. WAIT_SKIP=1 excludes it, which answers
    // whether the spin loop is the *only* thing left or merely the first.
    if (WAIT_SKIP && inWait) return;
    // Full: stop the run rather than carry on executing the game with a hook
    // on every store, recording nothing. Thrown from inside the machine, which
    // unwinds the dispatcher the same way the frame limit does.
    if (run.n >= CAP) throw FULL;
    if (run.n === stopAt) {
      // Deep enough to reach the caller that passed the wrong value, not just
      // the routine that stored it. Eight frames stopped at the callRom into
      // the routine under suspicion, which is one frame short of the answer
      // every time the bug is in an argument.
      stack = (new Error().stack ?? '').split('\n').slice(2, 30)
        .map((l) => (l.match(/at (\w+)/) ?? [])[1]).filter(Boolean).join(' <- ');
      // ...except the JavaScript stack cannot reach the caller at all, which
      // is why the comment above kept being disappointed. Both dispatchers are
      // trampolines: a routine calls another by returning to the loop with a
      // new program counter, so ROM call depth is not JS call depth, and
      // `call <- callDecompiled <- callRom` repeated is the whole of what JS
      // knows. The chain is on the machine's own stack, in the same form in
      // both runs, so read it there. A longword in the overlay's code range
      // and even is a return address pushed by bsr/jsr; data pointers and
      // counters mostly fall outside it. Some of what this prints is
      // coincidence - check a hit against facts.json before believing it.
      romStack = [];
      for (let i = 0; i < 256 && romStack.length < 14; i += 2) {
        const a = (sys.m.a7 + i) >>> 0;
        const v = ((sys.m.byte(a) << 24) | (sys.m.byte(a + 1) << 16)
          | (sys.m.byte(a + 2) << 8) | sys.m.byte(a + 3)) >>> 0;
        // Filtered back to plausible return addresses. The raw form was needed
        // once, to read pushed arguments off the stack while chasing a colour
        // bank; for walking a call chain the filter is what makes it legible.
        // A longword in the overlay's code range and even is a return address
        // pushed by bsr/jsr. Check any hit against facts.json before believing
        // it - some of these are data that happens to look like code.
        if (v >= 0x400 && v < 0x20000 && (v & 1) === 0) romStack.push(v);
      }
    }
    // The cycle clock at each write. If the two runs disagree here, the
    // pacing is wrong and fixable; if they agree, what differs is only
    // where in a block each may take an interrupt.
    run.cyc[run.n] = sys.m.cycles | 0;
    run.irq[run.n] = sys.m.irqTaken | 0;
    run.pol[run.n] = totalPolls | 0;
    // a6 at each write. The last divergence is a value the game *reads* from
    // a frame local (`-$12(a6)`), so the question is whether the frame
    // pointer itself differs or only what is under it: same a6 with
    // different contents means residue, different a6 means the caller.
    run.a6[run.n] = sys.m.a6 | 0;
    // d2 too. graphicsDecompressor stores (d3.w >>> 4) + d2.w, so d2 IS the
    // colour base the caller chose - if the banner's palette bank differs,
    // it differs here, one level above the pixel.
    run.d2[run.n] = sys.m.d2 | 0;
    run.addr[run.n] = a;
    run.val[run.n] = (v & ((1 << bits) - 1 || -1)) | (bits << 24);
    run.n += 1;
  };
  const sb = m.setByte.bind(m); const st = m.store.bind(m);
  // One note per store the game made, whatever it decomposes into. `store`
  // writes its bytes through `setByte`, so hooking both counts a byte store
  // twice on the side that reaches it through `store` and once on the side
  // that calls `setByte` directly - which is not a difference in what the game
  // did, only in how each dispatcher spells it. Counting them separately put
  // the first "divergence" at write 29,770 in the middle of the self test's
  // RAM fill, where both runs were writing the same bytes in the same order.
  let inStore = false;
  m.setByte = (a, v) => { if (!inStore) note(a, v, 8); sb(a, v); };
  m.store = (a, v, b) => {
    note(a, v, b);
    inStore = true;
    try { st(a, v, b); } finally { inStore = false; }
  };
  // Interrupts stay on the cycle clock. Pacing them off the write count was
  // tried, to give both runs the same schedule in the one unit they agree on:
  // the game waits for vblank by spinning on a byte only the handler sets, so
  // on a cycle clock the two land at different iterations and the streams part
  // on a loop's rotation phase rather than on anything the game did. It fails
  // for a reason worth recording. A write clock alone deadlocks - the sound
  // driver's wait writes nothing, so the clock never advances - and every
  // fallback available is measured in instructions, which is exactly the unit
  // the two dispatchers do not share: `steps` counts instructions on one side
  // and blocks on the other. Pacing by writes made the streams part earlier,
  // at 14,464 rather than 27,627.
  // The frame interrupt, driven off poll points rather than cycles.
  //
  // Both runs execute the same code, so they arrive at the same block heads in
  // the same order - that is the one sequence they share exactly. A cycle
  // total is not: the lifted code pays for a whole block on entry and the
  // recompiler pays per instruction, so between block heads they are apart by
  // up to the rest of the block. Nine hundred cycles against a frame of a
  // quarter of a million almost never matters, and then once it lands either
  // side of the threshold and the decompiled run misses a frame - the
  // semaphore at 0x3E0802 reaching two where the other run had already
  // consumed it. Counting block heads removes the dependence entirely.
  // One asymmetry survives even then. When the recompiler takes an interrupt
  // it resumes by re-running the instruction it was interrupted at, so that
  // block head arrives twice; the lifted side takes the interrupt inside the
  // block it has already entered and arrives once. That is one extra poll per
  // interrupt on one side, which is exactly the sort of slow creep that ends a
  // spin loop an iteration early. The re-run is skipped, and only on the side
  // that makes it.
  const PER_FRAME = Number(process.env.POLLS_PER_FRAME ?? 9000);
  const isRecompiled = entry === viaRecompiled;
  let polls = 0;
  let totalPolls = 0;
  // The re-run is at the same address, and it arrives after the handler has
  // returned - not on the next poll point, which is inside the handler. That
  // is what the first version of this discounted, which was simply the wrong
  // event.
  let rerunAt = -1;
  sys.pacedIrq = () => {
    const pc = sys.m.pc;
    if (!POLL_AT.has(pc)) return false;
    if (rerunAt === pc) { rerunAt = -1; return false; }
    polls += 1;
    totalPolls += 1;
    if (polls < PER_FRAME) return false;
    polls = 0;
    if (isRecompiled) rerunAt = pc;
    return true;
  };
  const STOP = new Error('enough');
  let n = 0;
  try {
    // Attract, a coin, then the join button - 0 means held. The palette is
    // only written once the game is running.
    sys.run(() => {
      n += 1;
      p.at(n, sys);
      if (n > (FRAMES || p.frames)) throw STOP;
    }, entry);
  } catch (e) {
    // A run that has already diverged can branch somewhere the machine never
    // goes. That is the thing being measured, not a reason to stop measuring.
    // FULL and STOP are both ordinary ends: the buffer filled, or the pattern
    // ran its length.
    if (e !== STOP && e !== FULL) run.n = run.n;
  }
  return { run, stack, romStack, pcs, pn, cyc, srs, frs, fcyc, d2s, regs, early, io, hpoll, hidx, irqRegs, pend };
}

/** One pattern's two write streams, compared. */
function compare(p: Pattern): { note: string; agreed: number } {
    const ra = record(p, viaRecompiled);
    const rb = record(p, viaDecompiled);
    const a = ra.run;
    const b = rb.run;
    if (PC_SEQ && ra.pcs && rb.pcs) {
      // The gate: this harness is only believable if it reproduces the poll
      // count writes.test already reports. A run that drives the machine
      // differently will differ here first, and loudly.
      const lim = Math.min(ra.pn, rb.pn, PC_CAP);
      let at = -1;
      for (let i = 0; i < lim; i += 1) if (ra.pcs[i] !== rb.pcs[i]) { at = i; break; }
      // The cost-model test. If the two clocks part far earlier than the
      // control flow does, and drift steadily, then what separates the runs is
      // cycle accounting rather than anything the game did - which is the
      // difference between an unfixable seam and a cost model to correct.
      let cAt = -1;
      const where: string[] = [];
      if (ra.cyc && rb.cyc) {
        // Every block where the gap CHANGES, not merely where it is non-zero:
        // once the clocks part they stay parted, so the interesting events are
        // the steps. Each one is a block the two sides priced differently.
        let gap = 0;
        for (let i = 0; i < lim && where.length < 8; i += 1) {
          const g = ra.cyc[i] - rb.cyc[i];
          if (g !== gap) {
            if (cAt < 0) cAt = i;
            // What each side charged for the step INTO this poll, which is
            // the only thing that can make the gap move. Guessing at the
            // mechanism from the sign alone was wrong three times; this is the
            // number that settles it.
            const da = i > 0 ? ra.cyc[i] - ra.cyc[i - 1] : 0;
            const db = i > 0 ? rb.cyc[i] - rb.cyc[i - 1] : 0;
            where.push(`0x${(ra.pcs[i] >>> 0).toString(16)}@${i}`
              + ` charged ${da}/${db} from 0x${(ra.pcs[Math.max(0, i - 1)] >>> 0).toString(16)}`
              + `/0x${(rb.pcs[Math.max(0, i - 1)] >>> 0).toString(16)}`);
            gap = g;
          }
        }
      }
      // Which BLOCK ran a different number of times. Clocks are equal at
      // every poll and frame crossings are identical, so the question is not
      // when the interrupt arrives but which loop spun once more - and that is
      // a count, not a timestamp. Tally every address in both runs up to the
      // point the sequences part, and report the addresses whose tallies
      // differ most: a busy-wait that exits a beat early shows up here as one
      // address off by one while everything around it matches.
      let pdiff = 'no pending/mask comparison';
      if (ra.pend && rb.pend && ra.pcs) {
        const lim5 = Math.min(ra.pn, rb.pn);
        for (let i = 0; i < lim5; i += 1) {
          if (ra.pend[i] !== rb.pend[i]) {
            const A = ra.pend[i], B = rb.pend[i];
            pdiff = `PENDING/MASK first differ at poll ${i}, 0x${ra.pcs[i].toString(16)}: `
              + `irqPending ${(A >> 16) & 7}/${(B >> 16) & 7}, mask ${A & 7}/${B & 7}`;
            break;
          }
          if (i === lim5 - 1) pdiff = `pending and mask identical over ${lim5} polls`;
        }
      }
      // Cycles alone, indexed by interrupt number. Registers can agree while
      // the clocks have already drifted, and the drift is what matters: it is
      // charged cost for identical work.
      // Cost per block ADDRESS, summed over the whole run, in each run
      // separately - then diffed. Alignment-free: a sum over a run does not
      // care that the poll sequences drift. The delta between consecutive
      // polls inside ONE run is exactly what that block was charged, so this
      // needs no new recording. A block that appears with different totals and
      // the same visit count is priced differently, which is the fault.
      // The per-visit cost distribution for the one block that is mispriced.
      // A block charged a constant should show a single value; anything else
      // says the charge depends on something, and comparing the two runs'
      // histograms says on what.
      let hdiff = 'no histogram';
      if (ra.cyc && rb.cyc && ra.pcs && rb.pcs) {
        const hist = (r: typeof ra) => {
          const h = new Map<number, number>();
          for (let i = 1; i < r.pn; i += 1) {
            if (r.pcs![i - 1] !== 0x14510) continue;
            const dc = (r.cyc![i] - r.cyc![i - 1]) | 0;
            if (dc < 0 || dc > 4096) continue;
            h.set(dc, (h.get(dc) ?? 0) + 1);
          }
          return [...h.entries()].sort((x, y) => y[1] - x[1]);
        };
        const HA = hist(ra), HB = hist(rb);
        hdiff = `0x14510 per-visit cost -- recompiled: `
          + HA.slice(0, 6).map(([c, n]) => `${c}x${n}`).join(' ')
          + ` | decompiled: ` + HB.slice(0, 6).map(([c, n]) => `${c}x${n}`).join(' ');
      }
      let mdiff = 'no per-block cost comparison';
      if (ra.cyc && rb.cyc && ra.pcs && rb.pcs) {
        const cost = (r: typeof ra) => {
          const sum = new Map<number, number>(); const hits = new Map<number, number>();
          for (let i = 1; i < r.pn; i += 1) {
            const pc = r.pcs![i - 1], dc = (r.cyc![i] - r.cyc![i - 1]) | 0;
            if (dc < 0 || dc > 4096) continue;
            sum.set(pc, (sum.get(pc) ?? 0) + dc);
            hits.set(pc, (hits.get(pc) ?? 0) + 1);
          }
          return { sum, hits };
        };
        const A = cost(ra), B = cost(rb);
        const bad: Array<[number, number, number, number, number]> = [];
        for (const [pc, s] of A.sum) {
          const s2 = B.sum.get(pc) ?? 0;
          const h = A.hits.get(pc) ?? 0, h2 = B.hits.get(pc) ?? 0;
          if (s !== s2 && h === h2 && h > 0) bad.push([pc, s, s2, h, h2]);
        }
        bad.sort((x, y) => Math.abs(y[1] - y[2]) - Math.abs(x[1] - x[2]));
        mdiff = bad.length === 0 ? 'every block costs the same in both runs'
          : `${bad.length} blocks MISPRICED (same visit count, different total): `
            + bad.slice(0, 5).map(([pc, s, s2, h]) =>
              `0x${pc.toString(16)} ${s}/${s2} over ${h} visits (${(s - s2) / h}/visit)`).join('  ');
      }
      let ydiff = 'no interrupt-cycle comparison';
      if (ra.irqRegs && rb.irqRegs) {
        const n3 = Math.min(ra.irqRegs.length, rb.irqRegs.length);
        let y = 0;
        for (; y < n3; y += 11) {
          if (ra.irqRegs[y + 10] !== rb.irqRegs[y + 10]) {
            const prev = y >= 11
              ? `; previous interrupt cycles ${ra.irqRegs[y - 1]}/${rb.irqRegs[y - 1]} `
                + `(gap ${ra.irqRegs[y - 1] - rb.irqRegs[y - 1]})` : '';
            ydiff = `CYCLES first differ at interrupt ${y / 11}, pc 0x${(ra.irqRegs[y + 8] >>> 0).toString(16)}`
              + `/0x${(rb.irqRegs[y + 8] >>> 0).toString(16)}: ${ra.irqRegs[y + 10]}/${rb.irqRegs[y + 10]}`
              + ` (gap ${ra.irqRegs[y + 10] - rb.irqRegs[y + 10]})${prev}`;
            break;
          }
        }
        if (y >= n3) ydiff = `interrupt cycles identical at all ${n3 / 11}`;
      }
      let qdiff = 'no interrupt-register comparison';
      if (ra.irqRegs && rb.irqRegs) {
        const n2 = Math.min(ra.irqRegs.length, rb.irqRegs.length);
        let q = 0;
        for (; q < n2; q += 11) {
          let bad = -1;
          for (let k = 0; k < 8; k += 1) if (ra.irqRegs[q + k] !== rb.irqRegs[q + k]) { bad = k; break; }
          if (bad >= 0) {
            qdiff = `IRQ REGISTERS first differ at interrupt ${q / 11}, pc 0x${(ra.irqRegs[q + 8] >>> 0).toString(16)}`
              + `/0x${(rb.irqRegs[q + 8] >>> 0).toString(16)}, POLL ${ra.irqRegs[q + 9]}/${rb.irqRegs[q + 9]}`
              + `${ra.irqRegs[q + 9] === rb.irqRegs[q + 9] ? ' (aligned)' : ' (MISALIGNED)'}`
              + `, CYCLES ${ra.irqRegs[q + 10]}/${rb.irqRegs[q + 10]}`
              + `${ra.irqRegs[q + 10] === rb.irqRegs[q + 10] ? ' EQUAL' : ' DIFFER'}: d${bad}=`
              + `0x${(ra.irqRegs[q + bad] >>> 0).toString(16)} vs 0x${(rb.irqRegs[q + bad] >>> 0).toString(16)}`;
            break;
          }
        }
        if (q >= n2) qdiff = `registers identical at all ${n2 / 11} interrupts`;
      }
      let iodiff = 'no input comparison';
      if (ra.io && rb.io) {
        const n = Math.min(ra.io.length, rb.io.length);
        let k = 0;
        for (; k < n; k += 3) {
          if (ra.io[k] !== rb.io[k] || ra.io[k + 1] !== rb.io[k + 1]) {
            iodiff = `INPUT first differs at read ${k / 3}: `
              + `0x${ra.io[k].toString(16)}=0x${ra.io[k + 1].toString(16)} @pc 0x${(ra.io[k + 2] >>> 0).toString(16)}`
              + ` vs 0x${rb.io[k].toString(16)}=0x${rb.io[k + 1].toString(16)} @pc 0x${(rb.io[k + 2] >>> 0).toString(16)}`;
            break;
          }
        }
        if (k >= n) iodiff = `inputs identical over ${n / 3} reads`
          + (ra.io.length === rb.io.length ? '' : ` BUT COUNTS DIFFER ${ra.io.length / 3}/${rb.io.length / 3}`);
      }
      let gdiff = 'no register-file comparison';
      if (ra.regs && rb.regs && ra.pcs) {
        const lim4 = Math.min(ra.pn, rb.pn);
        for (let i = 0; i < lim4; i += 1) {
          if (ra.regs[i] !== rb.regs[i]) {
            gdiff = `REGISTER FILE first differs at poll ${i}, at 0x${ra.pcs[i].toString(16)}`
              + ` (previous block 0x${ra.pcs[Math.max(0, i - 1)].toString(16)})`;
            if (ra.early && rb.early) {
              let sa = -1;
              for (let q = 0; q < ra.hidx && q < rb.hidx; q += 1) if (ra.hpoll[q] === i) { sa = q; break; }
              if (sa >= 0) {
                const which: string[] = [];
                for (let k = 0; k < 8; k += 1) {
                  const x = ra.early[sa * 8 + k], y = rb.early[sa * 8 + k];
                  if (x !== y) which.push(`d${k}=0x${(x >>> 0).toString(16)}/0x${(y >>> 0).toString(16)}`);
                }
                gdiff += ` -> ${which.join(' ')}`;
              }
            }
            if (false) {
              const which: string[] = [];
              for (let k = 0; k < 8; k += 1) {
                const x = ra.early[i * 8 + k], y = rb.early[i * 8 + k];
                if (x !== y) which.push(`d${k}=0x${(x >>> 0).toString(16)}/0x${(y >>> 0).toString(16)}`);
              }
              gdiff += ` -> ${which.join(' ')}`;
            }
            break;
          }
          if (i === lim4 - 1) gdiff = `register file identical over all ${lim4} polls`;
        }
      }
      let rdiff = 'no register comparison';
      if (ra.d2s && rb.d2s && ra.pcs && rb.pcs) {
        const lim3 = Math.min(ra.pn, rb.pn);
        for (let i = 0; i < lim3; i += 1) {
          if (ra.d2s[i] !== rb.d2s[i]) {
            rdiff = `d2 first differs at poll ${i}, at 0x${ra.pcs[i].toString(16)}`
              + `: 0x${(ra.d2s[i] >>> 0).toString(16)} vs 0x${(rb.d2s[i] >>> 0).toString(16)}`
              + `; previous block 0x${ra.pcs[Math.max(0, i - 1)].toString(16)}`;
            break;
          }
          if (i === lim3 - 1) rdiff = `d2 identical over all ${lim3} polls`;
        }
      }
      let cdiff = 'no block-count comparison';
      if (ra.pcs && rb.pcs) {
        const lim2 = Math.min(ra.pn, rb.pn);
        const ca = new Map<number, number>(); const cb = new Map<number, number>();
        for (let i = 0; i < lim2; i += 1) {
          ca.set(ra.pcs[i], (ca.get(ra.pcs[i]) ?? 0) + 1);
          cb.set(rb.pcs[i], (cb.get(rb.pcs[i]) ?? 0) + 1);
        }
        const off: Array<[number, number, number]> = [];
        for (const [pc, n] of ca) { const m2 = cb.get(pc) ?? 0; if (n !== m2) off.push([pc, n, m2]); }
        for (const [pc, n] of cb) if (!ca.has(pc)) off.push([pc, 0, n]);
        off.sort((x, y) => Math.abs(y[1] - y[2]) - Math.abs(x[1] - x[2]));
        cdiff = off.length === 0 ? 'every block ran the same number of times'
          : `${off.length} blocks differ in count; worst: `
            + off.slice(0, 6).map(([pc, n, m2]) =>
              `0x${pc.toString(16)} ${n}/${m2}`).join(' ');
      }
      let fdiff = 'frame crossings identical';
      if (ra.fcyc && rb.fcyc) {
        for (let f = 1; f < 300; f += 1) {
          if (ra.fcyc[f] !== rb.fcyc[f]) {
            fdiff = `frame ${f} crossed at cycle ${ra.fcyc[f]} vs ${rb.fcyc[f]}`
              + ` (delta ${rb.fcyc[f] - ra.fcyc[f]})`;
            break;
          }
        }
      }
      seq.push(`${p.name}: polls ${ra.pn} vs ${rb.pn}; ${fdiff}; ${pdiff}; ${hdiff}; ${mdiff}; ${ydiff}; ${qdiff}; ${iodiff}; ${gdiff}; ${rdiff}; ${cdiff}; `
        + (cAt < 0 ? 'clocks identical throughout; '
          : `clocks part at poll ${cAt} (${ra.cyc![cAt]} vs ${rb.cyc![cAt]}, `
            + `at 0x${(ra.pcs[cAt] >>> 0).toString(16)}); mispriced blocks: ${where.join(' ')}; `)
        + (at >= 0 && ra.srs && rb.srs
          ? `frames at the part: ${ra.frs![at]}/${rb.frs![at]}, one before: `+ `${ra.frs![Math.max(0, at - 1)]}/${rb.frs![Math.max(0, at - 1)]}; `+ `sr at the part: 0x${(ra.srs[at] >>> 0).toString(16)}/0x${(rb.srs[at] >>> 0).toString(16)}`
            + `, one before: 0x${(ra.srs[Math.max(0, at - 1)] >>> 0).toString(16)}`
            + `/0x${(rb.srs[Math.max(0, at - 1)] >>> 0).toString(16)}; ` : '')
        + (at < 0 ? `poll ADDRESSES identical over all ${lim} compared`
          : `part at poll ${at} of ${lim}: 0x${(ra.pcs[at] >>> 0).toString(16)}`
            + ` vs 0x${(rb.pcs[at] >>> 0).toString(16)}`
            + ` (previous 0x${(ra.pcs[Math.max(0, at - 1)] >>> 0).toString(16)})`));
    }
    let i = 0;
    while (i < a.n && i < b.n && a.addr[i] === b.addr[i] && a.val[i] === b.val[i]) i += 1;
    // Where the two clocks first part, which is upstream of where the writes
    // do: identical work costing different cycles is a fault in the cost
    // model, and it moves every interrupt after it.
    let ci = 0;
    while (ci < a.n && ci < b.n && a.cyc[ci] === b.cyc[ci]) ci += 1;
    // Phase or drift. The lifted code charges a block's cycles at its head
    // where the recompiler charges each instruction as it runs, so mid-block
    // the two are apart by the rest of the block - bounded, and harmless. A
    // gap that grows without bound is a cost model that disagrees, which
    // moves every interrupt after it. The spread says which.
    // Only over the prefix the two runs share. Past the first differing
    // write they are doing different things, so their clocks are not
    // comparable and the extremes out there are noise - which is what the
    // quarter-million-cycle excursion turned out to be.
    let lo = 0; let hi = 0;
    const n = Math.min(a.n, b.n, i);
    for (let k = 0; k < n; k += 1) {
      const d = b.cyc[k] - a.cyc[k];
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    const spread = `clock gap over ${n} writes: ${lo}..${hi}`
      + `; interrupts taken at the last common write:`
      + ` ${a.irq[Math.max(0, i - 1)]} vs ${b.irq[Math.max(0, i - 1)]}`
      + `; poll points reached: ${a.pol[Math.max(0, i - 1)]}`
      + ` vs ${b.pol[Math.max(0, i - 1)]}`
      // Same frame pointer at the divergent write, or a different one? The
      // value the runs disagree on is read from `-$12(a6)`, so this splits
      // the two possible stories without any further guessing.
      + `; d2 (the colour base) 0x${(a.d2[i] >>> 0).toString(16)} vs 0x${(b.d2[i] >>> 0).toString(16)}`
      + `; a6 at the divergence: 0x${(a.a6[i] >>> 0).toString(16)}`
      + ` vs 0x${(b.a6[i] >>> 0).toString(16)}`
      + ` (${a.a6[i] === b.a6[i] ? 'same frame, so the contents differ'
        : 'different frames, so the caller differs'})`;
    // Where it first goes badly wrong, and who was running. A thousand
    // cycles is more than any block costs, so the first write past that is
    // past the phase and into whatever charges asymmetrically.
    // The negative side is the bigger signal: the recompiled run a quarter
    // of a million cycles ahead is what charging for a wait the other skips
    // looks like, and it dwarfs anything on the positive side.
    let gi = 0;
    while (gi < n && Math.abs(b.cyc[gi] - a.cyc[gi]) < 1000) gi += 1;
    let gwho = '';
    if (gi < n) {
      try { gwho = record(p, viaDecompiled, gi).stack; }
      catch (e) { gwho = `(${(e as Error).message})`; }
    }
    const gap = gi < n
      ? `
  gap passes 1000 at write ${gi} (${b.cyc[gi] - a.cyc[gi]}, at`
        + ` 0x${a.addr[gi].toString(16)})
  gap stack: ${gwho}`
      : '';
    let note = `identical: ${a.n} writes`      + (ci < a.n && ci < b.n        ? `, but the cycle clocks part at write ${ci}`          + ` (${a.cyc[ci]} vs ${b.cyc[ci]}, at 0x${a.addr[ci].toString(16)})`        : ', and the cycle clocks agree');
    if (i < a.n || i < b.n) {
      const show = (r: Run, k: number): string => (k < r.n
        ? `0x${r.addr[k].toString(16)}=${(r.val[k] & 0xffffff).toString(16)}/${r.val[k] >>> 24}`
        : '(end)');
      // The third run goes further than the other two and can wander into a
      // branch the machine never takes - which is the divergence, not a
      // separate fault. The stack is captured before that happens.
      let who = '';
      // One re-run per dispatcher, not three. The decompiled side's JavaScript
      // stack and its ROM stack come from the SAME run, so capturing them
      // separately paid for an extra full game per diverging pattern - which
      // is measurable: it is the load that made the suite time out under
      // parallel execution (see _flaky in baseline.json).
      let rs = '';
      try {
        const ra = record(p, viaRecompiled, i);
        rs += `
  rom stack recompiled: ${ra.romStack.map((v) => '0x' + v.toString(16)).join(' <- ')}`;
      } catch (e) { rs += `
  rom stack recompiled: (${(e as Error).message})`; }
      try {
        const rb = record(p, viaDecompiled, i);
        who = rb.stack;
        rs += `
  rom stack decompiled: ${rb.romStack.map((v) => '0x' + v.toString(16)).join(' <- ')}`;
      } catch (e) { who = `(${(e as Error).message})`; }
      who += rs;
      // A window either side, not three writes. The first differing write is
      // often several writes downstream of the cause, and the run up to it is
      // what says which.
      const run = (r: Run, from: number, to: number): string => {
        const out: string[] = [];
        for (let k = Math.max(0, from); k <= to; k += 1) out.push(show(r, k));
        return out.join(' ');
      };
      let cwho = '';
      if (ci < i) { try { cwho = record(p, viaDecompiled, ci).stack; }
        catch (e) { cwho = `(${(e as Error).message})`; } }
      note = [`diverge at write ${i} of ${a.n}/${b.n}`        + (ci < i ? `; cycles first differ at write ${ci}`          + ` (${a.cyc[ci]} vs ${b.cyc[ci]}, ${a.addr[ci].toString(16)})`          + `
  cycle stack: ${cwho}` : '')        + ` (cycles ${a.cyc[i - 1]} vs ${b.cyc[i - 1]} at the last common write,`        + ` ${a.cyc[i]} vs ${b.cyc[i]} at this one)`,
        `  common:     ${run(a, i - 8, i - 1)}`,
        `  recompiled: ${run(a, i, i + 9)}`,
        `  decompiled: ${run(b, i, i + 9)}`,
        `  stack:      ${who}`].join('\n');
    }
    return { note: `${p.name}: ${note}
  ${spread}${gap}`, agreed: i };
}

// The write stream needs no common clock. Two runs that do the same thing
// write the same bytes in the same order however each is paced, which is what
// makes this the instrument that can compare whole games - compose can only
// sample, and a sample needs a moment both runs are at, which does not exist.
const ONLY = process.env.WRITE_ONLY ?? '';

describe('writes to work RAM', () => {
  it('are the same', () => {
    const chosen = PATTERNS.filter((p) => !ONLY || p.name.includes(ONLY));
    const results = chosen.map(compare);
    writeFileSync(join(here, 'writes.txt'),
      results.map((r) => r.note).join('\n\n') + '\n');
    if (seq.length) {
      writeFileSync(join(here, 'writes-pcseq.txt'), seq.join(String.fromCharCode(10)) + String.fromCharCode(10));
    }
    const worst = Math.min(...results.map((r) => r.agreed));
    const bad = results.filter((r) => !r.note.includes('identical'));
    // The floor describes the DEFAULT window - all of work RAM. A run windowed
    // with W_LO/W_HI legitimately parts far sooner, because it is watching a
    // few hundred bytes rather than 128k, so asserting the floor against it
    // reports red for doing exactly what it was asked to do. Every diagnostic
    // run in the 0x3e3280 investigation was piped to /dev/null and so nobody
    // saw those reds; the next person would have read one as a regression.
    const windowed = process.env.W_LO !== undefined || process.env.W_HI !== undefined;
    if (windowed) {
      console.log(`windowed run (${LO.toString(16)}..${HI.toString(16)}): `
        + 'floor not asserted, it describes the whole of work RAM');
    } else if (bad.length) {
      expect(worst).toBeGreaterThanOrEqual(floor);
    }
  }, 3600000);
});
