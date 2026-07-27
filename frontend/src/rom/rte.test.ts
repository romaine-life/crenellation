// Does an interrupt and its rte put the mask back?
//
// The trace says the port's mask stays at 4 through the handler's rte where
// the chip's returns to 0, and that one difference is what eventually blocks
// the interrupt the main loop is waiting for. Tracing it through four million
// instructions is slow and indirect; this exercises the mechanism on its own.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { Machine } from './machine';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));

describe('taking an interrupt and returning from it', () => {
  it('puts the mask back where it was', () => {
    const m = new Machine(rom);
    m.a7 = 0x3e5000;
    m.setSR(0x2000);            // supervisor, mask 0 - as the game runs
    const before = m.getSR();
    const spBefore = m.a7;

    m.next = 0x1234;            // the address the frame should carry
    const handler = m.interruptFrame(4);

    const inHandler = m.getSR();
    // what the frame actually holds, read back the way rte reads it
    const stackedSr = m.load(m.a7, 16);
    const stackedPc = m.load(m.a7 + 2, 32);

    // and now the rte the translator emits, by hand
    const popped = m.loadPost('a7', 2, 16);
    m.a7 = (m.a7 + 4) >>> 0;
    m.setSR(popped);

    // eslint-disable-next-line no-console
    console.log([
      `before:        sr 0x${before.toString(16)} mask ${(before >> 8) & 7}  sp 0x${spBefore.toString(16)}`,
      `handler entry: sr 0x${inHandler.toString(16)} mask ${(inHandler >> 8) & 7}  vector 0x${handler.toString(16)}`,
      `frame holds:   sr 0x${stackedSr.toString(16)} pc 0x${stackedPc.toString(16)}`,
      `after rte:     sr 0x${m.getSR().toString(16)} mask ${(m.getSR() >> 8) & 7}  sp 0x${m.a7.toString(16)}`,
    ].join('\n'));

    expect((inHandler >> 8) & 7).toBe(4);
    expect(stackedSr).toBe(before);
    expect(stackedPc).toBe(0x1234);
    expect(m.getSR()).toBe(before);
    expect(m.a7).toBe(spBefore);
  });
});
