// Where the port's boot path first differs from the chip's.
//
// The port boots and then waits for ever on a sound handshake. Reasoning about
// the driver has not settled it, so this compares against the chip the same way
// everything else was settled: both sides record the first time each address is
// reached, in order, and the first place the lists part company is where to
// look.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'vitest';

import { System } from './system';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));

const chip: number[] = [];
for (const line of readFileSync(join(here, 'boottrace.log'), 'utf8').split('\n')) {
  const s = line.trim();
  if (/^[0-9A-F]+$/.test(s)) chip.push(parseInt(s, 16));
}

describe('the boot path against the chip', () => {
  it('finds where they part company', () => {
    const sys = new System(rom);
    const seen = new Set<number>();
    const order: number[] = [];
    sys.m.atPcExtra = (pc: number) => {
      if (seen.has(pc)) return;
      seen.add(pc);
      order.push(pc);
    };

    try {
      sys.run((s) => { if (s.frames >= 900) throw new Error('enough'); });
    } catch { /* the stop, or a real failure - either way compare what there is */ }

    // The chip reaches addresses the port never does and the other way round,
    // so a straight index comparison drifts. What matters is the first address
    // the chip reached that the port never reached at all: everything before it
    // both sides did, so that is where the paths part.
    const portSet = new Set(order);
    let firstMissing = -1;
    let atIndex = -1;
    for (let i = 0; i < chip.length; i += 1) {
      if (!portSet.has(chip[i])) { firstMissing = chip[i]; atIndex = i; break; }
    }
    const context = chip.slice(Math.max(0, atIndex - 8), atIndex + 4)
      .map((a) => '0x' + a.toString(16)).join(' ');

    const extra = order.filter((a) => !chip.includes(a)).slice(0, 10);
    const notes = [
      `chip reached ${chip.length} distinct addresses; port reached ${order.length}`,
      `first address the chip reached and the port never did: `
        + (firstMissing < 0 ? 'none' : `0x${firstMissing.toString(16)} (chip's ${atIndex}th)`),
      `chip's path around it: ${context}`,
      `addresses the port reached that the chip never did: `
        + (extra.length ? extra.map((a) => '0x' + a.toString(16)).join(' ') : 'none'),
    ];
    // eslint-disable-next-line no-console
    console.log(notes.join('\n'));
    writeFileSync(join(here, 'boottrace.txt'), notes.join('\n'));
  }, 600000);
});
