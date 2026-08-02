# What shipping means

Not "the ROM runs in a browser" — that has been true for a while. The product
is **Rampart, playable as it was meant to be played, on source a person can
read and change.** Three-player, drawn correctly, audible, and editable.

Everything below is measured. Where a number is missing it says so.

## 1. The code — essentially done

| | |
|---|---|
| Routines | 906, every one recompiled and decompiled |
| Bytes of the image with a verdict | all of it: code in a routine, or data with recorded evidence |
| Discovery | dry on 2026-07-29, three consecutive sweeps, both instruments |
| Matched against a frozen 68000 | 901 of 906, 24,097 snapshots |
| Instruction rules against silicon | 9,169 of 9,173 exact; the other four never start an instruction anywhere in the map |
| Routines disagreeing with the oracle | none — `decomp.txt` reads "all identical" and `decompKnownWrong` in `baseline.json` is empty |

Remaining: nothing here. 0xB032 was the last, and it is gone.

## 2. Equivalence — done, and it is identity rather than a floor

The two translations run the same game. Measured 2026-08-02:

| | |
|---|---|
| Frames compared, both dispatchers | 19,200 — every input pattern to its own end |
| Work RAM, playfield and palette | byte-identical at every frame of every pattern |
| Writes compared | 62 million, identical in address, value and order |
| Screens | the same picture on all six patterns, 0 of 80,640 pixels |
| Floors retired | `compose` and `writes`; both now assert identity |
| What is left | one bit — see below |

Four faults were fixed, all of the same shape: something one dispatcher did
that the other did not.

1. `tick` charged an interrupted block's cycles **before** running the handler,
   where the chip has not spent them yet, so the lifted side entered every
   handler ahead by that block's cost.
2. `move to sr` let an interrupt in **without spilling the routine's
   registers**, so the handler's `movem` wrote stale values to the stack.
3. **The oracle** stacked the address after a taken branch rather than the
   branch target — the generated case sets `m.next` to the fall-through before
   choosing the target. Nothing had noticed, because `rte` pops that address
   and discards it.
4. `xstate`, the X bit's tracked state, was the one piece of carried flag state
   that did not reach a block from its **predecessors**, so a block inherited
   the X of whatever sat before it in *address* order; and shifts never synced
   their condition codes at all.

**What remains is one bit.** 1,219 of 2,125 exception frames on attract stack
an identical address and status register; the 1,220th differs in X alone. X
outlives the instruction after it, so it can be set several routines back, and
the lifted world writes its flags to the machine only at sync points — though
not for want of one: `SPILL_ALL=1` spills at every block head and does not move
the number. It reaches memory only inside a frame the handler pops. It is the
`frames` floor in `baseline.json`, the only floor left in the equivalence
suite, and `polls.test` is the instrument.

**The deliberate rule change is a switch now, and that is what made both
proofs real.** `RULES.wallsConnectUp` in `decompiled.ts` is off in the game and
restored by `original()` in every equivalence harness. Compiled in, it made the
equivalence proof unprovable rather than false — and it made "the change is
live" unprovable too, because `draws.test` asserted a pixel count with the
change present either way, so both claims were the same number and neither
could fail on its own. Now the ROM's rules give 0 differing pixels on all six
patterns, and `MODIFIED=1` gives exactly 455 on the two patterns that lay a
wall by the frame compared.

This was the least valuable remaining work by the old reckoning and it is done;
everything below is what is actually between here and a product.

## 3. Readability — the function half is done

You cannot change what you cannot find.

| | | moved this session |
|---|---|---|
| Functions named semantically and uniquely | **1,187 of 1,187** | from 667 |
| Still named for their address (`fn_0ccb2`) | **0** | from 536 |
| Parameters named | 3,137 of 6,279 (50%) | from 2,304 |

**No `fn_[0-9a-f]+` identifier survives.** That was the bar this section set,
and `names.test.ts` now enforces it rather than ratcheting it — an exact
`toEqual([])`, because at the bar a `<=` would accept a regeneration that
silently lost a name, which is exactly what regeneration does when a curated
name stops applying. It also asserts the other half of the bar: every entry in
`names.curated.json` written as an object carries a `why`, so no name can claim
to be evidence-backed without being it.

Four things got it there:

1. **Reading.** Four hundred routines read out of the disassembly and named in
   `names.curated.json` with the instructions quoted beside them — the glyph
   layer and its four-slot table at 0x3E3400, the sound driver's tick
   accounting and its script interpreter, the C runtime's number formatter,
   the display-list rebuilders, the palette effect schedulers, the service
   menu, the crash screen.
2. **Ordering the naming rules properly.** `idents.py` named entry points after
   their host *after* it named jump stubs after their targets, so a stub into
   an entry point could never be named. Folded into one fixed point, jump stubs
   went from 31 of 67 to 57.
3. **Making silent losses loud.** `camel` drops hex and truncates to five
   words, so four hand-written names that differed only in a field offset
   collapsed to one identifier and three were discarded without a word.
   `idents.py` reports any name it could not apply, and an `ident` field says
   the identifier outright when the prose will not carry it.
4. **`paramnames.py`.** A call spills its arguments into the machine
   immediately before `callRom`, and the callee's table says which parameter
   comes from which register — so a local only ever passed on takes the name of
   what it is passed to. 659 parameters, to a fixed point.

Every one of those is a rename or a data change, and the equivalence proof was
re-run after each: compose, writes and draws all still report identity.

Two rules were measured and **dropped** rather than kept, to the same standard
`roles.py` applies to its withdrawn "shift" role: naming a callee's parameter
from its callers reported 3,247 renames and moved the count by zero, and a
"packed" role for shifted parameters matched two.

**Dispatch loops: 228 to 11**, and the generated file is *smaller* than it
started — 8.3 MB against 14 MB — because most of what those loops cost was
duplication the structurer could not avoid. Three faults, each found by asking
the lifter to say why it fell back (`WHYDISPATCH=1 python3 blocks.py`):

1. **The reducibility test was wrong.** `reducible()` collapses the graph with
   T1 and T2 and reports irreducible if anything is left over, and it
   maintained the predecessor map without the successor one — so merging a
   block into its predecessor left that block's successors still naming it,
   their live predecessor sets emptied, and the collapse stalled. 159 routines
   reported irreducible; only 3 of them had a component with two entries, which
   is what irreducible means. The smallest case is 0x022BA: `0 -> 1, 1 -> 2,
   2 -> {1, 3}` — an ordinary loop with a tail, stalling with two nodes alive.
2. **The join of an `if` was a guess.** `meet` picked, out of the nodes both
   arms can reach, one that no other such node reaches first. That is right
   most of the time and wrong exactly where the structurer then found a block
   reached twice — the arms had been told to stop at a node that was not a join
   and walked past it into each other. Replaced by the branch's immediate
   post-dominator, computed properly (Cooper, Harvey and Kennedy on the reverse
   graph from a virtual exit). That alone removed every "reached twice" bail
   and took the file from 17.6 MB to 8.3 MB.
3. **A loop with several ways out** now continues at the header's
   post-dominator rather than giving up, and an exit that only ever *returns*
   is not counted as a way out at all — its blocks are emitted inline where the
   branch is and nothing follows them.

The structurer also has a budget now (`_EMIT_BUDGET`), because between (1) and
(2) these graphs nested with the wrong join and one nested exponentially:
`serviceMenuSMainLoop` came out at 219 MB and the whole file at 272 MB, where
`tsc` runs out of heap. Past 24,000 emitted statements it bails and the routine
falls back to the dispatch form, which is what that form is for. One routine
uses it today.

Two more were fixed on the way: `split_nodes` returned a three-tuple on the
path where twenty-four splitting rounds are not enough, and the caller unpacks
four — latent, because no graph had ever needed a twenty-fifth. And tail
duplication was tried *in the emitter* and withdrawn: it measured as a no-op
while the reducibility test was wrong, and once that was fixed it was what
produced the 272 MB. It belongs in `split_nodes`, which bounds it.

**The parameter count moved by removing bad names as well as adding good
ones**, and the ratchet caught the dip in between, which is what it is for. Two
changes to `roles.py` in opposite directions. The comparison detector was
widened: the lifted form of a compare is not `x < y` — a `cmp` becomes
`setFlagsCmp` and the branch a condition several layers of masking deep — so
the adjacent-operator pattern matched 15 parameters in the whole file where a
wider one matches 149. And `limit` and `end`, which both mean "a value this
routine only ever tests against", never checked that the test happens before
the register is reused: `negateStore`'s d3 was called `limit` while the routine
overwrites its low byte first and asks `>= 0` about the *result*. Guarding on
reassignment outright cost more than the widening gained — 3,069 down to 3,036
— so it was corrected to guard on **order** instead, which is the right
question: only two parameters in the whole file are overwritten before ever
being read, so these registers really are inputs and are merely reused as
scratch afterwards.

**What is left here.** 11 routines of 1,182 still lift to a labelled
`dispatch:` switch — 10 with a loop whose several ways out reach no common
continuation at all, and one over the emit budget. And 3,142 parameters still
carry the register they arrived in; the seed is the limit there, since only a
routine with a named parameter can donate one, so widening `roles.py` widens
`paramnames.py` with it.

## 4. The machine — what makes it a game

None of this is recompilation, and all of it is between here and a product.

- **Motion objects.** Not drawn at all. The board keeps a display list the
  port never reads; terrain, castles, walls and ships come from the playfield,
  so the first job is establishing what is on that list.
- **Sound.** Both chips are written to correctly and neither is modelled.
  Needs YM2413 FM and OKI6295 ADPCM.
- **Two more stations.** Four buttons and four trackball axes are measured and
  unwired. Rampart is a three-player game; its whole design is the
  simultaneous scramble. This is the single biggest gap between what runs and
  what people would want to play.
- **Pacing.** The clock runs 1.4x slow, down from 7.6x.

## 5. Editability — proved once, not yet comfortable

`wallCellSet` is a real rule change living in the decompiled source, with
`compose MODIFIED` asserting it is in the running game. That proves the loop
works. It is one edit, re-applied by `handedits.py` after every regeneration.

For real work the source has to **graduate**: stop being generated, or make
hand edits scale past a handful. That is a deliberate cut, not something to
drift into.

## The order

1. **Names, code and data** (§3). Everything else is easier afterwards, and it
   is the thing that turns this from an artifact into a codebase.
2. **The stations** (§4). Two-player Rampart is a different game from
   one-player Rampart, and it is mostly wiring already-measured inputs.
3. **Motion objects** (§4). Until the sprite layer draws, changes are made
   half-blind.
4. **Graduate the source** (§5), once naming has settled what the files should
   look like.
5. **Sound** (§4).
6. **The equivalence floor** (§2) and 0xB032, whenever they are cheap.

Each step should end the way `wallCellSet` did: a change landed in the running
game, proved by an instrument, not by assertion.
