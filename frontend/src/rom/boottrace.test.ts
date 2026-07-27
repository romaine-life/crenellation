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
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));

const chip: number[] = [];
for (const line of readFileSync(join(here, 'boottrace.log'), 'utf8').split('\n')) {
  const s = line.trim();
  if (/^[0-9A-F]+$/.test(s)) chip.push(parseInt(s, 16));
}

describe('the boot path against the chip', () => {
  it('finds where they part company', () => {
    const sys = new System(rom, board);
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

    // the same comparison at routine granularity, which names a subsystem
    // rather than an instruction
    const starts: number[] = readFileSync(join(here, 'entries.txt'), 'utf8')
      .split(/\s+/).map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 16));
    starts.sort((a, b) => a - b);
    const owner = (a: number): number => {
      let lo = 0; let hi = starts.length - 1; let f = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1;
        if (starts[mid] <= a) { f = mid; lo = mid + 1; } else { hi = mid - 1; } }
      return f < 0 ? -1 : starts[f];
    };
    const portFns = new Set(order.map(owner));
    let firstFn = -1; let fnIndex = -1;
    for (let i = 0; i < chip.length; i += 1) {
      const f = owner(chip[i]);
      if (f >= 0 && !portFns.has(f)) { firstFn = f; fnIndex = i; break; }
    }
    // Where the two orders part, not just what is missing. A path taken in a
    // different order - playing a sound sequence before the routine that loads
    // it - looks identical to a set comparison and is exactly the failure here.
    const chipFns = new Set(chip.map(owner));
    // The chip's trace starts once the machine is up, part way through boot,
    // so the port's is skipped forward to the same address before the orders
    // are compared. Without this they part at step zero every time, on the
    // reset code the chip's trace never saw.
    const chipFirst = chip.length ? chip[0] : -1;
    const from = Math.max(0, order.indexOf(chipFirst));
    const portOrderFns: number[] = [];
    for (const a of order.slice(from)) {
      const f = owner(a);
      if (f >= 0 && portOrderFns[portOrderFns.length - 1] !== f) portOrderFns.push(f);
    }
    const chipOrderFns: number[] = [];
    for (const a of chip) {
      const f = owner(a);
      if (f >= 0 && chipOrderFns[chipOrderFns.length - 1] !== f) chipOrderFns.push(f);
    }
    let firstOrderDiff = -1;
    for (let i = 0; i < Math.min(chipOrderFns.length, portOrderFns.length); i += 1) {
      if (chipOrderFns[i] !== portOrderFns[i]) { firstOrderDiff = i; break; }
    }
    const orderNote = firstOrderDiff < 0
      ? 'the routine orders agree as far as they go'
      : `routine order parts at step ${firstOrderDiff}: chip goes to 0x`
        + `${chipOrderFns[firstOrderDiff].toString(16)}, port goes to 0x`
        + `${portOrderFns[firstOrderDiff].toString(16)}`
        + ` (both had just been in 0x${(chipOrderFns[firstOrderDiff - 1] ?? 0).toString(16)})`;
    const chipSet = new Set(chip);
    // the reset code runs before the chip's trace can start, so anything below
    // 0x13660 is expected to be here and is not a divergence
    const extra = order.filter((a) => !chipSet.has(a) && a > 0x13660).slice(0, 30);
    const notes = [
      `chip reached ${chip.length} distinct addresses; port reached ${order.length}`,
      `first address the chip reached and the port never did: `
        + (firstMissing < 0 ? 'none' : `0x${firstMissing.toString(16)} (chip's ${atIndex}th)`),
      `chip's path around it: ${context}`,
      `routines: chip entered ${chipFns.size}, port entered ${portFns.size}`,
      orderNote,
      `first routine the chip entered and the port never did: `
        + (firstFn < 0 ? 'none' : `0x${firstFn.toString(16)} (at the chip's ${fnIndex}th address)`),
      'port inside 0x1425C-0x143B0: ' + order.filter((a) => a >= 0x1425c && a < 0x143b0)
        .sort((x, y) => x - y).map((a) => a.toString(16)).join(' '),
      'routines the chip entered and the port never did: ' + chip.map(owner)
        .filter((f, i, all) => f >= 0 && !portFns.has(f) && all.indexOf(f) === i)
        .slice(0, 24).map((f) => '0x' + f.toString(16)).join(' '),
      `addresses the port reached that the chip never did: `
        + (extra.length ? extra.map((a) => '0x' + a.toString(16)).join(' ') : 'none'),
    ];
    // eslint-disable-next-line no-console
    console.log(notes.join('\n'));
    writeFileSync(join(here, 'boottrace.txt'), notes.join('\n'));
  }, 600000);
});
