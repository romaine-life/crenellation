#!/bin/sh
# Run the dynamic sweep, feed every address it finds back through
# regeneration, and repeat until a sweep finds nothing.
#
# Each fix lets the game run further and reveals the next one, so this cannot
# be done in one pass - and closing the set against the *pure* decompiled run
# is the whole point: a census that falls back to the recompiler takes a
# different path from the first gap onward and misses the rest.
#
# Usage: sh sweeploop.sh [max-rounds]
set -e
cd "$(dirname "$0")"
MAX=${1:-12}
i=1
while [ "$i" -le "$MAX" ]; do
  echo "=== sweep round $i"
  sh sweep.sh > /tmp/sweeploop-out.txt 2>&1 || true
  cat /tmp/sweeploop-out.txt
  FOUND=$(grep -oE '0x[0-9a-f]+' /tmp/sweeploop-out.txt | sort -u | tr '\n' ' ')
  if [ -z "$FOUND" ]; then
    echo "=== sweep round $i found nothing: dry"
    exit 0
  fi
  echo "=== feeding back: $FOUND"
  python3 - "$FOUND" <<'PY'
import json, sys
found = [int(x, 16) for x in sys.argv[1].split()]
p = 'out/runtime-entries.json'
d = set(json.load(open(p))) | set(found)
json.dump(sorted(d), open(p, 'w'))
print('runtime entries now', len(d))
PY
  python3 describe.py > /dev/null
  python3 gen_ts.py | head -1
  python3 cfg.py > /dev/null
  python3 idents.py > /dev/null
  python3 blocks.py > /dev/null 2>&1
  rm -f out/unproven.json
  python3 decomp.py > /dev/null 2>&1
  python3 handedits.py > /dev/null
  i=$((i + 1))
done
echo "=== hit the round limit with finds still coming - not dry"
exit 1
