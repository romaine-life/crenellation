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

The destination buffer is zeroed first, so the whole buffer can be compared â€”
including cases where the correct answer is "write nothing".

Register note: MAME's m68k state exposes the stack as `SP`, not `A7`.

## Verified

### Graphics decompressor â€” `0x11F2A`
- **Port:** `romlab/unpack.py` (`decode_strip`)
- **Evidence:** `romlab/compare_decomp.py` â€” 12 cases, 8192-byte buffers
  compared in full, all identical. Cases cover the four literal modes, an
  all-skip stream, three data banks, and two palette-base offsets.
- **Bug the verification caught:** in nibble mode the count is *pixels*, not
  source bytes. The `dbra` at `0x11F68` sits between the high- and low-nibble
  writes, so a run can end after a high nibble without its low half being
  emitted. The port had always emitted both, overrunning by up to one pixel per
  run. Two of five early cases mismatched by 18 and 37 bytes; after the fix all
  cases match exactly.

### Terrain painter / second decompressor - `0x124BE`
- **Port:** `romlab/unpack2.py` (`decode`)
- **Evidence:** `romlab/compare_terrain.py` - 10 cases, full buffers identical,
  and the routine's stateful rotation counter matches after every call.
- **Differences from the first decoder:** literal mode copies 8-bit bytes
  straight through rather than expanding nibbles; the palette base is reloaded
  from the high nibble of the last byte read; and a control byte with bit 7
  clear selects TEXTURE mode, copying from a 128-byte pattern block in the
  table at `0x3A390`. Texture mode is **stateful** - a rotating offset at
  `0x3E0E76` advances by 13 (mod 64) on every use, so verification must set
  that state identically before each call.
- This is the routine that paints terrain, which is why patching `0x3A480`
  earlier flattened the ground texture.

### Block recolour - `0x11FF8`
- **Port:** `romlab/compare_recolor.py` (`recolor_block`)
- **Signature:** `recolor_block(long dest @+4, long palette_base @+8)` - the
  word at +10 is what it actually reads, i.e. the low half of a pushed int.
- **Behaviour:** for each of 8 rows, take 8 pixels, keep the low nibble and add
  the palette base, then advance a full row (+0x1F8). This is the primitive
  that re-tints a sealed region, which is how territory shading works.
- **Evidence:** `romlab/compare_recolor.py` - 6 cases over seeded input blocks,
  all 64 pixels identical, palette bases 0x00 through 0xF0.

### Rectangle palette remap - `0x1217E`
- **Port:** `romlab/compare_remap.py` (`remap_rect`)
- **Signature:** `remap_rect(long dest @+4, long table @+8, long width @+12,
  long height @+16)`
- **Behaviour:** for each pixel in the rectangle, split it into palette bank
  (high nibble) and colour (low nibble), look the bank up in a 16-entry table
  and add that to the colour. Rows advance by 0x200. This is the generalised
  form of the 8x8 recolour - the mechanism behind re-tinting a claimed region.
- **Evidence:** `romlab/compare_remap.py` - 6 cases across sizes 8x8, 16x4,
  4x16, 12x12 and 32x2 with different remap tables, all pixels identical.

### Screen dissolve - `0x11E10`
- **Port:** `romlab/compare_dissolve.py` (`dissolve_sequence`)
- **Behaviour:** clears the framebuffer in pseudo-random order with an LFSR:
  seed and polynomial both `0xB400`; each step is `lsr.l #1` and, on carry,
  `eor` with the polynomial, repeating while the value is >= 0xF000; the word
  at `base + value*2` is then cleared, for 61441 iterations. The base is
  `0x200004`, not `0x200000` - that +4 was the only initial mismatch.
- **Verified by sequence, not by call.** The routine ends in `jmp $52a.l`
  rather than `rts`, so the sentinel-return harness cannot catch it. Instead
  the addresses it clears were recorded in order and compared against the port:
  **61441 leading entries identical**, an entire dissolve pass.

### Random number generator - `0x11E58`  *(first game-logic routine)*
- **Port:** `romlab/compare_rng.py` (`random`)
- **Signature:** `random(long n @+4) -> long`, called from 10 sites. This is
  the RNG behind piece selection and other in-game randomness.
- **Behaviour:** a 16-bit LCG whose seed lives at `0x3E0842`. The seed is
  multiplied by `0x3619` (signed 16x16 -> 32), `0x5D35` is added **as a word**
  so only the low half changes, and that low word becomes the new seed. The
  result is that seed multiplied by `n`, plus `(n << 16) >> 1`, returning the
  sign-extended high word - i.e. a value scaled into `n`.
- **Evidence:** `romlab/compare_rng.py` - 96 cases (8 seeds x 12 values of n,
  including 0x0000, 0x8000 and 0xFFFF to cover sign handling). Return value and
  updated seed both identical in every case.

## Correction: the scoring measurement was wrong

Earlier I reported score awards of 150/200/300 "measured" by grouping RAM
deltas at `0x3E20AA` / `0x3E20E4` into bursts. The function map shows those
addresses are **linked-list heads used by an allocator** (`0xCA52` walks a
circular list at `0x3E20A0`; `0xC504` pops from `0x3E20A8`; `0x3E2498` is a
lock flag). The "awards" were almost certainly allocation activity, not score.
The scoring constants currently in `game.ts` are therefore not measured, and
the real score location is still unknown.

## Framebuffer reproduction

Replaying calls to both verified decoders onto a "before" snapshot reproduces
**99.4%** of the framebuffer (787 of 131072 bytes differ, down from ~8% with
decoder 1 alone). The remainder comes from writers not yet ported: `0x11E44`,
`0x12350`, `0x1E7EE`, `0x122AE`, `0x1E79A`, `0x12010`, `0x18EC4`,
`0x2320`-`0x232C`.

## Tooling

`romlab/mapcode.py` builds a function map from the ROM: call targets from a
linear sweep, function bodies walked to their terminator, with call graph and
absolute data references. This is what surfaced the allocator cluster that
ad-hoc memory probing had mistaken for scoring. Use it before probing.

## Method notes

- `PC` during a memory tap is the *next* instruction; use **`CURPC`** for the
  instruction actually executing. Writer addresses collected via `PC` do not
  disassemble.
- `0x11F2A` is the decompressor's **loop head**, not its entry - the routine
  branches back to it, so tapping it captures mid-loop states rather than
  calls. The real call site is `0x11F1C`.
- Replaying only the decompressor's calls does **not** reproduce the
  framebuffer (~8% of bytes differ): several other routines draw into it too -
  `0x125C4`, `0x11E44`, `0x12350`, `0x1E7EE`, `0x122AE`, `0x1E79A`, `0x12010`,
  `0x18EC4`, `0x2320`-`0x232C`. Whole-screen reproduction needs those ported.


- **Stateful routines do not need their layout mapped first.** Snapshot the
  state before the call, snapshot after, and require the port to reproduce the
  same delta. The RNG was verified this way: set the seed, call, compare both
  the return value and the new seed. The same approach scales to routines whose
  state is a whole RAM region - snapshot all 16KB of work RAM if necessary.

## Outstanding â€” not ported, not verified

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
