# Main Menu Acceptance Ledger

This ledger is the source of truth for what is settled in the main menu UI
bridge and what still needs review. Keep `/design/main-menu` aligned with
this file.

The browser-facing visual ledger lives at
`/design/main-menu`. Its `Accept`, `Needs Review`, and
`Reject` controls save a design-portfolio draft through
`/api/design-portfolios/main-menu-acceptance` when that endpoint is available,
with browser-local storage as a fallback. A decision is only committed to git
when this file is updated. See `docs/design-portfolio-persistence.md` for the
draft endpoint contract.

## Settled / Locked

- Main menu mode button stack.
  The generated five-button row asset family is accepted. Keep labels as live
  DOM text using the approved vendored pixel font, with transparent live click
  targets over the button art.
- Upper-left brand/title banner.
  The crest plus `Chess Tactics` title crop is accepted. Treat it as locked
  unless a later layout change exposes a fit issue.
- Art-backed live bridge approach.
  The main menu should continue using art-backed chrome with real DOM labels,
  controls, and hotspots instead of reverting to generic browser cards.
- Main menu scenic background placement.
  The live menu uses `frontend/public/assets/ui/main-menu/background-scene-v1.png`
  as a full-screen art-backed background layer with no baked UI, labels, panels,
  menu chrome, board, grid, platform, or pieces. This background-only scene is
  accepted.
- Daily/news area removed from the main menu design.
  The live menu should not reserve a daily/news panel, daily timer, objective,
  reward, or news feed. Those systems are not part of the current main-menu
  target.
- Battlefield layer out of scope for the current main menu pass.
  The future real board/battlefield belongs to a separate directed workstream
  and should not appear here as a crop, preview, placeholder, or baked
  background element.
- Bottom dock removed from the current main menu pass.
  The generated dock chrome duplicated the primary mode buttons and did not
  carry a distinct product purpose. The live main menu should not render a
  bottom dock until there are real secondary actions that justify it.
- Desktop-first validation for this pass.
  Main-menu polish is being judged on desktop viewports. Mobile/tablet
  refinement is intentionally deferred unless a desktop change breaks basic
  rendering.
- Optimized runtime delivery of the accepted art (no visual change).
  The accepted background, five button-row sheets, and title are delivered as
  AVIF/WebP derivatives with the original PNG kept as the universal fallback.
  The PNG sources stay checked in and authoritative; derivatives are
  regenerated deterministically with `npm --prefix frontend run optimize:assets`
  (sharp, dev-only `--no-save`), driven by
  `frontend/src/ui/design/optimized-images.json`. The runtime prefers AVIF →
  WebP → PNG via CSS `image-set()` (background + button sheets) and a
  `<picture>` element (title). This is a delivery-format change only — the
  pixels, crops, and layout are unchanged. First-visit payload over those seven
  assets drops ~4386 KiB PNG → ~175 KiB AVIF / ~267 KiB WebP (~96% / ~94%).

## Needs Review

The remaining areas should stay visibly unfinished until their production shape
is real enough to review. Do not fill the main menu with fake live systems just
to mimic the concept.

- Profile/account panel (03) — **partial production shell**. Keep the real
  account/sign-in/settings affordance backed by the generated secondary
  `profile-panel.png` chrome. Do not show fake rank, allies, enemies, or
  progression counts until those systems exist.
- Bottom dock (05) — **absent for now**. Do not render the generated dock chrome
  or duplicate the primary mode routes in a second bottom navigation area.

## Rejected / Do Not Use

- Daily/news panel on the main menu.
- Bottom dock that duplicates the primary mode buttons.
