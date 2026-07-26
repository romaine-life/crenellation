// Test every instruction rule in isolation against the real 68000.
//
// Routine-level differences say a routine is wrong but not which rule is
// wrong, and one bad rule spreads across every routine that uses it. Here each
// distinct instruction encoding from the ROM was executed on its own with
// known registers, so a failure names the rule directly.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Machine } from './machine';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const baseline = new Uint8Array(readFileSync(join(here, 'insn-baseline.bin')));

type Case = {
  hex: string;
  trial: number;
  din: number[];
  ain: number[];
  out: number[];
  sr: number;
  hash: number;
};

// The capture writes one record per case in order, including the ones that did
// not come to rest ("X"). Records are matched to encodings by position, not by
// encoding: fifteen encodings occur twice in the list, and keying by the hex
// silently dropped one of each pair, so every case after the first duplicate
// was compared against another instruction's hardware result.
const records: (Case | null)[] = [];
for (const line of readFileSync(join(here, 'insn.log'), 'utf8').split('\n')) {
  const t = line.trim();
  if (t.startsWith('X ')) { records.push(null); continue; }
  const m = /^I ([0-9A-F]+) (\d) ([^|]+)\| ([^|]+)/.exec(t);
  if (!m) continue;
  const ins = m[3].trim().split(/\s+/).map((x) => parseInt(x, 16));
  const outs = m[4].trim().split(/\s+/).map((x) => parseInt(x, 16));
  records.push({
    hex: m[1], trial: Number(m[2]),
    din: ins.slice(0, 8), ain: ins.slice(8, 14),
    out: outs.slice(0, 14), sr: outs[14], hash: outs[15],
  });
}

// the encodings in capture order, duplicates kept, plus what each disassembles to
const order: string[] = [];
const labels = new Map<string, string>();
for (const line of readFileSync(join(here, 'encodings.txt'), 'utf8').split('\n')) {
  const m = /^([0-9A-F]{4,})\s\s(.+)$/.exec(line.trim());
  if (!m) continue;
  order.push(m[1]);
  labels.set(m[1], m[2]);
}

const SCRATCH = 0x3e4000;
const SCRATCH_LEN = 0x400;
const STACK = 0x3e5000;
const RAM_LO = 0x3e0000;
const CODE = 0x3e6000;

/** The same generator the capture used, so scratch matches byte for byte. */
class Rand {
  s = 0x2468ace0;
  next(): number {
    let x = this.s;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    this.s = x;
    return x;
  }
}

describe('instruction rules against the real 68000', () => {
  it('reproduces each instruction in isolation', async () => {
    const { call } = await import('./dispatch');
    void call;
    const { runOne } = await import('./insn-run');
    const rand = new Rand();
    let matched = 0;
    let compared = 0;
    let offMap = 0;
    let noRule = 0;
    let ccrBad = 0;
    const failing = new Map<string, number>();

    for (let idx = 0; idx < order.length; idx += 1) {
      const hex = order[idx];
      for (let trial = 0; trial < 2; trial += 1) {
        const m = new Machine(rom);
        for (let i = 0; i < baseline.length; i += 1) m.setByte(RAM_LO + i, baseline[i]);
        for (let i = 0; i < SCRATCH_LEN; i += 1) m.setByte(SCRATCH + i, rand.next() % 256);
        const d: number[] = [];
        for (let k = 0; k < 8; k += 1) d.push(rand.next() >>> 0);
        const a: number[] = [];
        for (let k = 0; k < 6; k += 1) a.push(SCRATCH + (rand.next() % (SCRATCH_LEN - 0x100)));

        const c = records[idx * 2 + trial];
        if (!c) continue; // the hardware did not come to rest on this one

        m.trackOffMap = true;
        m.d0 = d[0]; m.d1 = d[1]; m.d2 = d[2]; m.d3 = d[3];
        m.d4 = d[4]; m.d5 = d[5]; m.d6 = d[6]; m.d7 = d[7];
        m.a0 = a[0]; m.a1 = a[1]; m.a2 = a[2];
        m.a3 = a[3]; m.a4 = a[4]; m.a5 = a[5];
        m.a6 = SCRATCH + 0x300;
        // the capture masks interrupts for the duration of each case, and
        // `move sr,dN` reads that back, so the port has to start from it too
        m.sr = 0x2700;
        m.a7 = SCRATCH + 0x380;

        // the instruction under test lives at CODE, as it did on hardware
        for (let i = 0; i < hex.length / 2; i += 1) {
          m.setByte(CODE + i, parseInt(hex.slice(i * 2, i * 2 + 2), 16));
        }

        let ok = false;
        let threw = false;
        let ccr = -1;
        try {
          runOne(m, CODE);
          m.trackOffMap = false;
          const got = [m.d0, m.d1, m.d2, m.d3, m.d4, m.d5, m.d6, m.d7,
                       m.a0, m.a1, m.a2, m.a3, m.a4, m.a5].map((v) => v >>> 0);
          let h = 0;
          for (let i = 0; i < SCRATCH_LEN; i += 1) h = (h * 31 + m.byte(SCRATCH + i)) >>> 0;
          ok = got.every((v, i) => v === (c.out[i] >>> 0)) && h === (c.hash >>> 0);
          // Condition codes decide every branch, so a rule that computes the
          // right number with the wrong flags still breaks the routine using
          // it. Counted apart from the value comparison to keep the two
          // kinds of defect distinguishable.
          ccr = (m.x ? 16 : 0) | (m.n ? 8 : 0) | (m.z ? 4 : 0) | (m.v ? 2 : 0) | (m.c ? 1 : 0);
        } catch {
          threw = true;
        }
        m.trackOffMap = false;

        // An instruction that reached the playfield, palette, sound chips or
        // input ports read something the port does not model, so its result
        // says nothing about the rule. Count it, do not score it.
        if (m.offMap) { offMap += 1; continue; }
        // Counted only for cases that are comparable at all - an off-map case
        // has the wrong flags because it read hardware, not because the rule is
        // wrong, and including those hid the real number behind noise.
        if (ccr >= 0 && ccr !== (c.sr & 0x1f)) ccrBad += 1;
        if (threw) { noRule += 1; failing.set(hex, (failing.get(hex) ?? 0) + 1); compared += 1; continue; }

        compared += 1;
        if (ok) matched += 1;
        else failing.set(hex, (failing.get(hex) ?? 0) + 1);
      }
    }

    const worst = [...failing.keys()].slice(0, 25).map((h) => `${labels.get(h) ?? h}`);
    // eslint-disable-next-line no-console
    console.log(`instructions: ${matched}/${compared} match; ${failing.size} forms failing; ` +
                `${offMap} not comparable (hardware the port does not model); ${noRule} with no rule; ` +
                `${ccrBad} with wrong condition codes`);
    if (worst.length) console.log('failing forms:', worst.join(' | '));
    writeFileSync(join(here, 'insn-result.json'),
      JSON.stringify({ matched, compared, offMap, noRule,
        failing: [...failing.keys()].map((h) => ({ hex: h, asm: labels.get(h) })) }));

    expect(compared).toBeGreaterThan(3000);
    expect(matched).toBe(compared);
  });
});
