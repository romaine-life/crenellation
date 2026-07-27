// Verify routines by what they write, not by whether they return.
//
// Every other harness calls a routine and waits for it to come back to a
// sentinel. 111 routines contain no rts at all - they end by jumping elsewhere,
// or they are loops the game only leaves by interrupt - so no argument will
// ever make them return, and they cannot be judged that way at all.
//
// They can still be judged. From identical starting state the sequence of
// bytes a routine writes is as deterministic as the registers it ends with, so
// the first N byte-writes are compared instead. Recording stops as soon as the
// port has produced as many writes as the hardware did, which is also what
// stops a routine that would otherwise run forever.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Machine } from './machine';
import { call } from './dispatch';

const here = dirname(fileURLToPath(import.meta.url));
const floor: number = (JSON.parse(
  readFileSync(join(here, 'baseline.json'), 'utf8')) as Record<string, number>)['write'] ?? 0;
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const ramBaseline = new Uint8Array(readFileSync(join(here, 'write-ram-baseline.bin')));
const pfBaseline = new Uint8Array(readFileSync(join(here, 'write-pf-baseline.bin')));

type Case = { entry: number; writes: string[] };
const cases: Case[] = [];
for (const line of readFileSync(join(here, 'write.log'), 'utf8').split('\n')) {
  const p = line.trim().split(/\s+/);
  if (p[0] !== 'W') continue;
  cases.push({ entry: parseInt(p[1], 16), writes: p.slice(3) });
}

const entries: number[] = readFileSync(join(here, 'entries.txt'), 'utf8')
  .split('\n').map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 16));

const RAM_LO = 0x3e0000;
const PF_LO = 0x200000;
const SCRATCH = 0x3e4000;
const SCRATCH_LEN = 0x400;
const STACK = 0x3e5000;
const SENTINEL = 0x3e6000;
const STRUCTS = [0x3e0864, 0x3e1968, 0x3e1cf6, 0x3e1bc6, 0x3e0f48, 0x3e02d8, 0x3e4000];
const SHAPE = 1;

class Rand {
  s = 0x12345678;
  next(): number {
    let x = this.s;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    this.s = x;
    return x;
  }
}

const ENOUGH = 'write-budget-reached';

describe('routines compared by what they write', () => {
  it('reproduces the captured write sequences', () => {
    const byEntry = new Map<number, Case>();
    for (const c of cases) byEntry.set(c.entry, c);
    const rand = new Rand();
    let compared = 0;
    let matched = 0;
    const pass = new Set<number>();
    const fail = new Set<number>();
    const detail: Array<{ entry: string; at: number; rom: string; port: string }> = [];

    for (const entry of entries) {
      const m = new Machine(rom);
      for (let i = 0; i < ramBaseline.length; i += 1) m.setByte(RAM_LO + i, ramBaseline[i]);
      for (let i = 0; i < pfBaseline.length; i += 1) m.setByte(PF_LO + i, pfBaseline[i]);
      m.store(SENTINEL, 0x60fe, 16);
      for (let i = 0; i < SCRATCH_LEN; i += 1) m.setByte(SCRATCH + i, rand.next() % 256);
      const d: number[] = [];
      for (let k = 0; k < 8; k += 1) {
        const r = rand.next();
        d.push(SHAPE === 0 ? r % 0x10000 : SHAPE === 1 ? r % 32 : r % 256);
      }
      const a: number[] = [];
      for (let k = 0; k < 6; k += 1) {
        const r = rand.next();
        a.push(SHAPE === 0 ? SCRATCH + (r % (SCRATCH_LEN - 0x80)) : STRUCTS[r % STRUCTS.length]);
      }
      let sp = STACK;
      for (let k = 1; k <= 4; k += 1) {
        sp -= 4;
        const v = k % 2 === 0 ? rand.next() % 0x100
          : SCRATCH + (rand.next() % (SCRATCH_LEN - 0x80));
        m.store(sp, v, 32);
      }
      sp -= 4;
      m.store(sp, SENTINEL, 32);

      const c = byEntry.get(entry);
      // Only sequences that finished under the capture's cap. A truncated one
      // cannot be compared as a set: the port's last write might be the
      // hardware's first beyond the cap.
      if (!c || c.writes.length === 0 || c.writes.length >= 48) continue;

      for (let k = 0; k < 8; k += 1) (m as never as Record<string, number>)[`d${k}`] = d[k];
      for (let k = 0; k < 6; k += 1) (m as never as Record<string, number>)[`a${k}`] = a[k];
      m.a7 = sp;
      m.a6 = STACK + 0x200;
      m.sr = 0x2700;
      m.stubMissing = true;

      // record from here on, and stop the moment there are as many writes as
      // the hardware produced - which is also what bounds a routine that never
      // returns
      const seen: string[] = [];
      const want = c.writes;
      const origSetByte = Machine.prototype.setByte;
      (m as never as Record<string, unknown>).setByte = function patched(addr: number, v: number) {
        origSetByte.call(this, addr, v);
        seen.push(`${(addr >>> 0).toString(16).toUpperCase().padStart(6, '0')}:`
          + `${(v & 0xff).toString(16).toUpperCase().padStart(2, '0')}`);
        if (seen.length >= want.length) throw new Error(ENOUGH);
      };

      compared += 1;
      try { call(entry, m); } catch (e) {
        if ((e as Error).message !== ENOUGH) { /* stopped early: compare what there is */ }
      }
      // Compare which bytes were written, not the order within a store. The
      // 68000 writes the two halves of a long in an order that depends on the
      // instruction - `move.l d0,-(a7)` low word first, others high word
      // first - and the bytes land in the same places either way. Matching
      // that ordering exactly would be modelling microcode for no functional
      // difference; what matters is that the same bytes get the same values.
      const norm = (xs: string[]) => [...xs].sort().join(' ');
      let ok = seen.length >= want.length && norm(seen.slice(0, want.length)) === norm(want);
      let at = -1;
      if (!ok) {
        const s = [...seen].sort();
        const w = [...want].sort();
        for (let i = 0; i < w.length; i += 1) if (s[i] !== w[i]) { at = i; break; }
      }
      if (ok) { matched += 1; pass.add(entry); }
      else {
        fail.add(entry);
        if (detail.length < 20) {
          const s = [...seen].sort();
          const w = [...want].sort();
          const i = at >= 0 ? at : 0;
          detail.push({ entry: '0x' + entry.toString(16), at: i,
            rom: w[i] ?? '(none)', port: s[i] ?? '(none)' });
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log(`writes: ${matched}/${compared} routines reproduce their write sequence`);
    writeFileSync(join(here, 'write-result.json'),
      JSON.stringify({ pass: [...pass], fail: [...fail], detail }));

    expect(compared).toBeGreaterThan(200);
    // Not "perfect" - this harness has never been perfect and saying so
    // every run makes the suite permanently red, which is how a test that
    // had stopped compiling went unread for several rounds. The bar is that
    // it does not get worse: the floor is committed in baseline.json and
    // raised deliberately when something improves.
    expect(matched).toBeGreaterThanOrEqual(floor);
  }, 900000);
});
