---
status: "accepted"
date: 2026-06-25
deciders: Nelson, Claude
---

# ADR-0002: Render chrome via 9-slice border-image of a source PNG

## Context and Problem Statement

The app's pixel-art chrome (panels, buttons, rows, tabs, bars) must scale to any
element size while preserving hand-authored detail (gold corner brackets, bevels).
Framing was previously done six different ways across screens — baked full-frame
stretches, `background-size: 100% 100%`, flat CSS — producing distortion and
per-screen drift. We had to choose one rendering mechanism.

## Decision Drivers

- Preserve the artist's exact pixels (in pixel art, the look *is* the pixels).
- Scale one source to any size without distorting the corners.
- One mechanism for the whole app; no per-surface reinvention.
- Must be feasible in a 2D browser app.

## Considered Options

- **9-slice via `border-image`** of a single source PNG (corners fixed; edges and
  center tiled/stretched at runtime by the browser).
- **Live runtime composition** from separate corner/edge/fill atoms placed and
  rotated via DOM/CSS, with no combined source image.
- Baked full-frame crops stretched with `background-size: 100% 100%` (status quo).

## Decision Outcome

Chosen: **9-slice via `border-image` of a source PNG**. The source is either
extracted from the accepted concept art or assembled from atoms at build time;
patch margins live in a manifest; one shared `<Frame>` renderer emits the rule;
chrome is never reconstructed with bespoke CSS.

Live atom composition was considered and **rejected for pixel-art chrome**: it
still uses PNGs (atoms are bitmaps), buys no resolution-independence we actually
want (we want fixed chunky pixels, not smooth scaling), and costs more markup/CSS
(rotating one corner into four) for an identical visual result. The status-quo
full-frame stretch is rejected outright — it distorts detail.

### Consequences

- Good: one mechanism; crafted detail preserved; scales cleanly
  (`border-image-repeat: round` tiles edge art without smearing).
- Cost: the runtime input is a single combined source PNG, which can feel like a
  "baked artifact" — but it is a regenerable artifact, not the source of truth
  (the atoms / concept art are).

## More Information

- **Refined by [ADR-0011](0011-chrome-art-generated-not-extracted.md):** the 9-slice *source* is **generated** (codex, method-verified) or atom-assembled — **not** "extracted from the concept art" as this record's outcome loosely allowed.
- Consolidated current-state: [`../ui-kit-standard.md`](../ui-kit-standard.md) ("The decision").
- 9-slice scaling: https://en.wikipedia.org/wiki/9-slice_scaling
- CSS `border-image` (W3C CSS Backgrounds and Borders Module Level 3).
