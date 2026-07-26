#!/bin/sh
# Render each final song VGM to WAV via MAME's vgmplay, so the music is usable
# without a chiptune player.
cd /d/repos/crenellation/romlab || exit 1
mkdir -p out/music_final/wav

for f in out/music_final/song-*.vgm; do
  [ -e "$f" ] || continue
  base=$(basename "$f" .vgm)
  secs=$(python -c "
import struct
d = open('$f','rb').read()
print(max(5, int(struct.unpack_from('<I', d, 0x18)[0]/44100) + 2))
")
  powershell -NoProfile -Command "& D:\\Emulation\\MAME\\mame.exe vgmplay -rompath D:\\repos\\crenellation\\romlab\\roms -quik D:\\repos\\crenellation\\romlab\\$f -video none -nothrottle -skip_gameinfo -wavwrite D:\\repos\\crenellation\\romlab\\out\\music_final\\wav\\$base.wav -seconds_to_run $secs" > /dev/null 2>&1
  echo "$base rendered (${secs}s)"
done
