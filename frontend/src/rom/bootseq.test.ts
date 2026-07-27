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
    let state = '(not reached)';
    const LIMIT = 40_000_000;
    // Collapse consecutive repeats, because the chip's capture has to: its tap
    // fires once per fetch, so an instruction with extension words reports the
    // same address several times. That also collapses a genuine one-instruction
    // self-loop, so the port's trace has to be collapsed identically or the two
    // cannot be compared at all.
    sys.m.atPcExtra = (pc: number) => {
      if (port.length === 12096 + 3868898 - 1336) {
        state = `at the divergence: sr=0x${sys.m.sr.toString(16)} mask=${(sys.m.sr >> 8) & 7}`
          + ` irqPending=${sys.m.irqPending} cycles=${sys.m.cycles} nextIrqAt=${(sys as unknown as {nextIrq?: number}).nextIrq ?? -1}`;
      }
      if (port.length >= LIMIT) return;
      if (port.length && port[port.length - 1] === pc) return;
      port.push(pc);
    };

    // Deliver interrupts where the chip delivers them, not on a made-up
    // schedule. The handler entry appears in the chip's trace at known
    // positions; taking them at any other point makes the two sequences part
    // on timing rather than on anything the port got wrong.
    const chipIrqAt: number[] = [];
    for (let i = 0; i < chip.length; i += 1) if (chip[i] === 0x133b2) chipIrqAt.push(i);
    let irqNext = 0;
    // The port's own collapsed index, counted the same way the trace is, and
    // offset by where the chip's trace begins - it starts inside the reset
    // delay loop, 10,760 collapsed instructions into the port's run. The raw
    // instruction count cannot be used: the trace collapses consecutive
    // repeats and the counter does not.
    const CHIP_STARTS_AT = 10760;
    // Driving the port's interrupts from the chip's schedule sounds right and
    // is worse: the chip asserts the line at vertical blank and it stays
    // asserted while the mask blocks it, so the handler entry in the trace is
    // where the interrupt was *taken*, not where it arrived. Asserting at the
    // taken point loses the pending-while-masked behaviour, and the comparison
    // gets less far than a plain fixed rate - 3,867,531 against 3,868,964.
    const unusedPacing = (): boolean => {
      // port.length already counts the instruction about to run
      const rel = port.length - 1 - CHIP_STARTS_AT;
      if (rel < 0) return false;
      while (irqNext < chipIrqAt.length && chipIrqAt[irqNext] < rel) irqNext += 1;
      return irqNext < chipIrqAt.length && chipIrqAt[irqNext] === rel;
    };
    void unusedPacing;


    try {
      sys.run((s) => { if (s.frames >= 6000) throw new Error('enough'); });
    } catch { /* the stop, or a real failure */ }

    // The anchor has to be a stretch with no repeats in it. The chip's trace
    // opens inside a watchdog delay loop, and matching twenty addresses of a
    // two-instruction loop matches anywhere in it - which lines the two sides
    // up at different counter values and reports the loop exit as a
    // divergence. Twice now that has looked like a real bug and been the
    // alignment.
    const ANCHOR_LEN = 24;
    let anchorAt = 0;
    for (let i = 0; i + ANCHOR_LEN <= chip.length; i += 1) {
      const window = chip.slice(i, i + ANCHOR_LEN);
      if (new Set(window).size === ANCHOR_LEN) { anchorAt = i; break; }
    }
    const anchor = chip.slice(anchorAt, anchorAt + ANCHOR_LEN);
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
      'port runs the mask-setters: ' + [0xf77e, 0xf902, 0xfb4e, 0x650, 0x64a, 0x656, 0x620]
        .map((a) => `0x${a.toString(16)}:${port.includes(a)}`).join(' '),
      state,
    ];
    if (start < 0) {
      notes.push('the port never runs the chip\'s opening sequence, so there is'
        + ' nothing to align on - it diverges before the chip\'s trace begins');
      notes.push(`chip opens: ${anchor.slice(0, 8).map((a) => '0x' + a.toString(16)).join(' ')}`);
      notes.push(`port runs 0x135b8: ${port.includes(0x135b8)}; port opens: `
        + port.slice(0, 10).map((a) => '0x' + a.toString(16)).join(' '));
      const firstLoopExit = port.indexOf(0x135b8);
      notes.push(`port first reaches 0x135b8 at index ${firstLoopExit}`);
      notes.push('chip from there: ' + chip.slice(anchorAt, anchorAt + 16).map((a) => '0x' + a.toString(16)).join(' '));
      notes.push('port from there: ' + port.slice(firstLoopExit, firstLoopExit + 16).map((a) => '0x' + a.toString(16)).join(' '));
    } else {
      let diff = -1;
      const n = Math.min(chip.length - anchorAt, port.length - start);
      for (let i = 0; i < n; i += 1) {
        if (chip[anchorAt + i] !== port[start + i]) { diff = i; break; }
      }
      notes.push(`anchored on the chip's ${anchorAt}th address, a run of ${ANCHOR_LEN} with no repeats; found at the port's ${start}th`);
      if (diff < 0) {
        notes.push(`the sequences agree for all ${n} compared addresses`);
      } else {
        const before = chip.slice(Math.max(0, anchorAt + diff - 6), anchorAt + diff)
          .map((a) => '0x' + a.toString(16)).join(' ');
        notes.push(`they part at ${diff}: chip runs 0x${chip[anchorAt + diff].toString(16)},`
          + ` port runs 0x${port[start + diff].toString(16)}`);
        notes.push(`both had just run: ${before}`);
        notes.push(`chip continues: ${chip.slice(anchorAt + diff, anchorAt + diff + 6).map((a) => '0x' + a.toString(16)).join(' ')}`);
        notes.push(`port continues: ${port.slice(start + diff, start + diff + 6).map((a) => '0x' + a.toString(16)).join(' ')}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(notes.join('\n'));
    writeFileSync(join(here, 'bootseq.txt'), notes.join('\n'));
  }, 600000);
});
