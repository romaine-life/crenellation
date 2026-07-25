---
status: "accepted"
date: 2026-06-29
deciders: Nelson, Claude
---

# ADR-0043: UI motion is one tokenized system — a duration scale + easing tokens

The motion counterpart to [ADR-0024](0024-ui-typography-system.md) (typography is one
tokenized system) and [ADR-0031](0031-ui-spacing-system.md) (spacing is one tokenized
system). Where those make the `--ds-text-*` and `--ds-space-*` layers the law for type and
space, this ADR makes a `--ds-duration-*` / `--ds-ease-*` layer the law for *time* — how
long transitions run and how they accelerate. Scoped to UI transition/animation timing;
continuous decorative loops (rain, threat-pulse, reticle-glow) and the route-veil dissolve
keep their own bespoke timing for now (see migration).

## Context and Problem Statement

There was **no motion system** — not even an orphaned scale. An audit of `style.css` found
**~9 distinct hand-tuned durations** (80, 100, 120, 150, 170, 200, 300ms, plus the 1.1s /
1.5s decorative loops) and **zero shared duration/easing tokens**. Every transition re-picks
its own ms and curve.

This bit us immediately. Adding the Settings menu crossfade ([#244](https://github.com/romaine-life/chess-tactics/pull/244))
raised the obvious question — *"is it the same fade speed as the other fades?"* — and the
answer was no: the crossfade shipped at an ad-hoc **150ms** while the only other dedicated
opacity fade in the app (`.bgm-control`) was **200ms**. Two fades, two speeds, no reason.
Same disease 0024 fixed for type and 0031 fixed for space: every element eyeballs its own
value, so nothing is consistent and there's no one knob to tune feel.

## Decision Drivers

- One place to tune motion feel, not ~9 scattered literals.
- Kill "every transition hand-picks its own ms + curve" entropy (the 0024/0031 disease).
- Ground the values in the canon (durations + easing), not taste, so the scale is defensible.
- A real, named answer to "what speed is a fade / an entrance here?"
- Honor motion-reduction — but correctly: a pure opacity fade is not the kind of motion that
  reduce-motion is about, and a large share of players (this maintainer included) run with
  Windows "Animation effects" off, which Chrome reports as `prefers-reduced-motion: reduce`.

## Decision Outcome

**All UI transition timing is set through motion tokens. Raw ms + bespoke `cubic-bezier`
on a `transition`/`animation` for interactive UI is not allowed** (mirrors 0024 for type,
0031 for space). Continuous/decorative loops are out of scope (see migration).

### A. Two durations — instant-feedback vs fade (ONE fade speed)

- `--ds-duration-fast: 100ms` — **instant feedback**: hover, focus, toggle, filter/color swap.
- `--ds-duration-fade: 350ms` — **every fade/crossfade**: screen entrances AND in-panel
  control swaps share this ONE fade speed.

**A fade does not vary by surface here.** The canon (Material's "duration grows with surface
area") argues for a tiered fade scale, and an earlier draft of this ADR split fades into a
150ms `base` and a 300ms `slow`. That was **overruled** (2026-06-29): a fade reading at two
different speeds in different spots was the exact inconsistency we set out to kill, so all
fades resolve to the single `--ds-duration-fade`. (`--ds-duration-fade` is one knob — tune the
one value to retime every fade at once.) `fast` stays a separate, snappier tier because
hover/toggle feedback is an *instant state change*, not a fade — matching it to the fade speed
would make the UI feel laggy. ADR-0046's choreography assumes this single fade speed.

### B. Easing tokens — name the intent, don't paste a bezier

- `--ds-ease-standard: cubic-bezier(0.2, 0, 0, 1)` — in-place state changes (Material standard).
- `--ds-ease-out: cubic-bezier(0.05, 0.7, 0.1, 1)` — **entrances** (Material emphasized-
  decelerate): motion starts fast and *settles*. Entrances decelerate; they never accelerate in.
- `--ds-ease-linear: linear` — pure opacity crossfades (a fade reads fine linear).

### C. Reduced-motion policy — gate movement, not opacity

`prefers-reduced-motion: reduce` targets **movement** (translate / scale / parallax / zoom),
which can trigger vestibular discomfort. A **pure opacity fade has no movement**, so it is
reduced-motion-safe and is **intentionally NOT gated**. This is not pedantry: many players run
Windows with animations off (Chrome reads that as `reduce`), and gating opacity fades made the
settings crossfade silently dead for them. Transform/translate/scale motion **must** still be
reduced under `reduce`. (The global `* { animation: none !important }` already disables
keyframe `animation` under `reduce` but NOT `transition`; opacity transitions are the
deliberately-surviving path.)

### D. Mandate, first consumers & migration

1. Interactive UI transitions resolve to a duration token + an easing token. No raw ms /
   bespoke bezier on `transition` (allow `0s`).
2. **First consumers:** the settings menu crossfade, the screen-entrance fade (ADR-0046), and
   `.bgm-control`'s show/hide fade all resolve to `--ds-duration-fade` — one fade speed across
   all of them (the "same fade speed?" fix, taken to its conclusion).
3. **Staged migration** (the 0024/0031 model): the remaining ~hand-tuned transitions migrate
   to tokens over time; a lint rule can land once the bulk is converted. Out of scope:
   continuous decorative loops (rain/threat-pulse/reticle-glow) and the `.route-veil` cross-
   screen dissolve (its 260/340ms cover/reveal is its own choreography — fold it in later).

### Consequences

- Good: one knob for motion feel; fades are finally consistent (the user's question now has a
  one-word answer — yes); entrances have a real, canon-grounded speed/curve; the reduced-motion
  trap is closed by policy; motion joins type (0024) and space (0031) as a live token layer.
- Cost: a staged migration of existing transitions + a lint rule to add later; `base` (150) and
  PANEL_FADE_MS in `Settings.tsx` must stay in sync by hand (the JS that times the content swap
  can't read the CSS var at module load — noted at both sites).

## More Information

- Siblings: [ADR-0024](0024-ui-typography-system.md) (type system), [ADR-0031](0031-ui-spacing-system.md)
  (space system); surface split: [ADR-0006](0006-ui-decision-criteria.md).
- Token layer: `--ds-duration-*` / `--ds-ease-*` in `frontend/src/style.css` `:root`.
- Research (verified): duration ladder + easing curves — [Material 3: Easing & duration tokens](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)
  (short 50/100/150/200, medium 250/300/350/400, …; standard `(0.2,0,0,1)`, decelerate
  `(0,0,0,1)`, emphasized-decelerate `(0.05,0.7,0.1,1)`), cross-checked against the
  [material-components-android Motion docs](https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md).
  Concrete mobile/desktop numbers (entrances 225ms, desktop 150–200ms, >400ms feels slow) —
  [Material 1: Duration & easing](https://m1.material.io/motion/duration-easing.html).
  Response-time thresholds (100ms instant, 1s flow limit) — [NN/g: Response Times](https://www.nngroup.com/articles/response-times-3-important-limits/).
  Practitioner synthesis (small UI 200–300ms, large 400–500ms, the ~230ms perception floor) —
  [Val Head: How fast should your UI animations be?](https://valhead.com/2016/05/05/how-fast-should-your-ui-animations-be/).
  Reduce-motion as a movement concern + honor the setting — [Apple HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion).
