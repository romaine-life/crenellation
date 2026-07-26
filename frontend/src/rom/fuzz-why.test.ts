// Group the routine-level differences by cause.
//
// With the instruction rules verified one at a time, a routine that still
// differs is failing for a reason the instruction test cannot see: control
// flow, a call the dispatcher does not have, or hardware the port does not
// model. Those need different fixes, so they are counted separately rather
// than reported as one number.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

import { Machine } from './machine';
import { call } from './dispatch';

const here = dirname(fileURLToPath(import.meta.url));

const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const ramBaseline = new Uint8Array(readFileSync(join(here, 'ram-baseline.bin')));
const pfBaseline = new Uint8Array(readFileSync(join(here, 'pf-baseline.bin')));
const PF_LO = 0x200000;
const fuzz = JSON.parse(readFileSync(join(here, 'fuzz.json'), 'utf8'));
const entries = readFileSync(join(here, 'entries.txt'), 'utf8')
  .split('\n').map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 16));

const RAM_LO = 0x3e0000, SCRATCH = 0x3e4000, SCRATCH_LEN = 0x400;
const STACK = 0x3e5000, SENTINEL = 0x3e6000, TRIALS = 3;

class Rand {
  s = 0x12345678;
  next() { let x = this.s; x = (x ^ (x << 13)) >>> 0; x = (x ^ (x >>> 17)) >>> 0; x = (x ^ (x << 5)) >>> 0; this.s = x; return x; }
}
function scratchHash(m) {
  let h1 = 0, h2 = 0;
  for (let i = 0; i < 0x2000; i += 1) {
    const b = m.byte(0x3e4000 + i);
    h1 = (h1 * 31 + b) >>> 0;
    h2 = (h2 ^ (b + i)) >>> 0;
  }
  return h1.toString(16).toUpperCase().padStart(8, '0') + h2.toString(16).toUpperCase().padStart(8, '0');
}

describe('why routines differ', () => {
  it('groups the causes', () => {
const byKey = new Map();
for (const c of fuzz.cases) byKey.set(`${c.entry}:${c.trial}`, c);
const rand = new Rand();
const causes = new Map();       // cause -> Set of entries
const detail = new Map();       // cause -> sample text
const perEntry = new Map();
const devices = new Map();     // entry -> cause

for (const entry of entries) {
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const m = new Machine(rom);
    for (let i = 0; i < ramBaseline.length; i += 1) m.setByte(RAM_LO + i, ramBaseline[i]);
    for (let i = 0; i < pfBaseline.length; i += 1) m.setByte(PF_LO + i, pfBaseline[i]);
    for (let i = 0; i < SCRATCH_LEN; i += 1) m.setByte(SCRATCH + i, rand.next() % 256);
    const d = [], a = [];
    for (let k = 0; k < 8; k += 1) d.push(rand.next() % 0x10000);
    for (let k = 0; k < 6; k += 1) a.push(SCRATCH + (rand.next() % (SCRATCH_LEN - 0x80)));
    let sp = STACK;
    for (let k = 1; k <= 4; k += 1) {
      sp -= 4;
      const v = k % 2 === 0 ? rand.next() % 0x100 : SCRATCH + (rand.next() % (SCRATCH_LEN - 0x80));
      m.store(sp, v, 32);
    }
    sp -= 4;
    m.store(sp, SENTINEL, 32);

    const c = byKey.get(`${entry}:${trial}`);
    if (!c) continue;

    for (let k = 0; k < 8; k += 1) m[`d${k}`] = d[k];
    for (let k = 0; k < 6; k += 1) m[`a${k}`] = a[k];
    m.a7 = sp;
    m.a6 = STACK + 0x200;
    m.stubMissing = true;
    m.trackOffMap = true;

    let cause = null, sample = '';
    try {
      call(entry, m);
      m.trackOffMap = false;
      const got = [m.d0, m.d1, m.d2, m.d3, m.d4, m.d5, m.d6, m.d7, m.a0, m.a1, m.a2, m.a3].map((v) => v >>> 0);
      const want = c.out.map((v) => v >>> 0);
      const bad = got.filter((v, i) => v !== want[i]).length;
      const memBad = scratchHash(m) !== c.hash;
      if (!bad && !memBad) { /* match */ }
      else if (m.offMap) {
        cause = 'off-map hardware';
        sample = m.offMapAt.map((x) => '0x' + x.toString(16)).join(' ');
      }
      else if (m.missingCalls.length) { cause = 'stubbed call'; sample = '0x' + m.missingCalls[0].toString(16); }
      else if (bad && memBad) { cause = 'registers and memory'; }
      else if (bad) {
        cause = 'registers';
        const names = ['d0','d1','d2','d3','d4','d5','d6','d7','a0','a1','a2','a3'];
        const i = got.findIndex((v, j) => v !== want[j]);
        sample = `${names[i]} rom=${want[i].toString(16)} port=${got[i].toString(16)}`;
      } else cause = 'memory';
    } catch (e) {
      m.trackOffMap = false;
      cause = m.offMap ? 'off-map hardware' : 'threw';
      sample = (m.offMap ? m.offMapAt.map((x) => '0x' + x.toString(16)).join(' ') + ' | ' : '')
        + e.message.slice(0, 50);
    }
    for (const x of m.offMapAt) {
      const dev = (x >>> 16) << 16;
      devices.set(dev, (devices.get(dev) ?? 0) + 1);
    }
    if (cause) {
      if (!causes.has(cause)) { causes.set(cause, new Set()); detail.set(cause, sample); }
      causes.get(cause).add(entry);
      if (sample && !detail.get(cause)) detail.set(cause, sample);
      if (!perEntry.has(entry)) perEntry.set(entry, cause);
    }
  }
}

const rows = [...causes.entries()].sort((x, y) => y[1].size - x[1].size);
writeFileSync(join(here, 'fuzz-devices.json'), JSON.stringify(
  [...devices.entries()].sort((a, b) => b[1] - a[1])
    .map(([d, n]) => ({ device: '0x' + d.toString(16), accesses: n })), null, 1));
writeFileSync(join(here, 'fuzz-why.json'), JSON.stringify(
  rows.map(([cause, set]) => ({ cause, routines: set.size, sample: detail.get(cause) ?? '',
    entries: [...set].slice(0, 10).map((e) => '0x' + e.toString(16)) })), null, 1));
for (const [cause, set] of rows) {
  console.log(`${String(set.size).padStart(4)} routines  ${cause.padEnd(22)} ${detail.get(cause) ?? ''}`);
}
console.log(`\nexample entries per cause:`);
for (const [cause, set] of rows) {
  console.log(`  ${cause}: ${[...set].slice(0, 8).map((e) => '0x' + e.toString(16)).join(' ')}`);
}

  }, 600000);
});
