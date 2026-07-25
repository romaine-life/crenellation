# Chess Tactics UI Art Direction Contract

This document is the source of truth for the current visual redesign. Treat it
as binding for implementation work unless the product direction changes in a
later design review.

## Decision Records

Individual decisions — with their context, alternatives, and rationale — are
recorded as ADRs in [`adr/`](adr/) (see the [decision log](adr/decision-log.md)).
Those records are authoritative for *why* a choice was made. This contract is the
consolidated *current-state* view: it states the rules in force now and should
cite the ADR each derives from. When the two disagree, the ADRs win and this doc
is brought back into line.

## Deciding UI Tradeoffs (game-UI vs product-UI)

When game-UI guidance (immersion, theme, density) conflicts with product-UI
guidance (clarity, breathing room, convention), decide with the criteria and
surface-based tie-break in [ADR-0006](adr/0006-ui-decision-criteria.md):

1. If it breaks the usability floor (legibility, contrast, target size,
   label↔control proximity), usability wins.
2. Otherwise pick the lean by surface — **in-game (board/HUD)** leans game-UI
   (immersion, glanceability, density OK); **menus/chrome (settings, studio,
   editors)** leans product-UI (clarity, breathing room) while still wearing the
   game skin.
3. Within that lean, the accepted concept art is the reference for the look.

## Chosen Direction

**Dark Strategy Pixel battlefield inside a dark low-glare app shell.**

The default battlefield should be night-leaning, low-glare, and comfortable for
long play sessions. Pieces, overlays, and key terrain features should stay
visually distinct and colorful enough to read at a glance. Bright daytime maps
are allowed as occasional level/biome variants, but they are not the default
look. Do not interpret the bright mockups as approval for a white app UI or a
bright app background.

The first production biome is **moonlit grassland**: grass, water, cliffs,
stone paths, rocks, and trees under cool night lighting. It should preserve the
readability and tactical friendliness of the bright strategy mockups without
making the whole app bright.

The target experience is a compact tactics puzzle that also feels like a tiny
campaign battlefield. It should be easy to distribute and play with friends in a
browser, so the visual system must be feasible with 2D web rendering, canvas
layers, DOM HUD panels, and sprite/tile assets.

## Inspirations

- **Into the Breach:** isometric tactical clarity, puzzle-like turns, explicit
  threat language, immediately readable board state.
- **Advance Wars:** bright faction readability, approachable campaign-map tone,
  clean tactical UI.
- **Fire Emblem:** unit identity, roster attachment, tactical drama.
- **Chessmaster:** chess dignity, elegant board/piece presentation, serious
  chess identity, low-noise interface.
- **Chess:** role silhouettes, spatial logic, abstract rules made visible.

These are references for qualities, not sources to copy.

## Non-Negotiables

- Browser-first. Avoid any direction that requires a heavy native/game-engine
  pipeline to look acceptable.
- Small refined pixels are allowed and preferred; oversized chunky retro pixels
  are not the goal.
- The app shell is dark theme by default. Use low-glare navy, charcoal, and
  muted steel surfaces with off-white text.
- Battlefields default to dark/night or dusk environments. Bright daytime
  environments are allowed as special map variants, but they still live inside
  the dark app shell.
- The first board target is moonlit grassland.
- Board state must be readable faster than it is beautiful.
- Gameplay overlays must remain obvious over every terrain type.
- Chess identity must be preserved through piece silhouettes and role language.
- Avoid full painterly rendering as an implementation target. Rendered mockups
  are mood references, not literal production requirements.

## Visual Balance

The current center of gravity is:

- **Primary:** Dark Strategy Pixel
- **Secondary readability:** Bright Strategy Pixel
- **Secondary restraint:** Chessmaster Refined Pixel

Use Dark Strategy Pixel for the default mood, comfort, and app identity. Borrow
from Bright Strategy Pixel for terrain clarity, faction color, and readable
overlays. Use Chessmaster Refined Pixel to keep pieces and UI from becoming too
toy-like or noisy.

## Board Rules

The board is the first visual priority.

Do:

- Keep isometric presentation.
- Use readable grass, water, stone, road, bridge, cliff, tree, and rock
  materials tuned for night/dusk by default.
- Use moonlight, cool shadows, reflective water, and selective warm highlights
  to make the battlefield feel dark without becoming muddy.
- Keep tile boundaries visible without making the grid feel like spreadsheet
  chrome.
- Make water and cliffs attractive but not visually dominant.
- Keep move overlays cyan/blue and threat overlays orange/red.
- Support bright daytime maps and future biomes without changing the UI system.
- Design terrain as reusable tiles and props that can be rendered in canvas.

Avoid:

- Gloomy purple backgrounds as the dominant read. Dark should mean low-glare and
  readable, not muddy.
- Painterly tile detail that cannot plausibly become a tile sheet.
- Terrain clutter that hides piece silhouettes or overlays.
- Board framing that competes with tactical information.

## Piece Rules

Pieces should read as chess pieces first and tactical units second. They are not
literal Staunton pieces, and they are not humanoid soldiers wearing chess hats.

Do:

- Use strong chess silhouettes at actual board scale.
- Use player ivory/cobalt/gold and enemy charcoal/vermilion/gold.
- Put faction color on bases, trim, banners, shields, enamel, or icon accents.
- Keep pieces sprite-friendly: compact, outlined, readable, and easy to animate
  later.
- For the current pass, animation scope is minimal: pieces only need simple
  movement feedback when they move. Do not design around elaborate idle,
  attack, capture, or death animations yet.
- Preserve role identity:
  - Pawns: standard bearers, shield pawns, compact sentries.
  - Knights: horse-head silhouette, helm/standard hybrid, strong profile.
  - Bishops: mitre, diagonal pennant, signal-piece silhouette.
  - Rooks: fortress/tower silhouette with battlements.
  - Queens: tall command piece with crown authority.
  - Kings: protected command post or dignified standard, not an action hero.

Avoid:

- Fully humanoid fantasy units.
- Exact Staunton replicas.
- Painterly miniature detail that disappears at board scale.
- Piece designs that require many animation frames to feel alive.

## UI Shell Rules

The interface should be dark, quiet, and tactical. The board can be colorful;
the chrome should be low-glare.

Do:

- Use dark navy, charcoal, muted blue-gray, and subdued steel panels.
- Use off-white text, not pure white walls of UI.
- Use cobalt for primary/player actions, red/orange for power/threat, and gray
  for wait/disabled states.
- Keep selected-unit, actions, roster, threats, and event log clearly separated.
- Keep pixel typography restrained and readable.
- Let pieces, overlays, and select terrain accents carry most of the saturated
  color.

Avoid:

- White sidebars or large pale panels.
- Generic sci-fi dashboard chrome.
- Purple-heavy palettes.
- Oversized pixel text inside dense panels.
- Decorative borders that reduce information density.

## Implementation Shape

The intended web implementation is:

- Canvas-rendered isometric board and overlays.
- Canvas, SVG, or sprite-sheet pieces.
- DOM/CSS top HUD, side panel, menus, lobby, and editor.
- Optional sprite sheets for terrain and pieces after the first code pass proves
  scale and readability.

Do not begin with a full asset pipeline unless the code-rendered prototype
cannot reach an acceptable style. The first production pass should prove the
style with the existing architecture.

### Render accuracy rule (binding)

Decide per UI element by whether it carries rich *rendered* detail — painterly
art, a crest, lighting, illustration:

- **Rendered detail → art-backed.** Use the approved render itself (e.g. a
  percentage crop of `main-menu-aspirational.png`) as the image layer and overlay
  only transparent live DOM controls/hotspots. This is how the accepted mode
  buttons (01), brand plate (02), and the profile/status panel (03) are built.
  Do NOT reconstruct rendered art in DOM/CSS/SVG: CSS yields stylized geometry,
  not rendered artwork, and hand-drawn SVG cannot match a rendered lion crest.
- **Simple / text / utilitarian chrome → DOM/CSS** (dock labels, HUD labels,
  forms). These have no rendered detail to lose.
- **Text is always live, never baked.** Even inside an art-backed element, keep
  copy and numbers as live DOM text (a webfont matching the concept's type)
  overlaid on the art — never painted into the image. Baking text breaks
  localization, accessibility (resize / screen readers), crisp scaling, and
  dynamic content (live counts, rotating news). Art-back the *visuals* (crest,
  icons, frame, background); render the *words and numbers* live. The only baked
  text allowed is stylized logo/title lettering that is itself part of the art
  identity (e.g. the painted mode-button labels). Confirmed by game-UI
  localization and accessibility guidance.

Test: would redrawing it in code lose rendered detail visible in the concept? If
yes, keep the art. (Origin of this rule: element 03 was rebuilt in DOM/SVG and
could not match the concept's lion — its crest came out a sunburst. The fix was
to art-back it like 01/02.)

## Current Screen Concept References

The June 2026 screen concepts are binding visual references for the UI overhaul:

- [Main menu aspirational concept](art/ui-screen-concepts/01-main-menu-aspirational.png)
- [Campaign editor concept](art/ui-screen-concepts/02-campaign-editor.png)
- [Level editor concept](art/ui-screen-concepts/03-level-editor.png)
- [Skirmish concept](art/ui-screen-concepts/04-skirmish.png)

Use these as direction targets, not literal implementation screenshots. The
production UI should preserve their mood, hierarchy, low-glare shell, rich
isometric board presence, and tactical information density while adapting to the
actual app architecture.

The main menu concept is intentionally aspirational. Keep the saved image as a
growth reference for future features such as profile state, lobbies,
achievements, and richer account/status panels. Daily/news is not part of the
current main-menu target. The first
implementation pass may reduce the main menu to the modes the app actually has
today.

The level editor and skirmish concepts are the immediate product targets. They
should drive the first concrete UI sweep because they define the practical tool
layout, HUD structure, tile palette, brush controls, roster, selected-unit
panel, threat language, and low-glare chrome.

The current implementation uses an [art-backed UI bridge](art-backed-ui-bridge.md).
The app routes render the approved concept art with live DOM controls/hotspots
overlaid — the main menu as decomposed elements (art crops, a hybrid profile, DOM
panels), and the campaign editor, level editor, and skirmish as their full concept
renders with live hotspots — instead of the old utility UI, which was below the
intended quality bar. The earlier placeholder skeletons were removed end to end.

The default work surfaces are `/`, `/main-menu`, `/campaigns`,
`/level-editor`, and `/skirmish`. They show live DOM bridge
surfaces with unfinished asset slots labeled in place. The main menu uses a
generated no-board scenic background image, the accepted generated five-button
row asset family with live labels, and the accepted title/brand artwork. The
background image is accepted as the live background-only scene.
Profile/account is a real shell backed by the narrowed generated secondary
chrome. Daily/news is removed from the current main-menu design. The bottom
dock is also removed for now because it duplicated the primary mode buttons
without a distinct product purpose. The production route should not bake a board
into the background or grow a separate battlefield preview panel; the real
board/battlefield layer is out of scope for this pass. `/design/*/render` routes preserve the approved renders for comparison:
`/design/main-menu/render`, `/design/campaigns/render`,
`/design/level-editor/render`, and `/design/skirmish/render`.
`/design/main-menu` remains the asset review board for comparing candidate
asset families before wiring them into a bridge.

The main menu acceptance state lives in
[main-menu-acceptance.md](main-menu-acceptance.md). As of the current pass, the
mode button stack, upper-left brand/title banner, and art-backed live bridge
approach are settled. The scenic background is accepted. Daily/news is removed.
The real board/battlefield layer is out of scope for this pass, and desktop is
the validation target. Profile/account and the overall desktop composition still
need review.

## Parallel Work Boundaries

Use these boundaries when delegating to agents.

### Design Contract

Owns this document. Updates vocabulary, principles, decisions, and open
questions. Does not implement UI.

### Board Rendering

Owns terrain, grid, cliff, water, background, and overlay rendering in
`frontend/src/app.js`. Avoids piece redesign and non-board UI layout.

### Piece Style

Owns piece silhouette/rendering in `frontend/src/app.js` or future piece assets.
Avoids terrain palette and side panel layout.

### HUD And Sidebar

Owns `frontend/index.html` and `frontend/src` shell/panel CSS for the top HUD,
selected unit, actions, roster, legend, and log. Avoids canvas rendering.

### Menus And Editor

Owns main menu, party picker, lobbies, campaign editor, and level editor
styling. Avoids gameplay canvas changes.

### Responsive And Accessibility

Runs after the first integration. Owns mobile layout, scroll behavior, touch
targets, contrast, font sizing, and low-glare checks.

### Asset Pipeline

Owns a proposal, not first-pass implementation. Evaluates code-drawn sprites,
hand-authored sprite sheets, generated pixel art cleanup, file organization,
scaling rules, and maintenance costs.

## Current Implementation Plan

1. Lock this contract.
2. Board rendering pass: make the live board read as Dark Strategy Pixel
   moonlit grassland while preserving Bright Strategy Pixel readability and the
   dark app shell.
3. Piece style pass: improve silhouettes and faction language at board scale.
4. HUD/sidebar pass: rebuild the shell as dark low-glare tactical UI.
5. Menu/editor pass: bring non-game screens into the same system.
6. Responsive/accessibility pass.
7. Decide whether a dedicated sprite/tile asset pipeline is necessary.

## Asset Source Decision

Production pixel art may be generated by agents rather than hand-drawn by an
artist. Generated art should still be processed into usable game assets:

- normalized tile and piece sprite sheets
- consistent camera angle and scale
- transparent or cleanly keyed backgrounds
- controlled palettes and outlines
- predictable file names and metadata
- no dependency on one-off full-screen mockup renders for gameplay

The goal is to use generated art as the source for production sprites and tiles,
not merely as inspiration. The implementation should still treat those outputs
as real assets that need cleanup, slicing, consistency checks, and browser-safe
rendering rules.
