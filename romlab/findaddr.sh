#!/bin/sh
# Group [0:5] changes the map. Test each of those five addresses alone to find
# the single level selector. Control signature (no effect) is land~614/water~463.
cd /d/repos/crenellation/romlab || exit 1
RESULT=out/findaddr.txt
: > "$RESULT"

for i in 0 1 2 3 4; do
  HI=$((i + 1))
  python mkpoke.py "$i" "$HI" 4 > /dev/null 2>&1 || continue
  rm -f out/poke/*.bin
  powershell -NoProfile -Command "& D:\\Emulation\\MAME\\mame.exe rampart -rompath D:\\repos\\crenellation\\romlab\\roms -nvram_directory D:\\repos\\crenellation\\romlab\\nvram_clean -video none -sound none -nothrottle -skip_gameinfo -autoboot_script D:\\repos\\crenellation\\romlab\\poke.lua -autoboot_delay 1 -seconds_to_run 120" > /dev/null 2>&1
  python - "$i" >> "$RESULT" 2>&1 <<'PYEOF'
import pathlib, struct, sys, re
from collections import Counter
idx = sys.argv[1]
log = pathlib.Path('out/lvl/lvl.log').read_text()
addrs = [m.group(1) for m in re.finditer(r'^\s+([0-9A-F]{6}) v=', log, re.M)]
CAPS = pathlib.Path('out/poke')
best = None
for p in sorted(CAPS.glob('bitmap-*.bin')):
    n = p.stem.split('-')[1]
    pf = CAPS / f'palette-{n}.bin'
    if not pf.exists():
        continue
    bmp = p.read_bytes(); pal = pf.read_bytes()
    def cls(v):
        (w,) = struct.unpack_from('<H', pal, v * 2); k = (w >> 15) & 1
        r = (((w >> 9) & 0x3e) | k); g = (((w >> 4) & 0x3e) | k); b = (((w << 1) & 0x3e) | k)
        if b > r + 12 and b > g + 4: return 'w'
        if g > r + 12 and g > b + 12: return 'l'
        return 'o'
    c = Counter()
    for cy in range(0, 240, 8):
        for cx in range(0, 336, 8):
            c[cls(bmp[cy * 512 + cx])] += 1
    if best is None or c['l'] > best[0]:
        best = (c['l'], c['w'], c['o'])
l, w, o = best if best else (0, 0, 0)
verdict = ''
if l > 300 and not (560 < l < 660 and 430 < w < 500):
    verdict = '  <<< SELECTOR'
print(f'addr {addrs[int(idx)]}: land={l} water={w} other={o}{verdict}')
PYEOF
done
echo DONE >> "$RESULT"
