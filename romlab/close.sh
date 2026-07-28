#!/bin/sh
# Add every address the running game has no decompiled function for, regenerate,
# and repeat until the census comes back empty.
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
for round in 1 2 3 4 5 6; do
  n=$(python3 - "$root" <<'PY'
import json, pathlib, sys, bisect
root = pathlib.Path(sys.argv[1])
p_missing = root.joinpath('frontend/src/rom/missing.txt')
miss = set() if not p_missing.exists() else {int(x, 16) for x in
        p_missing.read_text().split() if x}
facts = json.loads(root.joinpath('romlab/out/facts.json').read_text())
fs = sorted((f['at'] if isinstance(f, dict) else f[0],
             f['end'] if isinstance(f, dict) else f[1]) for f in facts['funcs'])
los = [a for a, _ in fs]
inside = set()
for a in miss:
    k = bisect.bisect_right(los, a) - 1
    if k >= 0 and fs[k][0] < a < fs[k][1]:
        inside.add(a)
p = root / 'romlab/out/inner_entries.json'
cur = set(json.loads(p.read_text()))
p.write_text(json.dumps(sorted(cur | inside)))
print(len(inside - cur))
PY
)
  echo "round $round: added $n"
  [ "$n" = "0" ] && break
  (cd "$root/romlab" && python3 idents.py >/dev/null 2>&1 && python3 blocks.py >/dev/null 2>&1 \
     && rm -f out/unproven.json && python3 decomp.py >/dev/null 2>&1)
  sh "$root/romlab/census.sh" >/dev/null 2>&1 || true
done
echo "final: $(tr -d '\n' < "$root/frontend/src/rom/missing.txt" | wc -c) chars of missing addresses"
