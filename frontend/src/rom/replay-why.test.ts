// Say what differs for each routine that still fails on real arguments.
//
// A pass/fail count says how many routines are wrong, not how. These cases use
// the arguments the game actually passed, so a difference here is either a
// translation fault or a device the port does not model - and which register
// differs usually says which.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'vitest';

import { Machine } from './machine';
import { call } from './dispatch';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const baseline = new Uint8Array(readFileSync(join(here, 'replay-baseline.bin')));
const pfBaseline = new Uint8Array(readFileSync(join(here, 'replay-pf-baseline.bin')));
const cases = JSON.parse(readFileSync(join(here, 'replay.json'), 'utf8')) as Array<{
  entry: number; din: number[]; ain: number[]; stk: number[]; out: number[]; hash: string;
}>;

const RAM_LO = 0x3e0000;
const PF_LO = 0x200000;
const STACK = 0x3e5000;
const SENTINEL = 0x3e6000;
const NAMES = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'a0', 'a1', 'a2', 'a3'];

function digest(m: Machine): string {
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < 0x2000; i += 1) {
    const b = m.byte(0x3e4000 + i);
    h1 = (h1 * 31 + b) >>> 0;
    h2 = (h2 ^ (b + i)) >>> 0;
  }
  return h1.toString(16).toUpperCase().padStart(8, '0')
    + h2.toString(16).toUpperCase().padStart(8, '0');
}

describe('why replayed routines differ', () => {
  it('reports the first difference per routine', () => {
    const report = new Map<number, string>();
    for (const c of cases) {
      if (report.has(c.entry)) continue;
      const m = new Machine(rom);
      for (let i = 0; i < baseline.length; i += 1) m.setByte(RAM_LO + i, baseline[i]);
      for (let i = 0; i < pfBaseline.length; i += 1) m.setByte(PF_LO + i, pfBaseline[i]);
      m.store(SENTINEL, 0x60fe, 16);
      let sp = STACK;
      for (let k = 7; k >= 0; k -= 1) { sp -= 4; m.store(sp, c.stk[k] ?? 0, 32); }
      sp -= 4;
      m.store(sp, SENTINEL, 32);
      for (let k = 0; k < 8; k += 1) (m as never as Record<string, number>)[`d${k}`] = c.din[k];
      for (let k = 0; k < 6; k += 1) (m as never as Record<string, number>)[`a${k}`] = c.ain[k];
      m.a7 = sp;
      m.a6 = STACK + 0x200;
      m.sr = 0x2700;
      m.stubMissing = true;
      m.trackOffMap = true;

      let note = '';
      try {
        call(c.entry, m);
        m.trackOffMap = false;
        const got = [m.d0, m.d1, m.d2, m.d3, m.d4, m.d5, m.d6, m.d7,
                     m.a0, m.a1, m.a2, m.a3].map((v) => v >>> 0);
        const bad = NAMES.filter((_, i) => got[i] !== (c.out[i] >>> 0));
        const memBad = digest(m) !== c.hash;
        if (!bad.length && !memBad) continue;
        if (m.offMap) {
          note = `reads ${m.offMapAt.map((x) => '0x' + x.toString(16)).join(' ')} (not modelled)`;
        } else {
          const i = NAMES.indexOf(bad[0] ?? 'd0');
          note = bad.length
            ? `${bad.join(',')} first ${bad[0]} rom=${(c.out[i] >>> 0).toString(16)} port=${got[i].toString(16)}`
            : 'memory only';
          if (bad.length && memBad) note += ' +memory';
        }
      } catch (e) {
        m.trackOffMap = false;
        note = m.offMap
          ? `reads ${m.offMapAt.map((x) => '0x' + x.toString(16)).join(' ')} then ${(e as Error).message.slice(0, 40)}`
          : `threw: ${(e as Error).message.slice(0, 60)}`;
      }
      report.set(c.entry, note);
    }
    writeFileSync(join(here, 'replay-why.json'), JSON.stringify(
      [...report.entries()].map(([e, why]) => ({ entry: '0x' + e.toString(16), why })), null, 1));
  }, 600000);
});
