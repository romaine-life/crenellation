---
status: "accepted"
date: 2026-06-26
deciders: Nelson, Claude
---

# ADR-0009: Settings mode buttons built from atoms; retire extracted tab crops

Implements the kit standard ([ADR-0002](0002-nine-slice-border-image-for-pixel-art-chrome.md))
for the settings left-nav, and re-establishes a framed treatment after a prior
session flattened it.

## Context and Problem Statement

The settings section nav ("GENERAL / AUDIO / …") had been flattened to a generic
fill + accent bar in an earlier session. Restoring the framed look surfaced a
deeper defect: the framing assets `tab-active.png` / `tab-inactive.png` were
**extracted crops from the concept art** (the generator says so), top-bottom
asymmetric (mirror diff 5.85) and, for the active one, 1042 colours — so a
9-slice of them renders lopsided, unequal-armed brackets. They were never built
like the other chrome.

## Decision Drivers

- The kit standard: chrome composes from atoms / clean 9-slice sources, never
  dirty extractions.
- "Built like the other elements" — symmetric by construction, as `panel.png` is.
- Match the concept (gold brackets inactive, cyan brackets active).
- Don't cut corners (an earlier cheap recolor suggestion was explicitly rejected).

## Considered Options

- Keep the extracted `tab-*` crops (status quo) — asymmetric, off-system.
- Gold atom-frame for both states, active shown via a cyan glow (no cyan brackets).
- **Atom-assembled gold frame + a cyan frame from a deliberate palette swap.**

## Decision Outcome

Chosen: **assemble the mode-button frame from the kit atoms**, exactly like
`panel.png` — symmetric by construction. Two frames:

- `mode-button.png` — gold brackets (inactive).
- `mode-button-active.png` — cyan brackets (active), produced by a **deliberate,
  luminance-matched palette swap** of the corner atom's 4 gold ramp colours to a
  cyan ramp (navy structure untouched). This is an indexed swap on a clean
  7-colour sprite — the same technique used for unit team colours — **not** a hue
  filter (which was rejected as the cheap path).

The extracted `tab-active`/`tab-inactive` crops are **retired** (deleted; removed
from the kit manifest). `.settings-tab` border-images the atom frame and swaps to
the cyan frame when `.is-active`.

### Consequences

- Good: symmetric brackets by construction; on-system; gold/cyan matches the
  concept; reproducible via `scripts/generate-mode-button.mjs`.
- Cost: a new generator + two committed assets; `assemble-frame.mjs` gained a
  `buildFrameFrom()` export so generators can pass recoloured atoms.

## More Information

- Build: `scripts/assemble-frame.mjs` (`buildFrameFrom`), `scripts/generate-mode-button.mjs`.
- Palette: corner gold ramp `faefbb/c79b55/a7793d/5b4124` → cyan `d6f4ff/4fbdf0/2f93dd/14507f`.
- Evaluated live in `/artwork-compare` (ADR-0005) against the concept before landing.
