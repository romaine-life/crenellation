// The exact instruction where the port stops doing what the chip does.
//
// Comparing which addresses each side reached says only what is missing.
// Comparing the order they are first reached is noisy: taking an interrupt a
// few instructions earlier reorders everything after it. The sequence of
// executed addresses is neither - the first index where the two disagree is
// the instruction itself.
//
// The chip's trace starts once the machine is up, part way through boot, so the
// port's is aligned to it by finding where a run of the chip's first addresses
// occurs in the port's.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'vitest';

import { System } from './system';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));

const chip: number[] = [];
for (const line of readFileSync(join(here, 'bootseq.log'), 'utf8').split('\n')) {
  const s = line.trim();
  if (/^[0-9A-F]+$/.test(s)) chip.push(parseInt(s, 16));
}

describe('the boot instruction sequence against the chip', () => {
  it('finds the first instruction that differs', () => {
    const sys = new System(rom);
    const port: number[] = [];
    const LIMIT = 2_000_000;
    sys.m.atPcExtra = (pc: number) => { if (port.length < LIMIT) port.push(pc); };

    try {
      sys.run((s) => { if (s.frames >= 900) throw new Error('enough'); });
    } catch { /* the stop, or a real failure */ }

    // anchor: the first place the port runs the same twenty addresses the
    // chip's trace opens with
    const anchor = chip.slice(0, 20);
    let start = -1;
    for (let i = 0; i + anchor.length <= port.length; i += 1) {
      let ok = true;
      for (let k = 0; k < anchor.length; k += 1) {
        if (port[i + k] !== anchor[k]) { ok = false; break; }
      }
      if (ok) { start = i; break; }
    }

    const notes: string[] = [
      `chip sequence: ${chip.length} addresses; port: ${port.length}`,
    ];
    if (start < 0) {
      notes.push('the port never runs the chip\'s opening sequence, so there is'
        + ' nothing to align on - it diverges before the chip\'s trace begins');
      notes.push(`chip opens: ${anchor.slice(0, 8).map((a) => '0x' + a.toString(16)).join(' ')}`);
    } else {
      let diff = -1;
      const n = Math.min(chip.length, port.length - start);
      for (let i = 0; i < n; i += 1) {
        if (chip[i] !== port[start + i]) { diff = i; break; }
      }
      notes.push(`aligned at the port's ${start}th address`);
      if (diff < 0) {
        notes.push(`the sequences agree for all ${n} compared addresses`);
      } else {
        const before = chip.slice(Math.max(0, diff - 6), diff)
          .map((a) => '0x' + a.toString(16)).join(' ');
        notes.push(`they part at ${diff}: chip runs 0x${chip[diff].toString(16)},`
          + ` port runs 0x${port[start + diff].toString(16)}`);
        notes.push(`both had just run: ${before}`);
        notes.push(`chip continues: ${chip.slice(diff, diff + 6).map((a) => '0x' + a.toString(16)).join(' ')}`);
        notes.push(`port continues: ${port.slice(start + diff, start + diff + 6).map((a) => '0x' + a.toString(16)).join(' ')}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(notes.join('\n'));
    writeFileSync(join(here, 'bootseq.txt'), notes.join('\n'));
  }, 600000);
});
