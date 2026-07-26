// Say why each failing encoding fails: wrong register, wrong memory, or no rule.
//
// The pass/fail count says how many rules are wrong but not how they are wrong,
// and the three kinds need completely different fixes. This replays every case
// in capture order - the generator has to advance for the skipped ones too, or
// the inputs stop matching the hardware's - and reports the failures grouped by
// what actually differed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { Machine } = await import('./machine.ts');
const { runOne } = await import('./insn-run.ts');

const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const baseline = new Uint8Array(readFileSync(join(here, 'insn-baseline.bin')));

const records = [];
for (const line of readFileSync(join(here, 'insn.log'), 'utf8').split('\n')) {
  const t = line.trim();
  if (t.startsWith('X ')) { records.push(null); continue; }
  const m = /^I ([0-9A-F]+) (\d) ([^|]+)\| ([^|]+)/.exec(t);
  if (!m) continue;
  const ins = m[3].trim().split(/\s+/).map((x) => parseInt(x, 16));
  const outs = m[4].trim().split(/\s+/).map((x) => parseInt(x, 16));
  records.push({ din: ins.slice(0, 8), ain: ins.slice(8, 14),
                 out: outs.slice(0, 14), sr: outs[14], hash: outs[15] });
}

const order = [];
const labels = new Map();
for (const line of readFileSync(join(here, 'encodings.txt'), 'utf8').split('\n')) {
  const m = /^([0-9A-F]{4,})\s\s(.+)$/.exec(line.trim());
  if (!m) continue;
  order.push(m[1]);
  labels.set(m[1], m[2]);
}

const SCRATCH = 0x3e4000, LEN = 0x400, RAM = 0x3e0000, CODE = 0x3e6000;
class R { s = 0x2468ace0; next() { let x = this.s; x = (x ^ (x << 13)) >>> 0; x = (x ^ (x >>> 17)) >>> 0; x = (x ^ (x << 5)) >>> 0; this.s = x; return x; } }
const rand = new R();
const names = ['d0','d1','d2','d3','d4','d5','d6','d7','a0','a1','a2','a3','a4','a5'];
const want = process.argv[2];       // optional: only this encoding
const groups = new Map();

for (let idx = 0; idx < order.length; idx += 1) {
  const hex = order[idx];
  for (let trial = 0; trial < 2; trial += 1) {
    const m = new Machine(rom);
    for (let i = 0; i < baseline.length; i += 1) m.setByte(RAM + i, baseline[i]);
    for (let i = 0; i < LEN; i += 1) m.setByte(SCRATCH + i, rand.next() % 256);
    const d = [], a = [];
    for (let k = 0; k < 8; k += 1) d.push(rand.next() >>> 0);
    for (let k = 0; k < 6; k += 1) a.push(SCRATCH + (rand.next() % (LEN - 0x100)));
    const c = records[idx * 2 + trial];
    if (!c) continue;
    if (want && hex !== want) continue;

    m.trackOffMap = true;
    for (let k = 0; k < 8; k += 1) m[`d${k}`] = d[k];
    for (let k = 0; k < 6; k += 1) m[`a${k}`] = a[k];
    m.a6 = SCRATCH + 0x300; m.a7 = SCRATCH + 0x380;
    for (let i = 0; i < hex.length / 2; i += 1) m.setByte(CODE + i, parseInt(hex.slice(i * 2, i * 2 + 2), 16));

    let threw = null, got = null, h = 0;
    try {
      runOne(m, CODE);
      got = names.map((n) => m[n] >>> 0);
      for (let i = 0; i < LEN; i += 1) h = (h * 31 + m.byte(SCRATCH + i)) >>> 0;
    } catch (e) { threw = e.message; }
    m.trackOffMap = false;
    if (m.offMap) continue;

    let why, detail = '';
    if (threw) { why = 'threw'; detail = threw; }
    else {
      const bad = names.filter((n, i) => got[i] !== (c.out[i] >>> 0));
      const memBad = h !== (c.hash >>> 0);
      const ccr = (m.x ? 16 : 0) | (m.n ? 8 : 0) | (m.z ? 4 : 0) | (m.v ? 2 : 0) | (m.c ? 1 : 0);
      const romCcr = c.sr & 0x1f;
      if (!bad.length && !memBad) {
        if (ccr === romCcr) continue;
        // name the individual flags, since which one is wrong points straight
        // at the rule: V at overflow handling, X at the shift and add group
        const bits = ['C', 'V', 'Z', 'N', 'X'];
        const diff = bits.filter((_, i) => ((ccr >> i) & 1) !== ((romCcr >> i) & 1));
        why = 'ccr';
        detail = `${diff.join('')} rom=${romCcr.toString(2).padStart(5, '0')} port=${ccr.toString(2).padStart(5, '0')}`;
        const k = `${why}	${labels.get(hex)}`;
        if (!groups.has(k)) groups.set(k, { n: 0, hex, sample: detail });
        groups.get(k).n += 1;
        continue;
      }
      why = bad.length ? (memBad ? 'regs+mem' : 'regs') : 'mem';
      detail = bad.map((n) => {
        const i = names.indexOf(n);
        return `${n} rom=${(c.out[i] >>> 0).toString(16)} port=${got[i].toString(16)}`;
      }).join('  ');
    }
    const key = `${why}\t${labels.get(hex)}`;
    if (!groups.has(key)) groups.set(key, { n: 0, hex, sample: detail, din: d, ain: a });
    groups.get(key).n += 1;
  }
}

const rows = [...groups.entries()].sort((x, y) => y[1].n - x[1].n);
for (const [key, v] of rows) {
  const [why, asm] = key.split('\t');
  console.log(`${String(v.n).padStart(3)}  ${why.padEnd(8)}  ${asm.padEnd(28)} [${v.hex}]  ${v.sample}`);
}
console.log(`\n${rows.length} distinct (reason, instruction) groups`);
