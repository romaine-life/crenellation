# crenellation

Rampart (Atari, 1990), recreated. Not a lookalike: the real ROM, translated to
TypeScript twice over, and the game runs on the second translation.

- **`frontend/src/rom/dispatch.ts`** — the *recompilation*. One function per ROM
  routine, each a program counter and a switch over transliterated instructions.
  Verified instruction-by-instruction against real silicon (9,169/9,173 cases
  exact). It understands nothing, and it is right. **It is the oracle, and
  nothing the game runs imports it** — only tests do.
- **`frontend/src/rom/decompiled.ts`** — the *decompilation*. Recovered source:
  parameters, locals, real control flow, `if`/`for`. **This is what the game
  runs, and it is the source**, not a build artifact.
- **`romlab/`** — Python that produced it. Still live, because the lifter still
  improves; see "Regenerating" before running it.

`/play` mounts the game (`frontend/src/rom/RomScreen.tsx`, machine in a Web
Worker, SharedArrayBuffer for pixels and input, so COOP/COEP headers matter).
`/progress` is the status page.

## Where it stands

- 1,183 decompiled functions: 907 ROM routines plus entry points. Every byte
  of the image — overlay, upper half, both board regions — carries exactly one
  verdict: code in a routine, or data with recorded evidence
  (`romlab/census_image.py` is the auditor; zero alarms is the bar).
- **Discovery went dry on 2026-07-29 at 907 routines**: three consecutive
  sweeps of the protocol in `romlab/SWEEP.md` found nothing, by both
  instruments — no PC outside the map across 10,558 addresses real silicon
  executed, and no missing routine in the port under any input pattern.
  `SWEEPLOG.md` is the ledger. A new input pattern resets the count.
- Every routine is proved against the oracle on random machine states, none
  held back, and **none disagrees** — `decomp.txt` reads "all identical" over
  3,631 comparisons and `decompKnownWrong` in `baseline.json` is empty. 0xB032
  was the last one and it is gone. **901 of 907 are also matched against a
  frozen 68000** (24,097
  step-state snapshots; two capture sessions hours apart froze byte-identical
  machines, which is the determinism claim that makes the rest mean
  anything). **904 of 907 are verified and none of the other three is a
  translation gap** — `ledger.py` reads `verified 904 · incomparable 2 ·
  mapMerged 1 · voided 0`, and the classes sum with nothing unaccounted.

  Two capture top-ups did that, both measured in the port before any MAME time
  was spent on them. **Shape 4** puts CODE in the address registers: shapes 0–3
  seed every one with a scratch pointer or a data structure, so a routine that
  *dispatches* through a register could only ever jump into work RAM and run
  the random bytes the harness wrote there — which is why neither RLE decoder
  could be judged. **Shape 5** fills the stack with the sentinel, because a
  bare epilogue (`movem.l (a7)+,a2-a3; rts`) entered as a routine pops the
  harness's stack as registers and then returns into whatever is below it.
  Both runs froze a machine byte-identical to the committed ram/pf/io
  baselines, which is the only thing that makes their snapshots comparable, and
  the new lines were **appended** to `stepstate.log`, never regenerated.

  The last one is not fixable and should not be: **`0x438` is the last two bytes
  of an immediate operand.** `0x434` is `move.l #$55555555,d0`, which spans
  0x434–0x439. It is not an instruction boundary, and no jump table, pointer
  table or branch in the image names it. The classifier invented it once and
  reachability dropped it, correctly. **904 + 2 incomparable is the ceiling,
  not a shortfall.** It has its own class rather than sitting in
  `voided`, which would read as a gap in the translation.

  The earlier finding stands and is what made all this tractable: Two are
  incomparable with the reason on record — both halves of the protection probe
  at 0x140010/0x1400E4, where that window is served by a state machine and
  fetching differs from reading. The other five are capture artifacts: 0x438 is
  no longer a routine head at all (the map merged it into 0x430); 0x561C and
  0x19A1E have every recorded stopping point inside an exception stub, so the
  chip had vectored and left the routine; and 0x12222, 0x122C6 and 0x1A256
  "skipped a call the chip made" to **0x3E42B2, 0x3E42EF and 0x4AAEDF8A** —
  work RAM and one uninitialised pointer. The chip followed a harness-invented
  pointer into scratch and executed whatever bytes were there. Recording only
  "a call was skipped" made that unanswerable from the ledger, which is the one
  place it gets read; `stepstate.test` now names the address.
  The classes sum to 907 with nothing unaccounted; `romlab/ledger.py` builds
  them and `original593.py` reports the same for the original 593.
- **Capture data is not derived data.** `entries.txt` is the fuzz and
  call-and-return sessions' entry list and their random stream is consumed in
  its exact order — regenerating it took fuzz from 1,301 matches to 130.
  Step-state has its own `step-entries.txt`. Every harness now has a non-zero
  floor in `baseline.json` for the same reason: a zero floor hid stepstate
  falling from 832 to 95.
- The game boots, draws the attract screen in colour, and plays. Under the
  pure decompiled dispatcher every sweep pattern runs its full length —
  including games on all three stations — with no missing routines.
- **The two translations run the same game.** Every input pattern to its own
  end — 19,200 frames across the six — with work RAM, the playfield and the
  palette byte-identical at every frame; every write either makes identical in
  address, value and order, 62 million of them; the same 80,640 pixels on
  screen on every pattern. `compose`, `writes` and `draws` all assert identity
  now, and **the `compose` and `writes` floors are retired**. It takes about
  four minutes, not the 3h41m the old unbounded form did: the per-frame digest
  runs over a mirror kept current by hooking `setByte`, and the write
  comparison streams a hash and only pays for a full recording when something
  differs.
- **Nothing is left.** All **2,125** exception frames on attract stack an
  identical return address and status register, X included, on every input
  pattern's own run — `polls.test` asserts identity and **`baseline.json` has
  no floor at all**. The equivalence suite is now floor-free: compose, writes,
  draws and frames all assert, and the only numbers left in that file are
  capture floors and the deliberate `draws` count.

  The last two faults were the same shape — a flag carried further than it is
  true for. **X does not outlive a call**: a `jsr` cleared `flags` and not
  `xstate`, so the block head after it re-applied the caller's pre-call X over
  whatever the callee left (interrupt 1,220, at 0x444). And **uncertainty has
  to propagate**: a block whose predecessors disagree keeps whatever the
  previous block in memory left — deliberately, so a branch can still be
  answered — and marks itself uncertain, but it handed that fabricated state on
  as `end_flags`, so a successor with one predecessor called it certain and
  wrote it to the machine. 0x1252A is the case, its two predecessors ending
  with a byte `move.b` and a sixteen-bit `sub.w` (interrupt 1,300, at 0x124E4).
  What a block hands on is now what it KNOWS.

  Three earlier attempts are recorded in `blocks.py` because each looked right
  and none was: re-running the block loop, a third `lift_once` carrying the
  flag state, and syncing before a tail jump out of the routine. What located
  it was two negatives — `SPILL_ALL=1` changed nothing, so the value was wrong
  rather than missing, and every path into the header did sync, so the machine
  was not stale.

- Four faults were fixed to get there, all the same shape — something one
  dispatcher did that the other did not:
  - `tick` charged an interrupted block's cycles **before** running the
    handler, where the chip has not spent them yet. The lifted side entered
    every handler ahead by that block's cost.
  - `move to sr` let an interrupt in **without spilling the routine's
    registers**, so the handler's `movem` saved stale values to the stack. The
    third place needing the spill a block head already had.
  - **The oracle** stacked the address after a taken branch instead of the
    branch target: the generated case sets `m.next` to the fall-through before
    choosing the target. Invisible until now because `rte` pops that address
    and discards it.
  - `xstate` — the X bit's tracked state — was the one piece of carried flag
    state that did not reach a block from its **predecessors**, so a block
    inherited the X of whatever sat before it in *address* order. And shifts
    never synced their condition codes at all, because `sync_flags` returned
    early for any kind that was not cmp, sub or add.
- One deliberate rule change is live: `wallCellSet` no longer counts the cell
  above as connected (`romlab/handedits.py`). It is a **switch**, not a
  constant — `RULES.wallsConnectUp` in `decompiled.ts`, off in the game and put
  back by `original()` in every equivalence harness. A hard-coded change makes
  the equivalence proof unprovable rather than false, and it makes "the change
  is live" unprovable too: `draws.test` used to assert 380 pixels with the
  change compiled in either way, so both claims were the same number and
  neither could fail on its own. Now the ROM's rules give 0 differing pixels on
  all six patterns and `MODIFIED=1` gives exactly 455 on the two that lay a
  wall.

## Making it readable

The equivalence half is done, and so is this one. `names.txt` reads **five
zeros on one line** — no routine named for its address, none opaque, none named
only by a suffix, none without a stated purpose, no unnamed parameter — and all
five are *assertions* in `names.test.ts`, not ratchets. `baseline.json` has no
naming floor left in it. Measured 2026-08-02:

| | |
|---|---|
| Still named for their address | **0 of 1,187** |
| Opaque — nothing it, its host or its target points at says what it is for | **0 of 1,187** |
| Named only by a suffix on another routine's name | **0** |
| No *stated* purpose — the name was derived by rule | **0** |
| Parameters that say what they are | **4,419 of 4,419** |

**"1,187 of 1,187 carry a name that says what they do" was an overclaim and is
retracted.** `expect(byAddress).toEqual([])` says no routine is called
`fn_0ccb2`. It does not say the name is *useful*, and `idents.py` breaks a
collision by appending — `mainGameStateMachineFrom3` — so a name can be unique,
pass the assertion, and tell the reader only which routine it is a second entry
into. The two rows below it are the numbers that were hiding behind it. The
literal collisions *are* gone: the forty-six routines all called
`playerStateAccess` were broken apart by the `d(An)` field offset, which is
what `distinguish.py` is for. Of the 500, most are `Wrapper`/`Stub` variants of
one target or `FromN` entries into one routine — both say something true, just
not what the entry *does*. Those two remain ratchets, and they are what is left.

**A bar that only holds in the tree it was reached in is not a bar.** The
parameter assertion went red at 24 the first time a full regeneration ran under
it, and every one of the 24 was a name some pass had DERIVED from a body that
`dropunread.py` then rewrote — present in the working tree and nowhere a
regeneration could find it again. All 24 were read and written into
`params.curated.json`, and a second regeneration reproduces the three zeros
exactly. That is the whole reason to assert rather than ratchet at the bar.

`names.test.ts` **enforces** the first — `expect(byAddress).toEqual([])`, not a
ratchet, because at the bar a `<=` would quietly accept a regeneration that
lost a name, and losing one is exactly what a regeneration does when a curated
name stops applying. It asserts the second half of the bar too, and now in
both of its forms: every object entry in `names.curated.json` carries a `why`,
**and no entry is a bare string without evidence elsewhere**. Parameters are a
ratchet against `baseline.json` — **on the remainder**, `unnamedParams`, which
may only fall.

Two things about that table changed on 2026-08-02 and both moved the number
down, so read it as a smaller honest count rather than a regression:

- **A register the routine never reads is not a parameter of it.** The lifter
  makes every register live across a routine into one, because the whole live
  set has to survive an interrupt: `pieceWalker` took fourteen and read six.
  1,860 of them now move into the body as `let d1 = getReg('d1');` — the exact
  expression the dispatcher would have used to build the argument, with nothing
  running in between, so the rewrite is equivalent by construction and compose,
  writes and draws all still report identity. 1,009 of those had names, and
  every one described a value the routine never reads.
- **`argN` counts as unnamed.** It says a value arrived in the fourth stack
  slot, which the reader can already see. Counting it as a name made
  `stackargnames.py` invisible — it has moved 186 slots to real words and the
  old count would not have changed by one.

Under the same honest definition the count was 2,501 of 6,279 before the day
and is 2,334 of 4,419 after it: 3,778 parameters said nothing, 2,085 do.

- **`names.curated.json` is where a name goes**, as `{"name": ..., "why": ...}`.
  `idents.py` refuses an object with no `why`: a wrong name is worse than an
  address, and the only defence is being able to read afterwards why it was
  chosen. That had a hole exactly the width of the older form — an entry may
  also be a **bare string**, which is not an object, so 71 of the 400 slipped
  past both `idents.py` and `names.test`. 17 have their evidence in
  `manual_names.json` (`[name, why]` pairs); the other 54 had none anywhere and
  have now been read and recorded, so the test asserts zero rather than
  ratcheting. `romlab/readunevidenced.py` is the reader. Add `"ident"` when the prose does not camelise to something unique —
  `camel` drops hex and truncates to five words, and it silently discarded four
  names that differed only in a field offset before that was noticed. It now
  reports any hand-written name it could not apply.
- **`romlab/readsmall.py [from] [count] [--max BYTES]`** prints the unnamed
  routines smallest first, with callers, callees and disassembly, skipping
  anything already named — so a batch can be named, `idents.py` re-run, and the
  next batch read without regenerating.
- **`romlab/distinguish.py`** prints, per colliding routine, the fields, slots
  and constants that separate it from its namesakes.
- The mechanical levers are exhausted and run to a fixed point in `idents.py`:
  trampolines named after their target, wrappers after the one routine they
  call, entry points after the routine they continue. Folding that last one
  *into* the fixed point rather than after it took jump stubs from 31 to 57.
- **`paramnames.py`** names a parameter after the callee it is handed to: a
  call spills its arguments into the machine immediately before `callRom`, and
  the callee's table says which parameter comes from which register. It is a
  rename and nothing else — compose, writes and draws all still report identity
  after it.
- **`callernames.py`** is the reverse direction, which was built once, measured
  at 3,247 renames and *zero* movement, and withdrawn. The measurement that
  withdrew it also said how to retry: restrict it to parameters that have no
  name, and judge it by the count in `names.txt` rather than by the number of
  renames. Restricted that way it moves 197. **`stackargnames.py`** is the same
  rule for the other 721 — stack arguments, which neither existing pass reaches
  because a pushed value is never spilled to a register. `a7` pre-decrements, so
  the last value pushed is `off: 4`. Both run **two passes**: unanimity first —
  every call site hands the same name — then the weaker reading, where every
  caller that *says anything* agrees. A caller handing a bare `d3` is not
  disagreeing; it has nothing to say, because the lifter made a parameter of a
  register its own routine never reads. That is not the majority rule both
  files reject — a parameter fed `count` by one caller and `colour` by another
  is neither, and picking the commoner would be a guess dressed as a
  measurement. Strict runs first so a name all callers agree on is never
  displaced by one only some of them state.
- **`deadregs.py` asks four questions of the disassembly**, and the scope of
  each is the whole difference between a sound answer and a plausible one.
  *Dead on arrival*: walk the straight line from the entry and stop at the
  first instruction that can fork — up to there the order is the order of
  execution, so a register written is written before anything could read it.
  *Killed everywhere*: both arms of every conditional branch, with a call, a
  return, an unresolved target or a loop back to a visited block all counting
  AGAINST. *No branch skips it*: the first mention in the routine is a kill and
  no branch target lands between it and the register's last mention. *Preserved*:
  every appearance in what this entry can REACH is inside a `movem` — not dead,
  because a spill before a call still hands the value on, which is a different
  name for a different fact. It learned three things the hard way: `move.w`
  writes only the low word and leaves the caller's upper half (111 fell to 88);
  `movea` sign-extends so `movea.w` IS a full kill; and capstone prints
  `movem.l d2-d7`, so searching for `d3` in it finds nothing.
- **`stackroles.py` and `regroles.py`** name a slot after the one thing the
  routine does with it — `src`, `dst`, `record`, `ptr`, `index` — decided from
  every use rather than the first, because the first use of a pointer is
  usually the load that puts it somewhere else. Finding the stack slot is the
  hard half: with a frame pointer it is exactly `(N+4)(a6)`, and without one
  `by_sp` walks the prologue carrying a7's displacement and gives up entirely
  the moment a7 moves in a way it cannot account for. A wrong displacement does
  not fail; it silently names the wrong slot.
- **`readfamily.py` is what the last 450 were read with.** It takes the extent
  from `facts.json` — getting that wrong is the mistake that costs most, since
  a truncated dump makes capstone report a different instruction entirely —
  prints the disassembly elided to the lines touching an unnamed register, and
  follows it with a per-register digest.
- **The diagnostics are the point, not the passes.** `whyunnamed.py` bins every
  unnamed parameter by what the routine does with it, `whyrole.py` replays
  `roles.py`'s decision and says which test came out empty, `whypassed.py` says
  why the call graph declined, `whyunread.py` asks whether it is an input at
  all, and `readparam.py` prints the lines so a reader can see. Every rule
  above came out of one of those counts; `dropunread.py` exists because
  `whyunread.py` said 1,860 of the things being counted were not parameters.
- **`rolecandidates.py` measures a rule before it is added**, which is what
  `roles.py`'s own history demands — a `shift` role was built, found to name
  nothing, and removed. Of three candidates, `flag` (only ever tested against
  zero) reaches 22 and lives in `moreroles.py` — which also closed a hole worth
  29 more, because a parameter still *called* `a3` is one `roles.py` never
  reached rather than one it declined: single-block routines never go through
  `blocks.py`, where `roles.apply` is called. `kind` by *equality* reaches
  **two** in the whole file; `stored` reaches **zero**. The order guard is why
  `flag` is 22 and not 149: `counterStep` replaces the low word of its `d2` and
  *then* asks whether it is zero, so the test is about a value the routine
  computed, and 127 of the 149 were that shape.
- **The mechanical levers are now measured out.** 2,085 are left: 450 `argN`
  stack slots and 1,635 registers, of which 144 are refused as repointed. Of
  the other 1,491, **669 are *only* spilled to the machine** and 147 more only
  spilled and pushed — values passed along and nothing else, which no rule
  about the routine can name because the routine does nothing with them. The
  call graph is at a fixed point in both directions with unanimity required.
  Naming the struct fields was the obvious next lever and it is **measured
  dead** for this metric: of the unnamed parameters, *zero* are stored into or
  loaded from a field of a known structure, zero are stored through a pointer
  at a fixed displacement at all, and 44 are loaded from an absolute address —
  which means the parameter was overwritten, not named. `out/fields.txt` is
  still worth naming for the routines, but it will not move this number.
  What is left is reading, one routine at a time, the same grind the 400
  hand-read routine names were.
- **Dispatch loops are down from 228 to 11**, and `decompiled.ts` is *smaller*
  than before — 8.3 MB against 14 MB — because most of what those loops cost
  was duplication. **Count them with `grep -c 'dispatch:'`**: this said "0" for
  a day on the strength of grepping for `while (true)` and `switch (_pc)`,
  which are not the tokens the form uses, and `blocks.py`'s "lifted: 1,182
  (100%)" counts routines that lifted at all rather than routines that got
  structured control flow. Both readings were wrong and agreed with each other,
  which is how the claim survived. Three faults: `cfg.reducible()` collapsed the graph keeping
  only the predecessor map, so a merged block's successors went on naming it
  and the collapse stalled (159 routines read as irreducible where 3 were);
  the join of an `if` was a guess rather than the branch's immediate
  post-dominator; and a loop with several ways out gave up instead of
  continuing at the header's post-dominator. The structurer also carries a
  budget now (`_EMIT_BUDGET`), because with the wrong join one routine nested
  exponentially — 219 MB on its own — and past 24,000 statements it falls back
  to the dispatch form, which is what that form is for.
  **`WHYDISPATCH=1 python3 blocks.py` prints why each routine falls back**, and
  that is how all three were found.

## Regenerating

When only names or the lifter changed:

`cd romlab && python3 idents.py && python3 blocks.py && rm -f out/unproven.json
&& python3 decomp.py && python3 handedits.py && python3 namepasses.py &&
python3 dropunread.py && python3 namepasses.py`

When the *map* changed — funcs, entries, extents — the chain starts earlier
and regenerates both translations:

`python3 describe.py && python3 gen_ts.py && python3 cfg.py && python3
idents.py && python3 blocks.py && rm -f out/unproven.json && python3 decomp.py
&& python3 handedits.py && python3 namepasses.py && python3 dropunread.py
&& python3 namepasses.py`

Order matters and these steps are easy to get wrong:

- **`cfg.py` after any funcs change.** `blocks.py` and `decomp.py` read
  `cfg.json`, not `facts.json`; skipping it silently lifts the previous map —
  a new routine simply fails to appear and nothing errors.
- **`rm out/unproven.json` before `decomp.py`, not after.** It is read at
  generation time; clearing it afterwards silently emits the previous run's
  held-back set and every count is wrong.
- **`handedits.py`, then the naming chain.** Regeneration overwrites
  `decompiled.ts`, so every deliberate edit lives in `handedits.py` too and is
  re-applied. An edit that no longer applies is an *error* — the lifter now
  produces different text and the change has to be re-expressed, or taught to
  the lifter. The naming passes run after it, because they rename locals and
  would otherwise move the text a hand edit matches on; all of them are
  idempotent, so a second run reports zero rather than renaming again.
  `namepasses.py` runs the four that NAME to a **joint** fixed point, which is
  not the same as each running to its own: they feed each other, and the second
  round alone finds names the first round's output made findable. Run once each
  they give 2,126 unnamed; run to the joint fixed point, 2,085.
- **`namepasses.py` on BOTH sides of `dropunread.py`**, and the second run is
  not a formality. Run it only after, as this file said for a day, and the
  count is **1,048**; run it before as well and it is **856**. 236 role names
  vanish and 40 different ones arrive: `rowsLeft`, `count`, `index`,
  `screenAt` — names on registers the routine genuinely reads, so that is a
  loss and not a correction. The passes cannot see those roles once the unread
  registers have been rewritten into the body. Nothing is protected from
  removal by naming it first, either: `dropunread` moved exactly 1,860 in both
  orders. The reason it still has to run *before* the last naming round is the
  original one — a pass that names things about to stop being parameters
  spends its evidence on them, and the first time round 1,009 of the 1,860 it
  drops had names, `callernames.py` reporting 384 before it and 197 after.
  Both runs are wanted; only the order of the three is fixed.
- **`rm -rf romlab/__pycache__`** after editing a module another script imports.
  Stale bytecode has survived edits here more than once.

## The map, and how it grows

`describe.py` assembles the function map from the classifier's runs plus every
entry source; `facts.json` is its output, never edited by hand. Entry sources,
each with its own instrument:

- **`staticentries.py`** — every `callRom`/`jumpRom` in the lifted sources
  landing outside all routines. The lifter derived those transfers by
  following real flow, so inline data cannot fabricate them. The output
  **accumulates** (like `unproven.json`); it lists only what is uncovered *at
  that moment*, so overwriting forgets consumed entries and the map regresses.
  Loop `describe → gen_ts → cfg → idents → blocks → decomp → handedits →
  staticentries` until it reports zero: two clean rounds is converged.
- **`prune_entries.py`** — drops accumulated inner entries nothing can reach.
  Reach is control evidence only: a `load8(base + i)` citation is a data use
  and argues for dropping, which is how twelve bytes of index table at
  0x1996A stopped being a "function".
- **`reviewed_entries.json`** — verdicts from reading, with the evidence
  recorded. A `code` verdict becomes an entry (dead code has no callers, so
  no reachability instrument can find it); a `data` verdict retires a
  suspect; `ranges` records region-level judgments (the upper image, the
  board regions, the exception-stub strings).
- **`extents.curated.json`** — measured ends for functions the classifier
  overshot, applied like hand edits: an entry that no longer matches is an
  error.
- **`census_image.py`** — the auditor: every byte of the image gets exactly
  one verdict (code in a routine / data with evidence), and it alarms on any
  branch into an uncovered byte and any data run that looks like prologues.
  Run it after any map change; zero alarms and zero unjudged suspects is the
  bar. **`jumptables.py` and `account.py`/`name_data.py` must be re-run when
  funcs changes too** — the first finds cases whose targets sit inside the
  table's own data region, the other two recompute the data map as the
  complement of the current code map.
- **`sweep.sh` / `sweeploop.sh`** — the dynamic instrument: the pure
  decompiled game under every input pattern in `sweep.test.ts.tmpl` (attract,
  one/two/three players actually playing, service switch, idle), recording
  every address with no function. The loop feeds finds back and repeats until
  a sweep is empty. **Attract alone is not a sweep** — it was dry at 901
  routines while a joined player found six more. `SWEEP.md` is the protocol,
  `SWEEPLOG.md` the ledger, and `exectrace.lua` the silicon half.

A worktree can run all of this after one deliberate copy of the gitignored
inputs from the main checkout: `romlab/out/*.json`, `prog_ext.bin`,
`prog_upper.bin`. Outputs then land in the worktree's own `frontend/src/rom/`.

## Verifying

- **`decomp.test.ts`** — every routine against the oracle on random machine
  states. Calls from inside a routine go to the *recompiled* callee, so each
  test isolates one routine. `DECOMP_ONLY=13000-13a00` restricts the range; the
  full run is slow.
- **`compose.test.ts`** — the same ROM booted both ways, all of work RAM, the
  playfield **and the palette** compared every frame, on all six patterns to
  their own full length. Asserts identity. `MODIFIED=1` flips it to assert the
  opposite — that the deliberate change is present — which only became a real
  proof once the unmodified run was identical; before that a pre-existing
  divergence masked the edit entirely.
- **`writes.test.ts`** — every write from both runs, in address, value and
  order, over a whole game. A streaming digest with a checkpoint every 100,000
  writes makes the full length affordable; a difference is then bounded to one
  checkpoint block and only that block is recorded in full, with registers, the
  cycle clock and the ROM call stack. `W_LO`/`W_HI` set the address window.
  Call sequences are *not* comparable between the two dispatchers — the
  recompiled one only sees calls that leave a routine's own switch — which is
  why writes are the thing compared.
- **`polls.test.ts`** — the seam itself, and the instrument to reach for when
  compose or writes reports a difference. Four questions, each narrower than
  the last: do both runs cross every frame boundary at the same pc, clock,
  stack pointer and interrupt count; do they stack the same exception frame at
  every interrupt; do they reach the same poll points in the same order having
  spent the same cycles (`POLL_QUIET=1` delivers no interrupts at all, which is
  the only mode where that clock column means what it says); and, for one named
  frame, every poll inside it (`POLL_FRAME=N`, with `POLL_WATCH=addr` and
  `SPILL_ALL=1` to compare registers at a routine entry).
- **`draws.test.ts`** — the screens, rendered through the palette. With the
  ROM's rules the two runs must draw the same picture on every pattern, 0 of
  80,640 pixels differing; with `MODIFIED=1` the changed rule must show, at the
  exact per-pattern counts in `baseline.json`.

Per-routine verification passing does **not** mean the game works. `movep` was
stubbed as a no-op and every routine still verified clean, because the harness
never built a state where it mattered; the game drew every frame perfectly in
black for hours. Ask what is on screen, not only whether memory matched.

## Things that cost hours

- **A decompiled function has one entry.** The recompiler can start a routine at
  any address; this cannot, so every address the game enters at needs its own
  function. They come from tail jumps, jump tables and `lea $X(pc),a6`
  continuations — a scan of branch targets finds none of the last two. Each one
  fixed lets the game run further and reveals the next, so close the set against
  the *pure* decompiled run: a census that falls back to the recompiler takes a
  different path and misses them.
- **Decompiled code has no instruction boundaries**, so interrupts are polled at
  block heads with cycles charged from the recompiler's own cost model. Without
  it the sound driver's busy-wait never ends.
- **`\b` inside a bash heredoc becomes a literal backspace byte**, and both grep
  and the file reader render it invisibly — a regex that can never match, in a
  function whose source looks correct. Prefer the editor tool for anything with
  escapes.
- **A truncated dump lies.** `decode(lo, lo+90)` cuts the last instruction and
  capstone reports a different one entirely. Always use the routine's real
  extent from `facts.json`.

## Ground rules (settled; don't relitigate)

- **The ROM stays in the repo.** Decided deliberately.
- **Binary assets are data, never source.** `frontend/public/assets/` is
  gitignored; art/music ship from the `crenellationmedia` storage account.
- **Persistence**: Azure Postgres (`crenellation-pg`, db `crenellation`,
  workload identity `crenellation-identity`), provisioned by `tofu/` (state key
  `crenellation.tfstate`). The game must stay playable with the DB down.
- **Deploys**: push `main` → build → the workflow publishes the image tag to the
  `prod` branch, which ArgoCD watches. Host **rampart.romaine.life**
  (`k8s/values.yaml`; the description in `k8s/Chart.yaml` is stale).
- **Local dev**: set `DATABASE_URL` (pgadmin + break-glass password from
  ng6-crenellation, `sslmode=require`, password URL-encoded), then
  `devctl up crenellation-backend`. Frontend on `devctl up crenellation-frontend`.
  The workstation IP is a hand-added firewall rule (`dev-nelson-laptop`).

# Working in this repo

## Taking screenshots (read this before trying to screenshot the app)

**Do NOT use the in-editor preview/screenshot tool to capture images on this
machine — its capture step hangs (every grab times out at ~30s, even on a blank
page). The dev server is fine; only the pixel grab is broken.** Don't retry it,
and don't tell the user screenshots are impossible. Use the helper below.

For the ROM game specifically there is a shorter path: the tests render the
machine's own framebuffer to PNG via `frontend/src/rom/png.ts`, no browser
involved.

### How

1. Start the dev server **persistently** — through devctl (the dev-servers skill), not a
   backgrounded bash that dies between turns. Plain fallback from `frontend/`:
   `npx vite --host 127.0.0.1 --port 5199 --strictPort`. It serves `index.html` for every
   route (SPA), so any path works.

2. Capture with the `shot` tool. It drives the installed Chrome via `puppeteer-core`
   (system browser, no bundled download), freezes animation for determinism, and **clips
   to a CSS selector** — so you get small, focused, analyzable pixels instead of a
   full-page grab (too many pixels is what breaks image analysis):
   ```
   npm run shot -- <url> [--select <css>] [--out <path>] [--size <WxH>] [--ready <jsExpr>] [--full]
   ```
   Output defaults to `frontend/tmp-shots/shot.png` (gitignored). **Default to showing the
   small PNG inline — never substitute a link + description for the pixels.**

`frontend/scripts/shot.mjs` is the implementation.

## Dev environment gotchas (git worktrees)

- A worktree's `frontend/node_modules` may be **partial** (missing react /
  typescript / etc.). Run `npm install` in the worktree once, or typecheck with
  the main checkout's compiler:
  `node ../../../frontend/node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`.
- Never create symlinks/junctions to share `node_modules` — do a real install.
- Plain `npx vite` serves reliably. If you use the preview tool's managed server,
  pin an explicit `--port` and matching `port` in `.claude/launch.json` (no
  `autoPort`), or a port mismatch will make a healthy server look dead.
