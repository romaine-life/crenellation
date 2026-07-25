# UI Kit Standard

One framing system for the whole app. This document is the source of truth for
how every screen draws panels, buttons, rows, fields, tabs, and icons. If a new
surface needs chrome, it composes from the types defined here — it does **not**
invent its own class namespace or its own art.

Status: proposed standard (grounded against `main` @ `0973279`). No surface has
been migrated yet. Studio surfaces are explicitly out of scope (see below).

## Why this exists

As of current `main`, framing is done six different ways — one bespoke class
namespace and art approach per screen:

| Surface | Prefix | Rules | Framing technique | Verdict |
|---|---|---|---|---|
| Settings | `settings-*` | 69 | baked full-frame crops, `background 100% 100%` stretch | best **art**, wrong **technique** |
| Lobbies | `utility-*` | 80 | `border-image` 9-slice of full assets | right **technique** |
| Campaign editor | `ce-*` | 165 | `slice-*` mini-assets + `100% 100%` stretch | broken |
| Level editor | `le-*` | 105 | ~flat CSS, 2 asset frames | wireframe |
| Skirmish | `skirmish-*` | 173 | flat CSS, **0** asset frames | unstyled chrome |
| Main menu | `mode-*` | 18 | sprite-sheet rect cropping | legit (true atlas) |

Across `style.css` there are currently **19** `100% 100%` stretches and **15**
`border-image` 9-slices — the codebase is split roughly down the middle between
the wrong technique and the right one. Settings (#114, "cleaned asset kit") is
the most recent surface and it added a *sixth* island rather than adopting any
existing one. That is the disease this standard ends.

## The decision

> Recorded as [ADR-0002](adr/0002-nine-slice-border-image-for-pixel-art-chrome.md);
> this section is the consolidated current-state of that decision.

**One kit = the Settings art direction, rendered with the Lobbies technique.**

1. **One technique — 9-slice via `border-image` of the full asset.** A single
   source PNG (corners + edges + stretchable center) scales to any element size.
   No `background-size: 100% 100%`. No per-size baked frames (no more
   `setting-row-frame` *and* `setting-row-tall-frame`). No `slice-*` mini-assets.
2. **One metadata source — patch margins in a manifest** (the existing
   `asset-catalog.json` model). Every framed asset declares
   `{ top, right, bottom, left }` margins; the renderer reads them. Delete the
   duplicate per-feature manifests once their assets are folded in.
3. **One renderer — a shared `<Frame>` component (or one CSS utility class
   family)** that takes an asset id + state and emits the `border-image` rule
   from the manifest margins. No surface hand-writes `border-image` again.
4. **One icon mechanism + one icon set.** `gear`, `rook-blue`, `rook-red`, and
   the chess pieces are currently redrawn 3–4× across `main-menu/`, `skirmish/`,
   `utility/`, and `settings/`. Consolidate to one set referenced everywhere.
5. **Generate the art (method-verified); the concept is the style reference.**
   (Updated by [ADR-0011](adr/0011-chrome-art-generated-not-extracted.md) — this
   point used to say "extract the original," an early stopgap that beat codex's
   *code-drawn* redraws but produced dirty, asymmetric crops.) Chrome art is now
   produced by **codex img2img generation, verified via an `image_generation_call`
   event** (see [kit-forge.md](kit-forge.md)), or **assembled from codex-generated
   atoms** (`assemble-frame.mjs`). The accepted concept art is the style/palette
   reference fed into generation and the review target — **not** a crop source.
   Do not procedurally redraw chrome in code/CSS, and do not extract whole- or
   per-slice crops from the concept.
6. **Never patch with bespoke CSS.** CSS composes, positions, and state-switches
   art; it never recreates bevels, frames, glows, or corners with gradients.
7. **Every generator self-gates with `verifyAsset` — no asset is "good" by
   eyeball.** Each `generate-kit-*.mjs` runs `frontend/scripts/verify-kit-asset.mjs`
   on what it wrote and THROWS on the clipping class: a fully-transparent column/
   row, broken left/right symmetry (for mirrored assets), or a border that isn't
   continuous along an edge (corners present but the side clipped). This exists
   because eyeballing a stretched render repeatedly missed real clips (half-black
   button, clipped row bottom, open-sided neutral) that a pixel scan caught
   instantly. The gate covers *mechanical* defects only — faithfulness, seams,
   and "is this the right region" still need human review.

## Canonical type catalog

Eleven types. Each screen is assembled from these. The "Source today" column is
the existing asset that becomes the basis for the canonical art (re-cut to true
9-slice where it is currently a baked/stretched crop).

| # | Type | Variants × states | Source today |
|---|---|---|---|
| 1 | **Button** | neutral / primary / danger × normal·hover·pressed·disabled | settings `neutral/primary/danger-button`; states from skirmish `action-*` (most complete) |
| 2 | **Icon button** (square) | neutral / selected / danger | ce `icon-button*`, settings `stepper-button` |
| 3 | **Panel / frame** | shell / content / rail / inset-well | settings `main-panel-frame`, `rail-panel-frame` |
| 4 | **Row / list item** | normal / selected | settings `setting-row-frame`; ce `row-*-selected` (cyan glow) |
| 5 | **Field / input** | text / select-dropdown | ce `field-input`, `field-select` (gap in settings kit) |
| 6 | **Toggle** | on / off | settings `toggle-on/off` |
| 7 | **Stepper** | +/- numeric | settings `stepper-button` |
| 8 | **Tab** | active / inactive (+ hover/disabled) | settings `active-tab`, `inactive-tab` |
| 9 | **Bar / tray** (full-width chrome) | header / footer | settings `header-frame`; ce `footer-bar` |
| 10 | **Section divider** | label rule | settings `section-divider-frame` |
| 11 | **Icon glyph** | one shared set | unify `main-menu` + `skirmish` + `utility` + `settings` icon-* |

Feature-unique art that is **not** a chrome type and stays per-feature: faction
**shields** (`ce shield-*`), the **board / preview frame** (`ce preview-frame`,
`skirmish portrait-frame`), and the **board renderers** themselves.

Gaps the settings kit does not yet cover and will need new assets: **Field /
input / select** (type 5) and a unified square **Icon button** (type 2).

## Mechanism spec

The canonical CSS shape for every framed control (what `<Frame>` emits):

```css
.frame {
  background: transparent;
  border-style: solid;
  border-color: transparent;
  image-rendering: pixelated;
  /* margins + widths come from the manifest, not hand-typed per surface */
  border-width: var(--frame-top) var(--frame-right) var(--frame-bottom) var(--frame-left);
  border-image: var(--frame-src) var(--frame-slice) fill / 1 stretch;
}
.frame[data-state="selected"] { border-image-source: var(--frame-src-selected); }
```

State is a data attribute swapping `border-image-source`. This is exactly the
Lobbies/`utility-*` pattern, generalized and fed by the manifest.

## Asset + folder convention

- One shared kit folder: `frontend/public/assets/ui/kit/` with one
  `manifest.json` (type, variant, state, patch margins per asset).
- Per-feature folders keep only feature-unique art (shields, board frames).
- Source-of-truth concepts stay in `docs/art/ui-screen-concepts/`.

## Migration map + order

Out of scope: **Studio** (`/tileset-studio`, `/unit-studio`, tile/tileset
review + preview). The owner is evolving those under intense UI needs and will
style them to the app separately. Do not touch.

1. **Build the kit + `<Frame>` renderer** from the Settings art, re-cut to true
   9-slice with a `kit/manifest.json`. Prove it on Settings and Lobbies (already
   closest) — they should look identical before/after but scale correctly.
2. **Skirmish** — highest payoff: 173 rules, 0 asset frames today. Reframe all
   chrome (panels, action buttons, rows, tabs, bars) onto the kit.
3. **Campaign editor** — delete `slice-*` assets and the duplicate `manifest.json`;
   rebuild `ce-*` chrome on the kit; keep shields + preview frame.
4. **Level editor** — replace the flat-CSS `le-*` chrome with kit frames.
5. **Retire** orphaned/duplicate assets (`slice-*`, per-size baked frames,
   redundant icon copies) and collapse the per-feature manifests into the kit.

## Acceptance gates (per migrated surface)

- No `background-size: 100% 100%` or `slice-*` border-images remain on it.
- Every framed control routes through `<Frame>` / the kit classes.
- One source asset renders at multiple element sizes without distortion.
- Desktop screenshot matches the surface's concept.
- No new per-surface class namespace was introduced.
