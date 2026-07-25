---
status: "accepted"
date: 2026-06-27
deciders: Nelson, Claude
---

# ADR-0031: UI spacing is one tokenized system — a scale, spatial roles, and density modes

The spacing counterpart to [ADR-0024](0024-ui-typography-system.md) (typography is
one tokenized system). Where 0024 makes the `--ds-text-*` layer the law for live
text, this ADR makes the `--ds-space-*` layer the law for the empty space between
and inside elements. It honors the [ADR-0006](0006-ui-decision-criteria.md) surface
split (in-game vs menu) for density, and is scoped to *layout space only* — border,
ornament, and 9-slice frame metrics belong to the chrome/kit ADRs
([ADR-0002](0002-nine-slice-border-image-for-pixel-art-chrome.md)/[ADR-0014](0014-ui-chrome-low-fidelity-aesthetic.md)).

## Context and Problem Statement

A spacing scale already exists in `:root` — `--ds-space-1..6` = **4 / 8 / 12 / 16 /
24 / 32px** — but it was never ratified or made mandatory, so the app bypasses it
almost entirely:

- **1** rule in `style.css` consumes `var(--ds-space-*)`. Against it sit **~711
  raw-px spacing declarations** (`padding` / `margin` / `gap`) spread across **~29
  distinct values** (1, 2, 3, 5, 6, 7, 9, 11, 13, 15, 18, 22, 26, 28 …) — micro-
  stepped, no rhythm, picked per element.
- Spacing communicates grouping (Gestalt proximity): when every element eyeballs
  its own padding, related things stop reading as grouped and the UI reads as
  unpolished. (This is the "inconsistent padding" already noticed on the HUD.)
- The scale stops at 32, so anything larger (page gutters, large section breaks)
  has *no token to express it* — guaranteeing ad-hoc px at the top end.

So a scale exists but there is no system: no rule that space must come from it, no
vocabulary for *why* a given gap exists, and no density policy. New surfaces (the
new HUD View tab included) re-pick px every time.

## Decision Drivers

- One place to change spatial rhythm, not 711.
- Kill the "every element hand-picks its own padding" entropy — the same disease
  0024 fixed for type, fixed for space.
- Make the `--ds-space-*` layer the law, not a suggestion buried in `:root`.
- Respect that a dense in-game HUD and a roomy settings menu legitimately want
  different spacing (ADR-0006) — without re-arguing it per screen.

## Decision Outcome

**All layout spacing is set through design-system tokens. Raw px on a spacing
property (`margin`, `padding`, `gap`/`row-gap`/`column-gap`, and top/right/bottom/
left used as offsets) is not allowed in component CSS.** Mirrors 0024's rule for
type.

### A. The scale — ratify it, extend it up, keep the off-8 steps

Keep `--ds-space-1..6` (4/8/12/16/24/32) and **add `--ds-space-7: 48`,
`--ds-space-8: 64`** (and optionally `--ds-space-9: 96` for top-level layout). This
is the canonical 8px base with a 4px half-step that every major system converges on
(InVision; Material's 8dp grid + 4dp sub-grid; Carbon's 2/4/8 scale), and an 8px
base survives 1.5×/2×/3× density scaling without fractional/blurry pixels — which
matters extra for pixel art. The **4 and 12 steps stay** (fine, component-internal
spacing). Do **not** add in-between values (20/28/36): adjacent close options cause
unpredictable use ("when do I use 24 or 28? I dunno" — Curtis). Refine by extending
up, never by subdividing.

### B. Spatial roles — name *why* space exists, don't pick a number

Layer the EightShapes role vocabulary over the numeric scale, so component CSS
references a role alias that resolves to a step (never a px literal):

- **inset** — padding on all four sides of a container (panels, cards, HUD tiles).
- **stack** — vertical gap between stacked siblings (rows, menu items, log lines).
- **inline** — horizontal gap between in-flow siblings (button groups, pills, icon+label).
- **gutter** — inter-section / column gaps (page gutters, two-pane splits) — the
  consumer of the new large steps.

Component-specific spacing routes through a semantic alias that points back at a
role/step (the Polaris/Carbon mechanism), e.g. `--ds-card-inset: var(--ds-space-4)`,
`--ds-button-group-gap: var(--ds-space-2)`. Change a step → every consumer updates.

### C. Density — two modes bound to the surface split, not per-element guessing

Density is a surface-level dial with two named modes (the Cloudscape
comfortable/compact model), selected by an attribute on the surface root
(e.g. `data-density`), which swaps which end of the scale the role aliases resolve to:

- **compact** — in-game surfaces (board / HUD / skirmish). Per ADR-0006 these lean
  game-UI (glanceability, protect play space, density is fine), so insets/stacks
  draw from the tight end. A combat HUD surfacing unit/roster/log at a glance is a
  data-dense view (Cloudscape; Material density for data-rich surfaces).
- **comfortable** — menu/chrome surfaces (settings, studio, editors). These lean
  product-UI (clarity, breathing room), so they draw from the roomy end.

**The ADR-0006 usability floor is an absolute cap that overrides density:** compact
must never push interactive hit targets below ~44–48px or break legibility /
label-control proximity. Density is set by the mode, never by hand-tuning px per screen.

### D. Mandate & enforcement

1. Every spacing value resolves to a role alias → a scale step. No raw px/rem on a
   spacing property; allow only `0`, `auto`, `100%`.
2. Need a value the scale lacks? Pick the nearest step, or **add a step to the scale
   in a PR** — change the system, never drift one element.
3. Enforce in CI (stylelint allowed-list on spacing properties), with a **shrinking
   grandfather allowlist** while the existing ~711 declarations migrate, then flip
   the rule to error.
4. Out of scope: border/ornament/9-slice frame metrics (chrome/kit ADRs own those).

### Consequences

- Good: one knob for spatial rhythm; the "every element hand-picks padding" entropy
  ends; dense HUD and roomy menus coexist by policy, not per-screen tuning; the
  orphaned scale becomes a live, enforced system (paired with 0024 for type).
- Cost: a real migration (~711 declarations → tokens) and a lint rule to add; the
  grandfather list shrinks over time rather than a big-bang rewrite.

## More Information

- Sibling: [ADR-0024](0024-ui-typography-system.md) (typography system); surface
  split: [ADR-0006](0006-ui-decision-criteria.md); chrome text: [ADR-0014](0014-ui-chrome-low-fidelity-aesthetic.md).
- Research (verified): 8px base + 4px half-step & pixel-scaling — [InVision: Space, grids, and layouts](https://www.designsystems.com/space-grids-and-layouts/), [spec.fm: 8-Point Grid](https://spec.fm/specifics/8-pt-grid), [Material: Spacing methods](https://m2.material.io/design/layout/spacing-methods.html). Scale + tokens — [IBM Carbon: Spacing](https://carbondesignsystem.com/elements/spacing/overview/), [Material 3: Spacing tokens](https://m3.material.io/styles/spacing/tokens), [Shopify Polaris: Space tokens](https://polaris-react.shopify.com/tokens/space). Spatial roles + curated scale — [EightShapes: Space in Design Systems](https://eightshapes.com/articles/space-in-design-systems/). Density — [Cloudscape: Content density](https://cloudscape.design/foundation/visual-foundation/content-density/), [Una Kravets: Using Material Density on the Web](https://medium.com/google-design/using-material-density-on-the-web-59d85f1918f0).
- Token layer: `--ds-space-*` in `frontend/src/style.css` `:root`.
