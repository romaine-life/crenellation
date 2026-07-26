#!/bin/sh
# Render each extracted tune (VGM register log) to a playable WAV using MAME's
# vgmplay machine, so the music is usable without a chiptune player.
cd /d/repos/crenellation/romlab || exit 1
mkdir -p out/music/wav

for f in out/music/track*.vgm; do
  [ -e "$f" ] || continue
  base=$(basename "$f" .vgm)
  secs=$(python -c "
import struct, sys
d = open('$f','rb').read()
total = struct.unpack_from('<I', d, 0x18)[0]
print(max(5, int(total/44100) + 3))
")
  powershell -NoProfile -Command "& D:\\Emulation\\MAME\\mame.exe vgmplay -rompath D:\\repos\\crenellation\\romlab\\roms -quik D:\\repos\\crenellation\\romlab\\$f -video none -nothrottle -skip_gameinfo -wavwrite D:\\repos\\crenellation\\romlab\\out\\music\\wav\\$base.wav -seconds_to_run $secs" > /dev/null 2>&1
  echo "$base -> ${secs}s"
done
