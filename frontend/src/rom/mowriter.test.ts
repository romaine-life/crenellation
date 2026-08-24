// Who writes the low seven bits of a display-list position word?
//
// Three readings of those bits have been written down and withdrawn: an
// attribute (inferred from a distribution), a fraction (inferred from one
// writer's shift), and neither (the arithmetic refuses both, because
// motionObjectWordPack adds a term with zero low bits so the display word
// inherits them unchanged, and a value shifted left six can only leave 0x00 or
// 0x40 there - yet the machine shows 30 32 33 39 3a).
//
// Every one of those was an inference. This is not: hook the store, catch the
// write while it happens, and read the return addresses off the machine's own
// stack to see which routine did it. The stack-walk trick is writes.test's -
// a longword in the overlay's code range and even is a return address - and
// its own warning applies here: some hits are data that looks like code, so
// check one against facts.json before believing it.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PATTERNS } from './patterns';
import { System } from './system';
import { call as viaDecompiled, bind, original, DECOMPILED } from './decompiled';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const io = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));

const BASE = 0x3e0000;
const SLOTS = 0x47;
const FRAMES = Number(process.env.MO_FRAMES ?? 1500);

// The OBJECT RECORDS, not the display list. displayListBuild walks them at
// 0x3e02d8, sixteen bytes apart, and motionObjectEntryWrite only ever
// preserves the low seven bits of fields 0xc and 0xe - so whoever sets them
// does it here, one step earlier than the last probe was looking.
const RECORDS = 0x3e02d8;
const WATCH = new Set<number>();
for (let s = 0; s < SLOTS; s += 1) { WATCH.add(RECORDS + s * 16 + 0xd); WATCH.add(RECORDS + s * 16 + 0xf); }

describe('the low seven bits of a display-list position word', () => {
  it('names the routine that writes them', () => {
    original();
    const starts = DECOMPILED.map((d) => d.at).sort((a, b) => a - b);
    const nameAt = new Map(DECOMPILED.map((d) => [d.at, d.fn.name] as [number, string]));
    const owner = (pc: number): string => {
      let lo = 0, hi = starts.length - 1, best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= pc) { best = starts[mid]; lo = mid + 1; } else hi = mid - 1;
      }
      return best < 0 ? '?' : (nameAt.get(best) ?? '?');
    };

    const tally = new Map<string, { n: number; vals: Set<number> }>();
    const sys = new System(rom, io);
    bind(sys.m);
    const sb = sys.m.setByte.bind(sys.m);
    let inHook = false;
    sys.m.setByte = (a: number, v: number): void => {
      if (!inHook && WATCH.has(a) && (v & 0x7f) !== 0) {
        inHook = true;
        const chain: string[] = [];
        for (let i = 0; i < 128 && chain.length < 3; i += 2) {
          const at = (sys.m.a7 + i) >>> 0;
          const w = ((sys.m.byte(at) << 24) | (sys.m.byte(at + 1) << 16)
            | (sys.m.byte(at + 2) << 8) | sys.m.byte(at + 3)) >>> 0;
          if (w >= 0x400 && w < 0x20000 && (w & 1) === 0) chain.push(owner(w));
        }
        const k = chain.join(' <- ') || '(no return address on the stack)';
        const e = tally.get(k) ?? { n: 0, vals: new Set<number>() };
        e.n += 1; e.vals.add(v & 0x7f); tally.set(k, e);
        inHook = false;
      }
      sb(a, v);
    };

    const pat = PATTERNS.find((p) => /one player/.test(p.name))!;
    const STOP = new Error('enough');
    let n = 0;
    try {
      sys.run(() => { n += 1; pat.at(n, sys); if (n >= FRAMES) throw STOP; }, viaDecompiled);
    } catch (e) { if (e !== STOP) { /* recorded below */ } }

    const lines = [`writes with non-zero low seven bits, over ${n} frames of "${pat.name}"`, ''];
    for (const [k, e] of [...tally].sort((a, b) => b[1].n - a[1].n).slice(0, 12)) {
      lines.push(`${String(e.n).padStart(6)}  ${k}`);
      lines.push(`        values: ${[...e.vals].sort((a, b) => a - b).map((v) => v.toString(16)).join(' ')}`);
    }
    writeFileSync(join(here, 'mowriter.txt'), lines.join('\n') + '\n');
    expect(n).toBeGreaterThan(0);
  }, 900000);
});
