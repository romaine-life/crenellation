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
  anything). Of the six: four have every silicon trial voided because the
  port skipped a call the chip made, and two are incomparable with the reason
  on record — both halves of the protection probe at 0x140010/0x1400E4, where
  that window is served by a state machine and fetching differs from reading.
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
- **What is left is one bit.** 1,219 of 2,125 exception frames on attract stack
  an identical return address and status register, and the 1,220th differs in
  X alone. X outlives the instruction after it — a move or a compare leaves it
  — so it can be set several routines back, and the lifted world computes
  flags in JavaScript and writes them to the machine only at sync points. It is
  not a missing sync point: `SPILL_ALL=1`, which spills at every block head,
  does not change the number. It reaches memory only inside a frame the handler
  immediately pops, which is why every other instrument reports identity, and
  it is the `frames` floor in `baseline.json` — the only floor left in the
  equivalence suite. `polls.test` is the instrument.
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

The equivalence half is done, and so is the function half of this one.
Measured 2026-08-02 in `frontend/src/rom/names.txt`:

| | |
|---|---|
| Functions with a name that says what they do | **1,187 of 1,187** |
| Still named for their address | **0** |
| Parameters that say what they are | 3,137 of 6,279 |

`names.test.ts` **enforces** the first — `expect(byAddress).toEqual([])`, not a
ratchet, because at the bar a `<=` would quietly accept a regeneration that
lost a name, and losing one is exactly what a regeneration does when a curated
name stops applying. It also asserts the second half of the bar: every object
entry in `names.curated.json` carries a `why`. Parameters stay a ratchet
against `baseline.json`, and may only rise.

- **`names.curated.json` is where a name goes**, as `{"name": ..., "why": ...}`.
  `idents.py` refuses an object with no `why`: a wrong name is worse than an
  address, and the only defence is being able to read afterwards why it was
  chosen. Add `"ident"` when the prose does not camelise to something unique —
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
  after it. The reverse direction was built, measured at 3,247 renames and zero
  movement, and dropped; the note is in the file.
- **Dispatch loops are down from 228 to 11**, and `decompiled.ts` is *smaller*
  than before — 8.3 MB against 14 MB — because most of what those loops cost
  was duplication. Three faults: `cfg.reducible()` collapsed the graph keeping
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
&& python3 decomp.py && python3 handedits.py && python3 paramnames.py`

When the *map* changed — funcs, entries, extents — the chain starts earlier
and regenerates both translations:

`python3 describe.py && python3 gen_ts.py && python3 cfg.py && python3
idents.py && python3 blocks.py && rm -f out/unproven.json && python3 decomp.py
&& python3 handedits.py && python3 paramnames.py`

Order matters and these steps are easy to get wrong:

- **`cfg.py` after any funcs change.** `blocks.py` and `decomp.py` read
  `cfg.json`, not `facts.json`; skipping it silently lifts the previous map —
  a new routine simply fails to appear and nothing errors.
- **`rm out/unproven.json` before `decomp.py`, not after.** It is read at
  generation time; clearing it afterwards silently emits the previous run's
  held-back set and every count is wrong.
- **`handedits.py` then `paramnames.py` last.** Regeneration overwrites
  `decompiled.ts`, so every deliberate edit lives in `handedits.py` too and is
  re-applied. An edit that no longer applies is an *error* — the lifter now
  produces different text and the change has to be re-expressed, or taught to
  the lifter. `paramnames.py` runs after it, because it renames locals and
  would otherwise move the text a hand edit matches on; it is idempotent, so a
  second run reports zero rather than renaming again.
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
