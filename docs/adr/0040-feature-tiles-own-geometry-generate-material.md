---
status: "accepted"
date: 2026-06-28
deciders: Nelson, Claude
---

# ADR-0040: Board/feature tile art — own the geometry, generate the material (no code-drawn art)

Extends [ADR-0011](0011-chrome-art-generated-not-extracted.md) (art is generated,
not code-drawn) from UI chrome to the **board**, and applies the surface-swap
pipeline ([tile-asset-roadmap.md](../tile-asset-roadmap.md)) to the new class of
**connection / linear-feature tiles** (roads now; rivers, walls, fences, tracks
later). Complements [ADR-0039](0039-tile-top-and-side-are-composable-layers.md)
(top/side are composable layers — the side is where a river's waterfall will live;
this record governs how the feature OVERLAY itself is produced). Sibling of
[ADR-0032](0032-no-bland-html-css-every-surface-is-kit.md)
(every visible surface is generated/kit, never raw treatment).

## Context and Problem Statement

Roads were added as a connection-autotile feature: you draw a path and each cell
picks its piece from a 4-bit neighbour mask (`core/featureAutotile.ts`). These
pieces **must tessellate seam-perfect** across the isometric grid — a corner in
one tile has to meet its neighbour's stub exactly on the shared diamond edge.

That tessellation requirement is real and it pushed the first implementation into
the wrong place: the 16 road sprites were first **code-drawn** — flat hardcoded-RGB
polygons filled in PIL (the script later renamed `scripts/build-feature-tiles.py`).
That was waved past
ADR-0011 by arguing 0011 is "chrome-scoped." It is — but the project's *standing
bar* is properly generated/sourced art (ADR-0011 retired procedural/code redraw
"with NO exceptions"; ADR-0032 generalized "every surface is generated/kit, no
raw treatment"). Nothing blesses code-drawing pixels anywhere, and the one time
it was weighed it was rejected. The board had simply never been written down, so
an agent fell into the gap. This record closes it.

## Decision Drivers

- **Tessellation is non-negotiable** for connection tiles; per-piece AI generation
  drifts and breaks seams, so naive "just generate each sprite" does not work.
- **The project art bar forbids code-drawn looks** (ADR-0011 / ADR-0032); a flat
  RGB fill is exactly that.
- **Discoverability** — ADR-0025's lesson: a decision that lives only in working
  docs gets missed and agents improvise. Board-feature art must be in the ADR trail.
- **Recurrence** — rivers and other linear features will hit the identical tension.

## Considered Options

- **A. Generate each connection sprite per-piece** (16 per feature, via codex/PixelLab).
- **B. Code-draw the sprites procedurally** (flat fills / polygons — what shipped).
- **C. Own the geometry, generate the material** — compute the connection footprint
  deterministically, stamp a properly-generated flat material into it.

## Decision Outcome

Chosen: **C.** Draw a hard line between **geometry** and **material**:

- **Geometry** — the footprint, mask, placement, and compositing of a tile — **may
  be computed/deterministic.** It is structure, not art. The canonical tile
  template (`generate-tile-template.mjs`) and the Blender-derived iso edge already
  establish this: code is allowed to decide *where* art goes.
- **Material** — the painted surface a player sees (its colour and texture) — **must
  be properly generated** through the method-verified pipeline (codex img2img /
  PixelLab top-down, per [ADR-0011](0011-chrome-art-generated-not-extracted.md) and
  the surface-swap note in memory `pixellab-iso-angle-mismatch`). **Never code-drawn
  (flat RGB fills, gradients, hand-mixed colour).**

So connection/feature tiles follow the **same surface-swap shape as base tiles**:
the 16 masks are computed footprints (geometry), and a generated flat material is
projected/stamped into them (`project-tile-surface.py`-style affine), exactly as a
base tile = Blender edge (geometry) + generated PixelLab top (material).

**The test (use this when in doubt):** *does code decide this pixel's colour, or
does generated art?* Code may decide **where** art goes; generated art decides
**what it looks like**. A hardcoded fill colour is the tell that you crossed the line.

### Consequences

- Good: seam-perfect **and** on the art bar; one rule covers every future feature
  tileset; the gap that let a code-drawn road ship is closed and discoverable.
- Cost: a feature tileset needs a real material-generation pass, not just a script
  run. (Resolved: `scripts/build-feature-tiles.py` now composites a GENERATED surface
  into the computed masks for both roads and rivers — the initial code-drawn road was
  replaced, the connection geometry stayed.)

## Pros and Cons of the Options

### A. Per-piece generation

- Good: fully generated, no code-drawn pixels.
- Bad: sprites drift between pieces; seams don't line up; not deterministic; 16×
  the curation per feature.

### B. Code-drawn procedural

- Good: trivially seam-perfect and deterministic.
- Bad: it is exactly the code-drawn art ADR-0011/0032 forbid; the look is
  hand-authored in code, not generated.

### C. Own geometry, generate material (chosen)

- Good: deterministic seams from computed geometry; the look comes from generated
  art; reuses the proven surface-swap pipeline; one boundary rule.
- Bad: two-stage (generate material, then bake) instead of one script; needs a
  curated material per feature.

## More Information

- Refines: [ADR-0011](0011-chrome-art-generated-not-extracted.md) (chrome → board).
- Related: [ADR-0032](0032-no-bland-html-css-every-surface-is-kit.md) (every surface
  generated/kit); [ADR-0025](0025-world-scene-art-anti-story-lore.md) (subject/theme —
  roads sit under the "ancient roads / movement" motif).
- Pipeline precedent: [tile-asset-roadmap.md](../tile-asset-roadmap.md),
  `frontend/scripts/build-surface-tiles.py`, `frontend/scripts/project-tile-surface.py`;
  geometry contract: [tile-ruleset.md](../tile-ruleset.md).
- Feature implementation: `frontend/src/core/featureAutotile.ts`,
  `frontend/scripts/build-feature-tiles.py` (bakes roads + rivers).
