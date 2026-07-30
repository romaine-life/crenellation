#!/bin/sh
# The dynamic half of a sweep: every input pattern in SWEEP.md, against the
# pure decompiled game. Patches the census seam into the generated
# decompiled.ts, runs sweep.test.ts.tmpl, then puts the file back exactly as
# it was - the seam is scaffolding, not something that ships.
set -e
cd "$(dirname "$0")/../frontend"
cp src/rom/decompiled.ts /tmp/decompiled.sweep-backup.ts
python3 - <<'PY'
import pathlib
p = pathlib.Path('src/rom/decompiled.ts'); t = p.read_text(encoding='utf-8')
old = "        throw new Error('no decompiled routine at 0x' + at.toString(16));"
assert t.count(old) == 1
t = t.replace(old, "        if (MISSING) { MISSING(at); recompiled!(at, m); return; }\n" + old, 1)
t = t.replace("const BY_ADDR: Map<number, number> = new Map(",
  "export let MISSING: ((a: number) => void) | null = null;\n"
  "export let recompiled: ((a: number, m: Machine) => void) | null = null;\n"
  "export function census(rec: (a: number, m: Machine) => void, on: (a: number) => void): void {\n"
  "  recompiled = rec; MISSING = on;\n}\n\n"
  "const BY_ADDR: Map<number, number> = new Map(", 1)
p.write_text(t, encoding='utf-8')
PY
cp ../romlab/sweep.test.ts.tmpl src/rom/sweep.test.ts
npx vitest run src/rom/sweep.test.ts > /tmp/sweep-run.log 2>&1 || true
cp /tmp/decompiled.sweep-backup.ts src/rom/decompiled.ts
rm -f src/rom/sweep.test.ts
cat src/rom/sweep.txt 2>/dev/null || tail -20 /tmp/sweep-run.log
