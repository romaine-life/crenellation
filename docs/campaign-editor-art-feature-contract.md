# Campaign Editor Art And Feature Contract

This contract exists to prevent the campaign editor from drifting into
CSS-themed placeholder UI. The target is an art-driven editor whose visible
controls are backed by real behavior and real data.

## Source Of Truth

- Visual target: `docs/art/ui-screen-concepts/02-campaign-editor.png`.
- Live route: `/campaigns-next`.
- Reusable chrome source: `frontend/public/assets/ui/campaign-editor/source-sheet.png`.
- Production component: `frontend/src/ui/CampaignEditor.tsx`.
- Campaign workspace store: `frontend/src/campaign/store.ts`.

Do not crop the full concept screen into reusable controls. The concept has
layout-specific lighting and baked sample content. Use the campaign editor
source sheet for reusable chrome, and create new matching assets only where the
source sheet does not contain a needed control or icon.

## Non-Negotiables

- No fake controls. Every visible action either works, is disabled with a real
  reason, or is explicitly removed.
- No CSS imitation of rendered chrome. CSS may compose, slice, position, and
  state-switch art assets; it should not recreate bevels, crests, glows, or
  frames with gradients.
- Text and numbers remain live DOM/app state.
- The large level preview and level thumbnails must be data-backed. They may be
  read-only previews, but they cannot be decorative boards unrelated to the
  selected level.
- Destructive actions need confirmation or an undo/dirty-state model before
  they are treated as finished.

## Feature Contract

### Campaigns

- Create campaign.
- Rename campaign.
- Select campaign.
- Delete campaign with confirmation.
- Duplicate campaign.
- Import campaign from JSON.
- Save campaign workspace with success/error/dirty state.
- Track favorite state.
- Track lock/unlock state when the campaign model supports it.
- Show progress from real campaign/level completion data, not invented counts.

### Levels

- Add level to selected campaign.
- Select level.
- Rename level.
- Reorder levels.
- Delete level with confirmation.
- Edit objective.
- Edit difficulty.
- Edit starting funds.
- Edit income per turn.
- Edit notes, persisted in the level or campaign-level metadata.
- Show stars from real saved progress data, not selected-row decoration.
- Show row thumbnail rendered from the level data.

### Board Editing And Playtest

- `Edit Board` opens the board editor for the selected campaign level.
- The board editor loads that level and saves back to the same campaign
  workspace or shared level document.
- `Test Play` starts the selected level, not a random skirmish.
- Test play uses the selected level's board, units, objective, difficulty, and
  economy values.
- Returning from edit/play preserves the campaign editor selection.

## Art Contract

### Existing Chrome Assets

The following assets already exist and should be treated as reusable art
surfaces:

- `panel-large.png`
- `panel-card.png`
- `preview-frame.png`
- `footer-bar.png`
- `row-campaign.png`
- `row-campaign-selected.png`
- `row-level.png`
- `row-level-selected.png`
- `button-blue.png`
- `button-blue-pressed.png`
- `button-red.png`
- `button-red-pressed.png`
- `icon-button.png`
- `icon-button-selected.png`
- `icon-button-red.png`
- `field-input.png`
- `field-select.png`
- `shield-lion.png`
- `shield-rook.png`
- `shield-crescent.png`
- `shield-snow.png`
- `shield-flame.png`
- `shield-crown.png`

Before styling these in production, define their patch margins, content insets,
text insets, and state names in a manifest. Avoid stretching full PNGs with
`background-size: 100% 100%` as a final scalable solution.

### Missing Art Assets

Create or extract a matching icon set before replacing these with final UI:

- folder/import
- save
- undo or back
- settings gear
- edit pencil
- play
- duplicate
- trash
- move up
- move down
- lock
- favorite star
- dropdown arrow
- objective
- difficulty
- starting funds
- income per turn
- overflow/more handle

The current letter and symbol placeholders (`M`, `S`, `G`, arrows, `x`) are not
final art.

## Implementation Order

1. Define durable schema fields for real editor state: notes, favorite, lock
   state, progress/stars, and level display metadata.
2. Fix route contracts for selected level handoff:
   `/edit?campaignId=...&levelId=...` and
   `/play?campaignId=...&levelId=...&mode=test`.
3. Make board editor load/save the selected campaign level.
4. Make test play run the selected authored level.
5. Add real notes/name editing, dirty state, and destructive confirmations.
6. Add duplicate/import flows with validation.
7. Add campaign-editor asset manifest and migrate chrome to 9-slice/state
   contracts.
8. Replace placeholder icons with matching art assets.
9. Replace `MiniBoard` with a data-backed preview renderer and use the same
   renderer for level thumbnails.
10. Add seeded/demo campaigns only as a dev/empty-state aid, never as a
    substitute for implemented features.

## Acceptance Gates

Each completed slice must pass:

- Behavior check: the visible control performs the named action against real
  campaign/level state.
- Persistence check: saved workspace reloads with the same campaign/level data.
- Visual check: desktop screenshot compared against the concept.
- Empty-state check: unauthenticated or empty workspace remains honest.
- No-fake check: no invented stars, progress, notes, locks, or board previews
  remain in the completed slice.
