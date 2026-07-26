# Routine verification status

A routine counts as **ported** only when its behaviour was read out of the
68000 disassembly and reimplemented. It counts as **verified** only when the
original routine and the port have been fed *identical inputs* and produced
*identical outputs*.

Anything not meeting that bar is listed as outstanding, regardless of how
plausible the current implementation looks.

## Harness

`romlab/verify.lua` calls a ROM routine directly inside MAME:

1. Save the full CPU state.
2. Point the stack at scratch memory and push a sentinel return address.
3. Set the argument registers, set PC to the routine, let it run.
4. A read tap on the sentinel fires when the routine returns to it; the output
   buffer is dumped and the CPU state restored.

The destination buffer is zeroed first, so the whole buffer can be compared —
including cases where the correct answer is "write nothing".

Register note: MAME's m68k state exposes the stack as `SP`, not `A7`.

## Verified

### Graphics decompressor — `0x11F2A`
- **Port:** `romlab/unpack.py` (`decode_strip`)
- **Evidence:** `romlab/compare_decomp.py` — 12 cases, 8192-byte buffers
  compared in full, all identical. Cases cover the four literal modes, an
  all-skip stream, three data banks, and two palette-base offsets.
- **Bug the verification caught:** in nibble mode the count is *pixels*, not
  source bytes. The `dbra` at `0x11F68` sits between the high- and low-nibble
  writes, so a run can end after a high nibble without its low half being
  emitted. The port had always emitted both, overrunning by up to one pixel per
  run. Two of five early cases mismatched by 18 and 37 bytes; after the fix all
  cases match exactly.

## Outstanding — not ported, not verified

Each of these is currently **original code informed by observing the running
game**, not a port of the ROM's logic. Numbers were inferred from measurements
rather than read from the routine that produces them.

| System | Current implementation | What verification requires |
| --- | --- | --- |
| Enclosure / flood fill | `enclosure.ts`, written from the rules as I understand them | Locate the routine that runs after a wall is placed; call it with a crafted board in RAM; compare the territory result |
| Piece generation | `pieces.ts`, shapes and weights inferred from 292 observed placements | Find the shape table and the selection routine; compare the sequence for a fixed seed/state |
| Scoring | `game.ts` constants, inferred from grouping score-counter ticks into bursts | Find the routine that adds to the score word; call it per event type; compare awards |
| Ship movement and firing | `game.ts`, derived from motion-object tracking and spawn rates | Find the ship update routine; step it with a fixed ship state; compare positions and fire timing |
| Damage / blast footprint | `game.ts`, inferred from captured battle frames | Find the impact routine; call it against a crafted wall layout; compare which cells are destroyed |
| Phase control | `phases.ts`, durations read from the countdown word in RAM | Find the phase state machine; compare transition frames |
| Object composition (art) | Sprites cropped from captured frames | Decode tile codes + palette banks + sizes from the motion-object list; render from the gfx ROM |
| Terrain plates (art) | Painted from two sampled tiles with a synthetic bank edge | Decompress the real terrain art from ROM via the verified decompressor |
| Attract screens (art) | PNG screenshots | Decompress from ROM via the verified decompressor |

## Multiplayer

Hot-seat shaped in code but only one castle is placed; not playable. Outstanding.
