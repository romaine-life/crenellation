# Tile Ruleset

This document is the durable contract for board terrain assets. It defines what a tile is, how tiles connect, and how generated boards report gaps.

## Core Terms

| Term | Rule |
| --- | --- |
| Family | A terrain material group such as Grass, Stone, or Water. Families are the top-level socket identity for board generation. |
| Base tile | A tile whose north, east, south, and west edges all socket to the same family. Base tiles fill same-family regions. |
| Transition tile | A pair-aware tile whose four edges include two families. Transition tiles are the only legal way for one family to meet another family. |
| Reference | A non-played guide asset used to show footprint, angle, or review context. References are not selected by board generation. |
| Edge socket | The family declared for one tile edge. Edge order is always north, east, south, west. |
| Legal board generation | A board placement process that only places tiles whose edge sockets match their placed neighbors. |
| Missing art | A legal socket slot that has no production asset yet. Missing art is a coverage gap, not an illegal board rule. |

## Geometry Contract

All terrain tiles must use the canonical board footprint:

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

## Base Tiles

Base tiles are family-local.

- A Grass base tile has `N=Grass`, `E=Grass`, `S=Grass`, `W=Grass`.
- A Stone base tile has `N=Stone`, `E=Stone`, `S=Stone`, `W=Stone`.
- A Water base tile has `N=Water`, `E=Water`, `S=Water`, `W=Water`.
- A base tile must never directly socket to another family.
- Visual variants are allowed, but they must keep the same footprint and socket identity.

## Transition Tiles

Transition tiles are pair-local.

- Supported pair examples: Grass-Stone, Grass-Water, Stone-Water.
- A transition tile declares one terrain pair and one four-edge socket mask.
- Mask order is `N E S W`.
- Mixed masks `0001` through `1110` are transition slots.
- Pure masks `0000` and `1111` are not transition slots; they belong to base terrain.
- Each pair has `14` valid transition slots.

For a Grass-Stone transition, the mask records which edges use the secondary family for that pair. The UI must show the resolved edge sockets, not only the mask.

## Legal Board Generation

Generated boards must be socket-aware.

- A placed tile's north edge must match the south edge of the tile above it.
- A placed tile's west edge must match the east edge of the tile to its left.
- The same rule applies for east and south neighbors when those neighbors exist.
- Mixed-family boards must use transition tiles at family boundaries.
- If no produced tile exists for a legal socket requirement, the board may show a missing-art placeholder.
- The board should report missing-art counts separately from illegal socket counts.

Board generation is healthy when missing tiles mean "we need art for this legal slot," not "the algorithm placed an impossible edge."

## Coverage Checklist

Use this checklist when adding or reviewing a terrain family or pair.

- [ ] Every base family has at least one accepted base tile.
- [ ] Base tile variants preserve the canonical footprint.
- [ ] Base tile variants socket only to their own family.
- [ ] Every supported transition pair lists all `14` mixed socket masks.
- [ ] Each transition slot has either accepted art or an explicit missing-art placeholder.
- [ ] References are excluded from board generation.
- [ ] Generated boards report missing art separately from illegal sockets.
- [ ] Mixed boards only place legal socket matches.

## Implementation Pointers

- Socket contract: `frontend/src/core/tileSockets.ts`
- Board generation: `frontend/src/core/tileBoardGenerator.ts`
- Coverage diagnostics: `frontend/src/core/tileCoverage.ts`
- Studio surface: `frontend/src/ui/TilePreview.tsx`
