---
status: "accepted"
date: 2026-06-27
deciders: Nelson, Claude
---

# ADR-0032: No bland HTML/CSS — every visible surface in the app is the game's kit

The universal version of the kit rule. [ADR-0002](0002-nine-slice-border-image-for-pixel-art-chrome.md)
(9-slice mechanism), [ADR-0011](0011-chrome-art-generated-not-extracted.md) /
[ADR-0012](0012-nine-slice-frames-are-atom-assembled.md) (sources are generated or
atom-assembled) and [ADR-0014](0014-ui-chrome-low-fidelity-aesthetic.md) (low-fi
look) all govern "chrome" — but nothing states the blanket rule, so plain
hand-rolled CSS boxes keep reappearing on every new surface. This ADR makes it
absolute and app-wide. It is the visual-surface peer of [ADR-0024](0024-ui-typography-system.md)
(all text → type tokens) and [ADR-0031](0031-ui-spacing-system.md) (all spacing →
space tokens).

## Context and Problem Statement

We have a real kit (registry 9-slice frames: `panel` / `mode-button` / `row`, plus
generated sprites), and ADRs that say chrome must use it — yet bland, unstyled
`<div>`-with-a-CSS-`border`/`background`/`gradient` boxes persist everywhere, and a
new one appears whenever a feature is added. Live examples on the skirmish HUD alone:
the **portrait frame**, the five **service-record stat cells**, the **status chips**
(turn / objective), the **roster slots**, and the **board's own frame**
(`.skirmish-field`) — all hand-rolled CSS surfaces sitting next to real kit frames,
which is why edges don't align and the UI reads as half-finished. The owner's
standing standard is blunt: **nowhere in the app should there be just ordinary
HTML/CSS elements** dressed up as surfaces.

## Decision Drivers

- One blanket rule, so "is this allowed?" never has to be re-litigated per surface.
- Stop the entropy where every new feature ships another bland box.
- The kit already exists — using it everywhere is the whole point of having it.

## Decision Outcome

**Every visible surface in the app is rendered with the kit. There are no bland
HTML/CSS surfaces anywhere.**

A "visible surface" is anything the eye reads as a panel, box, card, button, chip,
tile, frame, or well — i.e. anything given a **background fill, border, frame, or
surface shadow** to make it look like an object. Every such surface must be a kit
9-slice frame (registry `panel` / `mode-button` / `row` via `border-image`) or a
generated/atom-assembled sprite (ADR-0011/0012). **Fabricating a surface with raw
CSS** — `background`/`border`/`border-radius`/`box-shadow` hand-tuned to look like a
box — **is not allowed, anywhere, no exceptions.**

### The test

> Does the user perceive this element as a surface/box/button? → it must be a kit
> frame. Is it invisible structure or text? → it's fine as plain CSS.

### What is NOT a surface (legitimately plain — not a violation)

- **Layout containers** — `display: flex/grid`, gaps, alignment, sizing on an element
  with **no** background/border/frame. Invisible scaffolding is fine (and spacing
  comes from the tokens, ADR-0031).
- **Text** — typography is its own system (ADR-0024); text isn't a surface.
- **The board/scene render** and sprites — game art, not chrome.
- A genuinely new surface type the kit lacks a frame for is **not** an excuse for raw
  CSS: add the frame to the registry (atoms → bake, ADR-0012) and use it. "No frame
  yet" means *make the frame*, not *hand-roll a box*.

### Consequences

- Good: one rule kills the bland-box class of defect; surfaces share the kit's edges
  so they align by construction; the kit earns its keep.
- Cost: a real migration — every existing raw-CSS surface converts to a kit frame
  (tracked as the standing cleanup; new code complies from now). Some need a new
  registry frame first (e.g. a navy in-game panel for the board/HUD) before they can
  convert — that's frame work, not a license to stay raw.
- Honest current state (2026-06-27): NOT yet enforced by lint and NOT yet fully
  migrated — known live violations include the skirmish portrait frame, service-record
  cells, status chips, roster slots, and the board frame. This ADR is the standard
  they're measured against; conversion is ongoing.

## More Information

- Generalizes: [ADR-0002](0002-nine-slice-border-image-for-pixel-art-chrome.md),
  [ADR-0011](0011-chrome-art-generated-not-extracted.md),
  [ADR-0012](0012-nine-slice-frames-are-atom-assembled.md),
  [ADR-0014](0014-ui-chrome-low-fidelity-aesthetic.md). Peers:
  [ADR-0024](0024-ui-typography-system.md) (text), [ADR-0031](0031-ui-spacing-system.md) (space).
- Kit: registry `frontend/config/nine-slice-registry.json` → `panel.png` /
  `mode-button.png` / `row.png` in `public/assets/ui/kit/`; apply via `border-image`.
- Enforcement intent: a lint rule flagging `background`/`border`/`box-shadow` that
  fabricate a surface on non-kit elements (peer of the spacing/type lints), once the
  migration has a shrinking violation list.
