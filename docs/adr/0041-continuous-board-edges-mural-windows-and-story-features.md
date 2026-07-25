---
status: "accepted"
date: 2026-06-29
deciders: Nelson, Claude
---

# ADR-0041: Continuous board edges — mural windows + multi-tile story features

## Context and Problem Statement

ADR-0039 made a tile's SIDE an independent layer, and the first cliff art picked a
RANDOM anti-adjacent side variant per void-facing cell. On a real board edge that read
as the same stamp repeated tile-to-tile ("grass starts at random spots") — each tile's
geology restarted independently, so a long run never felt like one cliff, and there was
no way to put a multi-tile set-piece (an exposed dino skeleton, buried ruins) across the
edge the way StarCraft-1 terrain does.

We want two things on the perimeter cliff:
1. a **continuous** base — geology that flows across adjacent tiles, not a repeating stamp;
2. occasional **story features** — set-pieces that span several tiles and don't feel
   grid-locked, and that **terminate cleanly** when they would run off the edge (never a
   sliced-through neck).

The art method is settled (codex — pixellab was off-palette, a Blender photoscan was a
photoreal "C"; the user compared all three on-board).

## Decision

**Both layers are ordered slices of ONE wide codex image, projected per ADR-0039.**

- **Continuity murals (base).** `forge-mural.mjs` generates one WIDE codex cliff
  cross-section per family (1536×1024); `build-mural-edges.py` slices it into N ordered
  windows and projects each onto the two iso faces (a generalised rectangular projection +
  the ADR-0039 lighting contract), masked to the frayed silhouette. Three murals are
  **pooled into one ordered 48-window bank** so every generated mural is used and no
  realistic edge repeats a window. The solver hands **consecutive edge cells consecutive
  windows**, so the cliff flows; consecutive windows are adjacent columns of the same
  image, so they meet at a shared column. The run **wraps the bottom corner** — the right
  edge (`p = y`) continues into the bottom edge (`p = rows-1 + (cols-1 - x)`) as one count.

- **Story features (overlay).** A feature (dino fossil, buried ruins) is the SAME pipeline:
  a wide set-piece image sliced into ordered `pieces` + a square `cap`. It is NOT a new
  render layer — the solver simply **overrides the mural `sideAsset`** for the cells it
  occupies. Features are laid sparsely **head→tail along a STRAIGHT edge only** (the corner
  is never crossed — a rigid skeleton can't bend it). When a feature would run off the edge
  before completing, its clipping piece is swapped for the `cap` **terminator** — a clean,
  intentional cross-section cut, never a torn mid-bone. Features are family-gated (soil
  families for the fossil/ruins).

Solver surface (`solveSocketBoard`): `muralEdges` (per-family ordered window bank) supersedes
the random `edgeAssets` for any family present; `edgeFeatures` (a list of
`{ pieces, cap, families }`) overlays set-pieces. Both only touch `sideAsset` — top, sockets,
terrain and legality are untouched.

## Consequences

- A board edge reads as one continuous, varied cliff, with the occasional fossil/ruin
  embedded in the strata; the terminator keeps cut features looking deliberate.
- Adding a family = generate murals + bake a bank; adding a feature = generate a wide
  body + a cap, bake, register a spec. No new render code.
- The iso staircase means horizontal strata step down ~27px per tile rather than forming
  perfectly level lines; the flowing CONTENT (roots, cracks, bones, colour) carries the
  continuity, which is the goal — not pixel-level strata registration.
- Water is excluded (its edge is the gated waterfall). Builds on ADR-0039 (composable
  layers) and ADR-0011 (generated, not code-drawn, art).
