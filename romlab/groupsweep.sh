#!/bin/sh
# Test level-counter candidates in groups of 5, one fresh MAME process each
# (soft_reset leaves the machine dead, so every test needs a cold boot).
# Reports any group whose poke changes the battlefield.
cd /d/repos/crenellation/romlab || exit 1
RESULT=out/groupsweep.txt
: > "$RESULT"

for g in 0 1 2 3 4 5 6 7 8 9 10 11 12; do
  LO=$((g * 5))
  HI=$((LO + 5))
  python mkpoke.py "$LO" "$HI" 4 > /dev/null 2>&1 || continue
  rm -f out/poke/*.bin
  powershell -NoProfile -Command "& D:\\Emulation\\MAME\\mame.exe rampart -rompath D:\\repos\\crenellation\\romlab\\roms -nvram_directory D:\\repos\\crenellation\\romlab\\nvram_clean -video none -sound none -nothrottle -skip_gameinfo -autoboot_script D:\\repos\\crenellation\\romlab\\poke.lua -autoboot_delay 1 -seconds_to_run 120" > /dev/null 2>&1
  python harvest_poke.py > /dev/null 2>&1
  python - "$LO" "$HI" >> "$RESULT" 2>&1 <<'PYEOF'
import json, sys, pathlib
lo, hi = sys.argv[1], sys.argv[2]
try:
    base = json.load(open('out/maps/map0.json'))['grid']
    new = json.load(open('out/mapsk/map0.json'))['grid']
    d = sum(1 for a, b in zip(base, new) for x, y in zip(a, b) if x != y)
    w = sum(1 for r in new for c in r if c == 'water')
    l = sum(1 for r in new for c in r if c == 'land')
    verdict = ''
    if l > 300 and w > 40 and d > 250:
        verdict = '  <<< MAP CHANGED'
    elif l < 100:
        verdict = '  (crashed/blank)'
    print(f'group [{lo}:{hi}] land={l} water={w} diff={d}{verdict}')
except Exception as e:
    print(f'group [{lo}:{hi}] ERROR {e}')
PYEOF
done
echo "DONE" >> "$RESULT"
