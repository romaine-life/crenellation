// Where does the colour base come from?
//
// The decompiled run draws every player's panel green: d2's low word reaches
// the graphics decompressor as 0x80 where the oracle has 0x90, 0xA0 and 0xB0,
// so the per-player term is zero. d2 is a parameter all the way down the call
// chain and no routine in it assigns d2, which means the value is set further
// up than the ROM stack's return addresses show.
//
// So ask the oracle. The recompiled dispatcher keeps its registers in the
// machine, so watching d2 there is sound - which the decompiled side is not,
// its registers being JavaScript locals. Find the instruction that puts a
// player's bank into d2 and the lift of that same address is the suspect.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'vitest';
import { System } from './system';
import { call as viaRecompiled } from './dispatch';
import { call as viaDecompiled, bind } from './decompiled';
import { PATTERNS } from './patterns';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));

describe('colour base', () => {
  // Both dispatchers. The decompiled side keeps registers in JavaScript locals,
  // but it spills them to the machine at every block head, so sys.m.d2 is
  // readable there at block granularity - coarser than the oracle's
  // per-instruction view, but the COUNTS are what matter, not the instant.
  for (const [who, entry] of [['oracle', viaRecompiled], ['lift', viaDecompiled]] as const)
  it(`says where the ${who} sets it`, () => {
    const sys = new System(rom, board);
    if (who === 'lift') bind(sys.m);
    const pat = PATTERNS.find((p) => p.name.startsWith('two players'))!;
    const seen = new Map<string, number>();
    const STOP = new Error('enough');
    let n = 0;
    sys.m.atPcExtra = (pc: number): void => {
      // At the decompressor's entry ONLY. Watching d2 wherever it happens to
      // hold a bank byte was a mistake: screenDissolve counts down through
      // 0xF000 and its low byte passes through all four, evenly, which reads
      // exactly like enumerating them. Here d2 IS the colour base - the
      // routine adds it to every pixel - so the value means what it says.
      // The return address on top of the stack names who asked for it.
      if (pc >= 0x11f08 && pc <= 0x11f2c) {
        const v = sys.m.d2 & 0xff;
        const from = sys.m.load(sys.m.a7 >>> 0, 32) >>> 0;
        const k = `d2.b=0x${v.toString(16)} from 0x${from.toString(16)}`;
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    };
    try {
      sys.run(() => { n += 1; pat.at(n, sys); if (n >= 600) throw STOP; }, entry);
    } catch (e) { if (e !== STOP) { /* the run ends how it ends */ } }
    const rows = [...seen.entries()].sort((a, b) => b[1] - a[1]);
    writeFileSync(join(here, `colour-${who}.txt`),
      rows.map(([k, c]) => `${k}  x${c}`).join('\n'));
  }, 600000);
});
