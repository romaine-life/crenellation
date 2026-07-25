# Tile Art Batch Manifest

This manifest defines the next production art batch for the Tileset Studio board assets.

## Fixed Inputs

- Canonical canvas: `96x140px`
- Top diamond: `96x55.426px`
- Grid step: `stepX 48`, `stepY 27.713`
- Style target: `frontend/public/assets/art/skirmish-style-target.png`
- Current base families: Grass, Stone, Water
- Current transition pairs: Grass-Stone, Grass-Water, Stone-Water

All accepted art must preserve the canonical tile footprint. Generated art is source material only until it has been normalized and reviewed in the studio.

## Batch A: Base Refresh

Purpose: refresh the three base families so they feel authored as one set before transition work expands.

Required output:

- Grass base tile.
- Stone base tile.
- Water base tile.
- One contact sheet showing all bases at `1x`, `2x`, and in a small board patch.

Priorities:

1. Match the skirmish style target's camera angle, palette discipline, and material contrast.
2. Keep the playable top diamond readable at board scale.
3. Avoid decorative detail that implies sockets, cliffs, paths, or tactical overlays.
4. Leave enough visual headroom for selected, threatened, and movement overlays.

## Batch B: Shared Cliff And Depth Treatment

Purpose: define one reusable depth language so raised sides, water edges, and transition borders do not feel like separate art systems.

Required output:

- Shared side-face treatment for the `86px` depth below the top diamond.
- Consistent shadow color and edge highlight rules.
- Water-depth treatment that reads as lower terrain without changing the tile footprint.
- Stone-depth treatment that can support raised, broken, or carved edges later.

Priorities:

1. Sides must align on the `96x140px` canvas without changing top-plane geometry.
2. Depth should clarify material and elevation, not overpower the tactical surface.
3. Edge lighting must be consistent across Grass, Stone, and Water.

## Batch C: Transition Art

Purpose: fill transition slots by pair and mask priority after the base and depth language are stable.

Mask order is north, east, south, west. Pure masks are excluded: `0000` and `1111` belong to base tiles. Mixed masks run from `0001` through `1110`.

Pair priority:

1. Grass-Stone: primary land transition for readable tactical boards.
2. Grass-Water: shoreline transition for strong visual contrast and board boundaries.
3. Stone-Water: hard-edge transition for ruins, bridges, and channel-like layouts.

Mask priority within each pair:

1. Single-edge masks: `0001`, `0010`, `0100`, `1000`.
2. Adjacent-corner masks: `0011`, `0110`, `1100`, `1001`.
3. Opposite-edge masks: `0101`, `1010`.
4. Three-edge masks: `0111`, `1011`, `1101`, `1110`.

Each accepted transition must include:

- Pair name.
- Mask id.
- Source prompt id or run id.
- Normalization notes.
- Studio preview confirmation.

## Prompt Principles

- Name the exact terrain pair and mask role.
- Ask for pixel-art terrain matching the skirmish style target, not generic fantasy terrain.
- Preserve a `96x140px` transparent canvas with a `96x55.426px` true-isometric top diamond.
- Keep the top plane clean enough for chess-like tactics readability.
- Describe materials, edges, and depth; do not ask for pieces, UI, labels, arrows, highlights, or board coordinates.
- Prefer compact material language over noisy micro-detail.
- Treat Water as a terrain family, not an external background.

## Normalization Gates

Before an asset can enter `canonical-true-iso` or equivalent production folders, verify:

- Canvas is exactly `96x140px`.
- Top diamond aligns to the canonical template.
- Transparent pixels remain transparent outside the tile silhouette.
- Neighboring tiles line up on `stepX 48` and `stepY 27.713`.
- Pixel rendering holds up at intended board scale with image smoothing disabled.
- Palette and contrast fit beside the current Grass, Stone, and Water base tiles.
- No accidental chess pieces, UI fragments, labels, shadows outside bounds, or crop artifacts.

## Acceptance Criteria

The batch is accepted when:

- Batch A bases form a coherent three-family set in the Tileset Studio.
- Batch B depth rules are visibly shared by Grass, Stone, and Water.
- Batch C covers all supported pairs with at least the single-edge and adjacent-corner masks accepted.
- Missing lower-priority masks are documented as explicit open slots, not silent gaps.
- Generated board previews show legal sockets and no visible geometry drift.
- The board reads as one tactics surface matching `frontend/public/assets/art/skirmish-style-target.png`.
