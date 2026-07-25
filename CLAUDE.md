# crenellation

Rampart-like castles-and-cannons arcade game (2P couch, controllers, one URL) —
**mid-port from the chess-tactics engine** (imported at chess-tactics@09cc849b,
no history carried). The chess screens still exist as reference while the port
proceeds; Rampart code lives in `frontend/src/rampart/` and mounts at `/play`
(`/skirmish` is the inherited chess game, which dies when the port no longer
needs it).

Ground rules settled at kickoff (don't relitigate):

- **Binary assets are data, never source.** `frontend/public/assets/` is
  gitignored (present locally for the dev server); art/music ship from the
  `crenellationmedia` storage account, not the repo or the image.
- **Persistence**: own Azure Postgres (`crenellation-pg`, db `crenellation`,
  workload identity `crenellation-identity`) — maps, profiles, in-progress
  battles as jsonb-style documents. The game must stay playable with the DB
  down. Provisioned by `tofu/` (state key `crenellation.tfstate`).
- **Deploys**: ArgoCD watches the `prod` branch (`k8s/`), host
  crenellation.romaine.life. Deliberately not cut until the port has something
  worth serving; build-and-deploy on main fails at the sprite guard until the
  frontend checks are reshaped for rampart — known, not worth fixing early.
- Gameplay constants (phase timers, scoring) are placeholders in
  `frontend/src/rampart/phases.ts` pending extraction from the Rampart ROM —
  numbers only; no ripped art or audio (repo and site are public).
- **Local dev is the live-db flow, same shape as chess-tactics**: set
  `DATABASE_URL` in the shell (pgadmin + the break-glass password from
  ng6-crenellation, `sslmode=require`, password URL-encoded), then
  `devctl up crenellation-backend` — plain `node supervisor.js`, inherits the
  env, talks straight to the PROD `crenellation-pg`. The workstation IP is a
  hand-added server firewall rule (`dev-nelson-laptop`, not in tofu — same as
  chess-tactics-pg). Frontend iteration stays on `devctl up
  crenellation-frontend` (vite, no proxy); persistence testing runs against
  the backend's baked preview, same as chess-tactics.

# Working in this repo

## Taking screenshots (read this before trying to screenshot the app)

**Do NOT use the in-editor preview/screenshot tool to capture images on this
machine — its capture step hangs (every grab times out at ~30s, even on a blank
page). The dev server is fine; only the pixel grab is broken.** Don't retry it,
and don't tell the user screenshots are impossible. Use the helper below.

### How

1. Start the dev server **persistently** — through devctl (the dev-servers skill), not a
   backgrounded bash that dies between turns. Plain fallback from `frontend/`:
   `npx vite --host 127.0.0.1 --port 5199 --strictPort`. It serves `index.html` for every
   route (SPA), so any path works.

2. Capture with the `shot` tool. It drives the installed Chrome via `puppeteer-core`
   (system browser, no bundled download), freezes animation for determinism, and **clips
   to a CSS selector** — so you get small, focused, analyzable pixels instead of a
   full-page grab (too many pixels is what breaks image analysis):
   ```
   npm run shot -- <url> [--select <css>] [--out <path>] [--size <WxH>] [--ready <jsExpr>] [--full]
   ```
   Examples:
   ```
   # one element off a REAL screen — small, exact, no fixture needed:
   npm run shot -- http://127.0.0.1:5199/skirmish --select '[data-testid=skirmish-board]'
   npm run shot -- http://127.0.0.1:5199/skirmish --select '.skirmish-board-unit' --out tmp-shots/unit.png
   # whole viewport / a small fixture page:
   npm run shot -- http://127.0.0.1:5199/unit-studio --size 1200x800
   ```
   Output defaults to `frontend/tmp-shots/shot.png` (gitignored). **Default to showing the
   small PNG inline — never substitute a link + description for the pixels.**

This works on ANY live route by selector — no per-target fixture, so there's no "new
screen ⇒ flail" cliff. `frontend/scripts/shot.mjs` is the implementation.

### Reaching a specific UI state

The Studio encodes its state in the URL, so deep-link instead of clicking:
- `mode=catalog|lab`
- `lab=board|tile|unit` (Lab component view)
- `view=board`, `family=<id>`, `collection=<id>`, `asset=<id>`, `unit=<id>`, `seed=<n>`
- `/unit-studio` is an alias for the Studio with the Units shelf preselected.

## Dev environment gotchas (git worktrees)

- A worktree's `frontend/node_modules` may be **partial** (missing react /
  typescript / etc.). Run `npm install` in the worktree once, or typecheck with
  the main checkout's compiler:
  `node ../../../frontend/node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`.
- Never create symlinks/junctions to share `node_modules` — do a real install.
- Plain `npx vite` serves reliably. If you use the preview tool's managed server,
  pin an explicit `--port` and matching `port` in `.claude/launch.json` (no
  `autoPort`), or a port mismatch will make a healthy server look dead.
