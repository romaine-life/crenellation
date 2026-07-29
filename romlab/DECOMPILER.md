# The decompiler

Turns the Rampart ROM into TypeScript that a person can read and edit, and
proves each piece against the recompilation, which was checked instruction by
instruction against real silicon.

Recompiled and decompiled are different claims. The recompilation is a program
counter and a switch over transliterated instructions: it runs the game and
understands none of it. The decompilation has parameters, locals, real control
flow, and a call where the ROM had a `jsr`. Only the second can be edited.

## The pipeline

| | |
|---|---|
| `cfg.py` | basic blocks, edges, reducibility |
| `idents.py` | a routine's purpose becomes its identifier |
| `blocks.py` | the lifter: registers become locals, the graph becomes `if`/`for` |
| `decomp.py` | the single-block lifter, the shared operand rules, and the emitter |
| `handedits.py` | deliberate source changes, re-applied after regeneration |

Run them in that order, then `handedits.py`. Two steps are easy to get wrong
and both fail silently:

- **`rm out/unproven.json` before `decomp.py`, not after.** It is read at
  generation time. Clearing it afterwards emits the previous run's held-back set
  and every count is wrong.
- **`rm -rf __pycache__`** after editing a module another script imports. Stale
  bytecode has survived source edits here more than once.

## The oracle gates emission

`decomp.test.ts` runs each routine twice from identical machines — once through
the recompiled dispatcher, once as the decompiled function — and compares every
register and every byte either could have touched. Disagreeing addresses go to
`out/unproven.json` and the lifter stops emitting them.

That list **accumulates**. Overwriting it swaps one failure set for the next and
the loop never converges.

Calls made from inside a routine under test go to the *recompiled* callee, so
each test isolates one routine. `DECOMP_ONLY=13000-13a00` restricts the range.

## What a decompiled function cannot do, and what replaces it

**It has one entry.** The recompiler can start a routine at any address —
`FNS[found](m, a)` picks up at `a`, because it is a switch. A decompiled
function starts at its first instruction. Every address the game enters at
therefore needs its own function, lifted from there to the end of the routine it
lands in. About 300 of them. They come from tail jumps, from jump tables
(`jmp $BASE(pc,dN.w)` reads an offset and jumps to BASE plus it), and from the
`lea $X(pc),a6` continuation pattern where a worker returns via `jmp (a6)`.

A scan of branch targets finds none of the last two. Each entry added lets the
game run further and reveals the next, so close the set against the **pure**
decompiled run — a census that falls back to the recompiler when it hits a gap
takes a different path from there on and misses the rest.

**It has no instruction boundaries.** The recompiler ticks every instruction and
unwinds with an exception, because it must resume at a particular program
counter inside a switch. Decompiled code has no such place to resume, so the
interrupt poll goes at the head of each block, charges that block's cycles from
the recompiler's own cost model, and runs the handler inline. A statement
boundary is as good as an instruction boundary when nothing needs resuming.
Without this the sound driver's busy-wait — spin until a byte changes, which
only an interrupt changes — never ends.

`move to sr` that lowers the mask lets a pending interrupt in as part of that
instruction, and the machine raises to say so. Nothing needs resuming there
either: the write has happened, so the handler runs and returns.

## Flags

The 68000 branches on condition codes; the lifted source has values. Conditions
are reconstructed from whatever set the flags, which is where most of the bugs
have been.

- **An `add` sets carry.** Modelling arithmetic flags as "the result against
  zero" loses it, and `add.w dN,dN` is this ROM's shift-left with `bcc` reading
  the bit that fell off the top. Both operands are pinned before the add.
- **A subtract's flags are a compare's** — `dst - src`. But an
  **address-register destination sets no flags at all**, and widening the
  capture without that guard cost twenty-five routines at once.
- **A shift sets carry from the bit that left the register.** Only literal
  counts are captured; a register count is modulo 64.
- **A store to memory sets N and Z from the value stored.** `move.w d0,(a0)+`
  then `dbeq` writes one word, not thirty-three, because d0 is zero and the
  condition already holds. The value is named before the store, since a
  destination that post-increments cannot be read back.
- **`bmi` is N alone**: the sign of the result *truncated to the operand width*.
  `sub.b` of 0x80 from 0 is +128 in full precision and 0x80 — negative — in a
  byte. The signed comparisons are a different case: N != V *is* the
  full-precision comparison.
- **`dbcc` is not `dbra`.** It has a condition; the condition is pinned *before*
  the decrement; the decrement happens **only when the condition is false**; and
  `dbcc` does not touch the flags, so the branch after it still tests whatever
  set them. `dbeq` followed by `bne` asks which way the loop ended.
- **Flags reach a block from its predecessors in the graph**, not from what sits
  before it in memory. Where predecessors disagree the graph has no answer;
  taking none there costs five routines and gains one, so that case keeps the
  address-order value and the oracle decides.
- **`move sr,dN` is answerable**: what set the flags last is known at the point
  of the read, so compute them there and hand them to the machine. `cmp` leaves
  X alone where `sub` sets it from the borrow, so they need separate helpers.
  Only sync a state that is *certain* — every predecessor lifted and agreeing —
  because a guess is fine for choosing a branch, which the oracle checks, and
  not for writing condition codes a callee may save.

## Instructions with a rule of their own

- **`movep` is not a no-op.** It moves a register through every other byte of
  memory, for a device wired to one half of the data bus. The palette at
  0x3C0000 is wired exactly that way. Stubbing it made the game draw every
  frame perfectly in black while every routine still verified clean.
- **A byte access through a7 moves it by two.** The 68000 keeps the stack
  word-aligned; a byte push reserves two and puts the byte at the new, even,
  stack pointer.
- **`link a6,#$fffc` reserves four bytes** — the displacement is a signed word.
- **Registers are 32 bits unsigned.** A running total round a loop grows past
  2^32 in JavaScript and stops comparing equal to anything read from memory.
- **Division overflow leaves the destination alone** and sets V, rather than
  truncating to a plausible wrong number.
- **`8(a6)` after `link a6` is an argument**, the same slot `4(a7)` names before
  anything is pushed — and writing one has to mark the slot, or a later read
  hands back the value the routine was passed.
- **a7 is the machine's stack pointer, never a local.** Every path that can name
  a register by name has to know that, including `movem` register lists, which
  is how `movem.l d1-d7/a2-a7,(a0)` — this ROM's setjmp — saved the wrong value.

## Structuring

Reducible graphs become `if`/`else` and `for(;;)`. Irreducible ones get node
splitting first; what still will not nest goes in a labelled dispatch loop,
which is what every decompiler falls back to. About 20% end up there.

Every `for(;;)` carries a label and every `continue` names its loop: bare
`continue` goes to the nearest enclosing loop, and leaving an inner loop for the
outer one otherwise restarts the inner one forever.

Blocks the entry cannot reach are pruned from the graph, not merely skipped —
the dispatch form enumerates every block and wants a condition for any with two
successors. Rampart has routines that share a tail, so a second
`movem ...,-(a7)` sits mid-routine as another entry point; lifting it pushes
onto the same saved-register stack the real restore pops from.

Node splitting renumbers blocks under conditions that never moved, because it
redirects edges *into* the copied region. Reconcile every condition against the
graph as it finally stands rather than tracking the renumbering.

## Names

`idents.py` builds an identifier from a routine's stated purpose. Precedence:
`names.curated.json` (hand-read, wins), then the evidence pass in `name_all.py`,
then nothing — a routine with no established purpose keeps its address, because
`fn_0ccb2` is uninformative and honest while a plausible name nobody checked is
neither.

A name shared by many routines is not a name. Those keep their addresses until
something distinguishes them.

**The evidence pass can be confidently wrong.** 0x9080 was named `creditCompare`
and drains a ring buffer with nothing to do with credits. The exception stubs in
`manual_names.json` were shifted a whole vector, because the table starts with
BAD INT rather than bus error — each stub prints its own name inline after the
`jsr`, which is what settled it. Read the routine.

Two name files exist: `manual_names.json` feeds `gen_doc.py` and `name_all.py`;
`names.curated.json` feeds `idents.py`. They overlap and are not automatically
reconciled.

## Finding a divergence in the composed game

Per-routine verification passing does not mean the game works — see `movep`.

- **Do not compare call sequences.** The recompiled dispatcher only sees calls
  that leave a routine's own switch; the decompiled one routes every call
  through. The traces part at the first call for reasons that mean nothing.
- **Compare writes.** Granularity-independent, and the JavaScript stack at a
  differing write names the function that made it. `writes.test.ts`, windowed
  with `W_LO`/`W_HI`.
- **Compare what is on screen too.** `compose.test.ts` compares work RAM, the
  playfield *and the palette* — leaving the palette out meant a completely black
  game compared equal for nine hundred frames.
- **Check the measurement before believing it.** `cfg.py`'s reducibility test
  was wrong and "194 irreducible routines" was quoted as a wall for hours; the
  real number was 127. A truncated dump makes capstone report a different
  instruction entirely. `\b` in a bash heredoc becomes a backspace byte, and
  both grep and the file reader render it invisibly.

## Editing the game

`frontend/src/rom/decompiled.ts` is the source. Regeneration overwrites it, so
deliberate changes live in `handedits.py` as (routine, old, new, why) and are
re-applied afterwards. An edit that no longer applies is an error: the lifter
produces different text now, and the change has to be re-expressed against it or
taught to the lifter.

Once a rule has been changed on purpose, "identical to the original" is the
wrong question. `compose.test.ts` takes `MODIFIED=1` and asserts the opposite —
that the change is in the running game rather than in a file nothing reads.
