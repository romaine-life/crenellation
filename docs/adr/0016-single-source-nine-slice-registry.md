---
status: "accepted"
date: 2026-06-27
deciders: Nelson, Claude
---

# ADR-0016: Single-source nine-slice registry — one declaration; bake, editor, catalog read it

Builds the substrate for the atom-assembled frames decided in
[ADR-0012](0012-nine-slice-frames-are-atom-assembled.md), and reuses the
9-slice `border-image` mechanism of
[ADR-0002](0002-nine-slice-border-image-for-pixel-art-chrome.md). ADR-0012 said
*how* a frame is built (mirror one corner atom); this ADR says *where the
description of each frame lives* so the three tools that build, edit, and
catalog it can't disagree.

## Context and Problem Statement

After ADR-0012, every kit frame is assembled from atoms via
`buildFrameFrom(corner, edge, fill, W, H)`. But the *parameters* of each
frame — which atom names it uses, its frame size, its palette-swap variants —
lived implicitly across **per-frame generator scripts** (a bespoke
`generate-mode-button.mjs`, a `generate-row.mjs`, etc.) **and** were duplicated
again in the in-app editor and in the catalog edit-link.

Three copies of "what a frame is" meant they could drift. The editor's notion
of the row frame (its size, its `flipSides`/`carve` flags) could silently
diverge from what the bake actually wrote, so a preview you tuned would not be
the PNG you committed. Adding a new frame meant touching a generator, the
editor, and the catalog — three files, three chances to disagree.

## Decision Drivers

- Kill editor↔bake divergence by construction: the editor preview and the baked
  PNG must read the *same* frame description.
- One place to add or inspect a frame; one `buildAsset()` bake path instead of a
  bespoke script per frame.
- Data, not code — a frame is a declaration, not a program.

## Decision Outcome

Chosen: **`frontend/config/nine-slice-registry.json` is the single source of
truth for atom-built 9-slice frames**, read by three consumers.

The registry declares, per asset id (under `assets`):

- `label` — human name (e.g. "Mode button (tabs / header)").
- `atoms` — the `{ corner, edge, fill }` atom names under
  `public/assets/ui/kit/atoms/`.
- `frame` — the `{ w, h }` assembly size.
- `variants[]` — each `{ out }` (the composed PNG written to
  `public/assets/ui/kit/`), with optional `swap` (a palette name) and optional
  `inspect` (an atom PNG to dump for review).
- optional `consume` — `{ selector, cssVar }`, the CSS custom property the
  asset's `content` value drives.
- optional `carve` — flood-clear the navy bleed outside the rail.
- optional `flipSides` — mirror the left/right (and top/bottom) edges.

plus a top-level `palettes` map (e.g. `active`) of `fromHex → toHex` swaps that
variants reference by name.

The three consumers, all reading this one file:

1. **The Node bake — `scripts/nine-slice-kit.mjs`.** It loads the file as `REG`,
   then resolves `REGISTRY` by mapping each variant's `swap` *name* to its actual
   hex swap map from `REG.palettes`. `buildAsset(assetId, cfg)` looks the asset up
   in `REGISTRY`, tunes the corner, loads edge/fill, and assembles every variant
   via `buildFrameFrom(c, e, fl, w, h, !!rec.flipSides)` — applying `carve` and
   palette swaps as declared. There is a **single** bake implementation for all
   frames.
2. **The in-app editor — `src/ui/NineSliceEditor.tsx`.** It imports the JSON
   directly and derives its `ASSETS` list from `REGISTRY` — atom URLs, target
   PNG (`variants[0].out`), frame size, `carve`, `flipSides` — so every
   registered frame appears in the editor automatically.
3. **The catalog edit-link — `src/ui/design/AssetLibraryStudio.tsx`.** It imports
   the same JSON and builds `EDITOR_ASSET` by walking every variant's `out` back
   to its asset id, so each composed PNG (including `-active` variants) renders an
   "✎ Edit in 9-slice editor" link to `/nine-slice-editor?asset=<id>`.

**Adding a frame is one registry entry** — no code change. It becomes bakeable,
editable in the dev tool, and catalog-linked at once. The per-frame generator
scripts are retired in favour of the one `buildAsset()` path.

### Consequences

- Good: one bake implementation (`buildAsset`) for all frames; no bespoke
  per-frame generator scripts to keep in step.
- Good: the editor preview and the baked PNG read the same frame description, so
  they can't diverge.
- Good: every registered frame is catalog-linked to its editor automatically; a
  PNG *not* in the registry is whole-PNG migration debt, flagged as unsupported.
- Cost: the registry is now load-bearing — its schema (atom names, frame, the
  `variants`/`swap`/`consume`/`carve`/`flipSides` keys) must be kept in sync
  across the three consumers, each of which types and reads a slice of it.

## More Information

- Registry: `frontend/config/nine-slice-registry.json` (`palettes` + per-asset
  `assets`).
- Bake: `frontend/scripts/nine-slice-kit.mjs` (`REG` → `REGISTRY` →
  `buildAsset`); assembler `scripts/assemble-frame.mjs` (`buildFrameFrom`,
  ADR-0012).
- Editor: `frontend/src/ui/NineSliceEditor.tsx`. Catalog edit-link:
  `frontend/src/ui/design/AssetLibraryStudio.tsx`.
- Refines [ADR-0012](0012-nine-slice-frames-are-atom-assembled.md)
  (atom-assembled frames); mechanism
  [ADR-0002](0002-nine-slice-border-image-for-pixel-art-chrome.md) (9-slice
  `border-image`); worked example
  [ADR-0009](0009-mode-button-from-atoms.md).
- This registry is the substrate the `flipSides` flag (ADR-0017), palette-swap
  variants (ADR-0018), and the dev editor (ADR-0019) build on.
