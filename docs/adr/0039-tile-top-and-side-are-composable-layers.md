---
status: "accepted"
date: 2026-06-28
deciders: Nelson, Claude
---

# ADR-0039: A board tile is a TOP layer composited over a SIDE layer

## Context and Problem Statement

A board tile is an isometric cube: a top diamond (the walkable surface) over the
side/cliff faces (the relief that drops toward the void). Until now each tile was
**one baked PNG** — `build-surface-tiles.py` projects a generated top surface into
the diamond, composites it over a Blender-derived edge, then recolors the side
faces to the top's palette, and saves a single `<fam>-<n>.png`. The renderer draws
one `<img>` per cell.

That fuses two things that want to vary **independently**:
- The **roadmap** needs the SIDE to change while the TOP stays the same tile:
  **river terrain → waterfalls** (a river top with falling water on its side), and
  **frayed perimeter edges** (a normal top whose void-facing side is torn rock).
  The frayed edge already shipped (`build-edge-tiles.py`) — and it works precisely
  by re-treating *only the side faces* while keeping the top pixel-identical, which
  is empirical proof that top and side are separable.
- Fusing them makes the asset count **multiplicative**: every (top × side) you want
  to see is its own baked sprite. 6 families × 8 variants = 48 tops; ×4 side
  treatments (plain / frayed / river-face / waterfall) ≈ **192 sprites**, and a new
  side type re-bakes across all 48 tops, while an animated waterfall multiplies by
  its frame count. This is the combinatorial-explosion anti-pattern the autotiling
  literature warns against (Boris The Brave, "Beyond Basic Autotiling"; Red Blob
  Games, dual-grid).

## Decision Outcome

Chosen: **render each tile as a SIDE layer with the TOP layer composited over it,
and author/select the two independently.** Baking a combined sprite is retained only
as an optional export optimization for tiles whose side never varies — never as the
only representation.

Asset count goes from **N×M (multiplicative)** to **N+M (additive)**: 48 tops + a
small side library (~4 per family, or fewer when a side is family-agnostic and
recolored by tint) covers the same combinations; a new side costs ~6 assets, a new
top costs 1, and an animated waterfall is *one* side reused under every river top.

This matches how the genre builds variable sides: Unity/Excalibur stacked isometric
tilemap layers (separate cliff/side layer per elevation), Godot per-layer Y-sort,
Final Fantasy Tactics' independently-textured side polygons, RPG Maker cliff
side-wall sheets, and SLYNYRD's "three independent surfaces, swap out parts" rule.

### How it renders

- Per cell, two `<img>`s inside the one `.tileset-generated-board-tile` div: the
  **side** first (under), the **top** second (over). Both at the full
  `TILE_FRAME_HEIGHT` (180) frame, `position: absolute; inset: 0`, so they overlay
  1:1 with **zero offset math**. This is layout positioning, not a CSS visual
  effect — the art is still generated PNGs (ADR-0011, ADR-0032; no drop-shadow/
  gradient/fade fakery).
- **Paint order is unchanged.** Both layers live in the cell's existing
  `zIndex = x + y` band (`boardProjection.ts`); within the cell, DOM order (side
  then top) puts the top over its own side. Keep every layer's footprint inside the
  cell's frame so the `x+y` painter order keeps holding (a waterfall stays within the
  ~85px side band).
- **No double-darkening / haloing by construction.** The top owns the diamond
  pixels; the side owns the pixels outside it. They are **disjoint** (the diamond
  mask in the build scripts separates them) with hard alpha (0/255), so there is no
  overlap to alpha-blend. Pixel-art rules hold: native footprint, grafted 1:1, never
  fractionally downscaled, `image-rendering: pixelated`.
- **Seam fidelity** comes from a shared edge contract: the diamond vertices
  (`APEX/RIGHT/FRONT/LEFT` = 48,41 / 96,68 / 48,95 / 0,68) are the single source of
  truth in every script, so any top and any side meet on the exact same equator.
- **Palette match** stays a per-family side tint (the table already in
  `build-edge-tiles.py`), applied so one side mesh serves many tops.

### The two heights (do not "reconcile" by collapsing them)

`projectionContract.ts` has `TILE_CANVAS_HEIGHT = 140` (cube content height,
apex→bottom, used only to derive `sideHeight`) and now `TILE_FRAME_HEIGHT = 180`
(the authored/stored/rendered sprite frame; the extra headroom sits above the apex
for protruding relief). Both are correct; they measure different things. Tiles
anchor to the equator, not the frame top, so the headroom never shifts the grid.

### Migration (phased, low-risk)

1. **Phase 1 (shipped): the structural split AND the first independent side
   selection.** `split-tiles.py` cuts every baked surface tile into `<name>-top.png`
   (diamond) + `<name>-side.png` (everything outside it); `top ∪ side == the original`
   by construction. The game board (`BoardLabBoard` → skirmish + level preview)
   renders the two layers. Selection is *already independent*: `SocketBoardCell` gains
   a separate `sideAsset` field, and the void-facing ring is given the frayed edge as
   its **side** while keeping its own top variant. A plain cell is pixel-identical; an
   edge cell keeps its own top with a frayed side.
2. **Later:** a fuller **side library** (frayed sides per family; animated
   river/waterfall sides as frame sequences) selected by terrain/edge flags; the
   Studio's editable board and the catalog adopting the same split; and optionally
   flattening the static interior to a baked sprite as an export optimization.

## Consequences

- Good: variable sides (waterfalls, frayed edges, future cliffs/elevation) cost a
  single new side layer instead of re-baking the whole surface library; per-side
  animation becomes possible; the existing offline compositor can still flatten the
  static case if draw-count ever matters (it won't at chess-board sizes — ~2 imgs ×
  ~100 cells).
- Cost: two DOM nodes per tile instead of one (negligible here); a side authored
  against the wrong equator would seam — mitigated by the shared vertex contract and
  the Phase-1 invariant (`top ∪ side == original`) that the split script verifies.

## More Information

- Builds on: [ADR-0011](0011-chrome-art-generated-not-extracted.md) (art is
  generated, never CSS-faked), [ADR-0032](0032-no-bland-html-css-every-surface-is-kit.md)
  (the board floats on the world; visual richness is art, not CSS).
- Pipeline: `frontend/scripts/build-surface-tiles.py` (top + edge composite),
  `frontend/scripts/build-edge-tiles.py` (side-only frayed treatment — the side
  generator prototype), `frontend/scripts/split-tiles.py` (the Phase-1 splitter).
- Render: `frontend/src/render/TileGrid.tsx` (one positioned cell),
  `frontend/src/render/BoardLabBoard.tsx` (now renders side+top),
  `frontend/src/render/boardProjection.ts` (`zIndex = x+y`).
- Geometry: `frontend/src/art/projectionContract.ts` (140 content / 180 frame).
- Selection: `frontend/src/core/tileBoardGenerator.ts` (`edgeAssets` sets the
  void-facing ring's `sideAsset` — an independent side selection, decoupled from the
  top; extends to river/waterfall sides).
