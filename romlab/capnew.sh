#!/bin/sh
# Capture step-state ground truth for the entries in out/step/entries-new.txt,
# over the same shape/step matrix the original session used. One MAME run per
# (shape, steps) pair; each run covers every entry. The logs land in the main
# checkout's out/step/ as sn<shape>-<steps>.log, next to but never over the
# originals. Determinism is checked afterwards by diffing ram-baseline2.bin /
# pf-baseline2.bin / io-baseline2.bin against the committed step-*.bin - only
# if those are byte-identical do the new S-lines join stepstate.log.
# MAME writes nvram back on every clean exit, so nvram_clean has been
# drifting one run at a time since the first capture - todays eeprom differs
# from the original session's in 31 bookkeeping bytes. The original device
# content survives inside the committed io-baseline.bin (the 0x500000 block's
# odd lane, first 2048 bytes); it is restored before every run so all 32 runs
# freeze the same machine, byte-identical to the committed baselines.
set -e
LUA='D:\repos\crenellation\.claude\worktrees\full-decompilation-continuation-fea13d\romlab\stepnew.lua'
NV="$(dirname "$0")/nvram_orig"
for SHAPE in 0 1 2 3; do
  for N in 1 2 3 5 10 20 60 200; do
    echo "shape $SHAPE steps $N"
    mkdir -p "$NV/rampart"
    cp "$(dirname "$0")/eeprom-original.bin" "$NV/rampart/eeprom"
    powershell -NoProfile -Command \
      "\$env:STEPSHAPE='$SHAPE'; \$env:STEPN='$N'; & D:\\Emulation\\MAME\\mame.exe rampart -rompath D:\\repos\\crenellation\\romlab\\roms -nvram_directory 'D:\\repos\\crenellation\\.claude\\worktrees\\full-decompilation-continuation-fea13d\\romlab\\nvram_orig' -video none -sound none -nothrottle -skip_gameinfo -autoboot_script '$LUA' -autoboot_delay 1 -seconds_to_run 240" \
      > /dev/null 2>&1 || true
  done
done
echo "captures done; logs in D:/repos/crenellation/romlab/out/step/sn*.log"
