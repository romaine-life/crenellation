// Debug a single differential case: print the hardware's outputs and the
// port's side by side, so a mismatch shows which register or memory diverged
// rather than only that something did.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { Machine } = await import('./machine.ts');
const { call } = await import('./dispatch.ts');

const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const ramBaseline = new Uint8Array(readFileSync(join(here, 'ram-baseline.bin')));
const fuzz = JSON.parse(readFileSync(join(here, 'fuzz.json'), 'utf8'));
const entries = readFileSync(join(here, 'entries.txt'), 'utf8')
  .split('\n').map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 16));

const RAM_LO = 0x3e0000;
const SCRATCH = 0x3e4000;
const SCRATCH_LEN = 0x400;
const STACK = 0x3e5000;
const SENTINEL = 0x3e6000;
const TRIALS = 3;

const want = process.argv[2] ? parseInt(process.argv[2], 16) : 0x11e58;

class Rand {
  s = 0x12345678;
  next() {
    let x = this.s;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    this.s = x;
    return x;
  }
}

const byKey = new Map();
for (const c of fuzz.cases) byKey.set(`${c.entry}:${c.trial}`, c);

const rand = new Rand();
for (const entry of entries) {
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const m = new Machine(rom);
    for (let i = 0; i < ramBaseline.length; i += 1) m.setByte(RAM_LO + i, ramBaseline[i]);
    for (let i = 0; i < SCRATCH_LEN; i += 1) m.setByte(SCRATCH + i, rand.next() % 256);
    const d = [];
    for (let k = 0; k < 8; k += 1) d.push(rand.next() % 0x10000);
    const a = [];
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
    if (entry !== want || !c) continue;
    // fall through and report every trial for this entry

    m.d0 = d[0]; m.d1 = d[1]; m.d2 = d[2]; m.d3 = d[3];
    m.d4 = d[4]; m.d5 = d[5]; m.d6 = d[6]; m.d7 = d[7];
    m.a0 = a[0]; m.a1 = a[1]; m.a2 = a[2]; m.a3 = a[3]; m.a4 = a[4]; m.a5 = a[5];
    m.a7 = sp;
    m.a6 = STACK + 0x200;
    m.stubMissing = true;

    let err = null;
    try { call(entry, m); } catch (e) { err = e.message; }
    const got = [m.d0, m.d1, m.d2, m.d3, m.d4, m.d5, m.d6, m.d7,
                 m.a0, m.a1, m.a2, m.a3].map((v) => (v >>> 0));
    const names = ['d0','d1','d2','d3','d4','d5','d6','d7','a0','a1','a2','a3'];
    console.log(`entry 0x${entry.toString(16)} trial ${trial}${err ? '  ERROR: ' + err : ''}`);
    const dIn = d.map((v) => v.toString(16)).join(' ');
    const dRom = (c.din ?? []).map((v) => v.toString(16)).join(' ');
    console.log('  in  d port:', dIn);
    console.log('  in  d rom :', dRom, dIn === dRom ? '' : '  <-- INPUTS DIFFER');
    for (let i = 0; i < names.length; i += 1) {
      const w = c.out[i] >>> 0;
      const g = got[i];
      console.log(`   ${names[i]}  rom ${w.toString(16).padStart(8, '0')}  ` +
        `port ${g.toString(16).padStart(8, '0')}  ${w === g ? '' : '<-- differs'}`);
    }
    let h1 = 0, h2 = 0;
    for (let i = 0; i < 0x2000; i += 1) {
      const b = m.byte(0x3e4000 + i);
      h1 = (h1 * 31 + b) >>> 0;
      h2 = (h2 ^ (b + i)) >>> 0;
    }
    const gotHash = h1.toString(16).toUpperCase().padStart(8, '0') +
                    h2.toString(16).toUpperCase().padStart(8, '0');
    console.log(`   mem  rom ${c.hash}  port ${gotHash}  ${c.hash === gotHash ? '' : '<-- differs'}`);
  }
}
console.log('no case found for that entry');
