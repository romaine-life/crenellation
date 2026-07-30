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

Data matters as much as code. The game's state is still addressed as
`load8(0x3e0de4)` where it should read `player.credits`; the board is at
0x3E0864 and the player structs at 0x3E1968.

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
