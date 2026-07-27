// Boot the machine the way the board does and see how far it gets.
//
// Everything so far has called one routine at a time with arguments invented
// for it. This starts where the chip starts - the stack pointer and program
// counter out of the first eight bytes of ROM - and lets it run. It is the
// first thing that can tell whether 753 routines verified one at a time
// actually compose into a machine.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'vitest';

import { Machine } from './machine';
import { call } from './dispatch';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));

describe('booting from the reset vector', () => {
  it('reports how far the machine gets', () => {
    const m = new Machine(rom);
    const sp = ((rom[0] << 24) | (rom[1] << 16) | (rom[2] << 8) | rom[3]) >>> 0;
    const pc = ((rom[4] << 24) | (rom[5] << 16) | (rom[6] << 8) | rom[7]) >>> 0;
    m.a7 = sp;
    m.sr = 0x2700;
    m.budget = 20_000_000;
    // the board asserts level 4 once a frame; without it the game spins on a
    // flag only the handler sets
    let frames = 0;
    const IRQ_EVERY = 20_000;
    const origTick = m.tick.bind(m);
    m.atPc = () => { if (m.steps % IRQ_EVERY === 0) { m.irqPending = 4; frames += 1; } };

    // where it spends its time, so a hang can be read rather than guessed at
    const visits = new Map<number, number>();
    let last = 0;
    m.atPc = (cur: number) => {
      last = cur;
      visits.set(cur, (visits.get(cur) ?? 0) + 1);
      if (m.steps % IRQ_EVERY === 0) { m.irqPending = 4; frames += 1; }
    };

    const t0 = Date.now();
    let outcome = 'returned';
    try {
      call(pc, m);
    } catch (e) {
      outcome = (e as Error).message;
    }
    m.atPc = null;

    const hot = [...visits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const lines = [
      `initial sp 0x${sp.toString(16)}  initial pc 0x${pc.toString(16)}`,
      `outcome: ${outcome}`,
      `instructions run: ${m.steps}`,
      `speed: ${Math.round(m.steps / Math.max(Date.now() - t0, 1) / 1000)} million instructions per second`,
      `distinct addresses reached: ${visits.size}`,
      `last address: 0x${last.toString(16)}`,
      `stopped: ${m.stopped}   trapped: ${m.trapped}   frames delivered: ${frames}`,
      `calls the port had no routine for: ${m.missingCalls.length}`
        + (m.missingCalls.length
          ? ` (${[...new Set(m.missingCalls)].slice(0, 6).map((a) => '0x' + a.toString(16)).join(' ')})`
          : ''),
      '',
      'busiest addresses:',
      ...hot.map(([a, n]) => `   0x${a.toString(16).padStart(5, '0')}  ${n}`),
    ];
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
    writeFileSync(join(here, 'boot.txt'), lines.join('\n'));
  }, 300000);
});
