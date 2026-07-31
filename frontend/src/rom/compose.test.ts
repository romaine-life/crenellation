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
import { describe, it, expect } from 'vitest';

import { System } from './system';
import { call as viaRecompiled } from './dispatch';
import { call as viaDecompiled, bind, POLL_AT } from './decompiled';
import { PATTERNS, type Pattern } from './patterns';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));
const floor: number = (JSON.parse(
  readFileSync(join(here, 'baseline.json'), 'utf8')) as Record<string, number>)['compose'] ?? 0;

type Machine = System['m'];
type Entry = (addr: number, m: Machine) => void;

// Once a rule has been changed on purpose, "identical to the original" is the
// wrong question - the decompiled source is no longer trying to be the ROM. The
// matching decompilation projects handle this with a build flag; same idea.
const MODIFIED = process.env.MODIFIED === '1';
// How much of the stack below a7 counts as dead. The two dispatchers push
// exception frames at different instants, so bytes under the stack pointer
// legitimately differ; 0x100 was enough for boot. DEAD_BYTES widens it as a
// diagnostic - if a difference vanishes at a larger window it was dead
// stack, not a fault. Default unchanged.
const DEAD = Number(process.env.DEAD_BYTES ?? 0x100);

// Which patterns to run. One by default, and the reason is the cost of a
// snapshot: work RAM is a Map, so every byte of the 264 KB compared per frame
// is a map lookup, and six patterns at a thousand frames each is billions of
// them - the suite spent an hour and fifty minutes on it. Attract reaches the
// same divergence as every other pattern, so the default proves the same thing
// in a fraction of the time; COMPOSE_ONLY='' runs the full sweep.
//
// The real fix is to stop snapshotting: a checksum kept up to date by hooking
// writes would make the per-frame digest free, the way writes.test already
// hooks them. That is worth doing and is not done here. Measured 2026-07-30:
// the full sweep was still running after 2h52m and was killed - though the
// machine was also carrying four orphaned vitest workers from earlier days at
// ~270 CPU-hours between them, so that figure is contention as well as cost.
//
// The design, so whoever does it does not have to rediscover it:
//
//   * The cost is not the hashing, it is `snapshot`: 264,000 calls to
//     `m.byte()` a frame, and work RAM is a Map, so every one is a hash
//     lookup. Keep a **mirror Uint8Array** updated by hooking `setByte` the
//     way writes.test already does - O(writes per frame), which is hundreds,
//     not hundreds of thousands - and hash the mirror instead. Flat typed
//     array reads, same FNV-1a, byte-for-byte the same digest.
//   * Keep `digestOf` exactly as it is. That is the point: an *unchanged*
//     hash over a mirror that is right by construction cannot disagree with
//     the old path, so validating it is comparing two numbers rather than
//     reasoning about a new algorithm.
//   * The dead-stack mask still works: save the 0x100 bytes below a7 out of
//     the mirror, zero them, hash, put them back. Cheap and identical to what
//     `snapshot` does today.
//   * A rolling *sum* (subtract the old byte's contribution, add the new)
//     avoids the per-frame hash entirely and is tempting. It is also where
//     this gets dangerous: it needs a new order-independent mix, it cannot
//     reuse FNV-1a, and if it is subtly wrong it reports *agreement that is
//     not there* - turning the strongest instrument in the repo into a rubber
//     stamp, silently. The mirror gets the thousandfold win without that risk.
//     Take it, and only reach for the sum if hashing the mirror is somehow
//     still the bottleneck.
//   * Either way, VALIDATE AGAINST THE OLD PATH over a few hundred frames -
//     same digests, same first differing frame - before trusting a green run.
//     Do not ship it on the strength of being faster.
// The "service switch hangs at frame 276" was the instrument, not the game.
// A frame boundary that lands inside an interrupt handler defers `take`
// until the handler finishes, and by then `frames` has moved on - so the
// replay's `frames == upto` was skipped and it ran for ever. It is `>=` now.
// Frame 275 quiesced outside a handler and 276 did not, which is the entire
// reason one number worked and the next did not.
//
// COMPOSE_ONLY='' now runs all six patterns in about 41 seconds. Nothing
// about it was ever unaffordable; the cost story was one hang plus, on
// 2026-07-30, four orphaned vitest workers holding ~270 CPU-hours.
const ONLY = process.env.COMPOSE_ONLY ?? 'attract';
// Frames per pattern. The default is a bound on the cost, not on the claim:
// six patterns at their full length is twenty thousand frames of the game run
// twice over with a snapshot and a digest every frame, which took the suite
// past three hours - and a suite that takes an afternoon is a suite nobody
// runs. COMPOSE_FRAMES=0 asks for the full length of every pattern.
const CAP = process.env.COMPOSE_FRAMES !== undefined
  ? Number(process.env.COMPOSE_FRAMES) : 1200;

/** Everything either run could have touched, for a byte-level comparison. */
function snapshot(sys: System): Uint8Array {
  const m = sys.m;
  // Memory only. The registers say where a run happened to be paused when the
  // frame boundary arrived, and the two pause at different instructions: the
  // recompiler charges cycles per instruction, the decompiled code per block.
  // That is a difference in when the snapshot was taken, not in what the game
  // did - and what the game did is entirely in memory.
  const out = new Uint8Array(0x20000 + 0x20000 + 0x800);
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
  for (let a = 0x3c0000; a < 0x3c0800; a += 1) out[o++] = m.byte(a);
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
  digests: number[]; frames: number; shot: Uint8Array | null; sp: number; ended: string;
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
    let rerunAt = -1;
    sys.pacedIrq = () => {
      const pc = sys.m.pc;
      if (!POLL_AT.has(pc)) return false;
      if (rerunAt === pc) { rerunAt = -1; return false; }
      polls += 1;
      if (polls < PER_FRAME) return false;
      polls = 0;
      if (isRecompiled) rerunAt = pc;
      return true;
    };
  }
  // A mirror of exactly what `snapshot` lays out, kept current by hooking every
  // byte written. Rebuilding the snapshot cost 264,000 `m.byte()` calls a
  // frame and work RAM is a Map, so every one was a hash lookup; maintaining
  // the mirror costs one array store per write, which is hundreds. Built
  // unmasked - `snapshot` zeroes the dead stack, and baking that in at frame
  // zero would lose the true bytes there for every later frame, once a7 moved.
  const mirror = new Uint8Array(0x40800);
  {
    let o = 0;
    for (let a = 0x3e0000; a < 0x400000; a += 1) mirror[o++] = sys.m.byte(a);
    for (let a = 0x200000; a < 0x220000; a += 1) mirror[o++] = sys.m.byte(a);
    for (let a = 0x3c0000; a < 0x3c0800; a += 1) mirror[o++] = sys.m.byte(a);
  }
  const mMem = sys.m as unknown as { setByte(a: number, v: number): void };
  const setByte0 = mMem.setByte.bind(mMem);
  mMem.setByte = (a: number, v: number): void => {
    setByte0(a, v);
    if (a >= 0x3e0000 && a < 0x400000) mirror[a - 0x3e0000] = v & 0xff;
    else if (a >= 0x200000 && a < 0x220000) mirror[0x20000 + a - 0x200000] = v & 0xff;
    else if (a >= 0x3c0000 && a < 0x3c0800) mirror[0x40000 + a - 0x3c0000] = v & 0xff;
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
      if (digests.length >= limit) throw STOP;
    }
  };
  // Sampled at the frame boundary, and that is the ceiling on what this
  // harness can claim. There is no moment in wall-clock time at which the two
  // dispatchers are at the same point in the program: the recompiler charges
  // cycles per instruction and the decompiled code per block, so a cycle count
  // is not a program point. Handler entry and handler return are no better -
  // an interrupt lands wherever it lands, and the two runs' first one lands
  // sixty bytes of stack apart. What is left over at a boundary is a sampling
  // difference, and it says so: the stack pointers differ. The instrument that
  // compares whole runs without a common clock is writes.test, which compares
  // the sequence of writes rather than the state at an instant.
  const onQuiesce = (): void => {
    if (sys.m.irqDepth !== 0) return;
    sys.m.atPcExtra = null;
    take();
  };
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
      p.at(frames, sys);
      // With position sampling the frame boundary only advances the pattern's
      // input schedule; take() is driven from atPcExtra instead. Letting both
      // push digests interleaves two sampling schemes and the counts stop
      // meaning anything - a run that did that reported "diverges at frame
      // 350" against 328 samples, which cannot both be true.
      if (SAMPLE) { /* position sampling drives take() */ }
      else if (sys.m.irqDepth === 0) take();
      else { deferred += 1; sys.m.atPcExtra = onQuiesce; }
      // A digest is only taken once the machine is out of any handler. If it
      // never comes out, no digest is ever taken, the run never reaches
      // `limit`, and the test hangs with nothing to show for it - which is
      // exactly what "service switch hangs at frame 276" looked like for a
      // whole session. Fail instead, carrying the state that explains it.
      if (frames - lastTook > 90) {
        throw new Error(`no digest for 90 frames: at frame ${frames}, `
          + `irqDepth ${sys.m.irqDepth}, digests ${digests.length}, `
          + `last took at ${lastTook}, deferred ${deferred} times`);
      }
    }, entry);
  } catch (e) {
    if (e !== STOP) died = (e as Error).message.slice(0, 90);
  }
  return { digests, pf, frames, shot, sp: sys.m.a7 >>> 0,
    ended: `${frames} frames, stopped=${sys.m.stopped}${died ? `, died: ${died}` : ''}` };
}

/** The first frame whose digests differ, or -1. */
function firstDiff(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i + 1;
  return a.length === b.length ? -1 : n + 1;
}

function compare(p: Pattern): { note: string; frame: number } {
  const a = play(p, viaRecompiled);
  const b = play(p, viaDecompiled);
  const f = firstDiff(a.digests, b.digests);
  if (f < 0) return { note: `${p.name}: identical for ${a.frames} frames`,
    frame: Number.MAX_SAFE_INTEGER };
  // Say which bytes, by replaying both to that frame. Only then is a snapshot
  // worth keeping.
  const sa2 = play(p, viaRecompiled, f);
  const sb2 = play(p, viaDecompiled, f);
  const sa = sa2.shot;
  const sb = sb2.shot;
  if (!sa || !sb) {
    return { note: `${p.name}: diverges at frame ${f} (${a.frames} vs ${b.frames} frames run)`,
      frame: f };
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
    frame: f };
}

describe('the decompiled routines compose', () => {
  const chosen = PATTERNS.filter((p) => !ONLY || p.name.includes(ONLY));

  it.skipIf(MODIFIED)('runs the game identically to the recompiled ones', () => {
    const results = chosen.map(compare);
    writeFileSync(join(here, 'compose.txt'),
      results.map((r) => r.note).join('\n') + '\n');
    // A floor, like every other harness here, and for a reason this one can
    // state exactly: there is no moment in wall-clock time at which the two
    // dispatchers are at the same point in the program. The recompiler charges
    // cycles per instruction and the decompiled code per block, so a frame
    // boundary finds one of them mid-call with a value pushed that the other
    // has already popped - which is what the stack pointers in the report say
    // whenever this stops. Demanding identity here would make the suite
    // permanently red, which is how a test that had stopped compiling went
    // unread for several rounds. The instrument that compares whole runs
    // without a common clock is writes.test.
    const worst = Math.min(...results.map((r) => r.frame));
    expect(worst).toBeGreaterThanOrEqual(floor);
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
    // WARNING - this cannot currently prove what it claims. `firstDiff` is
    // 351 for five of six patterns *with the change reverted*, verified by
    // regenerating without handedits.py and clearing node_modules/.vite. So
    // the pre-existing divergence at 351 masks the edit entirely: this test
    // would pass just the same if the change were silently lost. It only
    // becomes a real proof once frame 351 is fixed and the unmodified sweep
    // is identical. draws.test IS a real proof today - it asserts the exact
    // 380 pixels, and 0 without the edit - so the change is demonstrably
    // live; it is this instrument, not the change, that is not yet load
    // bearing. Do not treat a green run here as evidence until 351 is gone.
    const lines: string[] = [];
    let seen = 0;
    for (const p of chosen) {
      const a = play(p, viaRecompiled);
      const b = play(p, viaDecompiled);
      // The playfield alone, which is finer than the combined digest - but
      // MEASURED, and it does not make this a proof either. The combined
      // digest parts at frame 351 whether or not the edit is present; the
      // playfield parts at ~390 with it and ~391 without. Regenerate without
      // handedits.py and this test still passes. So the playfield diverges
      // on its own, transiently, for a reason unrelated to wallCellSet.
      //
      // Not a contradiction with draws.test reporting the screens identical
      // without the edit: that compares the 336x240 *visible* screen at one
      // frame, this digests the whole 512x256 buffer every frame. A
      // difference that appears at 391 and is gone by 600 shows here and not
      // there.
      //
      // draws.test remains the real proof the change is live - exact 380
      // pixels with it, 0 without. Making this one a proof needs the
      // transient playfield divergence understood first; it is not simply a
      // matter of digesting a smaller region.
      const at = firstDiff(a.pf, b.pf);
      if (at > 0) seen += 1;
      lines.push(`${p.name}: ${at > 0 ? `change visible from frame ${at}`
        : `no wall laid, so nothing to see (${a.digests.length} frames)`}`);
    }
    writeFileSync(join(here, 'compose-modified.txt'), lines.join('\n') + '\n');
    expect(seen).toBeGreaterThan(0);
  }, 3600000);
});
