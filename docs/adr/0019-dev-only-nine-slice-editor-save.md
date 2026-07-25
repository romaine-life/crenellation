---
status: "accepted"
date: 2026-06-27
deciders: Nelson, Claude
---

# ADR-0019: Dev-only in-app 9-slice editor that saves to disk through the shared bake

Extends the single 9-slice registry ([ADR-0016](0016-single-source-nine-slice-registry.md))
and the atom assembler + handedness it bakes through
([ADR-0012](0012-nine-slice-frames-are-atom-assembled.md),
[ADR-0017](0017-per-asset-flipsides-handedness.md)) with a way for the user — not the
agent — to tune a frame's atom offsets one pixel at a time and persist the result
into the repo. It is the editing counterpart of the live compare-surface lineage
([ADR-0005](0005-artwork-compare-fidelity-surface.md)): where that surface lets
you *see* the result, this one lets you *commit* it.

## Context and Problem Statement

Tuning a frame's gold bracket against its keyline border is a 1px-at-a-time
judgement call the user wants to own. Until now the only path was: the user
describes the nudge, the agent edits a config, re-bakes, and screenshots — a
synchronous round-trip per pixel, and a serialization point across the parallel
sessions the user runs.

There was an in-app editor, but it could only emit JSON to copy-paste back to an
agent. That reintroduced the agent into the loop and, worse, risked drift: a hand
edit, a CLI bake, and the editor's own preview were three places the same offsets
could disagree.

We want the user to nudge and **Save**, landing a committed config + regenerated
PNGs on disk, with no agent in the loop and no second bake implementation to drift
against — while never shipping a write endpoint to production.

## Decision Drivers

- Let the user own frame-tuning **asynchronously**, in parallel sessions, without a
  synchronous agent round-trip per pixel.
- Keep a **single bake path** — the editor's Save and the CLI must produce
  identical output by construction, not by discipline.
- **Never ship** the editor or its write endpoints to production.
- Don't fork the registry schema: the editor must read the same source of truth as
  the bake and the catalog ([ADR-0016](0016-single-source-nine-slice-registry.md)).

## Decision Outcome

Chosen: **a dev-gated in-app editor backed by a serve-only Vite endpoint that bakes
through the shared kit**, because it removes the agent from per-pixel tuning while
keeping one bake implementation and never reaching a production build.

- **Editor** — `frontend/src/ui/NineSliceEditor.tsx`, exported as `NineSliceLab` and
  embedded as the Studio's `nineslice` Viewer kind (the frame twin of `PortraitLab`),
  per `docs/studio-control-architecture.md` — it is NOT its own route. `/nine-slice-editor`
  survives only as a deep-link **alias** into the Studio (like `/unit-studio`): the
  Studio reads `?asset=<id>` off that path and canonicalises the URL to
  `/tileset-studio?…&vk=nineslice&frame=<id>`. It derives its asset list from the
  registry, so every registered atom-built frame is editable with no per-frame code.
  The arrow keys (and a d-pad) nudge the active piece 1px; offsets are clamped so a
  piece can't leave the footprint. The Asset Viewer deep-links into it —
  `AssetLibraryStudio.tsx`'s `AssetLab` renders an "✎ Edit in 9-slice editor" button
  that switches the Viewer kind in place (no route swap, no "Back to catalog" link;
  the Catalog tab is back).
- **Endpoint** — `frontend/scripts/vite-nine-slice-plugin.mjs`, exporting
  `nineSliceDevSave()` with **`apply: 'serve'`**, wired into
  `frontend/vite.config.js`'s `plugins`. `apply: 'serve'` means the middleware
  exists *only while `vite` is serving* — it is never part of a production build,
  so the write path cannot ship. It exposes two routes:
  - `GET /__nine-slice/config?asset=<id>` — returns the on-disk config so the
    editor hydrates from real saved state, not localStorage or defaults (otherwise
    a fresh editor would Save defaults over the committed config). Unknown assets
    400; a missing config file returns `config: null` and the editor keeps defaults.
  - `POST /__nine-slice/save` — normalizes the posted config, writes
    `config/nine-slice/<asset>.json`, calls `buildAsset()` to regenerate every
    variant PNG, calls `writeGeneratedCss()`, and appends a `logSave()` audit line.
- **One bake path** — both Save and the apply CLI go through `buildAsset()` in
  `frontend/scripts/nine-slice-kit.mjs`, so editor and bake **cannot diverge**.
  The editor's preview re-implements the same assembler (`buildFrameCanvas`, with
  `rot90` / `flipSides` copied verbatim from `assemble-frame.mjs`) so what you nudge
  is what bakes.
- **Dev gate** — the Save button and the hydration fetch are both behind
  `import.meta.env.DEV`. The button is gated client-side; the endpoint only exists
  server-side in serve mode — dev-only by construction from both ends.

### Scope rules baked in

These two are load-bearing, enforced identically in the editor preview and the bake:

1. **Keyline offset is inert.** The border is continuous by construction (atoms +
   `flipSides`, per [ADR-0012](0012-nine-slice-frames-are-atom-assembled.md) /
   [ADR-0017](0017-per-asset-flipsides-handedness.md)), so nudging only a corner's
   keyline would diverge from the fixed edges — a state the bake can't reproduce.
   The editor renders corner and edges at keyline `0,0` and only exposes the
   **bracket** as nudgeable; `tuneCorner` in the kit moves only the warm gold and
   leaves the cool keyline fixed. If a config carries a non-zero keyline, the bake
   **warns** (`keyline offset is IGNORED`) and the editor surfaces it on Save.
2. **Content is consumption-side.** It records element padding — where text and
   icons start — *not* a PNG edit. It is written into the config and carried into
   CSS by `writeGeneratedCss()` (the asset's `consume.cssVar` in
   `src/generated/nine-slice.css`), never baked into the pixels.

Every save is auditable on disk: `logSave()` appends one JSON line per bake to
`config/nine-slice/save-log.jsonl` (timestamp, source, asset, exact config, output
files), so a change is detectable on the filesystem, not just in the browser.

### Consequences

- Good: the user makes **user-driven, async, repo-persisted** frame edits across
  parallel sessions with no agent round-trip.
- Good: **one bake path** — editor Save and CLI both call `buildAsset()`, so there
  is no editor/CLI drift, and the editor preview shares the assembler logic.
- Good: **dev-only by construction** — `apply: 'serve'` keeps the write endpoint
  out of production builds; `import.meta.env.DEV` keeps the button out of the
  production UI.
- Good: scope rules (inert keyline, consumption-side content) are enforced in one
  place each and warn rather than silently mis-bake.
- Cost: a **dev endpoint surface** (`/__nine-slice/save`, `/__nine-slice/config`)
  that must stay serve-only — its safety rests on the `apply: 'serve'` guard.
- Cost: the editor must **track the registry schema** ([ADR-0016](0016-single-source-nine-slice-registry.md));
  a registry field the editor doesn't read can't be tuned in-app.

## More Information

- Editor: `frontend/src/ui/NineSliceEditor.tsx` (`NineSliceLab`), embedded as the
  Studio's `nineslice` Viewer kind in `frontend/src/ui/TilePreview.tsx`; the
  `/nine-slice-editor` alias is handled in `frontend/src/ui/App.tsx` +
  `readTilesetStudioRoute`/`writeTilesetStudioRoute`; the in-Viewer edit button is in
  `frontend/src/ui/design/AssetLibraryStudio.tsx` (`AssetLab`).
- Endpoint: `frontend/scripts/vite-nine-slice-plugin.mjs` (`apply: 'serve'`), wired
  in `frontend/vite.config.js`.
- Shared bake: `frontend/scripts/nine-slice-kit.mjs` (`buildAsset`,
  `normalizeConfig`, `writeGeneratedCss`, `logSave`, `REGISTRY`, `CONFIG_DIR`).
- Registry: `frontend/config/nine-slice-registry.json` (read by the bake, editor,
  and catalog).
- On disk: `config/nine-slice/<asset>.json`, `config/nine-slice/save-log.jsonl`,
  `src/generated/nine-slice.css`.
- Related: [ADR-0016](0016-single-source-nine-slice-registry.md) (the registry it
  reads), [ADR-0012](0012-nine-slice-frames-are-atom-assembled.md) /
  [ADR-0017](0017-per-asset-flipsides-handedness.md) (assembler + handedness it bakes
  through), [ADR-0005](0005-artwork-compare-fidelity-surface.md) (the live
  compare-surface lineage), [ADR-0002](0002-nine-slice-border-image-for-pixel-art-chrome.md)
  (the `border-image` mechanism).
