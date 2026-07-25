---
status: "accepted"
date: 2026-06-28
deciders: Nelson, Claude
---

# ADR-0042: The title bar is an invariant — screens ADD optional slots, never replace its chrome

Refines [ADR-0023](0023-app-title-bar-layout-and-controls.md) (three-section bar,
every screen) and [ADR-0036](0036-trailing-account-settings-cluster-is-icon-only.md)
(the trailing account/settings cluster). Builds on
[ADR-0004](0004-standard-app-title-bar.md) (one shared full-bleed bar) and
[ADR-0003](0003-single-shared-brand-lockup.md) (the brand lockup).

## Context and Problem Statement

ADR-0004 gave us one shared `.app-titlebar`; ADR-0023 then mandated the same
three-section treatment on **every** screen with the express purpose of stopping
per-screen drift; ADR-0036 fixed the trailing **account + settings cluster** as the
canonical top-right corner. Together these read as: the bar's leading brand and
trailing account cluster are a constant the user can orient by everywhere.

But the *implementation* didn't encode that. The per-route `titleBarConfig` made the
cluster an **opt-in flag** (`showAccountCluster?`), and let a screen swap the whole
trailing edge for a **custom slot** (`rightSlot?`) — the two being mutually exclusive
in `AppTitleBar` (`showAccountCluster ? cluster : rightSlot ? customActions : null`).
So a screen that wanted its own actions had to *give up* the cluster. Two surfaces did
exactly that: the **Level Editor** (`/edit`, `/level-editor`) and the **Campaign
Editor** (`/campaigns-next`, `/campaigns`) set `rightSlot` and omitted
`showAccountCluster`, and shipped with **no Settings gear and no avatar** — each
hand-rolling a plain-text `Settings` link instead. That is precisely the per-screen
drift ADR-0023 set out to kill, reintroduced through the config's own escape hatch,
and it silently contradicts ADR-0036's "fixed top-right corner."

The root cause is a contract bug: the bar's invariant chrome was expressed as
*optional*, and custom content was modeled as *replacing* the trailing edge rather
than *adding* to it.

## Decision Drivers

- The brand (leading) and account/settings cluster (trailing) are orientation and
  identity anchors; users rely on them being in the same place on every screen
  (ADR-0023, ADR-0036, NN/g navigation consistency).
- "Stop per-screen drift" (ADR-0023) must be enforced by the **code contract**, not
  left to each screen's config discipline — an optional flag is a drift generator.
- Screens genuinely need to add contextual content (live status, editor actions);
  the model must welcome that **without** letting it cannibalize the invariant.

## Considered Options

- **Keep the opt-in flag** (status quo). Rejected: it is the mechanism that produced
  the two offenders; "optional invariant" is a contradiction.
- **Per-screen bespoke headers.** Long ago rejected by ADR-0004.
- **Make the bar an invariant with additive slots** (chosen).

## Decision Outcome

**The persistent `AppTitleBar` ALWAYS renders its invariant chrome — the `BrandLockup`
(leading edge) and the `HeaderAccountCluster` (trailing edge). No route config can
suppress either.** Screens may only **ADD** optional regions *between* the brand and
the cluster:

1. **`centerSlot`** — contextual status portaled by the screen (Skirmish turn/objective,
   the editors' save-state).
2. **`actionsSlot`** — page-specific, **labeled** controls (Save, Publish, Test, ‹Catalog),
   portaled by the screen. (Renames the old `rightSlot`; "right" wrongly implied it
   owned the trailing edge — the cluster does.)

Additive content is laid out **before** the cluster; it never replaces it. The bar is a
brand · [center] · [actions] · cluster row — the same N-section pattern the Skirmish bar
already proved, generalized.

The **only** per-cluster modulations a config may set are the ones ADR-0036 already
sanctioned, and neither removes the account control:

- `showSettingsGear: false` — hides *only* the gear (the account control stays). An
  available modulation, but no screen currently uses it: even Settings keeps its gear
  as a "back to settings root" link (#241), so the gear is effectively universal too.
- `signInReturnTo` — where the signed-out **Sign In** control returns to.

`showAccountCluster` is **deleted** — its only honest value was `true`. The config can
no longer express "no cluster," which is the entire point.

### Consequences

- **Good:** the gear + avatar are now guaranteed on every screen by construction; the
  Level and Campaign editors regain them; the invariant is un-bypassable in code, not
  merely by convention; ADR-0023's anti-drift intent is finally enforced where it
  matters.
- **Good:** screens that need actions get a clean additive `actionsSlot` that coexists
  with the cluster — no false either/or.
- **Cost:** bars carrying both actions and the cluster need a trailing cluster column in
  CSS (the editors gain a 4th grid column, at the `.app-shell-titlebar.<bar>`
  specificity Skirmish already uses to beat the base bar grid).
- **Cost:** the two editors' hand-rolled `Settings` text links are removed (the cluster's
  icon-only gear replaces them per ADR-0036).

## More Information

- **Refines:** [ADR-0023](0023-app-title-bar-layout-and-controls.md),
  [ADR-0036](0036-trailing-account-settings-cluster-is-icon-only.md). **Builds on:**
  [ADR-0004](0004-standard-app-title-bar.md),
  [ADR-0003](0003-single-shared-brand-lockup.md).
- **Components:** `frontend/src/ui/shell/AppTitleBar.tsx` (always renders brand +
  cluster), `frontend/src/ui/shell/titleBarConfig.ts` (`centerSlot` / `actionsSlot`,
  no `showAccountCluster`), `frontend/src/ui/shell/TitleBarSlot.tsx` (`region:
  'center' | 'actions'`), `frontend/src/ui/shared/HeaderAccountCluster.tsx` (the
  invariant cluster). **Classes:** `.app-shell-titlebar-center` /
  `.app-shell-titlebar-actions`; bar grids `.app-shell-titlebar.{skirmish,le,ce}-topbar`.
