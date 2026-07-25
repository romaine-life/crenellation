---
status: "accepted"
date: 2026-06-26
deciders: Nelson, Claude
---

# ADR-0020: Settings body text follows the role→token type scale

## Context and Problem Statement

No ADR governed the font sizes of settings *content* (section headings, row
titles, descriptions, value readouts). The repo already defines a six-step
modular scale (`--ds-text-2xs`…`--ds-text-xl`, `style.css:1612`) with an explicit
rule — *"map text ROLES onto these steps; don't hand-pick font-sizes per
element"* — but settings elements were assigned ad hoc, and one (the UI-Scale
stepper readout) carried **no token at all**: it fell through to the body's 19px
base, rendering *larger than every row title* and louder than the matching
slider readout. Which size does each piece of settings text get, and on what
basis?

## Decision Drivers

- A role-based scale and its governing rule already exist in the repo; honor it
  rather than per-element sizes ([ADR-0001](0001-use-adrs-for-decisions.md) MADR,
  `style.css:1612`).
- Expert consensus: 6–7 sizes, ~1.2 modular ratio, assigned by **role** —
  designsystems.com, cieden.com.
- A value readout that is bigger than the page's titles is a typographic
  hierarchy failure (same class of problem as [ADR-0008](0008-brand-lockup-typography.md)).

## Considered Options

- **(a)** Map each settings text role onto the existing scale; fix the one
  off-scale element.
- **(b)** Introduce a settings-specific size set.
- **(c)** Leave the ad-hoc sizes as they are.

## Decision Outcome

Chosen: **(a)** — settings text maps to the existing scale by role:

| Role | Token | Examples |
|---|---|---|
| eyebrow / status | `--ds-text-2xs` | section title, account status |
| description / caption | `--ds-text-md` | row description (amended — see below) |
| control value / label | `--ds-text-md` | stepper & slider readouts, row value chip, account name |
| body / row title | `--ds-text-lg` | row `h4` titles |

> **Amended 2026-06-27:** the settings row hierarchy was scaled up one step for
> readability (the original tiers tested too small): description `xs`→`md`,
> value/label `sm`→`md`, row title `md`→`lg`. Description and value now share the
> `md` body tier, a clear step below the `lg` title; the eyebrow (`2xs`) stays the
> smallest. This is a **settings-only** bump — the shared brand lockup ("SETTINGS",
> `lg`; ADR-0003 / ADR-0008) was left unchanged to avoid resizing every screen, so
> the `lg` row title (and the tabs that follow it) now *tie* the brand in size; the
> brand keeps its lead by weight + position. Rail tabs follow the row-title tier to
> `lg` ([ADR-0022](0022-settings-nav-tabs-typography.md)).

The UI-Scale **stepper readout**, which had inherited the body's 19px, now uses
`--ds-text-sm`, matching the slider readout (both are "value" role).

(b) was rejected: a parallel size set duplicates the scale and re-creates the
exact drift the scale exists to prevent. (c) was rejected: it leaves a readout
louder than the titles.

The brand-lockup lines are out of scope here — their sizing is fixed by
[ADR-0008](0008-brand-lockup-typography.md).

### Consequences

- Good: one predictable hierarchy; nothing off-scale; consistent with the repo's
  own rule and with expert practice. CSS-only.
- Cost: none notable — a token swap on one element.

## Pros and Cons of the Options

### (a) Map roles onto the existing scale

- Good: single source of truth; the rule already says to do this.
- Bad: requires naming the role→token map explicitly (this ADR).

### (b) Settings-specific size set

- Good: total local control.
- Bad: duplicates the scale; reintroduces cross-screen drift.

### (c) Leave as-is

- Good: zero work.
- Bad: a value readout stays larger than every title; rule stays unenforced.

## Scope boundary

This ADR governs settings **text**. How a **button's frame relates to its
label** (label size, box-to-label sizing) is a separate decision — see
[ADR-0021](0021-settings-button-label-sizing.md). Buttons draw their size value
*from* this scale but are governed there.

## More Information

- Scale & rule: `frontend/src/style.css` :1612 (rule), :1617 (tokens), :253 (19px base).
- Sources: designsystems.com/typography-guides, cieden.com (establishing a type scale).
- Related: [ADR-0008](0008-brand-lockup-typography.md) (lockup typography), [ADR-0001](0001-use-adrs-for-decisions.md) (MADR).
