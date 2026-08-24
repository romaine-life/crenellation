// What do the high bits of a display-list code mean?
//
// The low twelve bits index mo.bin's 4,096 tiles - that much is settled, and
// rendering them gives castle blocks and terrain rather than noise. What the
// bits above them carry is not. Six codes sampled off the attract screen all
// had a zero high nibble, which says nothing at all.
//
// So sample properly: run a real game, collect every distinct code the ROM
// ever puts in the list, and report how the bits are actually used. A bit that
// never varies is not encoding anything; one that varies with the tile index
// is probably part of it; one that varies independently is a field.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PATTERNS } from './patterns';
import { System } from './system';
import { call as viaDecompiled, bind, original } from './decompiled';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const io = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));

const BASE = 0x3e0000;
const SLOTS = 0x47;
const FRAMES = Number(process.env.MO_FRAMES ?? 2400);

describe('the code field in a display-list slot', () => {
  it('says which of its bits actually vary', () => {
    original();
    const seen = new Set<number>();
    const lines: string[] = [];

    for (const pat of PATTERNS.filter((p) => /one player|two players/.test(p.name))) {
      const sys = new System(rom, io);
      bind(sys.m);
      const STOP = new Error('enough');
      let n = 0;
      const w = (a: number): number => (sys.m.byte(a) << 8) | sys.m.byte(a + 1);
      try {
        sys.run(() => {
          n += 1;
          pat.at(n, sys);
          if (n % 5 === 0) {
            for (let s = 0; s < SLOTS; s += 1) {
              const c = w(BASE + s * 8 + 2);
              if (c) seen.add(c);
            }
          }
          if (n >= FRAMES) throw STOP;
        }, viaDecompiled);
      } catch (e) { if (e !== STOP) lines.push(`${pat.name}: threw ${(e as Error).message.slice(0, 40)}`); }
      lines.push(`after "${pat.name}": ${seen.size} distinct codes so far`);
    }

    const codes = [...seen].sort((a, b) => a - b);
    // Which bits ever differ, and does anything sit above bit 11?
    let ored = 0, anded = 0xffff;
    for (const c of codes) { ored |= c; anded &= c; }
    const varying = ored & ~anded;
    lines.push('');
    lines.push(`distinct codes: ${codes.length}`);
    lines.push(`bits ever set   : ${ored.toString(2).padStart(16, '0')}`);
    lines.push(`bits always set : ${anded.toString(2).padStart(16, '0')}`);
    lines.push(`bits that vary  : ${varying.toString(2).padStart(16, '0')}`);
    lines.push(`max code        : 0x${(codes[codes.length - 1] ?? 0).toString(16)}`);
    lines.push(`codes >= 0x1000 : ${codes.filter((c) => c >= 0x1000).length}`);
    lines.push('');
    lines.push('high nibble distribution:');
    const byHi = new Map<number, number>();
    for (const c of codes) byHi.set(c >> 12, (byHi.get(c >> 12) ?? 0) + 1);
    for (const [hi, k] of [...byHi].sort((a, b) => a[0] - b[0])) {
      lines.push(`  ${hi.toString(16)}xxx : ${k}`);
    }
    lines.push('');
    lines.push('first 40 codes: ' + codes.slice(0, 40).map((c) => c.toString(16)).join(' '));

    writeFileSync(join(here, 'mocodes.txt'), lines.join('\n') + '\n');
    expect(codes.length).toBeGreaterThan(0);
  }, 900000);
});
