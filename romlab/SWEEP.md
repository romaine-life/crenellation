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

3. `sweep.sh` — the **pure decompiled** game under every input pattern below,
   recording every address the map has no function for. The pure run is the
   point: a census that falls back to the recompiler takes a different path
   from the first gap onward and misses the rest. It patches the census seam
   into the generated `decompiled.ts` and puts the file back afterwards; the
   patterns live in `sweep.test.ts.tmpl`. `census.sh` is the older
   single-pattern version of the same idea.
4. `sweeploop.sh` — runs 3 in a loop, feeds every find back through
   regeneration, and repeats until a sweep finds nothing. Each fix lets the
   game run further and reveals the next, so one pass is never enough:
   attract alone was dry at 901 routines while a joined player was not.
5. The MAME sweeps (`groupsweep.sh`, `mapsweep.sh`, `findaddr.sh`) — the real
   chip under input patterns, watching for a PC outside the function map.
   MAME lives at `D:\Emulation\MAME\mame.exe`; roms and nvram under the main
   checkout's `romlab/`.

## The input patterns

Encoded in `sweep.test.ts.tmpl`, one entry per pattern, so a sweep runs them
all rather than trusting a person to remember. Input bits are the ones
`RomScreen.tsx` maps - coin slots at byte 3 bits 0-1, the three stations at
bytes 0-2, service at byte 2 bit 3 - and they are active-low.

- attract, through two full demo loops
- one player: a coin, join at the middle station, then button one mashed with
  the trackball walking both axes. A wall goes down where the cursor is, so
  the cursor has to move for the piece code to see more than one cell
- two players: both coin slots, the left and right stations
- three stations at once, second buttons included, all eight trackball axes
- the service switch held and released, with buttons walking its menus
- no input at all, long run

The pattern list is allowed to grow; a sweep that adds a pattern still counts,
a sweep that skips one does not.

## The ledger

Every sweep gets one line in `SWEEPLOG.md`: date, instruments run, patterns
covered, what was found (or "dry"). Three consecutive "dry" lines close the
protocol; the third line's date is the date the map converged.
