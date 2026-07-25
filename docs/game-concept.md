# Chess Tactics — Game Concept

**Status:** Living concept doc. First draft reconstructed 2026-06-15 from the
design discussion + issue #25 (AI direction). This is the canonical statement of
*what the game is*. It supersedes the ad-hoc framing in the README and the
**gameplay-model** inspirations in `ui-art-direction.md`. Open questions are
flagged inline and collected at the end.

---

## 1. Pitch

Chess Tactics is a browser game of **bite-sized chess variations**. Each board is
a small, recognizable tweak on chess — a smaller grid, a pawn that steps three, an
odd squad, a strange piece, an obstacle — built to challenge a chess player the
way **Chess960 does: without ever invalidating the chess they already know.**

There is **no lore and no story.** Like chess itself, it is an abstract board
game; the player is no one. The fun is purely in the positions.

## 2. The player & the promise

- **Audience:** people who already play chess — up to grandmasters and lifelong
  players.
- **Promise:** every board is solvable with **transferable chess intuition.**
  Forks, pins, tempo, king safety, promotion races — your chess knowledge always
  applies. A variation *re-frames* that knowledge; it never throws it away.
- **Session:** a **short sitting — 5–15 minutes of play time** (not per game).
  Early boards are **rapid**; you clear several quickly.

## 3. Design pillars

These are load-bearing. When a design decision is unclear, resolve it in favor of
these.

1. **It must still feel like chess, tweaked.** Never introduce so much, so fast,
   that the game stops reading as "chess with a twist." One new idea at a time.
2. **Restraint over novelty.** The possibility space is enormous; the discipline
   is *not* using all of it at once. Concise variations beat kitchen-sink ones.
3. **A clear path from A→Z.** Difficulty and strangeness ramp legibly. The player
   is always oriented.
4. **Recognizable first, strange later.** The game starts as near-ordinary chess
   and *gradually* gets stranger / more "tainted" (see §7).
5. **Wacky is the exception, not the loop.** Most boards are concise near-chess.
   Cursed/whacky boards are spice, not the meal.

## 4. The core loop

- The player sits down and plays a **board**: a chess position on an authored grid
  with a set of rules and a win condition.
- A board sits somewhere on a spectrum (§5): from a **directed puzzle** to a
  **full game against an AI**, with **PvP** against a human also supported.
- Boards are **self-contained.** There is currently **no continuity** between
  boards — no carried-over roster, no meta-progression. A roguelike layer is **not
  planned**, but nothing in the design precludes adding one later.
- **Campaign** strings 5–10 boards into a curated, slowly-evolving sequence, and
  will grow richer over time.

## 5. What a board is — the puzzle ↔ game ↔ PvP spectrum

A single board can lean:

- **Directed / puzzle** — a specific line to reach the win condition (think
  "mate in N" on a tweaked board).
- **Open game vs. AI** — a short, Chess960-style game played out against the
  engine.
- **PvP** — the same board, human-vs-human.

The same authored board can support more than one of these.

## 6. Rules baseline

The **default** ruleset is **real chess**:

- **Check and checkmate work normally** — you may not leave your king in check;
  checkmate wins. **Castling, en passant, promotion, stalemate, and the draw rules
  (50-move and threefold repetition) are all in the v1 baseline** unless a board
  says otherwise.
- **Capture is one-hit, like chess.** There are **no hit points, no action points,
  no command points, and no per-piece "powers."** The stat/RPG layer shown in the
  old `skirmish-concept.png` (HP bars, AP, "CP 8/12", a POWER action) is
  **explicitly out of scope.**

Boards may deviate from this baseline — but deviation is a deliberate, per-board
**variation** (§7), not the norm. One-hit capture and normal check hold ~99% of
the time.

## 7. Variation levers

A board is defined by which dials it turns away from standard chess. The canonical
levers:

| Lever | Examples |
|---|---|
| **Board size & shape** | smaller grids, non-rectangular boards, holes |
| **Modified piece moves** | a pawn that moves three; a knight with a longer leap |
| **Custom / "Frankenstein" pieces** | pieces with incomplete or hybrid movesets; a "tortured/cursed bishop" with unusual movement or effects |
| **Obstacles & terrain** | rocks today; later: terrain that blocks movement or lines, gives cover, creates hazards, or mutates |
| **Unique squads** | non-standard armies — which pieces each side fields, and how many *(authored per board)* |
| **Royal & win conditions (fluid)** | default is one king + checkmate, but a board may use: two kings; a queen acting as the king; a king with two lives; a king that can kill its attacker once and only dies if attacked again; or an alternate goal entirely *(v1 ships standard checkmate only; the fluid variants are a later expansion)* |

**Tactical-motif vocabulary.** Variations are judged by the chess tactics they
create and reward — forks, pins, skewers, discovered attacks, deflections,
overloads, traps, promotion races, smothered-mate-like enclosures. This is the
design language for "is this board interesting?"

**The "tainting" progression.** Across the campaign, boards drift from ordinary →
strange. Early: a smaller board, a stretched pawn. Later: cursed pieces, mutating
terrain, fluid kings. The drift is gradual by design (pillars §3).

## 8. Modes

Near-term scope:

- **Campaign** — a curated sequence of 5–10 boards, growing over time.
- **Solo Skirmish** — a quick one-off board vs. the AI: **mostly fixed boards, with
  a random-setup option.** Cheap to include, so it is in.
- **Level Editor + sharing** — first-class (§9).
- **PvP** — human-vs-human on a board, supported.

Explicitly **not** in scope: **Daily Challenge** (cut). The accounts / ranks /
roster meta-systems from the old main-menu art are not part of this concept unless
re-introduced deliberately.

## 9. The editor & sharing — a core pillar

The **level editor is a huge part of the fun**, and is a **first-class,
player-facing feature**, not just the author's tool. Players build their own chess
variants and **share them**; collaborating with friends on boards is wanted.

- A board/level is a durable, serializable document (grid, terrain/obstacles,
  squads, win condition, rules).
- Sharing/collaboration is in scope; the heavier collaboration lift is acceptable
  "until it gets too painful."
- **Separate, not part of the game:** the bespoke **asset/design portfolio**
  tooling (the `/design` portfolios) is a content-production and collaboration aid
  for creators, **not** a player-facing game feature. Keep it for now; it does not
  belong on the game's concept surface.

## 10. The AI

The AI is an **open, exploratory design area** — see **issue #25** for the full
discussion. This section records *direction*, not a spec.

- **v1 is intentionally braindead.** Ship a simple, obvious first-pass opponent
  (greedy capture, otherwise legal-move play). Everything below is the
  *longer-term* arc, not the first cut.
- **Leaning adversarial, not puzzle-pressure.** Because the theme *is* chess
  tactics, the AI should aim to be a genuinely **competent opponent**, more than an
  Into-the-Breach-style intent generator.
- **Reuse the *shape* of chess-engine thinking, not Stockfish itself.** Once
  terrain and custom rules diverge from chess, a stock engine stops fitting — but
  legal-move generation, position evaluation, selective alpha-beta/negamax search,
  quiescence on forcing lines, transposition tables, and time management all still
  apply.
- **Abstract tactical-motif detection.** Detect forks / pins / overloads /
  deflections / enclosed-forced-kills *abstractly* (a move that threatens multiple
  targets; a defender pulled off duty; a vital target with no escape) so they
  survive cursed pieces and terrain.
- **Influence / utility maps** for messy, terrain-heavy positions where deep
  search is impractical.
- **Complexity guardrail:** **one unit acting per decision stays tractable; a whole
  squad acting in arbitrary order explodes combinatorially.** Custom movement alone
  is usually fine; mutable terrain + multi-unit combos get hard fast. Unit/board
  design should respect this so the AI stays viable — another reason to keep
  variations concise (pillar §3).

## 11. Non-goals

- **Not** Into the Breach, **not** Advance Wars, **not** Final Fantasy Tactics.
  These were prior framings; the gameplay-model inspirations cited in
  `ui-art-direction.md` are superseded by the chess-variation thesis. (The
  *visual* identity in that doc — moonlit "Dark Strategy Pixel," readable board —
  is not re-litigated here.)
- **No** stat / RPG layer (HP / AP / CP / powers).
- **No** story or lore (for now).
- **No** daily challenge.
- **No** roguelike / meta-progression yet (not precluded later).
- The asset / design portfolio is **not** a game feature.

## 12. Relationship to the current codebase

The game is considered **un-prototyped**; existing code and art are scaffolding —
useful raw material, not canon. For future contributors:

- **Aligned with this concept:** the pure, deterministic chess **rules engine**
  (movement, capture, promotion) under `frontend/src/core`; the **terrain /
  elevation** and **objective** scaffolding; the **level/campaign schema**, the
  **editors**, and **Postgres persistence**.
- **Rejected by this concept:** the **HP / AP** code paths and the **CP / POWER**
  economy implied by `skirmish-concept.png`; the **enemy-telegraph / forecast**
  mechanic *as a core identity* (that was the Into-the-Breach framing — it may
  survive only as optional, occasional board flavor, never the spine); the
  README's "anchors / telegraphs / six breaches" flavor line.
- **Gap to close for a real prototype:** the live skirmish currently runs
  *last-side-standing without check*. The baseline this doc mandates — **real
  check / checkmate** — is **not yet implemented**, and is the foundational
  gameplay work.

## 13. v1 scope — the first cut

The first prototype stays deliberately minimal (pillars §3). Resolved scope:

1. **Rules:** full standard chess — castling, en passant, promotion, stalemate,
   and the 50-move / threefold-repetition draws.
2. **Win condition:** standard **king checkmate only.** The fluid-royal variants
   (two kings, queen-as-king, king-with-lives, …) are a later expansion.
3. **Squads:** **authored per board.** No player drafting yet.
4. **Tactics:** **not surfaced** to the player and not a near-term concern — no
   motif hints or teaching in v1.
5. **Solo Skirmish:** **mostly fixed boards, with a random-setup option.**
6. **AI:** a **simple, braindead first pass** (greedy / legal-move play). The richer
   engine directions live in issue #25 and §10 as the longer-term arc.

**Deferred (post-v1, not precluded):** fluid royal / win conditions; mutating or
cursed terrain and pieces; named-tactic surfacing; a competent search-based AI;
player-drafted squads; roguelike / meta-progression.
