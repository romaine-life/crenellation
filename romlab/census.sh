#!/bin/sh
# Boot the game on the decompiled dispatcher and record every address it has no
# function for. The seam is patched into the generated file and removed by the
# next regeneration - it is scaffolding, not part of what ships.
set -e
cd "$(dirname "$0")/../frontend"
python3 - <<'PY'
import pathlib
p = pathlib.Path('src/rom/decompiled.ts'); t = p.read_text(encoding='utf-8')
old = "        throw new Error('no decompiled routine at 0x' + at.toString(16));"
new = ("        if (MISSING) { MISSING(at); recompiled!(at, m); return; }\n" + old)
assert t.count(old) == 1
t = t.replace(old, new, 1)
t = t.replace("const BY_ADDR: Map<number, number> = new Map(",
  "export let MISSING: ((a: number) => void) | null = null;\n"
  "export let recompiled: ((a: number, m: Machine) => void) | null = null;\n"
  "export function census(rec: (a: number, m: Machine) => void, on: (a: number) => void): void {\n"
  "  recompiled = rec; MISSING = on;\n}\n\n"
  "const BY_ADDR: Map<number, number> = new Map(", 1)
p.write_text(t, encoding='utf-8')
PY
cat > src/rom/missing.test.ts <<'TS'
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { System } from './system';
import { call as viaRecompiled } from './dispatch';
import { call as viaDecompiled, bind, census } from './decompiled';
const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));
describe('missing entry points', () => {
  it('records every address with no decompiled function', () => {
    const sys = new System(rom, board);
    bind(sys.m);
    const missing = new Map<number, number>();
    census(viaRecompiled, (a: number) => missing.set(a, (missing.get(a) ?? 0) + 1));
    const STOP = new Error('enough');
    let frames = 0;
    try {
      sys.run(() => { frames += 1; if (frames > Number(process.env.CENSUS_FRAMES ?? 2000)) throw STOP; },
        viaDecompiled);
    } catch (e) { if (e !== STOP) throw e; }
    writeFileSync(join(here, 'missing.txt'),
      [...missing.keys()].map((a) => `0x${a.toString(16)}`).join('\n'));
    expect(frames).toBeGreaterThan(0);
  }, 900000);
});
TS
npx vitest run src/rom/missing.test.ts >/dev/null 2>&1 || true
wc -l < src/rom/missing.txt
