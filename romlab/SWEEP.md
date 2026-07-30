# The discovery sweep, written down

Discovery converges when nothing finds a new entry any more. "Nothing has
turned up lately" is an anecdote; this file defines the measurement. A sweep
is one full pass of every instrument below. **Dry is three consecutive sweeps
that discover nothing.** Any discovery — a new entry, a changed extent — feeds
back through regeneration and resets the count to zero.

## The instruments

Static, run after every regeneration (all in `romlab/`):

1. `staticentries.py` — lifted `callRom`/`jumpRom` targets outside every
   routine. Zero uncovered is the pass condition; the output accumulates.
2. `census_image.py` — the byte-level audit. Pass is zero misclassification
   alarms and zero unjudged suspects; every byte of the image carries exactly
   one verdict.

Dynamic, run against the port and against silicon:

3. `census.sh` — boots the game on the **pure decompiled** dispatcher and
   records every address it has no function for. The pure run is the point:
   a census that falls back to the recompiler takes a different path from the
   first gap onward and misses the rest. `CENSUS_FRAMES` extends the run.
4. The MAME sweeps (`groupsweep.sh`, `mapsweep.sh`, `findaddr.sh`) — the real
   chip under input patterns, watching for a PC outside the function map.
   MAME lives at `D:\Emulation\MAME\mame.exe`; roms and nvram under the main
   checkout's `romlab/`.

## The input patterns

Each dynamic sweep covers, in one session or several:

- attract, left to run through at least two full demo loops
- service mode, every screen entered and exited
- a 1-player, a 2-player and a 3-player game, each played to game over
- high-score entry, completed and abandoned
- trackball motion on every axis of every station, buttons held and mashed,
  during play and during phase transitions

The pattern list is allowed to grow; a sweep that adds a pattern still counts,
a sweep that skips one does not.

## The ledger

Every sweep gets one line in `SWEEPLOG.md`: date, instruments run, patterns
covered, what was found (or "dry"). Three consecutive "dry" lines close the
protocol; the third line's date is the date the map converged.
