#!/bin/sh
# Capture shape 4 - address registers holding code - over the committed
# 907-entry list, one MAME run per step count. Same determinism discipline as
# capnew.sh: the original eeprom is restored before every run so all eight
# freeze the same machine, and the baselines are checked afterwards.
set -e
LUA='D:\repos\crenellation\.claude\worktrees\full-decompilation-continuation-fea13d\romlab\step4.lua'
NV="$(dirname "$0")/nvram_orig"
for N in 1 2 3 5 10 20 60 200; do
  echo "shape 4 steps $N"
  mkdir -p "$NV/rampart"
  cp "$(dirname "$0")/eeprom-original.bin" "$NV/rampart/eeprom"
  powershell -NoProfile -Command \
    "\$env:STEPSHAPE='4'; \$env:STEPN='$N'; & D:\Emulation\MAME\mame.exe rampart -rompath D:\repos\crenellation\romlab\roms -nvram_directory 'D:\repos\crenellation\.claude\worktrees\full-decompilation-continuation-fea13d\romlab\nvram_orig' -video none -sound none -nothrottle -skip_gameinfo -autoboot_script '$LUA' -autoboot_delay 1 -seconds_to_run 240" \
    > /dev/null 2>&1 || true
  wc -l "D:/repos/crenellation/romlab/out/step/s4-$N.log" 2>/dev/null || echo "  (no log)"
done
echo "shape 4 captured"
