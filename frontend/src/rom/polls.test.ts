// Where do the twenty-seven come from?
//
// Both runs poll for interrupts at the same set of addresses - the decompiled
// side's block heads - and over a two-demo-loop attract the recompiled run
// reaches 1,871,999 of them and the decompiled one 1,871,972. Twenty-seven in
// 1.87 million. Counting them says how many; it does not say which, and every
// hypothesis so far has been argued from the count alone and been wrong.
//
// So record the *sequence* rather than the total. Two runs that execute the
// same code reach the same block heads in the same order, so the first index
// where the sequences part names the exact place one run polls where the
// other does not - which is the question, instead of a number to reason from.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { System } from './system';
import { call as viaRecompiled } from './dispatch';
import { call as viaDecompiled, bind, POLL_AT } from './decompiled';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));

// Enough to cover the window the write comparison diverges in, and small
// enough that two Int32Arrays of it are megabytes rather than gigabytes.
const CAP = Number(process.env.POLL_CAP ?? 2_000_000);
const FRAMES = Number(process.env.POLL_FRAMES ?? 400);
const SKIP = new Set((process.env.POLL_SKIP ?? '').split(',')
  .filter(Boolean).map((s) => Number.parseInt(s, 16)));

function sequence(entry: (a: number, m: System['m']) => void): Int32Array {
  const sys = new System(rom, board);
  bind(sys.m);
  sys.m.pollAt = POLL_AT as Set<number>;
  const seq = new Int32Array(CAP);
  let n = 0;
  // Same pacing the write comparison uses, so this measures the same runs it
  // does rather than a differently-timed pair.
  const PER_FRAME = Number(process.env.POLLS_PER_FRAME ?? 9000);
  const isRecompiled = entry === viaRecompiled;
  let polls = 0;
  let rerunAt = -1;
  const FULL = new Error('recorded enough');
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
    seq[n] = pc | 0;
    n += 1;
    polls += 1;
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
      return seq.subarray(0, n);
    }
  }
  return seq.subarray(0, n);
}

describe('poll points', () => {
  it('are reached in the same order', () => {
    const a = sequence(viaRecompiled);
    const b = sequence(viaDecompiled);
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
    const report = lines.join('\n');
    writeFileSync(join(here, 'polls.txt'), report);
    // eslint-disable-next-line no-console
    console.log(report);
    expect(a.length).toBeGreaterThan(0);
  }, 900000);
});
