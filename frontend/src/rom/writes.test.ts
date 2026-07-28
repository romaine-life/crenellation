// Which write differs, and who made it?
//
// Comparing call sequences does not work: the recompiled dispatcher only sees
// calls that leave a routine's own switch, while the decompiled one routes
// every call through. Writes are comparable either way - the same behaviour
// writes the same bytes - and the JavaScript stack at a decompiled write names
// the function that made it.
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
const FRAMES = Number(process.env.WRITE_FRAMES ?? 280);
const LO = 0x3e3240;
const HI = 0x3e32a0;

function record(entry: (addr: number, m: System['m']) => void, stacks: boolean): string[] {
  const sys = new System(rom, board);
  bind(sys.m);
  const m = sys.m as unknown as {
    setByte(a: number, v: number): void; store(a: number, v: number, b: number): void;
  };
  const seq: string[] = [];
  const note = (a: number, v: number, bits: number): void => {
    if (a < LO || a >= HI) return;
    let who = '';
    if (stacks) {
      const st = (new Error().stack ?? '').split('\n').slice(2, 7)
        .map((l) => (l.match(/at (\w+)/) ?? [])[1]).filter(Boolean);
      who = ' <- ' + st.join(' ');
    }
    seq.push(`${a.toString(16)}=${v.toString(16)}/${bits}${who}`);
  };
  const sb = m.setByte.bind(m); const st = m.store.bind(m);
  m.setByte = (a, v) => { note(a, v, 8); sb(a, v); };
  m.store = (a, v, b) => { note(a, v, b); st(a, v, b); };
  const STOP = new Error('enough');
  let n = 0;
  try {
    sys.run(() => { n += 1; if (n > FRAMES) throw STOP; }, entry);
  } catch (e) { if (e !== STOP) throw e; }
  return seq;
}

describe('writes to the diverging region', () => {
  it('are the same', () => {
    const a = record(viaRecompiled, false);
    const b = record(viaDecompiled, true);
    let i = 0;
    const key = (s: string): string => s.split(' <- ')[0];
    while (i < a.length && i < b.length && key(a[i]) === key(b[i])) i += 1;
    const note = i === a.length && i === b.length
      ? `identical: ${a.length} writes`
      : [`diverge at write ${i} of ${a.length}/${b.length}`,
        `  recompiled: ${a.slice(i, i + 3).join(' | ') || '(none)'}`,
        `  decompiled: ${b.slice(i, i + 3).join(' | ') || '(none)'}`].join('\n');
    writeFileSync(join(here, 'writes.txt'), note);
    expect(note.startsWith('identical')).toBe(true);
  }, 900000);
});
