---
status: "accepted"
date: 2026-06-25
deciders: Nelson, Claude
---

# ADR-0004: One shared, full-bleed app title bar at a standard height

## Context and Problem Statement

Every screen hand-set its own title-bar height and art — Settings ~94–116px with
a gold panel frame, Skirmish ~68px with a bottom rule, Studio content-sized, the
campaign editor a thin border + gradient. With no shared header, heights and
styling drifted between screens.

## Decision Drivers

- A consistent header is what users use to orient; reinventing it per screen is a
  named anti-pattern.
- The in-game HUD legitimately needs to protect board space (a shorter bar).

## Considered Options

- Keep per-screen bespoke headers (status quo).
- One shared header, every screen identical including the in-game HUD.
- One shared header component + height token with a per-screen content slot; the
  in-game HUD as a documented compact variant.

## Decision Outcome

Chosen: **one shared `.app-titlebar`** — the gold `panel.png` 9-slice frame at a
single `--app-header-h` token (~72px), full-bleed (flush to the screen edges),
with per-screen content inside.

Height is standardized toward Skirmish's ~68–72px, not Settings' 94–116px:
Material's standard top app bar is 48–56dp, while the tall "prominent" bar
(96–128dp) is explicitly reserved for hero/imagery moments — so Settings was the
oversized outlier, not the standard.

## Consequences

- Good: one token and one source; bars can't drift; full-bleed matches top-app-bar
  convention.
- Cost: screens migrate onto `.app-titlebar`; the in-game HUD may later need a
  documented compact variant of the same component.

## More Information

- Material top app bar (m2/m3); NN/g navigation guidance.
- Token: `--app-header-h`; class: `.app-titlebar`.
- Consolidated current-state: [`../ui-art-direction.md`](../ui-art-direction.md).
