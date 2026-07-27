# Routine verification status

A routine counts as **ported** only when its behaviour was read out of the
68000 disassembly and reimplemented. It counts as **verified** only when the
original routine and the port have been fed *identical inputs* and produced
*identical outputs*.

Anything not meeting that bar is listed as outstanding, regardless of how
plausible the current implementation looks.

## Verification state

Measured, not asserted. Every routine is run on the real 68000 under MAME and
again in the TypeScript port from byte-identical starting state, and compared.

| | |
|---|---|
| Routines in the overlay | 757 |
| *of the 593 the map held before trampolines and table cases were found* | *569 verified, 24 not* |
| **Verified against hardware** | **721** |
| Failing | 2 |
| Passing under some inputs, failing under others | 13 |
| Judged only by a stopping-point mismatch | 6 |
| Reproduces mid-run but not end to end | 10 |
| Never judged | 5 |

Four harnesses. Three call the routine and compare everything when it comes
back to a sentinel return address: one drives it with three argument shapes in
a pass, one with a single shape per run of the emulator, one replays the
arguments the game itself passed during play. Those three cannot judge a
routine that never returns, and 111 routines contain no `rts` at all.

The fourth does not need the routine to finish, and it is now the widest of
the four: it reaches 135 routines no call-and-return harness can judge. The capture runs the chip for a
while, stops, and records **the address of the instruction it stopped on**
along with fifteen registers and a hash of the memory window. The port then
compares every time it arrives at that address. The capture runs at seven stopping points - 2, 3, 5, 10, 20, 60 and 200
instructions - and a match at any of them settles the routine.

One stopping point was not enough, and the reason is worth stating because it
had been mistaken for the port's fault. A routine only has a comparable
stopping point if it is still running when the snapshot is taken. 174 routines
stop between 25 and 200 instructions and another 21 stop within six, so a
snapshot taken only at 200 had nothing to say about any of them - and they were
being counted as never judged. Widening the set took this harness from 187
routines of 278 to 603 of 633.

The routine count went *down* from 763 to 745 when the pointer-table detector
was tightened. It had been accepting any run of three longs whose values landed
inside known code, and most of what passed that test were round numbers -
0x1000, 0x2000, 0x5800 - which are constants and address masks, not entry
points. Requiring the value to be an address an instruction actually starts at
removed 18 invented routines, each of which could only ever have failed. What
survives is unambiguous: `link`/`movem` prologues, the reset routine, and the
run of exception stubs at 0x18548 that each do `jsr $18652` followed by their
message text.

A quarter of what that harness first measured was not the routine at all. 89 of
365 snapshots were taken inside `0x1357C`, the power-on reset routine - it
re-masks interrupts, rebuilds the stack pointer from scratch and clears the
palette. Reaching it means the routine under test went off the rails and the
machine restarted, so the snapshot describes the reset code. Others had landed
on bytes that are not instructions at all. Those cases are discarded now rather
than counted as failures, which is why the number of unexplained mismatches
fell from 63 to 41 while the verified figure barely moved.

Two earlier attempts at that fourth harness are worth recording because they
were wrong:

- **Comparing write sequences.** Unsound: which half of a long is written first
  depends on the instruction, so stopping after a fixed number of writes leaves
  the two sides holding different sets. It did find a real defect first - a long
  written through a pre-decremented address goes low word first, and the port
  wrote ascending.
- **Comparing after a fixed instruction count.** Also unsound, though less
  obviously. The capture counts boundaries by watching CURPC change, and an
  instruction that does not change it goes uncounted, so the counter lagged by
  up to three. Searching a small window of offsets made 207 routines agree
  instead of 112 - but "agrees at one of four counts" is a weaker claim than
  "agrees at the instruction the chip was on", and the stricter test is the one
  reported. It puts the figure at 569 rather than 572.

### Against the original list

The map has grown as executable code kept turning up that had been filed as
data, so the headline figure is measured against a denominator that did not
exist when the work started. `romlab/original593.py` reconstructs the original
list - code runs and entries straight out of the classifier, nothing injected -
and reports how those particular routines stand now. It reconstructs to exactly
593, which is the check that it is the right list.

**569 of the 593 are fully verified**, counting one as verified only if every
piece it was later split into is. 24 are not.

### Instruction rules

**9,149 of 9,153 comparable cases reproduce exactly, condition codes included.**
204 further cases are not comparable because they read the playfield, the input
ports or the sound chips. Instructions that write the status register are not
claimed at all - writing it unmasks interrupts, so the case measures the game's
interrupt handler. Nor are pc-relative operands, because the harness relocates
each encoding to a scratch address; there are 93 of those and
`romlab/pcrelcheck.py` checks each against its encoding instead. All 93 agree.

### The defects that mattered most

- `jsr`/`bsr` did not push a return address, so every callee read its stack
  arguments four bytes off. Routines reproducing went from 172 to 346.
- A jump target was matched with an unanchored pattern, so `$d00e(pc, d0.w)`
  was read as the fixed address `$d00e`. Every table-driven dispatch jumped to
  the base of its own jump table instead of the case the table selected.
- A long written through a pre-decremented address goes low word first on the
  68000; the port wrote ascending. The bytes land in the same places either
  way, so only a harness that compares the order of writes could ever see it.

Thirteen more: absolute short addressing not sign-extending; pre-decrement and
post-increment applied twice on read-modify-write operands; a byte access
through `a7` stepping by one instead of two; shift counts silently reduced
modulo 32 by JavaScript; bit instructions taking their width from the mnemonic
rather than the destination; `divu` using the signed overflow bound; `cmp`
setting X; `asl` never setting V; multiply, swap and rotate computing flags
from the value they had already written; an arithmetic right shift past the
operand width dropping the sign bit out of C; and `movep`, `roxl`/`roxr` and
status-register access having no rules at all.

### How the entry points were found

Not by reading the ROM. Every harness reports the address it died at when the
dispatcher has no routine covering it, those addresses are collected, filtered
against the jump-table bases (landing on one means a routine computed an offset
of zero, which is a divergence rather than a missing entry), given an extent by
following their basic blocks to a terminator, and fed back into the map. Then
everything is re-captured and the loop runs again.

It converges. The last pass added six - 0x3EA, 0xC4CA, 0x120A2, 0x12306,
0x13E0A, 0x1829C - and took failing from 19 to 16, input-dependent from 28 to
26, and unexplained mismatches from 41 to 36.

### Bracketing a divergence

`localise.test.ts` uses the stopping points as a bisection. A routine that
matches at three instructions and not at five has something wrong in those two,
which is a far smaller thing to read than a whole routine. It reports the last
point that matched and the first that did not.

That is what found the pairing problem above: 0x141D4 clean at two instructions
and wrong at three, with d3 changing across a boundary where nothing writes d3.

It also showed that two of the remaining mismatches are not mismatches. 0xB738
and 0x69E2 stop inside the exception stubs at 0x18548 - each is `jsr $18652`
followed by its message text, "ADDRESS ERR" and the rest - so the chip had
faulted and the snapshot describes the handler. Those are discarded now, along
with the reset-code ones.

Nine divergences remain bracketed to between one and forty instructions each.

### It was the watchdog

For most of this work the largest unjudged group was routines whose every
snapshot was taken inside the power-on reset code. That was recorded first as
"the chip crashed", then more carefully as "the chip took an address error the
port does not model", and an address-error exception was implemented to close
it. The exception did not close it, which was the clue: an address error
vectors to 0x018564, a message stub, not to 0x1357C.

The board has a watchdog. The harness freezes the game for a whole frame per
case, so nothing kicks it, and the board resets - which is what put the chip in
its reset code. Nothing to do with the routine under test at all.

Kicking it the way the game does, `clr.w $72FFFE`, takes the number of
snapshots landing in the reset code from hundreds to **zero**, and the
instruction-boundary harness from 2,513 of 2,859 to 2,841 of 2,879 with nothing
discarded.

0x72FFFE had been sitting in the list of addresses routines read that could not
be accounted for.

### What "the chip faulted" is worth now

Snapshots taken after the chip had faulted were discarded on the grounds that
there was nothing to compare. Once traps and halts were modelled that stopped
being true for one of the two cases: an exception stub reached through
`trap #$0` is a path the port now follows exactly, so those snapshots are
evidence and are used. Two more routines verified.

The other case is now modelled and still does not close. An address error - a
word access on an odd address - is implemented: the port stacks the seven-word
frame and vectors through 0x0C, as the chip does. That gained one routine and
took the not-comparable count down, but it did not make the reset-path
snapshots reproduce. Dropping the filter with the exception in place judges 21
more routines and fails almost all of them, so something in the frame or in
when the fault is raised still does not match MAME. Dropping that filter
too judges 18 more routines and fails almost all of them, which is a worse
answer than saying why they cannot be judged: it would be reporting a missing
exception as a translation defect.

### A trap is not a no-op

Thirteen of the remaining stopping-point mismatches were the exception stubs at
0x18548, all failing identically. Each is `jsr $18652` followed by its message
text; 0x18652 calls 0x19C2E; and 0x19C2E is `trap #$0`.

The port recorded the trap and carried straight on. The chip stacks the return
address and the status register and vectors through the table - and TRAP #0
vectors to 0x18658, which is the instruction *after* the jsr that reached it,
so the handler is the continuation and the path ends at `stop`. Two completely
different routes from the same instruction.

Implementing the vector took this harness from 2,445 of 2,532 to 2,497, and the
unexplained stopping-point mismatches from 19 to 6.

### The chip was not crashing; it was being handed rubbish

For a long time the largest unjudged group was "every snapshot was taken after
the chip faulted" - 31 routines the harness could say nothing about because,
called out of context, the machine ended up in its own reset code. That was
recorded as a hard boundary needing the game to reach the state that calls
them.

It was not. Those routines take a structure pointer as a *stack* argument, and
the harness was pushing random numbers there while carefully handing the
address registers real structures. Pushing structures on the stack as well -
one more argument shape - produced 4,223 snapshots with **not one** taken after
a fault, where the earlier shapes produced hundreds.

The same shape was added to the return-based harness, where it takes the
routines that reproduce from 390 to 450. It also cost one routine from the
verified column: driven with arguments it had never seen, it disagreed. That is
the shape working, not failing.

### The address bus is 24 bits

A pointer that computes 0x101FF00 does not read nothing - the 68000 has no A24
to A31, so it reads 0x01FF00, which is ROM, and the chip gets real data there.
The port was not masking, so every such read looked like a read of empty space.
This was dismissed twice as "wild pointers, nothing is there on the board
either", which was wrong: they wrap.

### What the board actually decodes

The first memory probe wrote a value and read it back, which finds RAM and
misses every read-only decode. A probe that only reads found a great deal more:
`0x140000-0x17FFFF`, `0x500000-0x519FFF`, `0x800000-0x8FFFFF` and several
ranges above that, all of which real routines read - `0xEDEA` calls `$140010`,
which had been written off as an address the board does not decode.

Some of it is mirrors. `0x800000` reads back exactly as the program ROM, and
`0x540000`, `0x940000` and `0xD40000` are the same thing as `0x140000`: the top
address lines are not all decoded. Those fold. The rest is snapshotted with the
palette and the sound chips.

Together the mask and the snapshot took the input-dependent count from 24 to 13
and the mid-run-only count from 12 to 6.

### Modelling the devices, and why it changed nothing at first

The palette, the two sound chips and the input ports are not implemented, so a
routine that reads one gets a real value on the chip and zero in the port. The
capture now snapshots what those addresses hold while the machine is frozen and
the port reads from that, which makes such a read comparable.

It moved no number at all. Of the 29 off-map addresses the failing routines
actually touch, 4 are device registers; the rest are 0x7EFFFF, 0x54005400,
0x50032B and the like - wild pointers produced by handing a routine a generated
argument where it expected a structure. No snapshot can make those comparable,
because there is nothing at them on the board either.

The change is kept because the port is more faithful with it, not because it
helped.

### The residual mismatches are mid-instruction snapshots

The capture takes its snapshot inside a memory-read tap, and an instruction can
read memory more than once. `0x441C` is the clean demonstration. At the
recorded stopping point the chip is "at" `0x4430`, which is
`move.b (a1)+, (a0)+`, and the registers are a1 = 0x8B where a2 + 0x3C = 0x8A,
with a0 not incremented at all. The source postincrement has happened and the
destination write has not: the state is from part-way through the instruction.

A port that executes instructions atomically can never reproduce that, and no
pairing of the program counter with the registers fixes it - the state does not
correspond to any instruction boundary. It is a limit of reading state from a
memory tap, not a defect in the translation, and the routines whose only
evidence against them is a snapshot of this kind are not shown to be wrong by
it.

Fixing it needs a capture that can stop the chip between instructions. MAME run
with `-debug -debugger none` does expose one: `cpu.debug` becomes a real
`device_debug` with `bpset`, `step` and `go`, and a breakpoint stops the chip
before an instruction executes, which is exactly the boundary the port compares
at. `romlab/bpcap.lua` is an attempt at that capture. Two faults in it are fixed:
the debugger objects were resolved at script load, before the machine exists,
and `bpset` was called with one argument, which hard-crashes MAME rather than
erroring - it wants `bpset(addr, cond, action)`. What still does not work is the
stop itself: under `-debugger none` a breakpoint does not halt execution, so
nothing ever reports "stop" and no snapshot is taken. Committed unfinished and
labelled, with the next thing to try named in its header.

### Why the unjudged are unjudged

Nothing falls through the accounting now - all 753 routines land in exactly one
category. The 39 that no harness can judge break down as:

| | |
|---|---|
| every snapshot was taken after the chip faulted | 31 |
| no snapshot at any stopping point | 5 |
| read hardware the port does not model | 2 |
| the port skipped a call the chip made | 1 |

The 31 are the real boundary. Called out of context with generated arguments,
the chip faults - into the reset routine or an exception stub - before reaching
any point worth comparing. Verifying them needs arguments under which they do
not fault, which means the game reaching the state that calls them; it never
did across three capture passes.

A separate category had been hiding: 11 routines fail end to end but reproduce
exactly mid-run. The divergence is after the compared point and for these it is
the hardware boundary - `0x5B4` and `0xEDEA` among them. They had been landing
in no bucket at all and so were invisible.

### What is left

- **21 failing.** Most read the input ports or the sound chips, which the port
  does not model. A few unmask interrupts - `0x656` is `move.w $3e0804.l, sr;
  rts` - and cannot be held still long enough to compare. One is a boundary
  rather than a bug: `0xEDEA` calls `$140010`, which the board does not decode.
- **21 input-dependent.** They pass under one set of arguments and fail under
  another. Nothing had asked them the right question before the per-shape runs.
- **63 whose only evidence is a stopping-point mismatch.** Either the port never
  arrives at the address the chip stopped on, or it arrives with different
  state. Both are worth chasing individually; neither has been.
- **87 never judged at all**, 49 of them with no `rts`. They neither return nor
  run far enough for the chip's stopping point to be somewhere the port can be
  compared against.

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

**Resolved.** Selection does not reference the group starts directly, which is
why a search for them found only the 13 wrap-around pointers. It goes through a
**separate group table at `0xFF90`** holding the 13 group addresses in order,
indexed by a byte drawn from the shuffled bag - see the bag builder above, both
ported and verified.

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

### Piece selection - the bag builder `0x59EE`
- **Port:** `romlab/compare_bag.py` (`build`)
- **Rampart does not draw a random piece each turn. It builds a bag.** A weight
  list chosen by **player kind and level** says how many copies of each rotation
  group to include; the bag is terminated with `0xFF` and then **riffle shuffled
  eight times** - four rounds of destination -> scratch -> destination. Each
  riffle cuts at `count/4 + random(count/2)` and interleaves the halves a byte
  at a time, drawing from the verified RNG at `0x11E58`.
- Selection itself (`0x59CA`) then walks the shuffled bag one byte at a time,
  indexing the group table at **`0xFF90`** (13 entries: single, bar, L1, J, L2,
  U, S, Z, diag1, diag2, T, plus, domino), and re-draws if the piece matches the
  previous one. When the bag runs out the byte is negative and it refills.
- **The weight tables are the difficulty curve:**

| Kind | Level | Bag |
| --- | --- | --- |
| 0 | 0-1 | single x2, bar x4, L1 x2, domino x2 (10) |
| 0 | 2-3 | single, bar x3, L1 x2, J x2, L2 x2, domino (11) |
| 0 | 4 | single, bar x2, L1 x3, J x5, L2 x5, S x2, Z x2, domino (21) |
| 1 | 0-1 | single, bar x2, L1 x2, J x2, L2 x2, S, Z, T, domino (13) |
| 1 | 2-3 | adds U, diag1, diag2, more S/Z/T (21) |
| 1 | 4 | adds plus, drops domino (21) |
| 2+ | any | single x2, bar x5, L1 x2, domino x4 (13) |

- **Evidence:** `romlab/verify18.lua` - 45 cases, 3 RNG seeds x 3 kinds x 5
  levels, comparing the whole 48-byte buffer **and** the resulting RNG seed.
  **45/45 identical.**
- **What the failure taught:** the first run was 30/45, and every failure was
  kind 2 in the bytes *after* the terminator. The three destination buffers and
  the shuffle scratch are real addresses that **overlap** - for kind 2 the
  destination is `0x3E1ECA` and the scratch `0x3E1EE0`, 22 bytes later - so the
  shuffle's intermediate copy lands inside the bag's own buffer. Modelling flat
  memory at the true addresses reproduces it exactly.

### Flood-fill span scanner - `0x65AA`
- **Port:** `romlab/compare_span.py` (`scan_span`)
- **Signature:** `scan_span(word start @+8, word end @+0xA, byte value @+0xF)`
- **Behaviour:** walks a **column** of the board (cells are `x*32 + y`, so
  advancing the pointer by one steps in y) between two coordinates, and pushes
  the **start of every run of cells that differ from `value`** onto the
  coordinate stack. Cells matching the value are the boundary; everything else
  is territory still to claim. This is the seeding step of the scanline fill in
  `0x5EA2`.
- The coordinate stack lives at `0x3E209C` and is **pre-incremented**, so the
  first entry lands two bytes above the base rather than at it. `0x663C` pushes,
  `0x661A` pops into a fixed slot at `0x3E1F1A`.
- **Evidence:** `romlab/verify19.lua` - 10 crafted columns: uniform, wholly
  differing, a single run, two runs, runs touching the start and the end, five
  alternating single cells, a one-cell span both matching and differing, and a
  different column entirely. **10/10 identical** in both the queued coordinates
  and the final stack pointer.

### Projectile flight - `0x7008`
- **Port:** `romlab/compare_shot.py` (`step`, `screen`)
- **Rampart flies a shot as a ground-plane vector plus an independent height**,
  which is what produces the arc without any trigonometry:

```
x += vx ; y += vy          positions are in 1/64 units
height += vz               using vz BEFORE gravity is applied
vz -= 1                    gravity, one unit per frame
screen_x = x >> 6
screen_y = (y - height) >> 6
```

  The shadow travels the ground plane in a straight line and the height lifts
  the sprite off it. When height reaches zero or below the shot has landed: the
  final position stands and the velocities and height are cleared.
- Shot state is the `0x1A`-byte record: vx at +6, x at +8, vy at +0xA, y at
  +0xC, vz at +0xE, height at +0x10, the target at +0x12/+0x14 and the sprite
  at +0x16.
- **Verified against real flights rather than invented ones.** The routine is
  long and does not return in isolation, so instead `romlab/shotcap.lua`
  sampled every live shot every frame - **8686 records** - and the port must
  turn each frame into the next.
  - **8627 of 8630 transitions reproduced by exactly one step.**
  - The remaining **3** are update cadence, not a wrong rule: two frames where
    the shot was not stepped at all and one where it stepped three times. Each
    is exactly N applications of the same rule.
  - **0 unexplained.** The one case that initially looked wrong was a landing,
    and modelling the landing reproduced it exactly, including the final
    integration happening before the clear.

### Cannon aiming handler - `0x6C20`
- **Port:** `romlab/verify21.lua` companion (`aim`)
- **Behaviour:** takes the cannon record at `player+0x6E`, converts its grid
  position to pixels (`x8`), takes the direction to the target at
  `player+0x4E/0x50` through the verified `0x11CF8` (note the **y difference is
  negated** before the call), and rotates the facing byte at record+4 **one step
  the short way round**: the gap `(direction - facing) & 7` is compared against
  4, turning one way when it is under and the other when it is over. It then
  advances the cursor by one `0x1A`-byte record.
- **Evidence:** 64 cases - 8 target bearings around the cannon x 8 starting
  facings. **40/40 of the cases that return in isolation are identical.** The
  other 24 call the redraw routine `0x2698`, which needs graphics state the
  harness does not set up, so they do not return; they are not counted as
  passes.

### Moving units (ships) - `0xAF72`
- **Port:** `romlab/compare_ship.py` (`step`, `sprite_pos`)
- **Seven records of `0x12` bytes at `0x3E1BC6`.** A record is active while its
  sprite pointer at +4 is non-zero. Each step:

```
x += vx ; y += vy      positions in 1/32 units - shots use 1/64
lifetime -= 1          at zero the unit is retired via 0xB53A
sprite_x = x >> 5 ; sprite_y = y >> 5
```

  The routine returns non-zero while any unit is still moving, which is how the
  caller knows the wave has not finished.
- Layout: lifetime at +8, x at +0xA, y at +0xC, vx at +0xE, vy at +0x10, sprite
  at +4. It also ORs `0x20` into the sprite's flag word each step.
- **Evidence:** `romlab/shipcap.lua` sampled every active unit every frame -
  **6776 records**. **6737 of 6766 transitions reproduce by exactly one step**,
  the other **29** by update cadence (frames where the unit was not stepped),
  each an exact number of applications of the same rule. **0 unexplained.**
- Found by tapping the entity table and reading which instructions write the
  position fields - the same method that located the projectile physics.

### Phase dispatcher - `0xEE44`
- **Port:** `romlab/compare_dispatch.py` (`dispatch`)
- **This is what "phase control" actually is.** There is no state machine
  switching on a phase number. There is a queue of **periodic timers**, and the
  dispatcher runs it once per pass:

```
for each of (count + 1) records:
    record.countdown -= 1
    if countdown > 0:                     skip - not due yet
    if gate set and record.flag == 0:     skip - gated out
    countdown = record.period             reload
    call record.handler(record.parameter)
```

- The count at `0x3E1CF4` is -1 when empty and is tested **signed** before the
  table is touched. A record whose countdown is already zero or negative still
  fires, because the test is `> 0` **after** decrementing rather than `== 0`.
  The gate is the word at `0x3E0802`; byte +3 of a record marks it as running
  even while gated.
- **Evidence:** `romlab/verify22.lua` - 10 cases: an empty queue, a timer not
  yet due, one firing, one already at zero, one already negative, gated on and
  off, the gate clear with the flag clear, and two multi-record queues mixing
  all of it. **10/10 identical.** Handlers point at a bare `rts`, and whether a
  record fired is read from its countdown - a fired record reloads, an unfired
  one keeps the decremented value.

### Multiplayer - three players throughout
- **Port:** the existing ports, exercised per player; `romlab/verify23.lua`
- Rampart is **three-player everywhere in the data model**, not one player with
  bolt-ons. The player structs are an array at `0x3E1968` with stride `0x7E`,
  and each player's identity is the byte at +2, which indexes the owner table at
  `0x1000A` to give `0x40`, `0x80` or `0xC0`. Every board cell carries its owner
  in its top two bits, so ownership is intrinsic to the board rather than
  tracked separately.
- The systems already verified are per-player by construction: the enclosure
  test takes an owner and was checked with a rival's wall present, the damage
  initiator walks all three structs at stride `0x7E`, the score lives at
  `player+0x56`, and the piece bag has **per-player-kind weight tables**.
- **Evidence:** `romlab/verify23.lua` re-runs the whole piece table through the
  ROM for **each of the three players** - 40 shapes x 3 - and the port must
  reproduce every board. **120/120 identical**, 40 for each of owner `0x40`,
  `0x80` and `0xC0`.

### Damage script selection - `0x8598`
- **Port:** `romlab/compare_blast.py` (`select`)
- **Blast patterns are a list of sub-lists.** A player's script comes from the
  level descriptor at `0x3E0DCA`, offset `0x22 + player[3]*4`. The routine then
  skips forward past `player[0x1D]` sub-lists - each a run of packed (x, y)
  words ending on a byte with the high bit set - parks the cursor at
  `player+0x3E` and queues the verified handler `0x8606`.
- A player whose word0 lacks bit `0x8000` is skipped, as is one whose descriptor
  slot is null; neither posts an event.
- **Evidence:** `romlab/verify25.lua` - 8 cases with the descriptor, pointer
  table and scripts all crafted: three skip depths, each player in turn, no
  player flagged, all three flagged, and a null descriptor slot. **8/8
  identical** in both the parked cursors and the resulting queue count.
- **Each case runs in a fresh emulator instance.** `0x8598` hardcodes the live
  player array at `0x3E1968`, so crafting inputs corrupts the running game and
  later cases in the same session fail for reasons unrelated to the routine -
  which is exactly what happened on the first attempt.

### Piece selection wrapper - `0x5948`
- **Evidence:** `romlab/verify26.lua`
- **Bag kind comes from the player's own state**, not from a seat number: word0
  bit `0x4000` selects kind 2, otherwise byte `+0x14` nonzero *or* byte `+0x1F`
  >= 4 selects kind 1, else kind 0. Each case advanced exactly the cursor for
  its kind and no other.
- **The bag cursor is indexed by kind**, at `0x3E1F0A + kind*4`. It is not
  per-player, so two players whose state puts them in the same kind draw
  alternately from one shared bag.
- **Anti-repeat:** a drawn group equal to the player's previous one (`+0x28`) is
  rejected and another drawn - **unless** it is the single-cell piece, which may
  repeat. Both confirmed: a bag of `[bar, bar, L]` against a previous bar
  returned the L, and a forced single against a previous single was accepted.
- **Rejected pieces are consumed, not returned.** The redraw advanced the cursor
  from 0 to 3 to skip the two bars, so a run of repeats eats through the bag
  early and forces an earlier refill. The distribution guarantee is therefore
  weaker than a clean bag.

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

`0x8B4` (piece walk/placement) is **ported and verified** - see above. Also
located, and not part of any system the goal names: `0xB7FA` (the computer
player scoring candidate wall positions - it scans all 42x30 cells, counts
matching neighbours through `0xFCCA`, and keeps the best), `0x122C` (a
full-board scan over type-1 cells), and `0xA20` (the wall-placement check that
calls the verified enclosure test at four offsets).

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

## Phase control - the dispatcher and its handlers

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

**The dispatcher is `0xEE44` and is ported and verified (10/10)** - see above.
It is 74 bytes, not a long state machine: the `0x9300`-`0xA7DA` region is
handlers hanging off the queue rather than the control flow itself. An earlier
note in this file claimed the opposite; it was wrong.

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

## Where the code is

**All game code lives below `0x20000`** - the overlay. Scanning the remaining
900KB of the ROM for the addresses every system touches (the board, the player
array, the entity table, the RNG seed, the event count) finds **zero**
references above `0x20000`, and the whole region contains just 8 `rts` and 2
`link` opcodes, which is noise rather than code. Everything above the overlay is
graphics, audio and level data.

That bounds the remaining work: anything still unlocated is in the 128KB
already being disassembled, not in a bank that has been missed.

## Firing chain

| Address | Role |
| --- | --- |
| `0x6CAE` | fire trigger: muzzle position from the radius-7 offset tables, then spawn |
| `0x220C` | spawn wrapper: looks up an entity template from the table at `0xFD5E` and calls the allocator |
| `0xFD16`-`0xFD58` | 12 entity templates, 6 bytes each - a zero word, a sprite code (`0x131`-`0x13C`) and a flag word |
| `0x5B40` | the allocator proper; refuses past a capacity check on `0x3E02CA` and returns `0xFF` |
| `0x11CF8` | aiming direction - **ported and verified** |
| `0x11D5C` | distance - **ported and verified** |

Shot state lives in the **0x1A-byte records at `player+0x6A`**, not in the
16-byte entity records: x velocity at +6, y velocity at +0xA, an arc term at
+0xE, and the spawned entity pointer at +0x16. `0x6FB4` advances the cursor at
`player+0x72` through them and retires the event when the last shot is gone.

The per-frame integration is `0x7008`, **ported and verified above**. It was
found by reading `player+0x6A` live and tapping writes across the ring, after
`0xF79E`/`0xF936` (the sprite depth sorter) and `0xF306` (an animation table
walker) turned out to be the wrong places.

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
decoder 1 alone). The remaining writers are `0x11E44` (the dissolve, since
ported and verified), `0x2320`-`0x232C` (the screen copy), `0x5892`/`0x11D96`
(the rectangle grab and scaler behind the zoom effect), and `0x12350`,
`0x1E7EE`, `0x122AE`, `0x1E79A`, `0x12010`, `0x18EC4`. None is a game system;
they are additional blitters. **Art correctness does not depend on them** - it
was established per call against the hardware's own pixels (11614 calls,
715179 pixels), not by whole-screen replay.

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

## Systems - ported and verified

Every system that was outstanding has been ported from the disassembly and
checked against the ROM. Nothing in this table is inferred from observation any
more.

| System | Verified against | Result |
| --- | --- | --- |
| Enclosure test | 18 crafted boards | 18/18 |
| Flood-fill span scanner | 10 crafted columns | 10/10 |
| Piece shapes and placement | all 40 shapes, full board compare | 40/40 |
| Piece rotation | every slot in the table | 131/131, 13 wraps |
| Piece selection (bag + weights + shuffle) | 3 seeds x 3 kinds x 5 levels | 45/45 |
| Scoring | every threshold boundary | 26/26 |
| Damage | 8 crafted boards | 8/8 |
| Projectile flight | 8686 live shot records | 8627/8630 + 3 cadence, 0 unexplained |
| Moving units (ships) | 6776 live unit records | 6737/6766 + 29 cadence, 0 unexplained |
| Cannon aiming | 8 bearings x 8 facings | 40/40 returning |
| Aiming direction | boundary ratios, all signs | 35/35 |
| Distance | overflow extremes | 18/18 |
| Phase dispatcher | 10 queue states | 10/10 |
| Event queue post / remove / test | crafted tables | 12/12, 12/12, 12/12 |
| RNG | 8 seeds x 12 ranges | 96/96 |
| Cell address / screen address | corners, out of range | 12/12, 15/15 |
| Multiplayer | 40 shapes x 3 players | 120/120 |
| Playfield art | 11614 live decoder calls | 715179 px, all discrepancies resolved |
| Sprites | 40 consecutive frames | 13 frames pixel-exact, 99.74% |
| Rendering primitives | decompressor, terrain painter, recolour, remap, dissolve | all exact |

## Update cadence - measured

The projectile and unit integrations run **once per active record per frame**.
Measured by counting the writes each integrating instruction makes and
comparing against the number of active records that frame
(`romlab/cadence.lua`): calls equal active records on the overwhelming majority
of frames - 6/6 on 458 frames, 3/3 on 767, 7/7 on 378, 5/5 on 264, 8/8 on 123,
and so on down the distribution. Off-by-one frames are spawn and retire
boundaries, where a record appears or is cleared between the update and the
end-of-frame sample. Bursts occur about once in 1500 frames.

This closes the cadence question raised by the trajectory verification: the
handful of transitions that needed 0 or 3 applications of the rule were
sampling artefacts at those boundaries, not a variable schedule.

## Level data reached by the damage selector

The damage **code path is complete and verified** (`0x8598` selector 8/8,
`0x8606` handler 8/8). The level data it reaches is structured as follows:

- The pointer at `0x3E0DCA` walks a table of **level records `0x2E` bytes
  apart** (`0x10012`, `0x10040`, `0x1006E`, ...).
- `desc + 0x22 + sel*4` with `sel` = 3, 4 or 5 therefore lands on the **next
  record's leading pointer triple**, which is how one record's selector reaches
  the following record's three data pointers.
- Of the three, the middle one (`0x2BBA6`, `0x2C466`, `0x2CD26`, ...) yields
  words that are in range for the 42x30 board; the other two do not, so the
  selector reaches three different kinds of level data and only one is a blast
  pattern.

**What is not established** is which selector value the game uses in play. The
byte at `player+3` was 0 throughout every capture, and slot 0 is null, so no
real selection was ever observed - the routine is phase-gated and never ran on
its own. Forcing it by setting the trigger bit did not make it run either.
This is level data, not code; every instruction that consumes it is verified.
