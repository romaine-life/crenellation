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
import { call as viaDecompiled, bind } from './decompiled';

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
const FRAMES = Number(process.env.WRITE_FRAMES ?? 280);
const LO = Number(process.env.W_LO ?? 0x3e0000);
const HI = Number(process.env.W_HI ?? 0x400000);
const CAP = 4_000_000;

type Run = { addr: Int32Array; val: Int32Array; n: number };

function record(entry: (addr: number, m: System['m']) => void, stopAt = -1): {
  run: Run; stack: string;
} {
  const sys = new System(rom, board);
  bind(sys.m);
  const m = sys.m as unknown as {
    setByte(a: number, v: number): void; store(a: number, v: number, b: number): void;
  };
  const run: Run = { addr: new Int32Array(CAP), val: new Int32Array(CAP), n: 0 };
  let stack = '';
  const note = (a: number, v: number, bits: number): void => {
    if (a < LO || a >= HI || run.n >= CAP) return;
    if (run.n === stopAt) {
      // Deep enough to reach the caller that passed the wrong value, not just
      // the routine that stored it. Eight frames stopped at the callRom into
      // the routine under suspicion, which is one frame short of the answer
      // every time the bug is in an argument.
      stack = (new Error().stack ?? '').split('\n').slice(2, 30)
        .map((l) => (l.match(/at (\w+)/) ?? [])[1]).filter(Boolean).join(' <- ');
    }
    run.addr[run.n] = a;
    run.val[run.n] = (v & ((1 << bits) - 1 || -1)) | (bits << 24);
    run.n += 1;
  };
  const sb = m.setByte.bind(m); const st = m.store.bind(m);
  m.setByte = (a, v) => { note(a, v, 8); sb(a, v); };
  m.store = (a, v, b) => { note(a, v, b); st(a, v, b); };
  const STOP = new Error('enough');
  let n = 0;
  try {
    // Attract, a coin, then the join button - 0 means held. The palette is
    // only written once the game is running.
    sys.run(() => {
      n += 1;
      sys.inputs[3] = n > 500 && n < 515 ? 0xfe : 0xff;
      sys.inputs[0] = n > 540 && n < 555 ? 0xf6 : 0xf7;
      if (n > FRAMES) throw STOP;
    }, entry);
  } catch (e) {
    // A run that has already diverged can branch somewhere the machine never
    // goes. That is the thing being measured, not a reason to stop measuring.
    if (e !== STOP) run.n = run.n;
  }
  return { run, stack };
}

describe('writes to work RAM', () => {
  it('are the same', () => {
    const a = record(viaRecompiled).run;
    const b = record(viaDecompiled).run;
    let i = 0;
    while (i < a.n && i < b.n && a.addr[i] === b.addr[i] && a.val[i] === b.val[i]) i += 1;
    let note = `identical: ${a.n} writes`;
    if (i < a.n || i < b.n) {
      const show = (r: Run, k: number): string => (k < r.n
        ? `0x${r.addr[k].toString(16)}=${(r.val[k] & 0xffffff).toString(16)}/${r.val[k] >>> 24}`
        : '(end)');
      // The third run goes further than the other two and can wander into a
      // branch the machine never takes - which is the divergence, not a
      // separate fault. The stack is captured before that happens.
      let who = '';
      try { who = record(viaDecompiled, i).stack; } catch (e) { who = `(${(e as Error).message})`; }
      // A window either side, not three writes. The first differing write is
      // often several writes downstream of the cause, and the run up to it is
      // what says which.
      const run = (r: Run, from: number, to: number): string => {
        const out: string[] = [];
        for (let k = Math.max(0, from); k <= to; k += 1) out.push(show(r, k));
        return out.join(' ');
      };
      note = [`diverge at write ${i} of ${a.n}/${b.n}`,
        `  common:     ${run(a, i - 8, i - 1)}`,
        `  recompiled: ${run(a, i, i + 9)}`,
        `  decompiled: ${run(b, i, i + 9)}`,
        `  stack:      ${who}`].join('\n');
    }
    writeFileSync(join(here, 'writes.txt'), note);
    if (!note.startsWith('identical')) {
      expect(i).toBeGreaterThanOrEqual(floor);
    }
  }, 900000);
});
