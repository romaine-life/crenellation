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
const CAP = Number(process.env.WRITE_CAP ?? 300_000);

type Run = { addr: Int32Array; val: Int32Array; cyc: Int32Array; n: number };

function record(p: Pattern, entry: (addr: number, m: System['m']) => void,
                stopAt = -1): { run: Run; stack: string } {
  const sys = new System(rom, board);
  bind(sys.m);
  // Both runs poll for interrupts at the same addresses - the decompiled
  // side's block heads, which is the only granularity it has. Without this
  // the recompiled run can take an interrupt between any two instructions
  // and a spin loop stops on a different iteration, so the comparison
  // measures the interrupt schedule rather than the code.
  sys.m.pollAt = POLL_AT as Set<number>;
  const m = sys.m as unknown as {
    setByte(a: number, v: number): void; store(a: number, v: number, b: number): void;
  };
  const run: Run = { addr: new Int32Array(CAP), val: new Int32Array(CAP),
    cyc: new Int32Array(CAP), n: 0 };
  let stack = '';
  const FULL = new Error('recorded enough');
  const note = (a: number, v: number, bits: number): void => {
    if (a < LO || a >= HI) return;
    // The exception frame is the seam, not the game - the two dispatchers take
    // an interrupt at different points within a block by design, so the
    // stacked program counter and condition codes differ there and nowhere
    // else. Skipping the six bytes measures what the game did.
    if (sys.m.inFrame) return;
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
    }
    // The cycle clock at each write. If the two runs disagree here, the
    // pacing is wrong and fixable; if they agree, what differs is only
    // where in a block each may take an interrupt.
    run.cyc[run.n] = sys.m.cycles | 0;
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
  return { run, stack };
}

/** One pattern's two write streams, compared. */
function compare(p: Pattern): { note: string; agreed: number } {
    const a = record(p, viaRecompiled).run;
    const b = record(p, viaDecompiled).run;
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
    let lo = 0; let hi = 0;
    const n = Math.min(a.n, b.n);
    for (let k = 0; k < n; k += 1) {
      const d = b.cyc[k] - a.cyc[k];
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    const spread = `clock gap over ${n} writes: ${lo}..${hi}`;
    let note = `identical: ${a.n} writes`      + (ci < a.n && ci < b.n        ? `, but the cycle clocks part at write ${ci}`          + ` (${a.cyc[ci]} vs ${b.cyc[ci]}, at 0x${a.addr[ci].toString(16)})`        : ', and the cycle clocks agree');
    if (i < a.n || i < b.n) {
      const show = (r: Run, k: number): string => (k < r.n
        ? `0x${r.addr[k].toString(16)}=${(r.val[k] & 0xffffff).toString(16)}/${r.val[k] >>> 24}`
        : '(end)');
      // The third run goes further than the other two and can wander into a
      // branch the machine never takes - which is the divergence, not a
      // separate fault. The stack is captured before that happens.
      let who = '';
      try { who = record(p, viaDecompiled, i).stack; } catch (e) { who = `(${(e as Error).message})`; }
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
  ${spread}`, agreed: i };
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
    const worst = Math.min(...results.map((r) => r.agreed));
    const bad = results.filter((r) => !r.note.includes('identical'));
    if (bad.length) expect(worst).toBeGreaterThanOrEqual(floor);
  }, 3600000);
});
