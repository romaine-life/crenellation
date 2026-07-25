---
status: "accepted"
date: 2026-06-28
deciders: Nelson, Claude
---

# ADR-0038: Campaigns are tiered game content — a global official tier (file + DB override) plus per-user campaigns

The first persistence/content-architecture ADR (the rest govern UI chrome). It
sits alongside `docs/persistence.md`, which it updates: campaigns stop being a
purely per-user, sign-in-gated document and become **game content with two
tiers**. It reuses the global-content pattern set by `design_portfolios` (public
GET, privileged PUT) and the dev/ops write-path discipline of
[ADR-0019](0019-dev-only-nine-slice-editor-save.md) (code-owned content is edited
through a controlled, auditable path, never a free-for-all production endpoint).

## Context and Problem Statement

On production, the Campaign screen shows **no campaigns** to a signed-in player.
Root cause is structural, not a one-off bug: campaigns are stored only in the
per-user `campaign_workspaces` Postgres row (sign-in required), and
`frontend/src/campaign/hydrate.ts` uses *first-non-empty-source-wins, else demo*.
A signed-in user with an empty/never-saved workspace gets a `200 {campaigns:[]}` —
`if (ws.campaigns.length)` is false, and because the fetch *succeeded* the demo
fallback never fires. Net: **signed-out sees the bundled demo; signed-in sees
nothing.** Content was placed on the per-user, sign-in-gated axis — the same axis
as player progress — when it should belong to the game.

The owner's requirement: *campaigns belong to the game, not a user; it must not
matter whether the viewer is signed in.* And the model is **tiered** — official
campaigns authored by admins (visible to everyone) **plus** per-user self-defined
campaigns.

## Decision Drivers

- **Official campaigns must be visible to everyone**, signed in or not. (The
  reported bug.)
- **The game (`/`, `/play`) and static serving must never depend on the DB** — a
  Postgres outage must not take down or empty the game (`docs/persistence.md`,
  "Failure behavior").
- **Game content is code-owned files**, not DB-only rows; git is the recoverable
  source of truth, the delivery layer is just delivery (`docs/persistence.md`,
  "Boundaries").
- **Per-user campaigns must coexist** as a private, owner-scoped tier (today's
  `campaign_workspaces`, unchanged).
- **Admins can author official campaigns**, including live between deploys.
- **Honest auth**: there is *no* admin role in this codebase. `user.role` is an
  inert upstream passthrough (`'pending'` default, `'designer'` dev-host stub),
  compared nowhere; `requireUser` gates only on `signed_in`. A design must not
  pretend a role check exists.
- **Per-player progress must keep working** across the change (localStorage,
  keyed by `levelId`).

## Considered Options

- **A. Code-owned file only** — official campaigns ship as a committed JSON file;
  admins author by editing → commit → deploy. No DB, no live publishing.
- **B. Live global DB doc only** — official campaigns in one global Postgres row
  (public GET, admin PUT), no committed fallback.
- **C. Status quo (per-user only)** — keep campaigns per-user; just seed a demo.
- **D. Tiered: committed file + optional live DB override, with a weekly
  bake-back** — official tier is dual-homed (file is the durable fallback, DB row
  is the live edit surface); per-user tier unchanged. **(chosen)**

## Decision Outcome

Chosen: **D**, because it is the only option that satisfies *every* driver at
once — officials visible to all without sign-in, the game never depends on the DB,
content is code-owned and git-recoverable, admins publish live, and per-user
campaigns are untouched. B was rejected outright: with no bundled fallback,
officials vanish on a DB outage, violating the bedrock no-DB-dependency rule. C
doesn't meet the requirement at all. A meets the invariants but cannot publish
live; D contains A as its Step 1 and adds the live layer on top.

### The two tiers

**Tier 1 — Official (global, visible to everyone).** Dual-homed:

- **Source of record / fallback = a committed file**
  `frontend/public/assets/campaigns/official.json`, holding the canonical
  Workspace `{ campaigns: Campaign[]; levels: Record<levelId, Level> }` at
  `formatVersion 1` — the exact shape the editor already produces. Served by
  `express.static`: zero DB, zero auth. This is what keeps `/play` and the
  official tier alive when Postgres is down, and what git tracks.
- **Live edit surface = one global Postgres row** in a new `official_campaigns`
  table (PK `id` alone — e.g. `'default'`), a deliberate clone of
  `design_portfolios`: public GET (synthesizes an empty doc on miss, never 404),
  admin-gated PUT, `revision` bump, `updated_by`. The row, when present, carries a
  **complete** official Workspace (partial/tombstone merges are impossible —
  `validateWorkspaceBody` requires every level ref to resolve in-document).

**Tier 2 — Per-user (private, sign-in required).** The existing
`campaign_workspaces` table and `/api/campaign-workspace` GET/PUT, **unchanged**,
keyed by `owner_email`.

### Read contract (the crux — replaces first-source-wins)

`ensureCampaignsHydrated` **always** loads officials first (`origin:'official'`,
`readOnly:true`), regardless of sign-in; **then additively merges** the per-user
workspace on top when signed in (`origin:'mine'`). De-dupe by id, official-first.
Official source preference is **API-first, file-fallback**: try
`GET /api/official-campaigns/default` (unwrap `.portfolio.data`, normalize a
synthesized `{}` to `{campaigns:[],levels:{}}`), fall back to the static file on
`503`/error. The demo-on-401 fallback is removed. This single change fixes the
prod bug.

### Lifecycle: DB is authoritative, the file is a recoverable mirror (model A)

Reads are API-first, so the **DB row is the live source** and the committed file
is a **weekly snapshot + outage fallback + git history**. We do **not** retire or
clear the DB row after a bake. Two reasons: (1) it is a single upserted row (PK
`id`), so it never accumulates — there is nothing to garbage-collect; (2) clearing
it would *regress live content*, because the bake-back commits with `[skip ci]`
and therefore does not redeploy, so the running container's baked-in file lags git
until the next real deploy — handing authority to a stale file. "Retirement" is a
non-event: the row is continuously the live source, and git always holds a copy at
most a week behind. (The alternative — making the file authoritative by clearing
the row — would require coupling every content snapshot to a full build+deploy plus
a compare-and-delete on `revision`; rejected as disproportionate.)

### Weekly bake-back (DB → file)

A scheduled **GitHub Actions cron** (deterministic data movement, no agent),
modeled on the image bump-bot
([build-and-deploy.yaml](../../.github/workflows/build-and-deploy.yaml)): `curl`
the **public** `GET /api/official-campaigns/default`, `jq '.portfolio.data'` into
`official.json`, `git diff --cached --quiet` to no-op unchanged weeks, then commit
`[skip ci]` and push directly to `main`. Because the official GET is public, the
job needs **no DB credentials** — only the default `GITHUB_TOKEN`. Direct commit
to `main` (not a PR) matches the bump-bot; a PR variant would add a content-review
gate and is the only reason to deviate. The `git diff` guard plus the lazy DB seed
prevent any ping-pong between file and row.

### Admin gating (grounded in real auth)

Because no admin role exists, admin authority is an explicit, code-owned
**`ADMIN_EMAILS`** env allowlist (comma-separated, parsed once into a lowercased
Set at boot) checked by a new **`requireAdmin(req,res)`** helper (`requireUser`
first, then membership). **Fail-closed**: if `ADMIN_EMAILS` is unset the Set is
empty, every official PUT returns `403`, and the system runs on baked content
only. `/api/auth/me` gains a computed `is_admin` boolean (UI affordance only — the
real gate is server-side; the allowlist is never sent to the client). This is
swappable to a real role check later, inside the same helper, with zero call-site
churn. We deliberately do **not** reuse `requireDesignPortfolioWriter` (which
falls through to any-signed-in-user in prod).

### Editing model: tier-aware inline, not a global mode (updated)

The original Step 2 sketch flipped a global `officialMode` to make the *whole*
store editable official drafts behind one "Publish" button. That flag was
removed (see `docs/level-editor-save-and-officials-inline.md`). The editing model
is now **tier-aware inline**: every campaign/level already carries its tier
(`origin`/`off-` id), and a save routes by the *thing's* tier, not a mode. A new
shared `frontend/src/campaign/save.ts` is the single spine for both the Campaign
Editor and the Level Editor:

- **Private tier** → `saveUserWorkspace()` (`PUT /api/campaign-workspace`), verb
  **"Save"**, light, no confirm. Serializes only the user slice
  (`userWorkspaceForSave`: `origin !== 'official'`, non-`off-` levels).
- **Official tier** → `publishOfficialWorkspace()`
  (`PUT /api/official-campaigns/default`), verb **"Publish to all players"**,
  confirm dialog, admin-gated. `officialWorkspaceForSave` serializes **only** the
  official slice (`origin === 'official'`, `off-` levels) — a change from the old
  whole-store serialize, which was safe only because `officialMode` made the store
  officials-only.

`readOnly` is **UI-derived**, never trusted from a baked tag: an official campaign
is read-only (padlock) only for non-admins; an admin edits officials in place and
sees an **"OFFICIAL"** tag. `mapSaveError` centralizes error handling: `401` →
sign-in, `403` → "Admin access required to publish official campaigns." (proves the
server fails closed), **`503` → "Server unavailable — try again in a moment."** (a
DB-down branch that previously had no message), else a generic failure.

### Load-bearing guardrails (verified against the code)

1. **Official ids are namespaced and digit-free** — `off-c-<slug>` / `off-l-<slug>`
   with word slugs (e.g. `off-l-river-crossing`, never `off-l-1`). `nextCounterFrom`
   ([store.ts:74](../../frontend/src/campaign/store.ts)) strips all non-digits from
   *every* id when computing the per-user counter, so digits in official ids would
   inflate/collide the user `c/l<n>` space. Counter computation is additionally
   scoped to `origin !== 'official'` ids.
2. **Officials hydrate via the id-preserving path** (`store.hydrate` / a new
   `mergeOfficial`), **never** `importWorkspace`/`duplicateCampaign`
   ([store.ts:104-166](../../frontend/src/campaign/store.ts)) — those re-id to
   `l<counter>` and would orphan official progress.
3. **Progress stays correct for free** — `progress.ts` keys by `levelId` alone in
   localStorage; the disjoint `off-` prefix means official and per-user progress
   can never collide, and all existing per-user entries keep resolving verbatim.
4. **Save never persists officials, and publish never persists private** —
   `userWorkspaceForSave` filters `origin !== 'official'` (and drops `off-` levels);
   `officialWorkspaceForSave` filters to `origin === 'official'` (and `off-` levels);
   both strip `origin`/`readOnly` before PUT, so the per-user row stays
   byte-identical to today and the official row carries only officials. These two
   filters in `frontend/src/campaign/save.ts` (used by both editors) are the accepted
   mitigation for officials sharing the in-memory store array.
5. **PUT validation reuses `validateWorkspaceBody`** plus an added check that every
   campaign/level id carries the `off-` prefix and is digit-free.

### Consequences

- Good: **the prod bug is fixed on Step 1** with a frontend-only, reversible diff —
  no schema, no auth, no endpoint.
- Good: **officials are visible and playable for everyone**, including anonymous
  visitors and during a full Postgres outage.
- Good: **admins publish live**; content edits are decoupled from image deploys.
- Good: **git always holds a recoverable mirror** of official content; the official
  tier honors "content is code-owned files" and the no-DB-dependency rule.
- Good: **per-user tier and player progress are untouched**; honest, fail-closed
  admin gate that needs nothing from upstream auth.
- Cost: **two homes for the official tier** (file + row) kept in sync by a weekly
  job — bounded drift (≤1 week) and a `git diff` no-op guard, but it is a moving
  part, and the in-container fallback file can lag the live DB between deploys.
- Cost: **per-user Save safety rests on one origin-filter** at one call site
  (officials share the store array); mitigated by the `readOnly` tag and treated as
  an explicit acceptance gate.
- Cost: a **new public endpoint and a new env var** (`ADMIN_EMAILS`) to operate.

## Implementation Plan (phased)

Each step is independently deployable and reversible.

**Step 1 — Fix the prod bug (frontend-only; no DB, no auth).**
- Add `frontend/public/assets/campaigns/official.json` (curated officials, `off-`
  digit-free ids, `formatVersion 1`) — seed it from today's demo content re-id'd
  into the `off-` namespace so the official tier is real content from day one.
- `frontend/src/core/level.ts`: add optional `origin?: 'official'|'mine'` (default
  `'mine'`) and `readOnly?: boolean` to `Campaign` (non-breaking, not validated).
- `frontend/src/net/campaignWorkspace.ts`: add `loadOfficialCampaigns()` →
  `fetch('/assets/campaigns/official.json')`, never throws (resolves to empty on
  any failure).
- `frontend/src/campaign/store.ts`: add `mergeOfficial(ws)` (id-preserving, tags
  `origin:'official'`, `readOnly:true`, `locked:true`); scope `nextCounterFrom` to
  `origin !== 'official'`.
- `frontend/src/campaign/hydrate.ts`: rewrite to **always** load+merge officials
  first, then merge the per-user workspace on success; remove the
  `createDefaultWorkspace()`-on-catch fallback and the `if (ws.campaigns.length)`
  short-circuit; re-merge the user tier on auth change.
- **Verify**: signed-out, signed-in+empty (bug fixed), and signed-in+own all show
  officials; with the DB stopped officials still render and play; a user Save writes
  no `off-` id into `campaign_workspaces`.

**Step 2 — Admin authoring of officials (backend; append-only migration).**
- `MIGRATIONS` v4: create `official_campaigns` (clone of `design_portfolios`).
- `GET /api/official-campaigns/:id` (public, `{portfolio:{data,...}}` envelope) +
  `PUT` (`requireAdmin`); add the `requireAdmin` helper and `ADMIN_EMAILS` (fail-
  closed); add `is_admin` to `/api/auth/me` and pass it through `fetchMe`/`AuthUser`.
- Seed the `default` row idempotently from `official.json` lazily/on-first-PUT —
  **never** an eager startup write (startup must not block on the DB).
- Switch `loadOfficialCampaigns()` to prefer the API (unwrap `.portfolio.data`,
  normalize empty `{}`) and fall back to the static file on `503`/error.
- `CampaignEditor.tsx`: render officials read-only with an honest reason ("Official
  campaign — read-only"); for `is_admin`, an isolated **Official** authoring tab
  that PUTs `/api/official-campaigns/default` (distinct from the per-user Save;
  handle `403` separately from the existing `401→goSignIn`).
- **Verify**: an `ADMIN_EMAILS` user's edit shows for everyone; a non-admin gets
  `403` on PUT and read-only officials; with `ADMIN_EMAILS` unset all PUTs `403`;
  with the DB stopped the official GET falls back to the file and the game plays.

**Step 3 — Lock in tier separation (frontend-only).**
- Enforce the `saveWorkspaceNow` origin-filter + tag-strip end-to-end; add the
  auth-change re-merge. No data migration.

**Step 4 — Weekly bake-back (GitHub Actions cron).**
- New workflow: `schedule` weekly + `workflow_dispatch`; `curl` the public official
  GET → `jq` → `official.json`; `git diff --cached --quiet` guard; commit `[skip
  ci]` + push to `main` as `github-actions[bot]`.

**Progress continuity (no migration).** Per-user ids are untouched; officials use
brand-new `off-l-<slug>` ids, so no progress key is reassigned. Any old `demo-*`
progress orphans harmlessly (sample content); an optional one-time
`demo-* → off-l-<slug>` localStorage remap is only worth it if demo campaigns are
promoted verbatim and demo stars must be retained.

**Out of scope (later, independent).** `DROP TABLE campaigns` (the dead legacy
per-user CRUD table, zero callers).

## Pros and Cons of the Options

### A. Code-owned file only
- Good: maximal DB-independence; content fully in git; trivial.
- Bad: no live publishing — every official change needs a commit + deploy.

### B. Live global DB doc only
- Good: live admin publishing; mirrors `design_portfolios`.
- Bad: **violates the no-DB-dependency invariant** — officials vanish on a DB
  outage with no bundled fallback. Rejected.

### C. Status quo (per-user only)
- Good: zero work.
- Bad: does not meet the requirement; officials remain invisible to signed-in
  empty users and to anonymous visitors.

### D. Tiered file + DB override + weekly bake-back (chosen)
- Good: satisfies every driver; contains A as Step 1; live publishing without
  sacrificing DB-independence; git-recoverable.
- Bad: two homes to keep in sync (bounded weekly drift); a new endpoint + env var.

## More Information

- Updates: `docs/persistence.md` (the campaign/workspace rows; the "game never
  depends on the DB" and "content is code-owned" rules this honors).
- Precedent: `design_portfolios` (global, public GET / privileged PUT) in
  `backend/server.js`; write-path discipline in
  [ADR-0019](0019-dev-only-nine-slice-editor-save.md).
- Bug + flow: `frontend/src/campaign/hydrate.ts`,
  `frontend/src/campaign/store.ts`, `frontend/src/campaign/progress.ts`,
  `frontend/src/net/campaignWorkspace.ts`, `frontend/src/ui/Campaign.tsx`,
  `frontend/src/ui/CampaignEditor.tsx`, `frontend/src/core/level.ts`.
- Bake-back precedent: `.github/workflows/build-and-deploy.yaml` (the `[skip ci]`
  commit-and-push-to-main bump-bot).
- New artifacts: `frontend/public/assets/campaigns/official.json`;
  `official_campaigns` table + `/api/official-campaigns/:id`; `requireAdmin` +
  `ADMIN_EMAILS`; the weekly bake-back workflow.
