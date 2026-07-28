#!/bin/sh
# Add whatever address the game actually dies on, regenerate, repeat.
# The census with a recompiled fallback keeps running past the gap, but mixing
# the two dispatchers moves the path, so it misses entries the pure decompiled
# run reaches. This uses the pure run: one address per round, but the right one.
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
for round in 1 2 3 4 5 6 7 8 9 10 11 12; do
  cd "$root/frontend"
  DRAW_FRAMES=1200 npx vitest run src/rom/draws.test.ts >/dev/null 2>&1 || true
  line=$(grep '^decompiled' src/rom/draws.txt)
  addr=$(printf '%s' "$line" | sed -n 's/.*no decompiled routine at 0x\([0-9a-f]*\).*/\1/p')
  echo "round $round: $line"
  [ -z "$addr" ] && break
  python3 - "$root" "$addr" <<'PY'
import json, pathlib, sys, bisect
root, a = pathlib.Path(sys.argv[1]), int(sys.argv[2], 16)
facts = json.loads(root.joinpath('romlab/out/facts.json').read_text())
fs = sorted((f['at'] if isinstance(f, dict) else f[0],
             f['end'] if isinstance(f, dict) else f[1]) for f in facts['funcs'])
los = [x for x, _ in fs]
k = bisect.bisect_right(los, a) - 1
if not (k >= 0 and fs[k][0] < a < fs[k][1]):
    print('  not inside a routine - stopping'); raise SystemExit(1)
p = root / 'romlab/out/inner_entries.json'
cur = set(json.loads(p.read_text()))
p.write_text(json.dumps(sorted(cur | {a})))
PY
  cd "$root/romlab" && python3 idents.py >/dev/null 2>&1 && python3 blocks.py >/dev/null 2>&1 \
    && rm -f out/unproven.json && python3 decomp.py >/dev/null 2>&1
done
