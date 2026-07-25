# Tile Asset Roadmap

This document preserves the working plan for turning the skirmish concept art into production board and terrain assets.

## Runtime Workflow Warning

Use the right server for the job:

- `http://localhost:5173/tileset-studio` is the Vite hot-reload workbench for tile UI, art review, and rapid iteration.
- `http://localhost:3000/tileset-studio` is the backend/Express baked preview. It serves `frontend/dist`, so source edits only appear there after `npm run build` and a browser refresh.

Do not debug live UI iteration on `3000` unless the goal is specifically to verify the baked build. A correct dev page contains `@vite/client` and `/src/main.tsx`; a baked preview contains `/assets/index-*.js`.

## Style Target

Primary visual target:

- `docs/art/ui-screen-concepts/04-skirmish.png`
- Runtime copy: `frontend/public/assets/art/skirmish-style-target.png`

The goal is not generic pixel-art terrain. The goal is to capture the board feel, camera angle, material language, and readable tactics-game presentation from the generated skirmish concept.

## Current Checkpoint

Use this as the working checklist when resuming the tile-asset pipeline.

- [x] Separate Tileset Studio modes: Catalog is for browsing assets; View is for inspecting one selected tile, transition, or board.
- [x] Prevent board content from appearing inside Catalog mode.
- [x] Keep Catalog filters compact, dismissible, and non-permanent.
- [x] Use one focused viewing pane model for board, tile, and transition inspection.
- [x] Lock canonical tile geometry and edge-socket terminology.
- [x] Generate boards using socket-aware rules instead of arbitrary mixed-family placement.
- [x] Finish small Tileset Studio UX cleanup: route state, filters, Board Lab, View Selected, and inspection controls should all feel predictable.
- [x] Document the durable tile ruleset in one place: family, base tile, transition tile, reference, edge socket, legal board generation, and missing art. See `docs/tile-ruleset.md`.
- [x] Fill missing transition art for Grass-Stone, Grass-Water, and Stone-Water socket masks with first-pass structural tiles.
- [x] Stress-test mixed board generation until missing tiles only mean missing art, not illegal placement.
- [x] Prototype animated tiles after static rules and transition coverage are stable, before final skirmish-board integration.
- [ ] Return to high-fidelity asset generation once the rules and review workflow are stable.
- [ ] Integrate accepted tiles into the real skirmish board.

Current phase: asset-pipeline stabilization. The goal is to get out of UI/process churn and back to production tiles as soon as the checklist above is stable enough to trust.

## Current Geometry Contract

The canonical board tile geometry is locked unless a deliberate art-direction decision changes it.

- Top diamond width: `96px`
- Top diamond height: `55.426px`
- Side height: `86px`
- Grid step X: `48px`
- Grid step Y: `27px`
- Edge angle: `30deg`

Source of truth:

- `frontend/src/art/tileTemplate.ts`
- `frontend/scripts/generate-tile-template.mjs`
- `frontend/public/assets/tiles/canonical-template/`
- Socket contract: `frontend/src/core/tileSockets.ts`
- Board generation: `frontend/src/core/tileBoardGenerator.ts`
- Coverage diagnostics: `frontend/src/core/tileCoverage.ts`

## Workflow Roadmap

### 1. Board Geometry Lock

Purpose: prove that the board plane works before investing in final terrain art.

Pass criteria:

- Tiles share one consistent camera angle.
- The board reads as one coherent isometric plane.
- The layout supports chess-like tactics readability.
- No mixed-angle assets are shown as if they belong to the same final system.

Status: effectively locked.

### 2. Board Style Lock

Purpose: make the board feel close enough to the concept art while preserving the locked geometry.

Pass criteria:

- No broken crop artifacts or accidental chess-piece fragments.
- Grass, stone, water, and transitions feel visually related.
- The board looks like a usable tactics surface, not a collage of generated samples.
- The board can serve as the integration test for later tile families.

Status: first prototype active.

Review surface:

- `http://localhost:3000/tileset-studio`
- Legacy review: `http://localhost:3000/tile-review`
- Implementation: `frontend/src/ui/TilePreview.tsx`

### 3. Single Terrain Tileset

Purpose: move from a board mockup to a production-oriented tile family.

Start with grass only.

Expected assets:

- Base grass tile.
- Several same-geometry grass variations.
- Highlighted/selected state.
- Low-probability decorative variants.
- Random-fill example.
- Small grass-only board patch.

Pass criteria:

- The grass family can fill an area without looking like one repeated stamp.
- Variants still preserve the same tile footprint and angle.
- Decorative variants do not break gameplay readability.
- Highlight state reads clearly without replacing the terrain identity.

Status: next.

### 4. Terrain Transitions

Purpose: add cross-family transition tiles only after the base terrain family is stable.

Expected transition families:

- Grass to stone.
- Grass to water.
- Raised or lowered edges if the board needs elevation.

Socket contract:

- Base tiles are family-aware only: all four edges socket to the same terrain family.
- Base tiles do not directly connect to another terrain family.
- Transition tiles are pair-aware: they declare a terrain pair and a four-edge socket mask.
- Valid transition masks are mixed-family masks only (`0001` through `1110`).
- Pure masks (`0000`, `1111`) belong to base terrain families, not transition tiles.
- Mask order is north, east, south, west.
- The Tileset Studio portfolios every valid transition slot for each supported pair, including missing-art slots.
- The generated board test uses a socket-aware placer: each placed tile must match the already-placed north and west neighbors.

Current supported pairs:

- Grass-Stone.
- Grass-Water.
- Stone-Water.

Pass criteria:

- Neighboring tiles match the same canonical footprint.
- Transitions are readable from the gameplay camera.
- Transitions do not make the board look like disconnected objects.
- Tiled-style terrain rules can select valid neighbors without hand-placing every tile.

Status: structural V1 in place; first-pass transition coverage exists, but final art polish is not complete.

Implementation notes:

- Socket rules and board generation are pure core modules with Vitest coverage.
- The Tileset Studio imports the same core modules it uses to show transition ledgers and generated boards.
- Set Health currently reports total transition slot coverage, family-specific missing slots, invalid assets, and generated-board edge legality.

Reference principle:

- Terrain sets should be built from valid edge or corner combinations.
- Variation and random fill should be added through compatible variants, not by changing the geometry.

### 5. Animated Tiles

Purpose: animate stable tile families, not raw first-pass generations.

Timing: start animation prototypes after the static tile rules, transition coverage, and mixed-board generation are stable enough to trust. Do not wait until the final game integration, because animation may affect asset records, rendering, and review tools.

Likely animation targets:

- Water shimmer or running water. First prototype: `water-clean-a` uses local 8-frame shimmer frames from `frontend/public/assets/tiles/canonical-animated/water-shimmer-a/`.
- Subtle grass movement if it does not distract from tactics readability.
- Trees, shrubs, and props as separate animated objects or overlays.
- Magical or tactical highlight tiles.

Pass criteria:

- Animation frames use the same locked tile footprint.
- No frame changes the perceived camera angle.
- Motion supports atmosphere without making the board hard to parse.
- PixiJS handles playback and composition; asset generation provides consistent frames.

Implementation notes:

- Prototype generator: `frontend/scripts/generate-animated-tile-prototypes.mjs`
- NPM command: `npm run tiles:animated`
- Studio assets can declare optional animation metadata; renderers resolve the current frame without changing socket rules or geometry.
- Tileset Studio view mode includes frame-by-frame controls for animated assets: play or pause, previous or next frame, and a scrubber.
- Current prototype is deliberately subtle and should be judged in board context before expanding to more families.

## Tooling Notes

Current deterministic asset scripts:

- `frontend/scripts/generate-clean-canonical-tiles.mjs`
- `frontend/scripts/extract-concept-materials.mjs`
- `frontend/scripts/generate-tile-template.mjs`

Current generated folders:

- `frontend/public/assets/tiles/canonical-true-iso/` - active production catalog tiles, normalized to the true-isometric footprint.
- `frontend/public/assets/tiles/canonical-clean/`
- `frontend/public/assets/tiles/canonical-accepted/`
- `frontend/public/assets/tiles/canonical-template/`
- `frontend/public/assets/tiles/canonical-transition-fill/`
- `frontend/public/assets/tiles/concept-materials/`

`canonical-clean` and `canonical-accepted` are retained as legacy/source and before/after comparison folders; they should not be wired as active production tile catalog assets. PixelLab can be useful for inspiration, raw candidates, and object/animation experiments. It should not be treated as the geometry authority. Generated assets must be normalized to the canonical board angle before being accepted.

## Collaboration Rules

When reviewing with Nelson:

- Ask narrow questions tied to the current phase.
- Do not ask Nelson to judge geometry that can be measured directly.
- Do not mention future polish issues while validating geometry.
- Keep before/after comparisons tied to the immediate previous accepted artifact.
- Prefer bigger, coherent iteration passes over tiny stops.

## Portable Version For Future Projects

1. Pick the target board concept image.
2. Measure and lock the tile footprint first.
3. Build a board integration test before building a full tileset.
4. Make one terrain family work by itself.
5. Add terrain transitions.
6. Add animation only after static geometry and style are stable.
7. Treat AI-generated art as source material, not automatically production-ready assets.
