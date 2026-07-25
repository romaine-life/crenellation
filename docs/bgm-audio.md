# Background music (BGM)

The game plays a continuously **shuffled** soundtrack. This doc covers the
architecture and how to change the soundtrack.

## Architecture

The **blob container is the single source of truth.** The soundtrack *is* whatever
mp3s are in the container — add or remove a track there and the game follows it,
with no manifest to regenerate and no redeploy. The frontend talks only to the
backend's own contract, never to Azure directly (*borrow primitives, not
boundaries*).

```
browser ── GET /api/bgm ──▶ chess-tactics backend ── List Blobs (+metadata) ──▶ Azure Blob (bgm container)
   └────────── <audio> streams tracks directly from <bgm>/<file> (no-cors, public-read) ──────────┘
```

- **Backend** (`GET /api/bgm`, `backend/server.js`) **lists** the container and
  reads each blob's `title`/`artist`/`album` **metadata**, returning
  `{tracks:[{title, artist?, album?, url}]}` with absolute track URLs. It
  authenticates with the pod's **workload identity** — the same federated token
  used for passwordless Postgres — authorized by a `Storage Blob Data Reader`
  role on the media account (`tofu/storage.tf`). The list is cached briefly (5 min
  TTL). It never 500s: on error it serves the last good list, then an empty
  playlist. The container is public-*read* (browsers stream tracks) but **not**
  public-*list* — enumeration is the backend's authenticated job.
- **Titles** live in **blob metadata**, which is the editable source of truth: set
  it in the Azure portal / Storage Explorer, or seed it from each mp3's ID3 tag
  with the sync tool below. A blob with no `title` metadata falls back to a
  readable title derived from its filename.
- **Player** (`frontend/src/bgm.js`, `initBgm()` wired in `main.tsx`) fetches
  `/api/bgm`, builds a Fisher-Yates shuffle, and plays through it with one
  `<audio preload="none">` element, reshuffling each cycle and never repeating a
  track back-to-back across the boundary.
- **On-demand streaming** — only the *currently playing* track is fetched, one at
  a time, via HTTP range requests. A large library costs a listener only the song
  they're hearing. Nothing is preloaded or bundled.
- **Autoplay-safe** — browsers block audible autoplay until a user gesture, so
  playback is armed on the first `pointerdown`/`keydown`/`touchstart`.
- **Mute control** — a persistent title-bar control toggles mute (persisted in
  `localStorage`). It hides itself when `/api/bgm` returns no tracks.

`npm run check` (frontend) runs `scripts/check-bgm-shuffle.mjs`, which guards the
shuffle invariants.

## Changing the soundtrack

Everything happens in the **`bgm` container** (storage account `chesstacticsmedia`).
No git, no build, no redeploy.

- **Add a song** — upload the `.mp3` to the container (portal / Storage Explorer).
  It joins the shuffle within the cache TTL. To give it a clean title without
  typing, run **Sync BGM metadata** (below) — it reads the mp3's ID3 tag and writes
  the `title`/`artist`/`album` metadata. Or set that metadata by hand.
- **Remove a song** — delete the blob. It leaves the shuffle within the cache TTL.
- **Rename a title** — edit the blob's `title` metadata in the portal. That's the
  source of truth; the sync tool won't overwrite a title you've set.

### Sync BGM metadata (titles from ID3 tags)

`tools/bgm/sync-metadata.mjs` mirrors each mp3's embedded ID3 tag onto its blob as
metadata. It is **optional convenience** — nothing in the serving path depends on
it — and **non-clobbering**: it only fills blobs whose `title` metadata is empty
(use `--force` to overwrite).

- **From CI (one click):** run the **Sync BGM metadata** workflow
  (`.github/workflows/sync-bgm-metadata.yml`, `workflow_dispatch`). It authenticates
  with the CI service principal (`Storage Blob Data Contributor`).
- **Locally:** `az login`, then
  `npm --prefix tools/bgm install && node tools/bgm/sync-metadata.mjs [--force] [--dry-run]`.

## Where the audio lives

Nothing audio-related is in git or the app image (`*.mp3` is git-ignored; there is
no committed manifest). It all lives in a public-read Azure Blob container,
provisioned by this repo's OpenTofu (`tofu/storage.tf`):

- storage account: `chesstacticsmedia`, container: `bgm` (anonymous blob *read*,
  not list)
- role assignments: the app's workload identity gets `Storage Blob Data Reader`
  (list + read, for `/api/bgm`); the CI service principal gets
  `Storage Blob Data Contributor` (for the metadata-sync workflow)
- the backend's `BGM_BASE_URL` (`k8s/values.yaml`) is this container's public base

> Historical note: the soundtrack mp3s were originally uploaded from a long-lived
> `nelson/songs` git branch via an `upload-bgm` pipeline that also wrote an
> `index.json` manifest. That branch + pipeline + manifest are retired — the
> container is now self-describing. The branch may be kept as a cold backstop, but
> nothing reads from it.

## Provisioning runbook (one time)

CI lives in `.github/workflows/`: `tofu.yaml` (plan/apply) and `sync-bgm-metadata.yml`.

1. **Enable app-owned tofu** (infra-bootstrap, one line): add `chess-tactics` to
   `local.runs_own_tofu_apps` in `tofu/main.tf`. Merging grants this repo's CI
   service principal state access + the roles it needs.
2. **Apply this repo's tofu** — the `Infrastructure` workflow plans on PR and
   applies on merge to `main`, creating the storage account, the `bgm` container,
   the app identity's `Storage Blob Data Reader` role, and CI's
   `Storage Blob Data Contributor` role.
3. **Add the tracks** — upload `.mp3`s into the `bgm` container (portal / Storage
   Explorer), then run **Sync BGM metadata** to seed titles from their ID3 tags.

Until step 3, BGM is dormant: `/api/bgm` returns an empty playlist (an empty
container lists nothing) and the control hides itself — no errors, no churn.

## Testing without Azure

The backend supports a credential-free static-index path for environments with no
Azure container, selected by setting **`BGM_READ_URL`** (it reads
`<BGM_READ_URL>/index.json` instead of listing):

- **Smoke test** (`backend/smoke-test.js`) points `BGM_READ_URL` at a same-origin
  mock serving a tiny `index.json`, exercising the playlist contract end to end.
- **Local dev** (`frontend/vite.config.js`, opt in with `BGM_DEV_TRACKS=1`) has no
  backend, so its dev mock proxies the **deployed** backend's `/api/bgm` (override
  with `BGM_API_URL`) — real tracks, real metadata, no credentials.

In production no `BGM_READ_URL` is set, so the backend lists the live container.
