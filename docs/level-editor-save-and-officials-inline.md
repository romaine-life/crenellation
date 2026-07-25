# Plan: Level-Editor save loop + officials inline-publish redesign

> Source of truth for this feature. Combines two efforts that collided in
> `CampaignEditor.tsx` and the save layer: (1) making the Level Editor a real
> authoring surface that saves levels into campaigns and standalone, and (2)
> replacing the admin "Edit Officials" *mode* with tier-aware inline editing.
> See ADR-0038 (campaigns are tiered game content) — this plan updates it.

## The spine: a *tier-aware save*, replacing the *mode*

Today "which backend does a save hit?" is answered by a global flag
(`officialMode`): flipping it makes the whole store official drafts and one
"Publish" button targets the official endpoint. Both efforts fight this flag.

Replace it with a per-thing rule. Every campaign/level already carries its tier
(`origin: 'official' | 'mine'`; official ids are `off-`-prefixed). A save reads
the tier and routes:

- **Private tier** → `saveWorkspace` (`PUT /api/campaign-workspace`) — verb
  **"Save"**, light, no confirm.
- **Official tier** → `saveOfficialCampaigns` (`PUT /api/official-campaigns/default`)
  — verb **"Publish to all players"**, confirm dialog, admin-gated. The server's
  `requireAdmin` is the real gate; the UI only hides the affordance for non-admins.

One rule serves **both** the Campaign Editor and the Level Editor, so there is no
second place to edit `CampaignEditor.tsx` at cross purposes. It also delivers the
agreed UX: "Save" stays frictionless for your own work; publishing-to-everyone is
a distinct, weighty, confirmed act; the padlock appears only for people who truly
cannot edit (non-admins).

## Invariants (every phase must preserve — these are what reviewers check)

- **INV1** A per-user save NEVER includes `origin === 'official'` campaigns or
  `off-` levels (`userWorkspaceForSave`). ADR-0038.
- **INV2** An official publish NEVER includes the user's private campaigns/levels.
  `officialWorkspaceForSave` must serialize ONLY the official slice. (This is a
  behavior CHANGE — today it serializes the whole store, which was safe only
  because `officialMode` made the store officials-only.)
- **INV3** Publishing officials is admin-gated in the UI AND fails closed
  server-side: a non-admin who reaches the official path gets a 403, surfaced as
  "Admin access required".
- **INV4** `officialMode` and all its machinery (`hydrateOfficialForEditing`,
  `setOfficialMode`, the Edit/Exit Officials buttons + testids) are FULLY removed —
  zero dangling references anywhere outside intentional history/docs.
- **INV5** Non-admin sees official campaigns read-only with a padlock; admin sees
  them editable, no padlock, with an "OFFICIAL" tag.
- **INV6** The Level Editor routes an official-level save to the official endpoint
  (publish), and a private/unassigned-level save to the user endpoint.
- **INV7** `boardCode` round-trips the editor board; the backend accepts the full
  `TerrainType` set (incl. `sand`/`dirt`/`pebble`); authored unit `facing` persists.
- **INV8** No `off-` id is ever minted into or written to the per-user workspace
  from either editor.

---

## Phase 1 — Officials redesign + the save spine

### 1a. New `frontend/src/campaign/save.ts` (shared by both editors)

Extract the two slice-serializers out of `CampaignEditor.tsx` and add routing +
error mapping:

- `userWorkspaceForSave(): Workspace` — campaigns `origin !== 'official'`, levels
  whose id does not start with `off-` (moved verbatim from CampaignEditor).
- `officialWorkspaceForSave(): Workspace` — **only** the official slice: campaigns
  `origin === 'official'`, levels whose id starts with `off-`. (INV2 — changed
  from "whole store".) Strip the in-memory `origin`/`readOnly` tags before save,
  same as the user path does today.
- `tierOf(id: string): 'official' | 'user'` — `id.startsWith('off-') ? 'official' : 'user'`.
- `saveUserWorkspace()` → `saveWorkspace(userWorkspaceForSave())`.
- `publishOfficialWorkspace()` → `saveOfficialCampaigns(officialWorkspaceForSave())`.
- `mapSaveError(e): { action: 'sign-in' } | { message: string }` — 401 →
  `{action:'sign-in'}`; 403 → "Admin access required to publish official
  campaigns."; **503 → "Server unavailable — try again in a moment."** (closes the
  verified gap: no 503 branch exists today); else → `Save failed: <message>`.

Reuse the existing `stripTiers` helper logic; keep the in-memory tier tags out of
every PUT body (canonical Workspace shape per ADR-0038).

### 1b. `frontend/src/campaign/store.ts`

- Remove `officialMode` from state/interface, `hydrateOfficialForEditing`,
  `setOfficialMode`, and the `officialMode: false` lines inside `mergeOfficial` /
  `mergeUser`.
- `addLevel`: mint `off-` level id vs `l<n>` by the **selected campaign's
  `origin`** (not the mode). `newCampaign`: stays private (`origin:'mine'`, `c<n>`).
- Add `newOfficialCampaign()` — mints an `off-c-…` id, `origin:'official'`,
  selects it. (Admin-gated in UI. Minimal; richer "promote my campaign to
  official" is Phase 4.)
- Add `createUnassignedLevel(level: Level): string` — mints `l<counter>`, sets
  `level.id`, `replaceLevel`, bumps `counter`, returns the id. (Used in Phase 3.)
- `deleteCampaign`: drop the `officialMode` branch in next-selection — pick the
  first remaining campaign.
- Keep `origin` as the canonical tier marker. `readOnly`/`locked` become
  UI-derived (below); stop relying on baked values for gating. `taggedOfficial`
  may keep setting them as safe defaults, but the editor must not trust them for
  admins.

### 1c. `frontend/src/ui/CampaignEditor.tsx`

- Delete: the Edit/Exit Officials buttons + handlers (`enterOfficialEditing`,
  `exitOfficialEditing`), the `officialMode` selector, the `OFFICIAL` mode badge,
  the mode-conditional campaign count, and the `officialMode` branch in `exportWorkspace`.
- Import the slice/save helpers from `campaign/save.ts` (no longer defined inline).
- `readOnly = camp?.origin === 'official' && !me?.is_admin`. The campaign-list row
  padlock shows ONLY when that is true. For an admin, official rows are
  selectable + editable and show a small **"OFFICIAL"** tag instead of a padlock.
- Split dirty: `userDirty` (signature of the user slice changed vs last user save)
  and `officialDirty` (signature of the official slice changed vs last official
  load/publish). Track two saved-signatures.
- Title-bar actions:
  - **"Save"** → `saveUserWorkspace()`, enabled on `userDirty`. Errors via
    `mapSaveError` (`sign-in` → `goSignIn()`).
  - **"Publish to all players"** → shown when `me?.is_admin && officialDirty`;
    `window.confirm('Publish changes to the official campaigns? Every player will
    receive them.')` then `publishOfficialWorkspace()`; on success show
    "Published (revision N)". Errors via `mapSaveError` (403 message proves
    server gate).
- `selectFirstEditable`: simplify (no officialMode) — may select any campaign;
  keep selecting the first private one by default so a fresh load lands on
  editable content.
- Footer: `Delete Campaign` allowed for officials only when admin; consider
  enabling `Duplicate` on officials ("fork as my own" — already yields
  `origin:'mine'`). Optional, low-risk.

### 1d. `frontend/src/campaign/hydrate.ts`

- Drop the `officialMode` guard at line 24 → `if (hydrated || state.campaigns.length)
  return Promise.resolve();`. The store is now always the proper merged player view,
  so `/play` can always reuse it. (An admin's unpublished official edits will
  preview in `/play` — identical to how unsaved private edits already preview
  today; consistent, intended.)

### 1e. Tests + docs

- `frontend/src/campaign/store.test.ts`: rewrite the `officialMode` /
  `hydrateOfficialForEditing` cases (≈ lines 155–183) to assert that `off-`
  minting is driven by the **selected campaign's origin** (e.g. select an official
  campaign, `addLevel`, expect an `off-l-…` id; `newOfficialCampaign` mints
  `off-c-…`). Drop assertions on `officialMode`. Keep the import-strips-tag test.
- Update **`docs/adr/0038-campaigns-are-tiered-game-content.md`**: editing model is
  now tier-aware inline (admins edit officials in place; publish is a distinct
  confirmed, admin-gated act), not a global mode. Note `mapSaveError`'s 503 branch.

### Phase 1 acceptance
As admin: Crown of Valoria is selectable, editable inline, no padlock, shows
"OFFICIAL"; editing it reveals "Publish to all players" → confirm → publishes the
official slice only (private campaigns never enter the official row). As non-admin
or signed-out: it is locked with a padlock and "Publish" never appears. `npm test`
green with rewritten store tests. No remaining `officialMode` references.

---

## Phase 2 — Level Editor core save loop (campaign path), tier-aware

### 2a. New `frontend/src/core/levelBoard.ts`

- `levelToEditorBoard(level): EditorBoard` — prefer `level.boardCode`
  (`decodeBoard`); else derive an `EditorBoard` from `layers` (terrain type → a
  default Studio tile per family; units → placements w/ facing).
- `editorBoardToLevel(board, meta): Level` — build a valid `Level`:
  - `layers.terrain`: one `TerrainCell` per cell; `terrain` via a
    **family→TerrainType** map (`FAMILY_TO_TERRAIN`, mirroring `game/setup.ts`),
    `elevation: 0`, `cover` from `board.cover`. Decorative families fall back to
    `grass`.
  - `layers.units`: `{x,y,type,side}` (faction→side) + `facing` (8-dir direction).
  - `layers.decals` / `layers.zones`: `[]` (doodads ride in `boardCode`; decals
    mapping is Phase 4).
  - `boardCode: encodeBoard(board)`.
  - Clamp `board.cols`/`rows` to 4–16 × 4–20; carry name/objective/difficulty/
    economy/notes from `meta`.

### 2b. Schema + vocab + backend

- `frontend/src/core/level.ts`: add optional `boardCode?: string` to `Level`;
  add optional `facing?: UnitFacing` to `LevelUnit`. Both back-compat (validator
  ignores unknown fields).
- `backend/server.js`: widen `WORKSPACE_TERRAIN` (≈ line 1317) to the full
  `TerrainType` set — add `sand`, `dirt`, `pebble`. **Required** — otherwise a
  faithful board using those terrains is rejected. Needs a redeploy to land on
  prod; the backend smoke-test covers it locally.
- `frontend/src/game/setup.ts` `createFromLevel`: honor `unit.facing` when present
  so test-play shows the painted facing.

### 2c. `frontend/src/ui/LevelEditor.tsx`

- Read `campaignId`, `levelId`, `returnTo` from the URL (currently dropped).
- On mount: `ensureCampaignsHydrated()` (idempotent; covers a cold deep-link). If
  `levelId` resolves in the store, seed the board via `levelToEditorBoard` and show
  the real level name; else open blank (today's behavior).
- Track a real dirty flag; drive the existing `le-save-state` title-bar chip
  instead of the static "Unsaved".
- **Enable Save** (remove `disabled` + the "Saving unlocks…" title at line ~547):
  - Serialize via `editorBoardToLevel` → `replaceLevel(level)` (campaign path) or
    `createUnassignedLevel(level)` (cold path, Phase 3).
  - Route by tier (INV6): `tierOf(level.id) === 'official'` → `window.confirm` +
    `publishOfficialWorkspace()` labeled **"Publish to all players"**; else
    `saveUserWorkspace()` labeled **"Save"**. All errors via `mapSaveError`.
  - On the campaign path, offer "Back" via `returnTo` after a successful save.
- Keep "Copy board link" unchanged.

### Phase 2 acceptance
`/campaigns-next` → select a level → **Edit Board** → paint tiles/units → **Save**
(private) / **Publish to all players** (official, admin only) flips the chip;
reload `/edit?...` restores the EXACT board; **Test Play** launches with painted
terrain + units + facing; the Campaign Editor thumbnail updates on return. A
non-admin editing an official level via deep-link gets a 403 on save. Postgres
stopped → clear 503 message; officials still load/play. No `off-` id written to
the per-user row.

---

## Phase 3 — Outside campaigns (unassigned levels)

- `store.ts`: `createUnassignedLevel` already added in Phase 1b; wire the cold-save
  path in the Level Editor (no `campaignId`/`levelId` → mint `l<n>`, save to user
  workspace).
- `frontend/src/ui/CampaignEditor.tsx`: add an **"Unassigned levels"** section
  listing `levels` keys referenced by no campaign, each with a preview thumb
  (`LevelThumbnail`), **Edit** (deep-link `/edit?levelId=…`), and **Attach to
  this campaign** (push a `CampaignLevelRef` to the selected campaign). Official /
  read-only rules from Phase 1 already apply.

### Phase 3 acceptance
`/edit` cold → paint → Save → the level appears under **Unassigned levels** →
**Attach** moves it into the selected campaign; both survive a reload
(round-trips through `campaign_workspaces`). No `off-` id in the per-user row.

---

## Phase 4 — Fidelity polish (optional, not in this build)

Doodads → `decals` + a preview that draws them; cover/road/river preview parity;
tidy the `layers → EditorBoard` fallback for legacy levels; richer "promote my
campaign to official" path if `newOfficialCampaign` proves too blunt; enable
`Duplicate` of officials into the user's own.

## Verification (all phases)

Dev server + `npm run shot` per the screenshot workflow; `npm test` for the
backend smoke-test (terrain-vocab change is covered there) and the frontend store
tests; typecheck per the worktree compiler note in CLAUDE.md.

## Out of scope

The standalone `/api/levels` table + `net/levels.ts` (parked); elevation painting;
the dead `/api/campaigns/*` per-user CRUD.
