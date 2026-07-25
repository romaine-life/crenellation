---
status: "accepted"
date: 2026-06-26
deciders: Nelson, Claude
---

# ADR-0022: Settings rail tabs — a navigation component, sized at the content tier (md)

Splits the navigation tabs out of the action-button rule in
[ADR-0021](0021-settings-button-label-sizing.md), and sets their label size.

## Context and Problem Statement

The settings rail tabs (General / Audio / Gameplay / Creator Tools) wear the same
ornate bracket "mode-button" frame as the header action buttons, which tempted a
single frame-based rule covering both. But the tabs *switch views* — they're a
navigation control, not an action. Two questions: is their typography governed by
the action-button rule or on its own, and **what size** is a nav-tab label?

## Decision Drivers

- Design systems catalog **tabs / navigation-rail items as a separate component
  from buttons**, with their own type role (M3, Carbon, Polaris, Apple HIG file
  tabs/rails under *Navigation*, not actions). Component identity follows **role**,
  not frame art ([ADR-0021](0021-settings-button-label-sizing.md)).
- **Navigation is subordinate chrome.** Nav and tab labels are body-sized in every
  cited system (M3 14px, Carbon 14px, Polaris ~13px, Apple 13pt) and are **never
  larger than the content section/row titles they lead to** — users look at
  content; chrome should recede (NN/g). The biggest type belongs to content.
- The **active** item is marked by weight / color / fill / indicator, **never by
  size** (NN/g "you are here"; Carbon selects tabs by weight at constant size;
  WCAG 1.4.1 requires a non-color cue).

## Considered Options

- **(a)** Govern tabs as their own navigation component, sized at the **content
  row-title tier (`md`)** — equal to the row titles, below the `lg` brand title.
- **(b)** Fold tabs into the action-button rule because they share the bracket frame.
- **(c)** Keep the tabs at `lg`.

## Decision Outcome

Chosen: **(a).** The rail tabs are a navigation component and own their label size
(`.settings-tab strong`), independent of the `--settings-action-label` token. That
size is **`--ds-text-md`** — the same tier as the content row titles, the canon's
ceiling for nav (equal, never above). This keeps **"SETTINGS" (`lg`)** as the
unambiguous top of the hierarchy and stops the rail from outranking the rows it
navigates to. The **active** tab keeps the same `md` size and is marked by the
existing frame-fill swap + color shift (a non-color cue, WCAG-compliant) — not a
size jump.

> **Amended 2026-06-27:** the tabs still sit at the **content row-title tier** (the
> core rule here is unchanged) — but that tier was scaled up `md`→`lg` for
> readability ([ADR-0020](0020-settings-body-typography-role-scale.md) amendment),
> so the tabs follow to **`--ds-text-lg`**. They now *tie* the "SETTINGS" brand in
> SIZE — the inversion this ADR originally guarded against. That is a deliberate
> trade: the brand lockup is shared on every screen (ADR-0003), so it was left `lg`
> rather than resize all screens, and it keeps its lead by weight + position instead
> of size. "Tabs = row-title tier, never *above* the rows" still holds.

This corrects the ADR's original `lg` (recorded as "sized by sight, movable") and
**supersedes the undocumented `1.25rem` tab size from PR #148** ("blue active tab +
larger labels & icons (concept polish)"), which had no backing ADR — per
[ADR-0001](0001-use-adrs-for-decisions.md), the documented decision governs. The
`letter-spacing: 0.02em` introduced alongside it is kept.
Validated against the canon: a nav rail at `lg` tied the brand title and overshot
the `md` rows — the inversion every cited system forbids. `sm` was rejected too:
that is the action/body tier ([ADR-0021](0021-settings-button-label-sizing.md)), a
notch below the row titles, which would under-read in the ornate frame; `md` is the
prescribed "equal to the content row title."

(b) was rejected: it groups by the shared bracket frame (visual skin), not a basis
for component identity, and conflates navigation with actions.

Consequence to document loudly: **two elements with the same bracket frame (a tab
and a header button) legitimately differ in label size** — the tab is `md`
(navigation, content tier), the header button is `sm` (action, body tier). Do not
"reunify" them on the grounds that their frames match.

### Consequences

- Good: navigation recedes below content; SETTINGS stays the top of the hierarchy;
  the tab now sits level with the row titles instead of shouting over them; active
  state already carries a non-color cue.
- Cost: a maintainer eyeballing frame art (not role) may try to re-merge tabs with
  the header buttons; this ADR plus the CSS comment exist to prevent that.

## Pros and Cons of the Options

### (a) Navigation component, md (chosen)

- Good: matches every cited system; nav subordinate to content; SETTINGS stays top.
- Bad: tab and same-frame header button differ in size — correct, but needs the note above.

### (b) Fold into the action-button rule

- Good: one rule for everything bracket-framed.
- Bad: groups by skin; merges navigation with actions (rejected by the canon).

### (c) Keep lg

- Good: the rail reads boldly.
- Bad: ties the brand title and overshoots the md rows — a hierarchy inversion.

## More Information

- CSS: `.settings-tab strong` = `--ds-text-md`, distinct from `--settings-action-label`;
  active state via `.settings-tab.is-active` frame-fill swap + color.
- Sources: [Material 3 Navigation rail](https://github.com/material-components/material-components-android/blob/master/docs/components/NavigationRail.md) (label = title-small 14px),
  [IBM Carbon side-nav](https://carbondesignsystem.com/components/UI-shell-left-panel/style/) (14px, selection by weight not size),
  [Shopify Polaris typography](https://polaris-react.shopify.com/design/typography/font-and-typescale) (nav = body type),
  [Apple HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography) (sidebar = 13pt Body),
  [NN/g — "You Are Here"](https://www.nngroup.com/articles/navigation-you-are-here/) (active = highlight, not enlargement),
  [W3C WAI / WCAG 1.4.1](https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html) (non-color cue for selected state).
- Related: [ADR-0009](0009-mode-button-from-atoms.md), [ADR-0020](0020-settings-body-typography-role-scale.md), [ADR-0021](0021-settings-button-label-sizing.md).
