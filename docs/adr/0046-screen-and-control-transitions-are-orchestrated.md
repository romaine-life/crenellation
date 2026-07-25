---
status: "accepted"
date: 2026-06-29
deciders: Nelson, Claude
---

# ADR-0046: Screen & control transitions are one orchestrated system

The behaviour layer on top of [ADR-0043](0043-ui-motion-system.md). Where 0043 sets the
motion *tokens* (how long, what curve), this ADR sets the *choreography*: when transitions
fire, how they sequence, and what can be touched while they run. It exists because the same
fade was being reinvented per screen, with inconsistent — and sometimes broken — results.

## Context and Problem Statement

There is **no consolidated transition layer.** Navigation itself is centralized (every route
change funnels through `navigateApp()` → `setPath()` → `renderRoute()` in `App.tsx`), but the
transitions layered on top are scattered and contradictory:

- The cross-route **veil** dissolve runs for *heavy routes only* (`/play`, editors).
- The settings tab **crossfade** runs *inside settings only*.
- The **cold-load reveal** runs *only on a fresh main-menu load*, and it fires each element's
  fade *reactively as that element's asset finishes loading* — load-order-dependent, not a
  designed rhythm.
- The settings **entry fade** ran *settings only*; light hops (menu↔settings) faded one way
  and snapped the other.

So adding/removing a button or a screen means re-deriving the `mounted`-state + `requestAnimationFrame`
+ CSS dance every time, and two screens that should feel identical don't. (It also produced a
production incident — a bare `.settings-shell { opacity: 0 }` blanked the main menu, which
reuses that class.)

## Decision Drivers

- One built-in primitive, not a per-screen reinvention.
- A *designed* rhythm (buffered, sequenced) — never "fade whatever just loaded."
- No transition may strand a fixed background or break a screen's layout (the two recent
  incidents) — so the primitive must not restructure the DOM or style shared chrome classes.
- The ambience backdrop (rain) is continuous across screens and must NOT fade on navigation.

## Decision Outcome

**All screen-entrance and in-screen control transitions go through shared, tokenized
primitives that obey one choreography. Per-screen ad-hoc fade state is not allowed.**

### A. Consistent timing — ONE fade speed (from ADR-0043)

Every fade draws the SAME duration + easing from the 0043 tokens: `--ds-duration-fade` +
`--ds-ease-standard`. A screen entrance and an in-panel control crossfade are the *identical
fade* — fades do not vary by surface (the explicit product decision; it overruled an earlier
entrance-slower-than-control split). One knob (`--ds-duration-fade`) retimes everything. A new
**stagger token** `--ds-stagger` (≈ 50ms) sets the gap between sequenced reveals.

(The settings tab crossfade is a true **overlap** — the outgoing panel and incoming panel are
stacked in one grid cell and fade simultaneously (old 1→0 while new 0→1) over a *single*
`--ds-duration-fade` pass, not a sequential out-then-in. So a tab change and a screen entrance
take the same wall-clock, not 2×. If a crossfade ever needs a faster value, change
`--ds-duration-fade` — never give the crossfade its own duration.)

### B. The primitive is a hook on the screen's CHROME root — not a route wrapper

A shared `useScreenEntrance()` hook returns the entrance class a screen spreads onto its
**chrome root** (`.settings-shell`, the main-menu screen, etc.). It is NOT a wrapper at the
`renderRoute()` boundary, for two reasons: (1) a wrapper would fade the whole screen including
the **ambience backdrop**, which must stay continuous across navigation; (2) wrapping the
heterogeneous, often `position:absolute` screen roots risks layout/positioning regressions.
The hook adds **nothing** to the DOM and styles only the element the screen already owns —
never the shared `.shell` / `.settings-shell` / `.settings-tab` classes (the leak that blanked
the menu). Adding a button to a screen needs no transition work; the screen-level entrance
already covers all its controls.

### C. Buffered choreography — a designed rhythm, never reactive-to-load

1. A transition is fired by ONE explicit trigger (a navigation/selection), **never reactively
   per asset-load.** Readiness and reveal are decoupled: wait until content is ready, then play
   one deterministic reveal. *(The cold-load main-menu reveal — which fades each element as its
   image decodes — is named as the violating anti-pattern; it is mitigated in a follow-up.)*
2. *Within* a sequence (e.g. a row of buttons), elements reveal on the `--ds-stagger` cadence
   in fixed order, not load order.
3. *Between* transitions, a new one cannot begin until the current one fully settles; a
   control crossfade is `out → (buffer) → in`, never overlapping.

### D. Inert during motion

Any surface that can trigger a transition is non-interactive (`pointer-events: none`) from the
trigger until the sequence settles — you cannot start a new transition mid-transition. This is
the enforcement mechanism for C.3 (and it retires the rapid-tab-click race we hand-patched). A
mid-transition trigger is queued as the last target rather than dropped, so input never feels
deaf.

### E. Reduced-motion

Opacity fades are **not** gated on `prefers-reduced-motion` (the ADR-0043 policy — pure
opacity has no movement; many players run Windows animations off, which Chrome reads as
`reduce`). The inert-during-motion rule still applies (just near-instant), so behaviour is
identical with or without animation.

### F. Route-veil reconciliation

The veil remains the **heavy-route loading mask** (it lets a weighty chunk compose under an
opaque field). `useScreenEntrance()` is the **light-route entrance**. They are mutually
exclusive per route (heavy routes don't also run the hook fade), so nothing double-fades.
Folding the veil into the same token/choreography vocabulary is a follow-up.

### G. Persistent backdrops are app-continuous — they never re-fade

The ambience (the homepage art background + synced rain) is shared by every art-background
screen (main menu, settings, and the other light screens). It is **continuous**: navigating
between two art-background screens must NOT re-fade or blink it. This is guaranteed
structurally — the ambience lives OUTSIDE every faded chrome root (it is a sibling of the
chrome the hook fades, and its live canvas re-parents across the swap), so the entrance fade
can only ever touch the incoming screen's chrome, never the backdrop. This is the hard
constraint that rules out a whole-screen wrapper (B) and is non-negotiable: any future
consolidation (incl. folding in the veil, F) must preserve it.

### Consequences

- Good: one built-in fade, one rhythm; adding a button/screen inherits the behaviour; the
  menu↔settings asymmetry is gone; the leak/layout failure modes are excluded by construction
  (no DOM restructure, no shared-class styling).
- Done since the first cut: the settings tab crossfade now **overlaps** into one pass (not 2×);
  the campaign editor uses `useScreenEntrance()` instead of a hand-rolled entrance; every chrome
  fade resolves to `--ds-duration-fade`.
- Remaining staged follow-ups: migrating the **cold-load reveal** to the orchestrated model
  (with `--ds-stagger`); unifying the **route-veil** into the same vocabulary.

## More Information

- Sits on: [ADR-0043](0043-ui-motion-system.md) (motion tokens). Siblings: [ADR-0024](0024-ui-typography-system.md),
  [ADR-0031](0031-ui-spacing-system.md).
- Primitive: `useScreenEntrance()` in `frontend/src/ui/shell/`; tokens in `style.css` `:root`.
- Choreography canon (verified): Material 3 motion — coordinated/sequenced transitions +
  stagger ([Material 3: Transitions / choreography](https://m3.material.io/styles/motion/transitions/transition-patterns));
  don't let entrances accelerate, honour reduce-motion ([Apple HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion));
  keep the whole sequence well under the 1s flow limit ([NN/g: Response Times](https://www.nngroup.com/articles/response-times-3-important-limits/)).
