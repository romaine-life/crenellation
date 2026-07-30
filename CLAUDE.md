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
  held back. One disagrees — 0xB032, named in `baseline.json` with what it
  does wrong. 831 are also matched against a frozen 68000 (22,500 step-state
  snapshots, every capture run freezing the identical machine); 72 found after
  that session carry the oracle claim only and say so; two have every silicon
  trial voided by a stubbed call; one is incomparable with the reason on
  record (the protection bank probe at 0x140010 — that window is served by a
  state machine, and fetching differs from reading); one, 0x1A256, is
  outstanding.
- The game boots, draws the attract screen in colour, and plays. Under the
  pure decompiled dispatcher every sweep pattern runs its full length —
  including games on all three stations — with no missing routines. The
  composed decompiled run is byte-identical to the recompiled one through
  frame ~270.
- One deliberate rule change is live: `wallCellSet` no longer counts the cell
  above as connected (see `romlab/handedits.py`).
- Known divergence: 7 bytes of sound-sequencer state from frame 276, in the
  boot tail. Not on the visible path — and now the *first* divergence: the
  writes instrument's floor sits at write 29,770, up from 6,139.

## Regenerating

When only names or the lifter changed:

`cd romlab && python3 idents.py && python3 blocks.py && rm -f out/unproven.json
&& python3 decomp.py && python3 handedits.py`

When the *map* changed — funcs, entries, extents — the chain starts earlier
and regenerates both translations:

`python3 describe.py && python3 gen_ts.py && python3 cfg.py && python3
idents.py && python3 blocks.py && rm -f out/unproven.json && python3 decomp.py
&& python3 handedits.py`

Order matters and these steps are easy to get wrong:

- **`cfg.py` after any funcs change.** `blocks.py` and `decomp.py` read
  `cfg.json`, not `facts.json`; skipping it silently lifts the previous map —
  a new routine simply fails to appear and nothing errors.
- **`rm out/unproven.json` before `decomp.py`, not after.** It is read at
  generation time; clearing it afterwards silently emits the previous run's
  held-back set and every count is wrong.
- **`handedits.py` last.** Regeneration overwrites `decompiled.ts`, so every
  deliberate edit lives there too and is re-applied. An edit that no longer
  applies is an *error* — the lifter now produces different text and the change
  has to be re-expressed, or taught to the lifter.
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
  playfield **and the palette** compared every frame. `MODIFIED=1` flips it to
  assert the opposite — that a deliberate change is present — which is the
  right question once a rule has been changed on purpose.
- **`writes.test.ts`** — every write to a region from both runs, first
  difference, plus the JavaScript stack that made it. `W_LO`/`W_HI` set the
  window. This is the instrument that works: call sequences are *not*
  comparable between the two dispatchers, because the recompiled one only sees
  calls that leave a routine's own switch while the decompiled one routes every
  call through.

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
