#!/bin/sh
# One cold-booted MAME run per song id, so no song contaminates the next.
cd /d/repos/crenellation/romlab || exit 1
mkdir -p out/song/rip
rm -f out/song/rip/song-*.log out/song/rip/count-*.txt

for id in 14 13 21 252 22 18 3 4 116 12 17 117 118 119 120 251; do
  python ripone.py "$id" 75 > /dev/null 2>&1 || continue
  powershell -NoProfile -Command "& D:\\Emulation\\MAME\\mame.exe rampart -rompath D:\\repos\\crenellation\\romlab\\roms -nvram_directory D:\\repos\\crenellation\\romlab\\nvram_clean -video none -sound none -nothrottle -skip_gameinfo -autoboot_script D:\\repos\\crenellation\\romlab\\ripone.lua -autoboot_delay 1 -seconds_to_run 140" > /dev/null 2>&1
  n=$(cat "out/song/rip/count-$(printf %03d "$id").txt" 2>/dev/null || echo 0)
  echo "id $id -> $n FM writes"
done
echo DONE
