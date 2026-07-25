# UI Redesign Parallel Workstreams

Use `docs/ui-art-direction.md` as the binding design contract for every task in
this file. The prerequisite design decision is locked: **moonlit grassland Dark
Strategy Pixel battlefield inside a dark low-glare app shell**.

## Parallel Group 1

These tasks can start in parallel after reading the contract.

### Board Rendering

**Ownership:** board terrain, grid, cliff, water, battlefield background, and
overlay rendering in `frontend/src/app.js`.

**Task:** Rework the canvas board toward moonlit grassland: readable dark grass,
cool water, cliffs, stone paths, rocks, trees, clear tile boundaries, cyan move
overlays, orange/red threat overlays, and selected-square treatment.

**Avoid:** piece silhouette redesign, top HUD, side panel, menus, lobby, and
campaign editor styling.

**Output:** code changes plus screenshots of the live game board in the test
slot.

### Piece Style

**Ownership:** piece rendering functions and any future piece asset files.

**Task:** Redesign chess pieces as small refined pixel-style tactical tokens:
strong chess silhouettes, board-scale readability, player ivory/cobalt/gold,
enemy charcoal/vermilion/gold, and distinct pawn/knight/bishop/rook/queen/rock
forms. Keep animation expectations minimal for this pass: pieces only need
simple movement feedback when moving.

**Avoid:** terrain palette, board background, HUD/sidebar layout, and menu
styling.

**Output:** code changes plus screenshots showing pieces at actual board scale.

### HUD And Sidebar

**Ownership:** `frontend/index.html` plus `frontend/src` CSS for the top HUD,
selected-unit panel, actions, roster, legend, meters, account area, and event
log.

**Task:** Rebuild the shell as dark low-glare tactical UI: dark navy/charcoal
surfaces, off-white text, cobalt player/action emphasis, red/orange threat
emphasis, clear selected-unit hierarchy, readable roster rows, and compact log.

**Avoid:** canvas terrain rendering, piece drawing logic, menus, lobby, and
campaign editor screens.

**Output:** code changes plus desktop and mobile screenshots in the test slot.

### Asset Pipeline

**Ownership:** proposal documentation only unless explicitly expanded later.

**Task:** Recommend how agent-rendered pixel art should become production game
assets. Cover tile and piece sprite-sheet generation, cleanup, slicing,
transparent/keyed backgrounds, file organization, asset sizes, scaling,
rendering strategy, and maintenance costs.

**Avoid:** changing game code in the first pass.

**Output:** a short proposal doc under `docs/`.

## Parallel Group 2

Start these after the first Board/Piece/HUD integration exists.

### Menus And Editor

**Ownership:** main menu, party picker, lobby views, campaign editor, level
editor panels, and non-game overlays.

**Task:** Bring the non-game screens into the same dark low-glare tactical shell
without changing gameplay behavior.

**Avoid:** board rendering and piece rendering.

**Output:** code changes plus screenshots for each major flow.

### Responsive And Accessibility

**Ownership:** responsive CSS, scroll behavior, touch targets, font sizing,
contrast checks, and low-glare usability.

**Task:** Verify and tune mobile/tablet/desktop layouts after the first
integrated visual pass.

**Avoid:** introducing a new visual direction.

**Output:** targeted fixes plus evidence screenshots across desktop and mobile.

## Integration Notes

- Board Rendering and Piece Style both touch `frontend/src/app.js`; keep edits in
  their owned function areas and avoid broad refactors.
- HUD And Sidebar should not assume a white panel just because some concept art
  used light UI.
- Bright daytime grassland is a future biome variant, not the default target.
- If a task conflicts with `docs/ui-art-direction.md`, update the contract first
  rather than silently drifting.
