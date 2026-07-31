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
| Routines disagreeing with the oracle | 1 (0xB032), named in `baseline.json` |

Remaining: 0xB032, and the equivalence floor below.

## 2. Equivalence — a floor, with the cause known

The two dispatchers agree on 39,666 writes across every input pattern, and
their screens differ in 380 of 80,640 pixels at frame 600. Both trace to one
thing: the lifted code charges a block's cycles when it enters, the
recompiler charges per instruction, so between block heads they are up to 900
cycles apart. A frame is a quarter of a million, so it almost never matters —
and then once it lands either side of a boundary and the decompiled run
misses a frame. Driving the frame interrupt off poll points instead of cycles
took agreement from 27,004 to 39,666; what remains is 27 poll points of
difference in 1.87 million. See task #12.

This is the least valuable remaining work. It proves the translation; it does
not make the game better. Do it when it is cheap, not before the rest.

## 3. Readability — the critical path, untouched

You cannot change what you cannot find.

| | |
|---|---|
| Functions named semantically and uniquely | 406 of 1,186 (34%) |
| Still named for their address (`fn_0ccb2`) | 780 |
| Parameters named | 1,944 of 6,153 (31%) |

The 780 split into two different jobs: about 392 sit in families where the
evidence pass already knows the kind (43 sound-driver helpers, 42 player-state
accessors) and only needs them told apart — cheap, because reading one teaches
the rest. The other ~246 have no stated purpose at all.

Data matters as much as code — and `distinguish.py` shows it is not merely
parallel work but the *lever*. A colliding name is a name for a **region**
("touches the player structs"), and the fact that separates its members is
one level finer: the `d(An)` displacement, i.e. which field. None of the 42
player routines reaches the struct by absolute address; every one goes
through a base register, so the field offsets are the entire distinguishing
evidence. Offset 0x2 appears in 15 of them, 0xE in 9, 0x10 in 6.

So the order inside naming is: **name the struct, and the routines name
themselves.** Doing it the other way round means reading 42 disassemblies to
recover the same field map 42 times.

`python3 distinguish.py [group|0xaddr]` prints, for every colliding and
unnamed routine, the evidence needed to name it — fields, region slots,
constants, callers, callees — so this is 638 short reads, not 638
disassemblies.

Two mechanical levers fall out of it, both reading evidence that already
exists rather than inventing anything:

1. **Fields name the routines.** Described above: name the struct, and its
   forty-two accessors name themselves.
2. **Callees name the callers.** 0x010DE has no stated purpose, and calls
   `cellDraw`, `cellOwnerDraw` and `cellOverlayDrawSecondForm` — three named
   routines sharing a theme. A routine whose named callees share a leading
   token can be named from them, with the call graph as the recorded
   evidence, exactly as `idents.py` already names a trampoline after where it
   jumps. It compounds: each round of naming gives the next round more
   callees to work from, so run it to a fixed point the way
   `staticentries.py` is run.

Naming is now ratcheted like everything else: `frontend/src/rom/names.test.ts`
fails if `addressNamed` rises or `namedParams` falls, and `baseline.json`
holds both. `git diff baseline.json` is the record that a session moved it.

One trap, already hit: a duplicate key in `names.curated.json` is **silent**
— `json` keeps the last and the earlier name vanishes with no error. It is a
hard failure now (`idents.py`), but the same hazard applies to any
hand-edited map here.

**Two shortcuts that would move the number without doing the work.** Both
are rejected; the ratchet exists to stop exactly this.

- *Numbering the collisions* — `helperMainGameStateMachine1..16`. That is a
  name for the caller, not for any of the sixteen. `idents.py` already
  refuses it and keeps the address instead.
- *Suffixing them with the field offset* — `playerState2eAccess`. Tempting,
  because it is genuinely evidence and it would clear ~392 routines in one
  commit. It still says only *where* a routine reaches, not what it does,
  and a reader is no better off. The field offset is how you **find** the
  answer, not the answer.

The honest route for those 392 is the one the field map serves: read enough
routines touching a field to learn what the field *is*, name the field, and
let the accessors take their names from it. That is reading work, and there
is no rule that does it.

**Bar:** no `fn_[0-9a-f]+` identifier survives, every name carries recorded
evidence the way `reviewed_entries.json` records data verdicts, and a test
fails if either breaks. A wrong name is worse than an address — `0x9080` was
confidently called `creditCompare` and drains a ring buffer with nothing to do
with credits.

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
