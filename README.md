# Chess Tactics

Chess-based squad combat prototype.

The sample is a small tactical browser game served by Node/Express. Three
hybrid chess units defend anchors against enemy telegraphs across six breaches.

## Local Dev

Use two fixed local ports with fixed meanings:

- `http://localhost:3000` is the backend/Express preview. It serves the baked
  Vite build from `frontend/dist` and requires `npm run build` to reflect
  frontend source changes.
- `http://localhost:5173` is the Vite frontend dev server. Use it for UI,
  Tileset Studio, and art-workbench iteration that needs hot reload.

Do not try to make `3000` do both jobs during an agent session. If the page HTML
contains `/assets/index-*.js`, it is the baked preview. If it contains
`/@vite/client` and `/src/main.tsx`, it is the hot Vite dev server.

For fast frontend iteration:

```sh
cd frontend
npm install
npm run dev -- --host localhost --port 5173 --strictPort
```

Open `http://localhost:5173`.

For baked preview:

```sh
cd frontend
npm install
npm run build

cd backend
npm install
npm start
```

Open `http://localhost:3000`.

The browser app is built by Vite. Express serves `frontend/dist` as the baked
frontend; source files live under `frontend/src`, and stable public assets live
under `frontend/public`.

## Production Links

- Main menu design portfolio: <https://chess.romaine.life/design/main-menu>

## Agent Preview Contract

Agents and session tooling should start preview through the repo-owned launcher:

```sh
bin/agent-preview
```

The launcher uses `$PORT` when it is set by the session, otherwise `3000`.
It always starts `backend/supervisor.js`; do not run `backend/server.js`
directly for preview work. The supervisor is the supported entrypoint because
it owns the hot backend and static override paths used during session edits.
When the session does not provide explicit override directories, the launcher
uses writable paths under `${XDG_RUNTIME_DIR:-/tmp}`.

To check whether the expected preview is running:

```sh
bin/agent-preview-status
```

A direct `node backend/server.js` process, even on the right port, is not the
agent preview contract.

The server uses `auth.romaine.life` for Microsoft sign-in. Optional env:

- `AUTH_BASE_URL` defaults to `https://auth.romaine.life`.
- `PUBLIC_ORIGIN` defaults to the request host and can pin callback URLs.
- `FRONTEND_DIR` defaults to the built `frontend/dist` directory.
- `STATIC_FRONTEND_DIR` defaults to `/var/run/chess-tactics-static-override`.
- `HOT_BACKEND_DIR` defaults to `/var/run/chess-tactics-hot`.

The container starts `backend/supervisor.js` as PID 1. The supervisor prepares
the runtime server entrypoint, runs it with `NODE_PATH` pointed at the baked
dependencies, and reloads the child process when PID 1 receives `SIGHUP`.

Test-slot validation should deploy the CI-built image for the pushed ref with
Glimmung `deploy_image_to_test_slot`, so backend code, frontend assets, and
runtime wiring are exercised from the same image that PR CI proved.

## Persistence

Durable game/design data (levels, campaigns, campaign workspaces, design
portfolios) lives in **Azure Database for PostgreSQL**, reached passwordless via
Entra workload identity. Art assets remain committed files under
`frontend/public/assets`; they are not database records. The database is
self-provisioned by this repo's `tofu/`. See
[docs/persistence.md](docs/persistence.md) for the schema, auth model, backups,
failure behavior, and the one post-`tofu apply` value to pin.

## Checks

```sh
cd backend
npm test
```

The backend smoke-test exercises the Postgres-backed endpoints, so it needs a
Postgres. It uses `DATABASE_URL` if set, otherwise self-provisions a throwaway
local Postgres from system binaries (as on the GitHub-hosted CI runners). Hosts
without Postgres binaries should set `DATABASE_URL`. The frontend gate runs
without a database:

```sh
cd frontend
npm run check   # node checks + vitest + tsc
```

## Deploy

The app is deployed from `k8s/` by ArgoCD. CI builds and pushes
`romainecr.azurecr.io/chess-tactics:app-<content-fingerprint>` and updates the
Deployment image tag. Trusted test-slot CI runs also create a unique lookup tag
such as `ci-pr-<pr>-run-<run>-attempt-<attempt>` that points at the same ACR
manifest; those lookup tags are for Glimmung test-slot resolution, not chart
values.
