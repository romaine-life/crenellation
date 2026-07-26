#!/bin/sh
# Sweep the battlefield selector (RAM 0x3E1952, candidate index 1) across a wide
# range to enumerate every distinct map, capturing many frames per value so a
# clean (panel-free) frame can be chosen afterwards.
cd /d/repos/crenellation/romlab || exit 1
mkdir -p out/final
: > out/final/sweep.txt

for v in 0 1 2 3 4 5 6 9 12 16 20 24 32 48; do
  python mkpoke.py 1 2 "$v" > /dev/null 2>&1 || continue
  rm -f out/poke/*.bin
  powershell -NoProfile -Command "& D:\\Emulation\\MAME\\mame.exe rampart -rompath D:\\repos\\crenellation\\romlab\\roms -nvram_directory D:\\repos\\crenellation\\romlab\\nvram_clean -video none -sound none -nothrottle -skip_gameinfo -autoboot_script D:\\repos\\crenellation\\romlab\\poke.lua -autoboot_delay 1 -seconds_to_run 200" > /dev/null 2>&1
  mkdir -p "out/final/val$v"
  rm -f "out/final/val$v"/*.bin
  cp out/poke/*.bin "out/final/val$v/" 2>/dev/null
  echo "value $v: $(ls out/final/val$v/bitmap-*.bin 2>/dev/null | wc -l) captures" >> out/final/sweep.txt
done
echo DONE >> out/final/sweep.txt
