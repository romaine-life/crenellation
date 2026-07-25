# Tile pipeline — surface-swap tileset

The production terrain tiles are **surface-swap** tiles: a Blender-derived isometric
**edge** with a separately-generated flat **top** dropped into the top diamond, and the
side faces **palette-tied** to the top so the block reads as one material. This sidesteps
the fact that PixelLab can't reliably draw our iso top face — Blender owns the geometry,
PixelLab only paints a flat material (which it does well).

8 variants × 6 families (`grass dirt stone pebble sand water`), wired in
`src/art/tileset.ts` from `public/assets/tiles/surface/<fam>-<n>.png`. Rendered crisp
(`image-rendering: pixelated`, style.css).

## Inputs (committed, in-repo)

| What | Where |
| --- | --- |
| Raw flat top-down surface pools (16/family) | `docs/art/pixellab-runs/surfaces/<fam>/tile_<i>.png` |
| Blender-derived iso edges (codexfilter pixelation) | `public/assets/tiles/pixel/<fam>-codexfilter.png` |
| Curation map (which raw index → which variant) | `CURATION_MAP` in `build-surface-tiles.py` |
| Production output | `public/assets/tiles/surface/<fam>-<n>.png` |

Tile geometry: 96×180 canvas; top diamond apex (48,41) · right (96,68) · front-tip (48,95)
· left (0,68). The flat square surface maps onto that diamond via an affine (square→rhombus).

## To add or replace tiles

1. **Generate** a flat top-down surface pool with the PixelLab MCP. One `create_tiles_pro`
   call per family returns ~16 variations. Params that produce a flat, projectable material:
   ```
   tile_type=square_topdown, tile_view=top-down, tile_view_angle=90,
   tile_depth_ratio=0, tile_size=64, outline_mode=segmentation
   description: "Flat top-down seamless <X> ground material, viewed straight from
     directly above, no outline border, tileable. 1). … 2). … 3). … 4). …"
   ```
   Download the `storage_urls` from `get_tiles_pro` into
   `docs/art/pixellab-runs/surfaces/<fam>/tile_<i>.png`.

2. **Curate** — drop near-black / empty / single-feature surfaces; keep the ground-reading
   ones. `python scripts/tile-contact-sheet.py <dir> out.png` builds a labeled 4×4 sheet to
   pick from; review them applied to the edge at `/surface-lab` (Tiles view).

3. **Build** — put the chosen pool indices in `CURATION_MAP` and run:
   ```
   python scripts/build-surface-tiles.py
   ```
   This projects → composites onto the edge → palette-ties the sides → writes the production
   set. It's deterministic: re-running reproduces the tiles byte-for-byte.

4. **Review** the result on a real board at `/surface-lab` (Board view; Smooth/Crisp,
   zoom, re-roll). The board uses the game's own renderer, so seating/tessellation match.

## Scripts

- `build-surface-tiles.py` — the production build (raw + map → tiles). Source of truth.
- `project-tile-surface.py` — the square→diamond projection as a standalone single-tile tool.
- `tile-contact-sheet.py` — contact sheet of a surface pool for curation.

## Decisions on record

- **Seam:** palette-tie the sides to the top (beat rim-lip / "both" after reviewing all six
  families on a board). The palette-tie lives in `build-surface-tiles.py`.
- **Render:** crisp/`pixelated`, not bilinear — the old `auto` was a holdover from the
  retired 3D-render tiles and blurred the pixel art.
- The raw PixelLab **blocks** (whole-tile, abandoned) and the legacy **textured** Blender
  tiles are non-production — see `src/art/nonProductionTiles.ts`.
