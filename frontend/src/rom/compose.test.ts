// Does the decompiled code compose?
//
// decomp.test.ts proves each routine in isolation on random machine states.
// That is not the same claim as "the game runs on them": routines call each
// other, share memory, and are entered at addresses the harness never picks.
// This boots the same ROM twice - once through the recompiled dispatcher, once
// through the decompiled one - and compares everything either could have
// touched, once per frame, for a whole game.
//
// The two runs cannot be interleaved. `run` never returns, because the game's
// main loop does not, and the nesting of `jsr` lives on the JavaScript stack -
// unwinding out of it to swap machines would leave a resumed `rts` with no
// caller. So each runs to completion and is compared afterwards.
//
// Comparison is by digest per frame, not by keeping the frames. A snapshot is
// 264 KB and a pattern runs thousands of frames: holding both runs' snapshots
// would be gigabytes. The digests say which frame first differs, and the two
// runs are then repeated to that frame to say which bytes.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { png } from './png';
import { describe, it, expect } from 'vitest';

import { System } from './system';
import { call as viaRecompiled } from './dispatch';
import { call as viaDecompiled, bind, POLL_AT, original } from './decompiled';
import { PATTERNS, type Pattern } from './patterns';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));

type Machine = System['m'];
type Entry = (addr: number, m: Machine) => void;

// Once a rule has been changed on purpose, "identical to the original" is the
// wrong question - the decompiled source is no longer trying to be the ROM. The
// matching decompilation projects handle this with a build flag; same idea.
const POKE = process.env.POKE === '1';
const MODIFIED = process.env.MODIFIED === '1';
// Without MODIFIED this asks whether the two dispatchers run the same program,
// so it runs with every rule as the ROM has it - a rule the port changes on
// purpose is not a translation fault and must not be measured as one. With
// MODIFIED the changed rules stay live, because that test's whole claim is
// that they show. See RULES in decompiled.ts.
if (!MODIFIED) original();
// How much of the stack below a7 counts as dead.
//
// This is the one allowance left in this file, and it now covers exactly one
// known thing rather than a vague "the two take interrupts at different
// instants". They do not: polls.test asserts both cross every frame boundary
// at the same pc with the same clock and the same stack pointer, and that
// every exception frame either pushes carries the same return address. What
// still differs is the X bit of the status register in some stacked frames -
// one interrupt in 2,125 on attract, recorded as `frames` in baseline.json -
// and X is sticky across routine boundaries, so the lifted side, which keeps
// its flags in JavaScript and writes them to the machine at sync points, can
// hold a different one. The handler pops that frame; the bytes are residue
// below the stack pointer by the time a frame boundary arrives.
//
// Measured 2026-08-02 with DEAD_BYTES=0 - no allowance at all - the six
// patterns are identical to frames 1640, 614, 575, 502, 424 and 1640, and the
// first difference each time is a single byte five below the stack pointer,
// the low half of a popped frame's status word. So the allowance buys the
// whole game, and what it hides is one bit, in memory nothing reads.
// DEAD_BYTES widens or removes it; a difference that survives a larger window
// is not dead stack.
const DEAD = Number(process.env.DEAD_BYTES ?? 0x100);

// Which patterns to run: all six, each to its own full length, by default.
//
// It ran one pattern for 1,200 frames until 2026-08-01, on a cost argument
// that had stopped being true. The cost was never the hashing - it was
// `snapshot`, 264,000 `m.byte()` calls a frame against a Map - and it is gone:
// a mirror Uint8Array kept current by hooking `setByte` costs one array store
// per write, which is hundreds a frame rather than hundreds of thousands. The
// mirror is checked against the old path for the first eight frames of every
// run, always, not behind a flag: a faster digest that quietly drifted would
// report agreement that is not there, which is worse than no digest at all.
//
// The other half of the old cost story was a hang - a frame boundary landing
// inside an interrupt handler deferred the digest, and the replay's
// `frames == upto` was then skipped, so it ran for ever - plus, on
// 2026-07-30, four orphaned vitest workers holding ~270 CPU-hours between
// them. Neither was the instrument being expensive.
//
// COMPOSE_ONLY picks patterns by substring while narrowing something down.
const ONLY = process.env.COMPOSE_ONLY ?? '';
// Frames per pattern. Zero means each pattern's own full length, which is the
// default now: the claim is that the two dispatchers agree for a whole game,
// and a cap is the instrument's bound rather than the game's. Set
// COMPOSE_FRAMES=N to stop short while narrowing something down.
const CAP = process.env.COMPOSE_FRAMES !== undefined
  ? Number(process.env.COMPOSE_FRAMES) : 0;

/** Everything either run could have touched, for a byte-level comparison. */
function snapshot(sys: System): Uint8Array {
  const m = sys.m;
  // Memory only. The registers say where a run happened to be paused when the
  // frame boundary arrived, and the two pause at different instructions: the
  // recompiler charges cycles per instruction, the decompiled code per block.
  // That is a difference in when the snapshot was taken, not in what the game
  // did - and what the game did is entirely in memory.
  // The palette is 1024 entries of four bytes - 0x3C0000 to 0x3C1000 - not
  // 0x800. This compared half of it until 2026-07-31: the ROM writes the
  // upper entries through 0x182D4 and nothing here ever looked at them.
  const out = new Uint8Array(0x20000 + 0x20000 + 0x1000);
  let o = 0;
  for (let a = 0x3e0000; a < 0x400000; a += 1) out[o++] = m.byte(a);
  // Below the stack pointer is not state. The 68000 leaves what a popped frame
  // wrote, nothing reads it, and the next push overwrites it. The two
  // dispatchers leave different residue there because they take interrupts at
  // different instants - the chip between instructions, the decompiled code at
  // the head of a block - so the frame one of them pushed at 0x14514 and the
  // other at 0x14510 sits there differing in the stacked program counter's low
  // byte and the Z bit of the stacked condition codes, long after both
  // handlers have returned. Both runs' stack pointers agree at every frame
  // boundary; it is only the dead bytes beneath that differ. A quarter of a
  // kilobyte is far more than any frame this ROM pushes and far less than the
  // stack itself, which starts at 0x3e32fe.
  const dead = (m.a7 >>> 0) - 0x3e0000;
  for (let i = Math.max(0, dead - DEAD); i < dead; i += 1) out[i] = 0;
  for (let a = 0x200000; a < 0x220000; a += 1) out[o++] = m.byte(a);
  // The palette. Leaving it out meant a run that drew the right playfield in
  // the wrong colours - or in none at all - compared equal for nine hundred
  // frames, which is exactly what happened.
  for (let a = 0x3c0000; a < 0x3c1000; a += 1) out[o++] = m.byte(a);
  return out;
}

/** Where a snapshot byte came from, so a difference names itself. */
function where(i: number): string {
  if (i < 0x20000) return `ram 0x${(0x3e0000 + i).toString(16)}`;
  i -= 0x20000;
  if (i < 0x20000) return `playfield 0x${(0x200000 + i).toString(16)}`;
  return `palette 0x${(0x3c0000 + i - 0x20000).toString(16)}`;
}

/** FNV-1a over a snapshot. */
function digestOf(s: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Run one pattern. `upto` stops at that frame and returns its snapshot;
 * otherwise the whole pattern runs and only digests come back.
 */
function play(p: Pattern, entry: Entry, upto = 0): {
  digests: number[]; pf: number[]; frames: number; shot: Uint8Array | null;
  sp: number; ended: string;
} {
  const sys = new System(rom, board);
  bind(sys.m);
  // Both runs poll for interrupts at the same addresses - the decompiled
  // side's block heads, which is the only granularity it has. Without this
  // the recompiled run can take an interrupt between any two instructions
  // and a spin loop stops on a different iteration, so the comparison
  // measures the interrupt schedule rather than the code.
  sys.m.pollAt = POLL_AT as Set<number>;
  // SAMPLE_POLLS compares state by *program position* rather than by time.
  //
  // A frame boundary is a time measure and the two runs do not share a clock:
  // the lifted code charges a block's cycles on entry, the recompiler charges
  // per instruction. Comparing state there catches two machines at slightly
  // different moments - which is how a poll-paced run once reported fourteen
  // bytes of palette differing at frame 8 while every single write matched.
  //
  // A poll count is a position measure: both runs poll at the same addresses
  // running the same code, so poll N is the same instruction with the same
  // call depth in both. That is what a frame boundary cannot promise, and it
  // is the likeliest reason a difference survives at frame 351 while
  // writes.test reports every write identical.
  //
  // Off by default. The two modes are exclusive - see the frame callback.
  //
  // INCOMPLETE, and the missing piece makes its output untrustworthy: the
  // detail replay below stops on `frames >= upto`, a frame count, while this
  // samples on a poll count. So when a digest differs the replay walks to a
  // completely different place and reports whatever it finds there - a run at
  // SAMPLE_POLLS=20000 said "frame 63 of 9708, 0 bytes differ", which is not
  // a contradiction, just two different points being compared. Before
  // trusting any result from this mode, make `upto` mean a sample index when
  // SAMPLE is set. The first differing *digest* was sample 63 of 9708, which
  // is real; the byte-level detail attached to it was not.
  const SAMPLE = Number(process.env.SAMPLE_POLLS ?? 0);
  let sampled = 0;
  // Digests taken during a replay, so `upto` can mean a sample index.
  let taken = 0;
  // With SAMPLE set, drive the frame interrupt off poll count too. Both
  // halves have to be position-based or the comparison is meaningless:
  // sampling by position alone puts the two runs at the same instruction
  // having taken 9,708 and 3,439 interrupts respectively, and pacing by
  // position alone leaves them a few polls out of phase for a snapshot taken
  // at a frame boundary. Together, both *when we look* and *what has
  // happened by then* are measured in program positions.
  //
  // The re-run discount is the same one writes.test needs: the recompiled
  // side resumes by re-running the instruction it was interrupted at, so a
  // block head arrives twice there and once on the lifted side.
  if (SAMPLE) {
    const PER_FRAME = Number(process.env.POLLS_PER_FRAME ?? 9000);
    const isRecompiled = entry === viaRecompiled;
    let polls = 0;
    let inHandler = false;
    sys.pacedIrq = () => {
      const pc = sys.m.pc;
      if (!POLL_AT.has(pc)) return false;
      // The re-run, exactly. Matching it by program counter - which is what
      // writes.test does - is approximate: a tight loop whose body is one
      // block revisits the same address legitimately, and the discount then
      // fires on the wrong arrival. The transition is what identifies it:
      // the recompiled side resumes by re-running the instruction it was
      // interrupted at, so the *first poll back at depth zero after being
      // inside a handler* is that re-run and nothing else is.
      if (sys.m.irqDepth !== 0) { inHandler = true; return false; }
      if (inHandler) { inHandler = false; if (isRecompiled) return false; }
      polls += 1;
      if (polls < PER_FRAME) return false;
      polls = 0;
      return true;
    };
  }
  // A mirror of exactly what `snapshot` lays out, kept current by hooking every
  // byte written. Rebuilding the snapshot cost 264,000 `m.byte()` calls a
  // frame and work RAM is a Map, so every one was a hash lookup; maintaining
  // the mirror costs one array store per write, which is hundreds. Built
  // unmasked - `snapshot` zeroes the dead stack, and baking that in at frame
  // zero would lose the true bytes there for every later frame, once a7 moved.
  const mirror = new Uint8Array(0x41000);
  {
    let o = 0;
    for (let a = 0x3e0000; a < 0x400000; a += 1) mirror[o++] = sys.m.byte(a);
    for (let a = 0x200000; a < 0x220000; a += 1) mirror[o++] = sys.m.byte(a);
    for (let a = 0x3c0000; a < 0x3c1000; a += 1) mirror[o++] = sys.m.byte(a);
  }
  const mMem = sys.m as unknown as { setByte(a: number, v: number): void };
  const setByte0 = mMem.setByte.bind(mMem);
  mMem.setByte = (a: number, v: number): void => {
    setByte0(a, v);
    if (a >= 0x3e0000 && a < 0x400000) mirror[a - 0x3e0000] = v & 0xff;
    else if (a >= 0x200000 && a < 0x220000) mirror[0x20000 + a - 0x200000] = v & 0xff;
    else if (a >= 0x3c0000 && a < 0x3c1000) mirror[0x40000 + a - 0x3c0000] = v & 0xff;
  };
  // The dead-stack mask, applied to the mirror and put back - the same 0x100
  // bytes below a7 that `snapshot` zeroes, for the same reason.
  const framed = (): number => {
    const dead = (sys.m.a7 >>> 0) - 0x3e0000;
    const lo = Math.max(0, dead - DEAD);
    const save = mirror.slice(lo, dead);
    mirror.fill(0, lo, dead);
    const h = digestOf(mirror);
    mirror.set(save, lo);
    return h;
  };
  // The playfield on its own, over the mirror's middle third. Additive on
  // purpose: `digestOf` and the combined digest above are untouched, so the
  // main comparison cannot be weakened by anything here - only MODIFIED
  // reads this.
  //
  // It exists because one number over work RAM, playfield and palette
  // together cannot answer "is the deliberate change live": work RAM diverges
  // at frame 351 for its own reason (the self-test spin loop's register), and
  // that swallows a playfield-only difference completely. wallCellSet moves a
  // tile index, so the playfield is exactly where it shows and work RAM is
  // exactly where it does not.
  //
  // No dead-stack mask: the stack is in work RAM, not here.
  const pfDigest = (): number => digestOf(mirror.subarray(0x20000, 0x40000));
  const digests: number[] = [];
  const pf: number[] = [];
  let shot: Uint8Array | null = null;
  const limit = CAP || p.frames;
  const STOP = new Error('enough');
  let frames = 0;
  let lastTook = 0;
  let deferred = 0;
  let died = '';
  // The frame boundary says when to look; this says when it is fair to. The
  // boundary arrives wherever the cycle count happens to cross it, which can
  // be inside an interrupt handler - and the two dispatchers enter handlers at
  // different instants by design, so a snapshot taken there compares a machine
  // half way through the handler's work against one that has not started it.
  // Waiting for the handler to finish compares the game, not the seam.
  const take = (): void => {
    // Reaching here at all means the machine quiesced outside a handler, which
    // is the only thing the 90-frame guard below is watching for. It used to be
    // recorded only on the digest path, so a *replay* - which takes no digests
    // - looked stalled from its ninety-first frame and died there every time.
    // Every replay past frame 90 therefore returned no snapshot, and `compare`
    // fell through to the branch that reports the frame number with no bytes:
    // "diverges at frame 390 (2400 vs 2400 frames run)" was the instrument
    // declining to look, not a divergence it could not describe.
    lastTook = frames;
    if (upto) {
      // When sampling by position, `upto` is a sample index, not a frame:
      // count the digests this replay would have taken and stop on the same
      // one the first pass differed at. Comparing a poll-sampled digest
      // against a frame-stopped replay walks to a different place entirely
      // and reports whatever is there - which is how this mode once said
      // "frame 63 of 9708, 0 bytes differ".
      if (SAMPLE) {
        taken += 1;
        if (taken >= upto) { shot = snapshot(sys); throw STOP; }
        return;
      }
      // `>=`, not `==`. A frame boundary that lands inside an interrupt
      // handler defers `take` until the handler finishes, and by then the
      // next boundary may already have incremented `frames` - so the exact
      // value is skipped and the replay runs for ever. That is the whole of
      // the "service switch hangs at frame 276": 275 quiesces outside a
      // handler and 276 does not. It was the instrument, not the game.
      if (frames >= upto) { shot = snapshot(sys); throw STOP; }
    } else {
      const h = framed();
      // The mirror is only worth having if it produces the *identical* number,
      // so the first frames of every run are checked against the path it
      // replaces. A faster digest that quietly drifts would report agreement
      // that is not there, which is worse than no digest at all - so this is
      // not a debug flag, it runs always, and eight frames of it is nothing
      // against the thousands it saves.
      if (digests.length < 8) {
        const want = digestOf(snapshot(sys));
        if (h !== want) {
          throw new Error(`mirror digest disagrees with snapshot at frame `
            + `${digests.length}: ${h} vs ${want}`);
        }
      }
      digests.push(h); pf.push(pfDigest()); lastTook = frames;
      // Keep the last snapshot of a normal run too, not only of a replay:
      // MODIFIED renders the visible screen out of it, and until this was
      // added `shot` was null outside replay mode so that comparison
      // silently saw two blank screens and reported no difference.
      if (digests.length >= limit) shot = snapshot(sys);
      if (digests.length >= limit) throw STOP;
    }
  };
  // Sampled at the frame boundary, and the frame boundary is now a program
  // point in both runs rather than a moment on two different clocks.
  //
  // It was not always. This used to defer the digest until the machine came
  // out of any handler, because a boundary that landed inside one caught a
  // machine half way through work the other had not started - the recompiler
  // charging cycles per instruction and the lifted code per block meant the
  // two crossed at different instructions. That is measured, and it is fixed:
  // both poll only at block heads, a block costs the sum of its instructions,
  // and the lifted side now defers a block's charge across the handler that
  // interrupted it, so both cross every boundary at the same pc with the same
  // clock, stack pointer and interrupt count. polls.test asserts exactly that.
  //
  // Waiting to quiesce is therefore no longer needed, and it was doing harm:
  // the service-switch pattern runs its work *inside* the vblank handler and
  // never comes out, so no digest was ever taken, the run hit the ninety-frame
  // guard and died at frame 366 of 1800 - and the comparison reported
  // "identical", because both runs had stopped looking at the same place.
  if (SAMPLE) {
    // Only at a poll point and only outside a handler: both runs are then at
    // the same instruction with the same call depth.
    sys.m.atPcExtra = (pc: number): void => {
      if (!POLL_AT.has(pc) || sys.m.irqDepth !== 0) return;
      sampled += 1;
      if (sampled % SAMPLE === 0) take();
    };
  }
  try {
    sys.run(() => {
      frames += 1;
      // POKE=1 forces the one word the two runs disagree on to a fixed value in
      // BOTH runs, from the frame callback - which fires just before the
      // handler that reads it. 0x3E3274 is -$12(a6) as extractsOwnerBitsCellByte
      // sees it: stack scratch below an inherited frame pointer, in the region
      // where the two dispatchers push exception frames that differ by design.
      // If the runs then agree, that residue is the whole cause; if they still
      // differ, there is a second one. This is a harness poke, never a change
      // to the port - it makes both runs equally wrong, on purpose, to see what
      // depends on the difference.
      if (POKE) for (let i = 0; i < 4; i += 1) sys.m.setByte(0x3e3274 + i, 0);
      p.at(frames, sys);
      // With position sampling the frame boundary only advances the pattern's
      // input schedule; take() is driven from atPcExtra instead. Letting both
      // push digests interleaves two sampling schemes and the counts stop
      // meaning anything - a run that did that reported "diverges at frame
      // 350" against 328 samples, which cannot both be true.
      if (SAMPLE) { /* position sampling drives take() */ }
      else { if (sys.m.irqDepth !== 0) deferred += 1; take(); }
      // The guard that used to be here fired when no digest had been taken for
      // ninety frames, which could only happen while digests waited on the
      // machine leaving a handler. Nothing waits now - every boundary takes
      // one - so `frames` and `digests.length` advance together and there is
      // no state left for it to detect. `deferred` is kept as a count of the
      // boundaries that landed inside a handler, which is a fact about the
      // game worth reporting rather than a reason to look away.
      void lastTook;
    }, entry);
  } catch (e) {
    if (e !== STOP) died = (e as Error).message.slice(0, 90);
  }
  return { digests, pf, frames, shot, sp: sys.m.a7 >>> 0,
    ended: `${frames} frames, ${deferred} of them crossing inside a handler,`
      + ` stopped=${sys.m.stopped}${died ? `, died: ${died}` : ''}` };
}

/** The first frame whose digests differ, or -1. */
function firstDiff(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i + 1;
  return a.length === b.length ? -1 : n + 1;
}

function compare(p: Pattern): { note: string; frame: number; short: boolean } {
  const a = play(p, viaRecompiled);
  const b = play(p, viaDecompiled);
  const f = firstDiff(a.digests, b.digests);
  // A pattern that stops early is not a pass. Both runs agreeing to halt at
  // frame 366 of 1800 reads as "identical" to a digest comparison and says
  // nothing about the other 1,434 - and the shape it hides is the one this
  // suite has been caught by before, an instrument declining to look. The
  // limit is `CAP || p.frames`, so a full-length run must produce exactly that
  // many digests; anything less is reported and fails.
  const want = CAP || p.frames;
  const short = a.digests.length < want || b.digests.length < want;
  if (f < 0) {
    return {
      note: `${p.name}: identical for ${a.digests.length} of ${want} frames`
        + (short ? ` - STOPPED SHORT (${a.ended} / ${b.ended})` : ''),
      frame: Number.MAX_SAFE_INTEGER,
      short,
    };
  }
  // Say which bytes, by replaying both to that frame. Only then is a snapshot
  // worth keeping.
  const sa2 = play(p, viaRecompiled, f);
  const sb2 = play(p, viaDecompiled, f);
  const sa = sa2.shot;
  const sb = sb2.shot;
  if (!sa || !sb) {
    return { note: `${p.name}: diverges at frame ${f} (${a.frames} vs ${b.frames} frames run)`
      + ` - the replay reached no snapshot, which is a fault in this harness,`
      + ` not a divergence it could not describe`,
      frame: f, short };
  }
  const diffs: string[] = [];
  let total = 0;
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] !== sb[i]) {
      total += 1;
      if (diffs.length < 6) diffs.push(`${where(i)} ${sa[i]}!=${sb[i]}`);
    }
  }
  return { note: `${p.name}: frame ${f} of ${a.frames}, ${total} bytes differ`
    + ` (sp 0x${sa2.sp.toString(16)} vs 0x${sb2.sp.toString(16)}) - ${diffs.join(' ')}`,
    frame: f, short };
}

describe('the decompiled routines compose', () => {
  const chosen = PATTERNS.filter((p) => !ONLY || p.name.includes(ONLY));

  it.skipIf(MODIFIED)('runs the game identically to the recompiled ones', () => {
    const results = chosen.map(compare);
    writeFileSync(join(here, 'compose.txt'),
      results.map((r) => r.note).join('\n') + '\n');
    // Identity, not a floor.
    //
    // The floor that used to be here was argued from a real observation - the
    // two dispatchers have no common clock, the recompiler charging cycles per
    // instruction and the lifted code per block - and the conclusion drawn
    // from it was wrong. They do share a clock at every point either of them
    // can be *looked at*: both poll only at block heads, and a block costs the
    // sum of its instructions, so the clocks are equal at every poll. What
    // separated them was two things, both fixable and both fixed. The lifted
    // side charged a block's cycles before running the handler that
    // interrupted it, where the chip has not spent them yet - so it went into
    // every handler ahead by that block's cost. And the deliberate wall rule
    // was compiled in, so a run with it on was not trying to match. With the
    // rules original and the charge deferred, all 2,400 frame boundaries of
    // attract are crossed at the same pc, clock, stack depth and interrupt
    // count (polls.test), and every frame of every pattern digests the same.
    //
    // So a difference here is now a fault, and this says so. A floor would
    // swallow the next one exactly as it swallowed this one for weeks.
    const parted = results.filter((r) => r.frame !== Number.MAX_SAFE_INTEGER);
    expect(parted.map((r) => r.note)).toEqual([]);
    // And a run that stopped early is not agreement either - see compare.
    expect(results.filter((r) => r.short).map((r) => r.note)).toEqual([]);
  }, 3600000);

  // With a rule changed, the useful claim is the opposite one: the change is
  // actually in the running game rather than in a file nothing reads. Walls
  // first exist when the demo lays them, which is why this needs a pattern
  // that plays rather than the first frames of boot.
  it.skipIf(!MODIFIED)('differs from the original where it was changed', () => {
    // Every chosen pattern, not just the first. This tested `chosen[0]` and
    // so proved the change live under attract alone however many patterns
    // were asked for - which is the same shape of gap as comparing work RAM
    // and calling the screen covered.
    //
    // The assertion stays "somewhere", deliberately: the rule only shows
    // where a wall is actually laid, so a pattern that never lays one is
    // *expected* to match, and demanding a difference from all six would
    // fail for the right behaviour. Per-pattern numbers are recorded so the
    // reader can see which exercised it.
    // LOAD BEARING SINCE 2026-08-02, and it was not before.
    //
    // The old warning here said this could not prove what it claims, and it
    // was right: with the change reverted the two runs still parted at frame
    // 351 for five of six patterns, so a difference found here said nothing
    // about the edit and the test would have passed just the same if the edit
    // had been silently lost. That divergence is gone - the test above now
    // asserts the two dispatchers are identical over every frame of every
    // pattern with the ROM's rules - so a difference under MODIFIED can only
    // come from the rules that were changed. That is what makes this a proof
    // rather than an echo, and it is the whole reason the changed rule became
    // a switch (RULES in decompiled.ts) instead of staying compiled in.
    const lines: string[] = [];
    let seen = 0;
    for (const p of chosen) {
      const a = play(p, viaRecompiled);
      const b = play(p, viaDecompiled);
      // The visible screen, not the raw playfield buffer, and now a clean
      // comparison on every pattern rather than on two of them.
      //
      // The note that used to be here recorded a transient playfield
      // divergence at ~391 present with the edit reverted, and a visible
      // difference on the gameplay patterns that draws.test never saw because
      // draws.test only ran attract. Both were the same fault this file's
      // first test used to floor at, and both are gone: with the ROM's rules
      // every pattern is byte-identical at every frame, and draws.test reports
      // zero differing pixels on all six. So whatever shows below is the
      // changed rule.
      //
      // draws.test remains the real proof the change is live - exact 380
      // pixels with it, 0 without. Making this one a proof needs the
      // transient playfield divergence understood first; it is not simply a
      // matter of digesting a smaller region.
      // Rendered through the palette, because a tile index that changed and a
      // colour that changed are different faults and only the pixels tell them
      // apart. Each pattern is compared at its own full length, so a pattern
      // that reports nothing is one where the demo never laid a wall by then -
      // which is a fact about the pattern, not a gap in the proof.
      const px = (s: Uint8Array, i: number): number => {
        const c = s[0x20000 + i];
        return (s[0x40000 + c * 4] << 8) | s[0x40000 + c * 4 + 2];
      };
      let at = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      if (a.shot && b.shot) {
        for (let y = 0; y < 240; y += 1) {
          for (let x = 0; x < 336; x += 1) {
            if (px(a.shot, y * 512 + x) !== px(b.shot, y * 512 + x)) {
              at += 1;
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
      }
      if (at > 0) {
        // Look at it. A count and a box say something differs; only the pixels
        // say what. rgba() is System.palette's expansion, inlined because the
        // snapshot is bytes rather than a live machine.
        const rgba = (w: number): number => {
          const i = (w >> 15) & 1;
          const e = (v: number) => ((((v << 1) | i) << 2) | (((v << 1) | i) >> 4)) & 0xff;
          return (0xff << 24) | (e(w & 0x1f) << 16) | (e((w >> 5) & 0x1f) << 8) | e((w >> 10) & 0x1f);
        };
        const w = x1 - x0 + 1, h = y1 - y0 + 1;
        for (const [tag, s] of [['a', a.shot!], ['b', b.shot!]] as const) {
          const buf = new Uint32Array(w * h);
          for (let y = 0; y < h; y += 1)
            for (let x = 0; x < w; x += 1)
              buf[y * w + x] = rgba(px(s, (y + y0) * 512 + x + x0));
          writeFileSync(join(__dirname, `modified-${p.name.split(',')[0].replace(/\W+/g, '-')}-${tag}.png`),
            png(w, h, buf));
        }
      }
      if (at > 0) seen += 1;
      lines.push(`${p.name}: ${at > 0
        ? `${at} pixels differ, box x ${x0}..${x1} y ${y0}..${y1}`
        : `no wall laid, so nothing to see (${a.digests.length} frames)`}`);
    }
    writeFileSync(join(here, 'compose-modified.txt'), lines.join('\n') + '\n');
    expect(seen).toBeGreaterThan(0);
  }, 3600000);
});
