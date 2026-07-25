# Art-Backed UI Bridge

This document describes the current bridge between the approved screen renders
and the production web app.

The UI overhaul is intentionally using live bridge screens as the normal app
surface while approved renders remain available as explicit references. This
keeps the work browser-first, lets reviewers see unfinished slots clearly, and
prevents the old utility UI from being mistaken for the target experience. It is
not the final component system.

## Contract

- `docs/ui-art-direction.md` remains the binding art direction source.
- `frontend/public/assets/ui/*.png` are the Vite public concept screens served
  at `/assets/ui/*`.
- `docs/art/ui-screen-concepts/*.png` are the saved source references.
- `frontend/public/assets/ui/main-menu-aspirational.png` remains the approved
  main menu composition reference.
- `frontend/public/assets/ui/main-menu/background-scene-v1.png` is the live
  scenic main-menu background. It is a generated background-only image with no
  baked text, panels, buttons, profile UI, news UI, dock UI, board, grid,
  playable platform, or chess pieces.
- `frontend/public/assets/ui/main-menu-brand-title-only-v1.png` is the accepted
  title-only render crop for the live main menu brand plate.
- `frontend/public/assets/ui/main-menu/secondary/*.png` contains the narrowed
  generated secondary chrome set imported from the follow-up art pass: profile
  panel, status panel, legacy daily/news panel frames, legacy dock chrome, and
  the source contact sheet. The daily/news frames and dock chrome are no longer
  part of the live main menu design. Battlefield frames, dock button states, and
  small fake-feature icons from that pass are intentionally not part of the live
  route.
- The remaining main menu elements follow the render-accuracy + text-live rules
  in `docs/ui-art-direction.md` (art for rendered visuals; live DOM for copy and
  state). The current live main menu keeps only real/accepted production pieces:
  the button row assets, the title artwork, the accepted no-board scenic
  background, and the art-backed account/settings shell. Daily/news and the
  bottom dock are removed from the live main-menu design; battlefield remains
  out of scope for this pass. None of these areas may be
  represented by fake timers, fake stats, fake destination links, or concept-art
  crops on the live main menu. The earlier *generated*
  `main-menu-*-chrome-v1.png` bitmaps (regenerated approximations that had
  drifted from the concept) were retired end-to-end (guarded by
  `frontend/scripts/check-no-chrome-bitmaps.mjs`).
- `frontend/public/assets/ui/main-menu-button-art-*.png` also includes generated
  no-text button candidates used by the main menu asset review board.
- `frontend/src/app.js` owns the `ART_SCREENS` manifest, image paths, and hotspot
  action wiring.
- `frontend/src/style.css` owns hotspot geometry and art-screen presentation.

Do not add a new one-off screen path for future concepts. Add the screen to
`ART_SCREENS`, define hotspot classes, and style those classes as percentage
rectangles over the 16:10 artboard.

## Review URLs

- `/` and `/main-menu` show the live DOM main menu bridge, with accepted button
  row assets, the accepted title artwork, the generated no-board scenic
  background, a
  real art-backed account/settings shell. The live route does not show a
  daily/news area, bottom dock, fake dock actions, a baked board in the
  background, or a separate battlefield preview panel.
- `/main-menu/skeleton` also opens the live DOM main menu bridge.
- `/design/main-menu/render` opens the saved main menu concept render.
- `/design/main-menu` opens the main menu chrome review board. It renders each
  converted slot's live component as a specimen next to its approved render
  crop, rather than comparing a candidate bitmap.
- `/campaigns` opens the art-backed campaign editor (concept render + live hotspots).
- `/level-editor` opens the art-backed level editor (concept render + live hotspots).
- `/skirmish` opens the art-backed skirmish screen (concept render + live hotspots).
- `/design/campaigns/render` opens the campaign editor concept render.
- `/design/level-editor/render` opens the level editor concept render.
- `/design/skirmish/render` opens the skirmish concept render.

Use the `/hotspots` suffix on concept review URLs to show the clickable overlay
map. For example, use `/design/main-menu/render/hotspots` or
`/design/level-editor/render/hotspots`.

## What Is Live

The main menu, campaign editor, level editor, and skirmish now use live bridge
surfaces by default. The main menu uses a generated no-board scenic background image
behind the live bridge. The mode button family uses accepted production row
assets with live HTML labels overlaid; the brand lockup uses the accepted title
artwork; the profile area is a real account/settings shell backed by generated
chrome. Daily/news has been removed from the current main-menu target. The
bottom dock has also been removed for now because it duplicated the primary
mode buttons without a distinct product purpose. There is no
separate battlefield preview panel on the main menu route. Other labeled slots on the editor and
skirmish screens are intentionally unfinished.

Current main menu acceptance state is tracked in
[main-menu-acceptance.md](main-menu-acceptance.md). In short: the generated mode
button asset family, upper-left brand/title artwork, and art-backed live bridge
approach are settled; the scenic background is accepted; daily/news is removed;
the battlefield layer is out of scope for this pass; profile/account and the
desktop composition still need production review.

The concept routes keep real buttons layered over the saved renders. The
hotspots route back into existing app actions such as menu navigation, campaign
creation, level editor preview, sign-in, settings, and skirmish end-turn.

The visible editor controls, skirmish roster, and skirmish HUD inside the
concept renders are approved visual targets, not finished live UI.

## Tuning Hotspots

Hotspots are percentage-positioned so they scale with the artboard. Use this
loop when adjusting them:

1. Open the target URL with the `/hotspots` suffix.
2. Adjust the matching selector in `frontend/src/style.css`.
3. Deploy the pushed ref's CI image into the test slot.
4. Inspect normal mode and hotspot mode.

Keep hotspot labels short because they are also used as accessibility labels.

## Decomposition Roadmap

Replace the bridge from the inside out:

1. The editor and skirmish screens are art-backed bridges: the approved concept
   render with live hotspots over the working controls (the placeholder skeletons
   were removed). Decompose them into real DOM components from the inside out,
   preserving the hotspot behavior until each slice is genuinely live.
2. Fill one main menu asset family at a time. The button row uses the accepted
   generated row assets with live labels; the title/brand plate uses
   `main-menu-brand-title-only-v1.png` from the approved render. The scenic
   background uses accepted `background-scene-v1.png`; it must stay
   background-only because the real board is a separate future layer.
   Profile/account can use the narrowed generated secondary panel. Daily/news is
   removed from the live main-menu design. The bottom dock is also removed until
   there are real secondary actions that justify it; do not duplicate the
   primary mode routes. Battlefield should not become a separate preview panel
   until the skirmish/battlefield direction lands. Use `/design/main-menu` to
   compare candidates against the approved render before wiring them into the
   bridge.
3. Extract editor and skirmish side panels as real DOM components.
4. Replace remaining rendered board imagery with canvas terrain tiles and overlays that
   match the concepts.
5. Replace rendered pieces with sprite-friendly chess silhouettes.
6. Keep the concept images available as visual regression references until the
   live screens clearly match them.

Each extraction should preserve the current review URL and hotspot behavior
until that slice becomes genuinely live.
