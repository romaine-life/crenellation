---
status: "accepted"
date: 2026-06-29
deciders: Nelson, Claude
---

# ADR-0045: Units deploy onto the board with a staggered drop-in, not a flat appear

At skirmish start the armies just *appeared* on their squares — the board summoned and every
unit was simply there, with no entrance and no turn-taking tempo. This gives the start a
deliberate, readable deployment beat. Scoped to the board's unit ENTRANCE at game start; the
per-move hop (its own thing) and the deferred landing effect/sound are out of scope here.

## Context and Problem Statement

The board now reveals as one coordinated unit (the popcorn fix — `boardReady` gates a single
veil/board reveal). But the units inside that reveal still just popped into place. There was
no choreography and no signal of whose turn it is.

Research across the tactics genre + the game-feel canon (multi-agent web sweep, cited below)
landed on a clear convention: heavy tactics (Final Fantasy Tactics, Tactics Ogre, Into the
Breach) **appear units in place** — they do not walk on. The craft is choreographing that
appearance into a deliberate *deployment*, not inventing walk-on locomotion the pixel sprites
have no frames for. The juice canon adds: a satisfying arrival builds speed and lands with
weight (anticipation → accelerate → impact squash).

## Decision Drivers

- Make the start read as authored deployment, using art/data already in hand (the move-hop
  machinery, the per-side palette, each piece's `startY` home edge, the `boardReady` reveal).
- Order should TEACH (mine-vs-theirs, turn-taking) — order is communication, not decoration.
- Never gate play on a cosmetic sequence.
- Honor reduced-motion **correctly** — without the OS false-positive (Windows "Animation
  effects" off → Chrome `reduce`) hiding the deploy from the maintainer and many players (the
  finding already recorded in [ADR-0043](0043-ui-motion-system.md) §C).

## Decision Outcome

**Units deploy in a staggered wave: each unit SPAWNS hovering above its own square (fading in,
motionless), then DROPS under gravity into a thud (impact squash).**

- **Order is communication.** The player force lands first (home row → forward), then the
  enemy answers from its edge, each wave ending on its royal piece (king/queen) as a focal
  accent — so the motion alone teaches mine-vs-theirs and turn-taking before turn 1. Order is
  computed from each piece's `startY` home edge (`computeArrivalDelays`). Neutral rocks are
  scenery, not deploying units → no drop.
- **Presentation-only.** Board state and input are live the instant the skirmish is ready;
  final positions are known up front, so the sequence never gates play and is trivially
  skippable/jump-to-end. (This also kills the "replays on every skirmish start" cost concern.)
- **Plays exactly once, for the real board.** It fires on the coordinated reveal, and the
  board now MOUNTS only once this screen has decided which game to play (`boardSettled` in
  `Skirmish.tsx`). The store ships a populated *placeholder* game (`store.ts` `INITIAL_GAME`),
  so mounting before that decision rendered the placeholder, then again when `newSkirmish`
  swapped in the real seed — the deploy played twice, the second time at the new positions.
  Gating the mount fixes that.

### A. Departure from ADR-0043 §B — a fall ACCELERATES

ADR-0043 makes UI entrances DECELERATE (`--ds-ease-out`, emphasized-decelerate): a surface
arriving settles, it "never accelerates in." The deploy drop deliberately does the OPPOSITE —
it accelerates (gravity ease-in) into an impact squash — because it is a physical FALL, weight
hitting ground, not a chrome surface arriving. The squash compresses onto the feet
(`transform-origin: center bottom`); there is no upward bounce (a thud, not a jiggle).

### B. Scope — board-unit motion is game-world physics, outside the UI motion token ladder

ADR-0043's `--ds-duration-*` ladder (100/150/300ms) governs UI CHROME and explicitly excludes
bespoke/decorative motion (rain, threat-pulse, the route veil). Board UNIT motion is in that
same excluded class: the move-hop (360/460ms, bespoke arcs) and now the deploy (~620ms fall,
staggered into a ~1.2s wave) are tuned by physical feel, not the chrome ladder. They share a
motion FAMILY (anticipation / settle / impact), not the chrome tokens.

### C. Reduced-motion — the drop is the DEFAULT; reduced is an explicit opt-in

ADR-0043 §C already records that many players (this maintainer included) run Windows with
animation effects off, which Chrome reports as `prefers-reduced-motion: reduce` — a FALSE
positive. Gating the deploy on that OS query would hide it from the very people tuning it. So
the drop is `!important` (clears the global `* { animation: none }` OS-reduce reset,
style.css ~6036) and plays for everyone by default. Reduced motion is instead an EXPLICIT
in-game choice: `:root.reduce-motion` swaps the fall for a calm, still-staggered fade-in-place
— movement removed, order kept (exactly ADR-0043's "gate movement, not opacity"). The
**Settings toggle that sets that class is a follow-up.**

### D. Hooks for sound + landing effect (deferred)

The land impact is a defined moment (~85% of the keyframe ≈ `arrival-delay + ~525ms` per
unit), marked in `style.css` and `SkirmishBoard.tsx`. That is where two deferred pieces hook:
1. the landing **sound cue** — needs a new SFX layer (only `bgm.js` exists today);
2. the per-tile **landing effect** (dust on soil, splash on water, chips on stone) — authored
   sprite art per family per [ADR-0040](0040-feature-tiles-own-geometry-generate-material.md)
   (generated material, never CSS), via the grass-patches sprite pipeline.

## Consequences

- Good: the start reads as authored deployment; turn-taking is established before turn 1;
  one motion family with the move-hop; reduced-motion handled without the OS false-positive
  hiding it; cheap (reused the hop machinery + `boardReady` gate + `startY`).
- Cost: a board-unit motion family lives outside the chrome token ladder (acceptable — it's
  physics, like the move-hop); the reduced path needs a Settings toggle to be reachable
  (follow-up); the thud is currently silent and dustless until the deferred hooks land.

## More Information

- Builds on / relates to: [ADR-0043](0043-ui-motion-system.md) (UI motion — departs on accel
  for a physical fall; reuses its reduced-motion false-positive finding); the board's
  coordinated reveal (`render/boardArtReady.ts`); [ADR-0040](0040-feature-tiles-own-geometry-generate-material.md)
  (generated material for the deferred landing effect).
- Research (verified, multi-agent sweep): appear-in-place deployment convention — Into the
  Breach, [Fire Emblem Preparations](https://fireemblemwiki.org/wiki/Preparations); staging /
  stagger order as communication — [Material — choreography](https://m1.material.io/motion/choreography.html);
  impact weight (squash, build-up) — Vlambeer "The Art of Screenshake"; reduced-motion as a
  movement concern + honor it — [WCAG 2.3.3](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html).
- Code: `computeArrivalDelays` + the `is-arriving` gate in `frontend/src/render/SkirmishBoard.tsx`;
  the `unit-arrival` / `unit-arrival-soft` keyframes in `frontend/src/style.css`; the
  `boardSettled` mount gate in `frontend/src/ui/Skirmish.tsx`.
