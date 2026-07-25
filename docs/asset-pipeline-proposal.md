# Asset Pipeline Proposal

This proposal covers how agent-rendered pixel art should become production
assets for the browser game. It follows the locked target from
`docs/ui-art-direction.md`: a moonlit grassland Dark Strategy Pixel battlefield
inside a dark low-glare app shell.

For task-level instructions that prevent agents from replacing pixel art with
CSS approximations, see `docs/asset-generation-contract.md`.

The recommendation is to keep the first visual implementation code-rendered
until the board, pieces, and HUD prove the style at gameplay scale. When sprite
assets become useful, generated art should enter a normalization pipeline before
it is allowed into runtime code. Full-scene mockups should be treated as source
material only, never as direct gameplay assets.

## Goals

- Preserve fast tactical readability over terrain beauty.
- Keep the canvas renderer browser-safe, deterministic, and low bandwidth.
- Make generated art repeatable through documented prompts, manifests, and
  cleanup checks.
- Keep production assets small enough to inspect, replace, and review in pull
  requests.
- Avoid a heavy native engine or opaque art pipeline.

## Source Art Contract

Generated source art should be requested as isolated asset sheets, not as
composed board screenshots. Every generation batch should specify:

- isometric tactical camera matching the current 72x36 logical tile footprint
- moonlit grassland lighting with cool shadows and selective warm highlights
- small refined pixel detail, not chunky retro pixels
- transparent background if the generator supports alpha
- flat key color background if alpha is not reliable
- no cast shadows baked outside the asset footprint unless explicitly requested
- no UI, labels, glow overlays, cursor states, or board coordinates
- one biome, faction, and scale target per sheet

Generated art should be saved as raw source under a future ignored or
large-file-managed source directory. The game should consume only normalized
exports.

## Recommended File Organization

Use a small manifest-driven layout when production assets are introduced:

```text
frontend/public/assets/
  manifest.json
  tiles/
    moonlit-grassland.png
    moonlit-grassland.json
  pieces/
    chess-tokens.png
    chess-tokens.json
  props/
    moonlit-grassland-props.png
    moonlit-grassland-props.json
  previews/
    moonlit-grassland-contact-sheet.png
docs/
  asset-pipeline-proposal.md
```

The PNG files should be the browser-loaded sprite sheets. The JSON files should
define frame rectangles, anchors, collision/occupancy hints, terrain tags, and
optional palette metadata. The manifest should map semantic IDs such as
`terrain.grass.a`, `piece.player.knight.idle`, or `prop.rock.small` to a sheet
and frame, so game code does not rely on hard-coded sheet coordinates.

## Tile Sheets

The current board uses 72x36 logical isometric tile tops and a 34px cliff skirt.
The first tile sheet should use those dimensions as the runtime contract:

- `tile.top`: 72x36 transparent PNG frame containing only the diamond top
- `tile.edge-left` and `tile.edge-right`: 36x34 or 72x34 cliff/edge modules
- `tile.transition`: 72x36 frames for grass-to-water, grass-to-stone, and path
  joins only after the base grass tile reads well
- `prop`: variable frames in a separate sheet, anchored to a tile center or tile
  base

Start with a deliberately small moonlit grassland set:

- grass base, grass alternate A/B, darker grass, stone path, shallow water
- cliff left, cliff right, cliff corner, cliff bottom lip
- small rock, large rock, tree stump or low shrub if it does not hide pieces
- optional bridge only when water is implemented in level data

The sheet should include two to four variants for noisy materials like grass,
but the renderer should choose variants deterministically from tile coordinates.
This keeps screenshots stable and avoids storing per-tile art choices.

## Piece Sheets

Pieces should ship as transparent sprite frames with the chess silhouette first
and tactical styling second. The first production frame set should be static:

- player pawn, knight, bishop, rook, queen
- enemy pawn, knight, bishop, rook, queen
- neutral rock and random-rock marker if those remain piece-like in runtime data

Use a 48x48 logical runtime footprint because the current renderer draws pieces
near that size. Each frame should include transparent padding and a stable
bottom-center anchor. Keep the actual silhouette inside roughly 40x44 pixels so
selection rings, tile overlays, and neighboring pieces still read clearly.

The first sheet should not include elaborate animation. If motion frames are
added later, use named rows such as `idle`, `move`, and `capture`, but keep the
initial runtime path able to draw a single `idle` frame for every piece.

## Cleanup And Normalization

Generated art must be cleaned before export:

- remove generator halos, stray pixels, anti-aliased fringe, and hidden
  near-transparent noise
- normalize all transparent pixels to alpha 0 and all opaque pixels to alpha 255
  unless intentional translucency is documented
- snap sheet frame bounds to integer pixels with at least 2px transparent gutter
  between frames
- enforce a limited shared palette per sheet or per biome/faction
- normalize outlines so player and enemy pieces have comparable weight
- align all piece anchors to the same baseline and apparent board contact point
- validate that a piece remains legible over grass, water, path, and threat
  overlays

If a generator cannot reliably produce alpha, use a single unlikely key color
such as `#ff00ff` in raw source only. Cleanup should convert keyed backgrounds
to real transparency before export. Runtime code should not chroma-key PNGs in
canvas; that adds browser work, edge cases, and inconsistent antialias cleanup.

## Slicing Rules

Slicing should be scriptable and manifest-driven. A human may clean the sheet,
but frame extraction should not depend on eyeballing coordinates in game code.

Recommended rules:

- fixed-grid slicing for tiles and piece rows whenever possible
- explicit rectangles in JSON for irregular props
- frame names must be semantic, stable, and lowercase kebab-case
- every frame must declare `anchorX` and `anchorY` in frame-local pixels
- pieces use bottom-center anchors; tile tops use center anchors; props declare
  either `tile-center` or `tile-base`
- no frame may bleed non-transparent pixels into its gutter

The slicer should emit a contact sheet preview so reviewers can inspect all
frames at 1x and at the expected canvas scale.

## Scaling And Canvas Rendering

The renderer should keep logical board geometry separate from source sheet
coordinates. For the current board, draw tile tops to 72x36 integer rectangles
and pieces to 48x48 integer rectangles. Set `ctx.imageSmoothingEnabled = false`
for sprite draws.

Do not draw sprites at fractional destination coordinates or fractional sizes.
Round each isometric anchor before `drawImage`, then subtract the frame anchor.
This avoids shimmering during movement and keeps pixel edges stable.

For high-DPI displays, prefer a DPR-aware canvas backing store while preserving
the same logical coordinates:

- CSS size remains the logical board size
- canvas width and height become `logicalSize * devicePixelRatio`
- context is scaled once by `devicePixelRatio`
- sprite destination rectangles remain logical integers
- image smoothing remains disabled after every canvas resize

Avoid arbitrary CSS scaling of the canvas for gameplay screenshots and QA. If a
responsive layout must scale the board down, use predictable integer or
near-integer scale bands and test that pixel art does not blur in Chrome,
Firefox, and Safari.

## Layering Strategy

Use canvas layers conceptually even if they initially share one physical canvas:

1. battlefield background and cliff skirt
2. tile tops and terrain variants
3. ground decals such as paths, water edges, spawn tint, and selection fills
4. tactical overlays for movement, threat, hover, and editor zones
5. props that sit behind pieces
6. pieces sorted by `x + y`
7. foreground props only if they never obscure legal move readability

Gameplay overlays should remain procedural canvas shapes instead of being baked
into terrain art. Move overlays stay cyan/blue and threat overlays stay
orange/red as required by the design contract.

## Consistency Checks

Before a sheet is accepted, run automated or checklist-based checks:

- all expected manifest IDs exist and point to valid rectangles
- PNG dimensions match the declared grid and frame gutters
- no non-transparent pixels exist outside declared frame rectangles
- no keyed background color remains in exported runtime PNGs
- frame anchors are present and in bounds
- all pieces fit inside their maximum silhouette box
- player and enemy versions share matching scale and baseline
- palette contains only approved moonlit grassland, player, enemy, neutral, and
  overlay-support colors
- preview renders include grass, water, stone path, selected tile, move overlay,
  and threat overlay backgrounds

Visual acceptance should happen at actual board scale first. Zoomed contact
sheets are useful for cleanup, but they should not override readability in the
live 72x36 tile and 48x48 piece context.

## Maintenance Costs

A sprite pipeline adds real cost:

- generation prompts and seeds must be versioned enough to reproduce a style
- cleanup takes human review even when agents produce the first draft
- every new biome multiplies tile transitions, props, previews, and QA surfaces
- every new piece state multiplies player/enemy frame counts
- browser rendering bugs become asset bugs if scaling and alpha rules drift
- sheet coordinate churn creates noisy code review unless manifests are stable

For that reason, do not convert everything to sprite sheets immediately. The
lowest-risk path is:

1. finish the code-rendered moonlit grassland and refined piece prototype
2. capture current board-scale screenshots as acceptance references
3. produce one small normalized tile sheet and one static piece sheet
4. wire the sheets behind the existing procedural renderer as an optional path
5. compare readability, bundle size, and maintenance effort before replacing
   code-drawn assets broadly

If the normalized sheets clearly improve the battlefield without weakening
readability, keep expanding the pipeline. If they only improve close-up polish,
prefer code-rendered or SVG assets for the first production release.
