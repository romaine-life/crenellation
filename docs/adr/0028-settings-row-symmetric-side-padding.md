---
status: "accepted"
date: 2026-06-27
deciders: Nelson, Claude
---

# ADR-0028: Settings/list row content is symmetrically inset on the spacing scale

Instances the `--ds-space-*` scale for the settings row's horizontal rhythm — the
same "map to the token scale, not ad-hoc px" stance [ADR-0024](0024-ui-typography-system.md)
takes for type. Sits inside the forged 9-slice row frame
([ADR-0012](0012-nine-slice-frames-are-atom-assembled.md)).

## Context and Problem Statement

A settings row is a 9-slice `row.png` frame (uniform 14px border) holding content:
title/description on the left, value/control on the right. The row's CSS `padding`
is already symmetric (16px each side) — but the content still lands **lopsided**.

The cause is the grid, not the padding: `.settings-row` declares
`grid-template-columns: auto minmax(0,1fr) auto auto` — **four** columns, sized for
when every row had a leading **icon**. Now that the row icons are gone, the three
remaining children (copy / value / control) shift one column over and leave a
**stale empty column plus its `gap`** — a phantom ~16px on the right. So the
right-side content sits ~16px more inset than the left. Lopsided rows make the
screen unpleasant to scan and review.

Underneath that one bug is a missing rule: nothing governed the row's side inset,
so it could drift the moment the row's contents changed.

## Decision Drivers

- Symmetric, predictable rows are faster and more pleasant to scan and review.
- A spacing scale (`--ds-space-1..6`) already exists; the row should reference it,
  not hand-picked px.
- The drift came from a layout that no longer matched its contents — the rule
  should make that class of bug impossible to reintroduce silently.

## Decision Outcome

**Settings/list row content is inset symmetrically — equal left and right — by a
single `--ds-space` token, and the row's grid template must declare exactly the
columns the row actually renders (no empty/stale columns).**

### A. Symmetric side inset

| Property | Rule |
|---|---|
| Side padding | one `--ds-space` token, applied **equally** left and right (today `--ds-space-4` = 16px) |
| Frame border | uniform `row.png` 9-slice (14px), symmetric by construction — separate from the content inset |
| Per-side ad-hoc px | not allowed — left inset **==** right inset |

### B. The right group is symmetric for every row variant

- A row carries an **optional** `value` and/or `control`. The layout right-aligns
  that group so the **right inset equals the left for every variant** — copy-only,
  +value, +control, +both. That means a flex row (copy fills; value/control hug the
  end), **not a fixed column count**: a fixed grid strands an empty track — and its
  `gap` — whenever an optional element is absent, which is exactly the lopsiding
  here (the 4-column grid left over from the retired icon).

### Consequences

- Good: rows read symmetrically regardless of which optional elements they carry;
  the inset is a token, not a guess; the layout can't silently strand a gap again.
- The CSS fix (row → flex with a right-aligned value/control group, equal side
  inset) lands with this ADR.

## More Information

- Spacing scale: `frontend/src/style.css` `:root` (`--ds-space-1..6`).
- Row: `.settings-row` in `frontend/src/style.css`. Frame:
  [ADR-0012](0012-nine-slice-frames-are-atom-assembled.md); type scale:
  [ADR-0024](0024-ui-typography-system.md).
