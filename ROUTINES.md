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

## Art decoded from ROM

The playfield art is **not** a set of pictures in the ROM. It is one
back-to-back compressed stream of 8x8 tiles: every tile decodes to a clean
terminator and the next begins exactly where the last ended. Screens are
placement maps over that tileset, and the palette bank is applied at draw time
(the `pal` argument), so one tile serves every colour scheme it appears in.

**Alignment evidence:** walking the stream from the first observed source,
**all 140** sources recorded during capture land exactly on a walk boundary,
and every stream decodes to exactly 8 rows. The walk runs clean from
`0x0D75BB` to `0x0FBA11`.

**Extraction:** `romlab/extract_tiles.py` - **5907 tiles, 4951 distinct**,
written as 4-bit indices (`out/tileset/tiles.bin`) plus a contact sheet and a
source-address index. The sheet shows the game's own text - INSERT COIN, USE
TRACKBALL, MILITARY MASTERS, FIREPOWER, BATTLEFIELD, ENTER YOUR NAME - along
with terrain and wall art.

**Verification:** `romlab/artverify.lua` + `romlab/compare_art.py`. Every call
the game made to the decompressor was tapped for its arguments, and the pixels
the hardware left at the destination were read back and compared against the
port:

- **11614 calls**, **1788 distinct (source, palette, row-count) combinations**,
  **715179 pixels compared**
- **11604 of 11614 tiles identical.** The 10 exceptions came from 9
  configurations, 8 of which matched *the same arguments* elsewhere in the same
  run - 1424x, 1657x, 281x, 107x, 35x, 16x, 4x and 2x - meaning the readback,
  which happens on the following call, had been overwritten by another routine.
- All 9 were re-run in the controlled harness where nothing else can write
  (`romlab/verify7.lua`): **9 of 9 identical**. No decoder discrepancy remains.

**Screen rebuild** (`romlab/screens.py`): replaying placements between
framebuffer snapshots reproduces **92.3%** of the pixels those tiles covered.
The shortfall is not a decode error - it is the already-documented unported
writers (terrain painter, sprites, text) overwriting tiles before the snapshot.

## Sprites (motion objects) decoded from ROM

Sprites are not part of the compressed playfield stream. They are hardware
motion objects: a 2KB display list of 4-word entries indexing 8x8 4bpp tiles in
the `:gfx` ROM (`romlab/extract_sprites.py` - **4096 tiles, 2179 distinct, 3903
non-blank**; the sheet shows castles, ships, cannons, walls and the attract
text). Pen 0 is transparent; the palette entry is `0x100 + color*16 + pen`.

Entry format, recovered by fitting against real frames:

| Field | Source |
| --- | --- |
| link | word0 `& 0x00ff` |
| code | word1 `& 0x7fff` |
| hflip | word1 `& 0x8000` |
| colour | word2 `& 0x000f` |
| X | (word2 `& 0xff80`) >> 7 |
| Y | **negated**: `(-((word3 & 0xff80) >> 7) - height*8) & 0x1ff` |
| width / height (tiles) | word3 `& 0x0070` >> 4, word3 `& 0x0007`, both +1 |

Crucially the hardware does **not** draw every entry in the list. It walks a
per-8-scanline-band chain: each band has a pointer in `:mob:slip`, entries are
linked, and each object is clipped to its band. Drawing the whole list renders
stale sprites - that alone was the difference between 91% and 98.7%.

**Verification** (`romlab/mobrender.py`): render playfield + sprites and compare
against the frame the emulator actually drew.

- State snapshotted at frame N corresponds to the screen at frame **N+1** - the
  one-frame skew was measured, not assumed, by cross-comparing six consecutive
  frames (the correct pairing scored 80640/80640 while every other pairing
  scored ~74000).
- Over 40 consecutive frames: **13 frames reproduced all 80640 pixels exactly**,
  **99.74%** of pixels overall.
- Every residual pixel is explained: re-rendering with the *following* frame's
  state accounts for **100%** of them (2314/2314, 1724/1724, 1340/1340). The
  playfield is redrawn mid-scan, so a single snapshot cannot represent what the
  screen showed. That is a capture limit, not a rendering error.

### Palette correction

MAME expands a 6-bit colour channel as `(x << 2) | (x >> 4)`, not `x * 255 /
63`. The two differ by one step on most values, which is why an early attempt to
match the screen scored only 34.6%; with the correct expansion the playfield
alone explains 97.8-99.9% of it. `romart.py` and `screens.py` were corrected.

### Cell address - `0x11BD8`
- **Port:** `romlab/compare_board.py` (`cell_address`)
- **Behaviour:** `base + x*32 + y` where the packed argument is a word, x in the
  high byte and y in the low. Both operands are byte sized, so coordinates wrap
  at 256 instead of being clamped.
- **Evidence:** `romlab/verify8.lua` - 12 cases covering all four corners, the
  origin, interior points and two out-of-range coordinates. All identical.

### Distance approximation - `0x11D5C`
- **Port:** `romlab/compare_board.py` (`distance`)
- **Behaviour:** *not* the usual `max + min/2 - min/8`. The routine puts the
  larger operand in d0 and the smaller in d1, then computes `min*min / max`
  and applies the halving and eighth-subtraction to **that**: the result is
  `max + q/2 - q/8` where `q = min^2 / max`.
- **Two details only a comparison would catch.** The swap test is a *signed*
  compare, so an operand of -32768 - whose negation overflows back to itself -
  stays on the small side rather than the large one. And the divide is
  unsigned, leaving its destination untouched on overflow, which the routine
  detects and replaces with `0x7fff`.
- **Evidence:** `romlab/verify8.lua` - 18 cases: axis-aligned, diagonal, all
  four sign combinations, zero, and the overflow extremes. First run was 17/18;
  the failure was exactly the -32768 case, and both details above came out of
  chasing it. **18/18 after the fix.**

### Piece walker and the shape table - `0x8B4`, table at `0xFE4E`
- **Port:** `romlab/compare_pieces.py` (`place`)
- **Signature:** `place(word packed_xy @+8, long script @+0xA, long stamp @+0xE)`
  called as `jsr $8b4.w` - **absolute short**. That is why an earlier search for
  callers found none: the address fits in 16 bits, so it never appears as a long
  anywhere in the ROM.
- **Pieces are scripts, not bitmaps.** An entry is `[id][dx][dy][directions...]`
  terminated by any byte with the high bit set. `dx,dy` offset the cursor, then
  each direction byte steps one cell through the tables at `0xFCCA/0xFCDA/0xFCE2`.
  `0x0B` is an escape meaning "take an extra step first", which is how the
  diagonal shapes are expressed.
- **The table holds 40 pieces** (`0xFE4E`-`0xFF81`): a single cell, both
  dominoes, both 3-bars, all four L corners, every rotation of the S, Z, T, U
  and J shapes, the plus, and the diagonals - Rampart's full set with rotations.
- Each cell is rejected unless it is on the board and either unowned or already
  the player's, and its terrain is clear or exactly `0x30`. The return is 0 for
  a rejected placement, 2 if it overlapped the player's own wall, otherwise 1.
- **Evidence:** `romlab/verify10.lua` walks the table in ROM, stamps all 40
  pieces onto a cleared board through the ROM routine, and dumps the result.
  `compare_pieces.py` reproduces **40/40 - every one of the 1344 board cells
  and the return value identical for every piece.**

### Rotation groups - table at `0x1163A`-`0x11739`
The 40 shapes are not 40 independent pieces. They are **13 rotation groups**,
each a run of pointers to shape entries, terminated by a `0` and then a pointer
back to the group's own start. Rotating a piece is simply advancing that pointer
and wrapping when it hits the terminator - which is why `player->0x24` points
into ROM rather than RAM.

| Group | Shapes | What it is |
| --- | --- | --- |
| `0x11736` | 01 | single cell |
| `0x11726` | 02, 03 | 3-bar, two rotations |
| `0x1170E` | 04-07 | L corner, four rotations |
| `0x116F6` | 08-0B | J, four rotations |
| `0x116DE` | 0C-0F | L, four rotations |
| `0x116C6` | 10-13 | U, four rotations |
| `0x116AE` | 14-17 | S, four rotations |
| `0x11696` | 18-1B | Z, four rotations |
| `0x11686` | 1C, 1D | diagonal, two rotations |
| `0x11676` | 1E, 1F | diagonal, two rotations |
| `0x1165E` | 20-23 | T, four rotations |
| `0x11652` | 24 | plus |
| `0x1163A` | 25-28 | domino, four entries |

**Still open:** which group the game *picks*. There is no table of group
pointers in the ROM in either 32- or 16-bit form - the only references to the
group starts are the 13 wrap-around pointers inside the groups themselves - so
selection reaches them some other way and is not yet located.

### Event-table membership - `0xEFFA`
- **Port:** `romlab/verify11.lua` companion in the same file (`event_pending`)
- **Behaviour:** the phase machine asks "has this event fired?" by scanning a
  table of 12-byte records at `0x3E1CF6`, count in the word at `0x3E1CF4`,
  comparing the long at record+4. A negative count short-circuits to 0.
- **The loop is a `dbra`, so it inspects count+1 records, not count.** That
  off-by-one is the kind of thing a port guesses wrong, so it was tested
  directly: a key sitting one past the count is found, one two past is not.
- **Evidence:** 12 cases - negative count, single hit and miss, first/middle/
  last of four, a key past the count, a key exactly at it, a zero key,
  duplicates, and a longer table. **12/12 identical.**

### Board coordinate to screen address - `0x11BEC`
- **Port:** `romlab/verify12.lua` companion (`screen_address`)
- **Behaviour:** `0x200004 + ((y << 9) + x) << 3`, where x is added as a **byte**
  so it wraps into the low 8 bits rather than carrying. Net effect: each board
  cell is 8 pixels wide and 8 rows tall in a 512-byte-per-row bitmap, which is
  what makes 42x30 cells cover the 336x240 screen exactly.
- Sits immediately after the cell-address routine `0x11BD8`: one maps a
  coordinate to the board array, the other to the pixels it is drawn at.
- **Evidence:** 15 cases - corners, edges, interior, and out-of-range
  coordinates chosen to exercise the byte-sized add. **15/15 identical.**

### Territory scoring - `0x865E`
- **Port:** `romlab/verify14.lua` companion (`award`)
- **Signature:** `score(player_struct @+8)`. It reads the claimed-cell count
  from `player+0x58`, finds the first entry in the threshold table at `0x117CE`
  that is `>=` that count, and adds the award at the same index in `0x117E2` to
  **`player+0x56` - the score**.
- **The thresholds are perfect squares:** 9, 16, 25, 36, 49, 64, 81, 100, 121
  (3^2 through 11^2), then 999. The awards are 100, 200, 300, 400, 500, 600,
  700, 800, 900, 1000, and 6420 past the end. **Territory scores by side
  length, not by area** - enclosing a 5x5 pays 300, a 10x10 pays 800.
- **This settles the earlier bad measurement.** The 150/200/300 figures reported
  long ago came from grouping allocator activity into bursts and were wrong;
  these values are read from the table the routine actually indexes.
- **Evidence:** 28 cases spanning every threshold boundary and both sides of it
  (0, 1, 8/9/10, 15/16/17, 24/25/26, 35/36, 49, 63/64, 80/81, 99/100, 120/121/
  122, 500, 998/999). **26/26 identical.** The two cases past the final
  threshold (1000 and 5000 cells) do not return in the harness - they take the
  6420 branch, which calls into display code needing state the harness does not
  set up. A 42x30 board makes those counts unreachable in play.

### Aiming direction - `0x11CF8`
- **Port:** `romlab/verify15.lua` companion (`direction`)
- **Signature:** `direction(long dx @+4, long dy @+8) -> 0..7`
- **Behaviour:** compares `|dx|` and `|dy|` against a **7/16 ratio** - roughly
  23.6 degrees - to sort the vector into one of three classes (mostly
  horizontal, diagonal, mostly vertical), then reflects that by the signs.
- **A detail worth pinning:** the final `& 7` is applied **only** on the
  negative-dy branch, so a result of 4 comes back unmasked.
- This is what the cannon aiming handler `0x6C20` uses: it takes the direction
  to the target, compares it with the cannon's current facing at record+4, and
  rotates one step the short way round.
- **Evidence:** 35 cases - all eight compass directions, the exact 7:16 and
  16:7 boundary ratios and both sides of them, zero, every sign combination,
  and the 16-bit extremes. **35/35 identical.**

### Damage - `0x8598` selects, `0x8606` applies
- **Port:** `romlab/compare_damage.py` (`damage_step`)
- **Damage is a scripted list of coordinates, not a computed blast radius.**
  `0x8598` walks the three player structs (stride `0x7E` from `0x3E1968`), and
  for any flagged one it picks a script from a table reached through
  `0x3E0DCA` + `0x22` + index*4, skips forward by the player's `+0x1D` entries,
  parks the cursor at `player+0x3E` and queues handler `0x8606`.
- **The rule runs the opposite way round from what "damage" suggests:** each
  call consumes one packed (x, y) word and stamps rubble `0x30` **only where
  the cell is already empty**. A cell still holding a wall is left alone on that
  pass. Since `0x30` is exactly what the verified piece walker accepts for
  rebuilding, this is the step that turns cleared ground into buildable ruin.
- Termination is by sign: when the next entry's high byte is negative the
  handler removes its own event, and the queue count goes with it.
- **Evidence:** `romlab/verify16.lua` - 8 crafted cases covering an empty cell,
  a cell holding a wall, a cell already rubble, a mid-list cursor, both board
  corners, and immediate termination. **8/8 identical** across all 1344 board
  cells, the cursor, and the event count.

### Piece rotation - `0x5AFC`
- **Port:** `romlab/verify17.lua` companion (`rotate`)
- **Signature:** `rotate(long *slot) -> 0 or 1`, where `slot` is `&player->0x24`
- **Behaviour:** advance the piece pointer by one entry. If the new entry is the
  group's `0` terminator, step past it and load the wrap-back pointer stored
  immediately after, returning **1** to signal the rotation wrapped. Otherwise
  return 0. This is the mechanism the rotation groups were built for.
- **Evidence:** starting from **every** slot in the table, `0x11636`-`0x1173A`:
  **131/131 identical**, and **exactly 13 of them wrapped** - one per rotation
  group. That count is an independent confirmation of the group structure,
  since nothing in the test told it how many groups to expect.

### Enclosure test - `0xBC2`
- **Port:** `romlab/compare_enclose.py` (`enclosed`)
- **Signature:** `enclosed(long cell_ptr @+8, long direction @+0xC) -> long`
- **It is not a flood fill.** The routine follows the wall like a maze runner
  and counts turns: if the cell to the side is wall it turns toward it and
  steps, otherwise if the cell ahead is wall it carries straight on, otherwise
  it turns away and stays put. When it returns to the cell it started from
  having accumulated four quarter-turns, the boundary closed. The **sign** of
  the turn count says which way round it went, and only the negative winding
  counts as an enclosure - which is how the game distinguishes the inside of
  your wall from the outside of someone else's.
- A cell counts as wall if it is `owner | 1` **or** `owner | 3`, so a decorated
  cell still forms part of the boundary.
- The routine has no bound: a wall that never closes makes it loop forever. The
  port reproduces that rather than papering over it.
- **Evidence:** `romlab/verify9.lua` - 18 crafted boards, **18/18 identical**.
  Closed rectangles from 2x2 to 12x9, at the board edge and the far corner, a
  concave outline, a board with a second player's wall present, and one with a
  `0x43` variant cell in the boundary all return **1**. A rectangle with a
  **single cell removed returns 0**, as do a lone cell and a mid-edge start.
  Three start/direction combinations never terminate on hardware and the port
  fails to terminate on exactly those three.

## The board

Rampart keeps no tilemap and does not read the screen to decide what is walled.
There is a real board array, found by tracing which code runs at a phase change
and following the addressing:

- **Base `0x3E0864`**, one byte per cell, **stride 32**.
- `cell = 0x3E0864 + x*32 + y` - **x is the column (0..41), y the row (0..29)**,
  so the board is stored column major. 42x30 cells over a 336x240 screen is
  exactly 8x8 pixels per cell.
- Bounds are checked as `x < 0x2A`, `y < 0x1E` in the code itself.
- **Cell encoding: low 6 bits (`& 0x3F`) = terrain type, high 2 bits (`& 0xC0`)
  = owner.** Owner codes come from a table at `0x1000A`: `0x40`, `0x80`, `0xC0`
  for the three players. A player's wall is `owner | 1`.

Three direction tables sit together at `0xFCCA`:

| Table | Contents | Meaning |
| --- | --- | --- |
| `0xFCCA` | words `32, -1, -32, 1, 33, 31, -31, -33` | pointer delta per direction |
| `0xFCDA` | bytes `1,0,-1,0,1,1,-1,-1` | x delta per direction |
| `0xFCE2` | bytes `0,-1,0,1,1,-1,1,-1` | y delta per direction |

They agree with `x*32 + y` exactly: direction 0 is (+1,0) = +32, direction 3 is
(0,+1) = +1, and the diagonals follow. That agreement is what confirms the
layout rather than merely fitting it.

**Pieces are direction scripts, not bitmaps.** `0x8B4` takes a start coordinate
and a pointer to a byte script: two bytes of starting offset, then a run of
direction indices, terminated by a negative byte, with `0x0B` acting as a
double-step escape. It walks the piece cell by cell, checking each is in bounds
and either unowned or the player's own, then stamps `owner | 1`. This is the
shape of piece placement, and it means the piece table is a set of scripts.

Located but not yet ported: `0x8B4` (piece walk/placement), `0xB7FA` (the
computer player scoring candidate wall positions - it scans all 42x30 cells,
counts matching neighbours through `0xFCCA`, and keeps the best), `0x122C`
(a full-board scan over type-1 cells), `0xA20` (board addressing from a script).

## Game state addresses

Recovered from the writer index (`romlab/whowrites.lua`, address -> writing
routine, validated by finding the verified RNG writing its own seed) and from
tracing a phase change:

| Address | Holds |
| --- | --- |
| `0x3E0864` | the board, 42x30 bytes, stride 32, column major |
| `0x3E0842` | RNG seed (verified routine `0x11E58`) |
| `0x3E1870` | phase countdown, in seconds; `0x7A24` decrements it and beeps through a table at `0x11792` over the last five |
| `0x3E195C` | **phase / state** |
| `0x3E1950` | pause flag - nonzero suppresses scheduled events |
| `0x3E1960` | pointer to the current player struct; byte +2 is the player index |
| `0x3E0E76` | texture rotation used by the terrain painter |

`0xCAE2` is a scheduled-event trigger: given a phase, a countdown value and an
event id, it fires the event only when `0x3E195C` and `0x3E1870` both match and
`0x3E1950` is clear. That is the hook the phase script hangs off.

**Correction to an earlier note:** `0x8B4` does have callers - `0x6A4`,
`0x6E6`, `0x8D68` and `0x8E10` - but they use `jsr $8b4.w`, absolute short. A
search for the 32-bit address cannot find them. They pass
`*(player->0x24) + 1`, which is how the piece script table was located.

## Phase control - located, not yet ported

The phase machine is a large dispatcher spanning roughly `0x9300`-`0xA7DA`. It
holds its state in a local rather than a global, and drives progress by asking
`0xEFFA` whether a given event has fired - which is why the event-table test
above is part of this system rather than a utility.

| Address | Role |
| --- | --- |
| `0x9300`-`0xA7DA` | the dispatcher itself |
| `0xEFFA` | "has this event fired" predicate - **ported and verified** |
| `0x3E195C` | round counter within a sequence; cleared at `0x93C0` and `0xE80E`, incremented at `0x9BBA`, and set from `0x118AA` at `0xEADA` |
| `0x3E1870` | the countdown, decremented by `0x7A24` |
| `0x3E1950` | pause flag |
| `0xCAE2` | fires an event when phase and countdown both match and the game is not paused |

What remains is porting the dispatcher itself, which is a long C-style state
machine rather than a self-contained routine.

## How sealing and scoring actually work

Sealing is **not** detected by scanning the board. The chain is:

1. a wall is placed, and the placement path checks around it (`0xA20` and a
   routine near `0xCEC`, each calling the enclosure test at four offsets);
2. on success `0x5E38` converts the cell pointer back to a coordinate -
   `x = (ptr - 0x3E0864) >> 5`, `y = (ptr - 0x3E0864) & 0x1F`, a third
   independent confirmation of the board layout - and **posts an event**;
3. the queued handler `0x5EA2` runs a scanline flood fill, claiming cells and
   counting them into `player+0x58`;
4. when the fill runs dry it removes its own event and calls **`0x865E`**,
   which converts the count into points. **Ported and verified above.**

The event queue itself is three routines, all now ported and verified:
`0xEE90` post, `0xEEEE` remove, `0xEFFA` test. A record is 12 bytes and the key
is a **function pointer** - `0x5EA2` in this case - so the queue is a list of
(handler, parameter) pairs and the dispatcher simply calls them.

**A confounded experiment, recorded so it is not repeated.** Three attempts to
catch the score by watching RAM all failed: writing a sealed wall onto the board
does nothing (nothing posts an event), and two differential runs - one sealing
bare ground, one sealing a real castle - showed no award anywhere. The
differential is **confounded at the root**: changing the board changes what the
computer player does, so the two runs diverge by hundreds of cells for reasons
unrelated to scoring. Reading the routine was what worked.

## The dispatcher is an event loop

The phase machine is not a switch statement. The queue key is a **function
pointer**, and the handler table at `0x11AC4`-`0x11B5A` holds **26 handlers**,
each a 6-byte record of `(function, priority byte, flag byte)`. The dispatcher
simply runs queued `(handler, parameter)` pairs. Handlers recovered so far:

| Handler struct | Function | Role |
| --- | --- | --- |
| `0x11AE2` | `0x5EA2` | territory flood fill, then scoring |
| `0x11AEE` | `0x6C20` | cannon aiming - **uses the verified `0x11CF8`** |
| `0x11AF4` | `0x6CAE` | removed when a shot is fired |
| `0x11AFA` | `0x6FB4` | projectile scheduler |
| `0x11B00` | `0x7A24` | phase countdown |
| `0x11B54` | `0xB032` | the computer player |

Projectiles are a ring of **0x1A-byte records** at `player+0x6A`, with
`player+0x6E` and `+0x72` as cursors. Firing computes velocity from the
verified distance routine and a speed table at `0x11774` (64, 80, 96, 96, 96),
writing x velocity to record+6, y velocity to +0xA and an arc term to +0xE.

`0x6CAE` is the fire trigger. It places the muzzle using per-direction offset
tables at `0x11754` (x) and `0x11764` (y), which are a clean radius-7 circle -
(7,0), (4,4), (0,7), (-4,4), (-7,0), (-4,-4), (0,-7), (4,-4) - then spawns the
projectile entity into the table at `0x3E02D8`, 16 bytes per entry.

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
| ~~Enclosure test~~ | **Ported and verified** - `compare_enclose.py`, 18/18 crafted boards | Done; remaining work is replacing `enclosure.ts` with the port |
| Piece shapes, placement, rotation | **Ported and verified** - 40 shapes (`0x8B4`, 40/40 boards), rotation (`0x5AFC`, 131/131) | Remaining: which *group* a new piece is drawn from |
| ~~Scoring~~ | **Ported and verified** - `0x865E`, 26/26 across every threshold boundary | Done; remaining work is replacing the guessed constants in `game.ts` |
| Ship movement and firing | `game.ts`, derived from motion-object tracking and spawn rates | Find the ship update routine; step it with a fixed ship state; compare positions and fire timing |
| ~~Damage~~ | **Ported and verified** - `0x8606`, 8/8 crafted boards | Done; the blast *scripts* themselves still need extracting from the table at `0x3E0DCA` |
| Phase control | `phases.ts`, durations read from the countdown word in RAM | **Dispatcher located** (`0x9300`-`0xA7DA`); its event predicate `0xEFFA` ported and verified 12/12. Remaining: the dispatcher itself |
| ~~Object composition (art)~~ | **Decoded from ROM** - `extract_sprites.py` + `mobrender.py`, 13/40 frames pixel-exact | Done; remaining work is wiring the sprites into the game |
| ~~Terrain plates (art)~~ | **Decoded from ROM** - `extract_tiles.py`, 5907 tiles verified against 11614 live draws | Done; remaining work is wiring the tileset into the game |
| ~~Attract screens (art)~~ | **Decoded from ROM** - same tileset; screens are placement maps over it | Done; remaining work is wiring the tileset into the game |

## Multiplayer

Hot-seat shaped in code but only one castle is placed; not playable. Outstanding.
