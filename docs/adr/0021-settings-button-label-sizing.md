---
status: "accepted"
date: 2026-06-26
deciders: Nelson, Claude
---

# ADR-0021: Settings action-button labels — one body-tier token, grouped by role, box hugs label

Sits in the settings-button family with [ADR-0009](0009-mode-button-from-atoms.md)
(frame art) and [ADR-0010](0010-settings-header-buttons.md) (header geometry), and
draws its size from the type scale ([ADR-0020](0020-settings-body-typography-role-scale.md)).
The navigation tabs are a separate component — see [ADR-0022](0022-settings-nav-tabs-typography.md).

## Context and Problem Statement

Settings buttons wore large ornate frames but tiny labels (12–13px, filling only
14–18% of the button height, floating in a fixed-width box). Fixing that surfaced
three coupled questions: (1) on what **axis** do we group buttons under one rule —
frame art or role? (2) what **size** is an action-button label? (3) does a button
in the **title bar** get a bigger label than one in a content row?

## Decision Drivers

- **Group by role, not skin.** Design systems assign type by role/function; a
  different frame is *theming the same component*, not a new one (Brad Frost;
  Atomic Design).
- **Button text is body-tier.** M3 (Label Large 14sp), Carbon (14px), Polaris
  (~13px), Apple (Body 17pt), Spectrum all size button labels at the body/label
  tier — and the **same** size whether the button is in content or in a bar.
  Emphasis is carried by **color/fill/weight, never by resizing the label**.
- **Hierarchy.** A control's label must not out-size the title that labels its
  context — a button louder than its own row title (or rivaling the bar title) is
  an inversion (NN/g: size = importance).
- **Box hugs the label.** Button size is derived from label + padding (Carbon/M2);
  fix an empty-looking frame by tightening the box, not inflating the label.

## Considered Options

- **(a)** One **body-tier** action-button label (`sm`) shared by header buttons +
  panel pills, kept below titles; box hugs the label; emphasis via color/fill.
- **(b)** Group by **frame art** — everything in a large frame takes a big (`lg`)
  label that fills it.
- **(c)** Size per **context** — bigger label in the title bar than in rows.

## Decision Outcome

Chosen: **(a).** The header buttons (Back / Menu / Sign In) and the panel pills
(Reset / Open / View Tracks) are all **action buttons** → one shared label token
**`--settings-action-label` = `--ds-text-sm`** (body tier), declared once so they
can't desync. This sits **below** the `md` row title and below the `lg` "SETTINGS"
brand title — controls stay subordinate to the text that labels them. Emphasis is
carried by color/fill (cyan Sign In, gold Back/Menu, red Reset), never size. The
box **hugs its label + padding** (`min-inline-size` floor + auto-grow; height
**40px**), so a two-word label like "View Tracks" widens the button instead of
wrapping or floating.

Height is **40px, the desktop default — not a 44–48px touch floor.** That floor is
a fingertip ergonomic (Apple 44pt, Material 48dp *touch*); this game is mouse-only,
where the binding target is WCAG 2.5.8's ~24px and the default button across
systems is 32–40px (Carbon 40, M3 40dp, Bootstrap 38, Ant 32). A bar of 46px
buttons read as the large/touch tier and flattened the hierarchy. The ornate frame
border (12px) sets the practical lower bound, so 40px is the floor here, not 32.

(b) was rejected: it groups by frame art (the visual-skin axis every system
rejects), merges navigation tabs with actions, and inflates labels into a
hierarchy inversion (button louder than its row title). (c) was rejected: no
system enlarges a bar button — Apple/M3/Carbon size bar actions the same as
content actions; the title bar is **not** a license to enlarge an action. The
only larger element in the bar is the **title**, a different element class.

This supersedes two earlier drafts of this ADR (first frame-driven `lg` "fills the
frame"; then a context-split keeping the header at `lg`). The navigation tabs are
governed separately in [ADR-0022](0022-settings-nav-tabs-typography.md) and keep
`lg` as a navigation element, not an action.

### Consequences

- Good: one body-tier action label, subordinate to titles, consistent across the
  title bar and content rows; emphasis lives in color/fill; boxes hug their labels.
- Note: header buttons and pills match in **size** while wearing different frames —
  correct by role; don't "fix" them apart on visual grounds. Two same-frame
  elements (a tab and a header button) may legitimately differ, because a tab is a
  different component (ADR-0022).
- Cost: button widths vary by label length (a `min-inline-size` floor bounds it).
  If a frame looks under-filled at `sm`, tighten the box — do not raise the label.

## Pros and Cons of the Options

### (a) One body-tier token, grouped by role (chosen)

- Good: matches every cited system; one token, no desync; keeps controls below titles.
- Bad: ornate frames are not "filled" by the label — handled by hugging the box.

### (b) Frame-art-driven big label

- Good: visually fills the ornate frame.
- Bad: groups by skin; merges tabs with actions; inverts the title→control hierarchy.

### (c) Context-sized (bigger in the bar)

- Good: lets the header read large.
- Bad: no system enlarges bar actions; splits one role into two sizes needlessly.

## More Information

- CSS: `--settings-action-label` (= `--ds-text-sm`) on `.settings-screen`, consumed
  by `.settings-header-button span` and `.settings-row-control > .settings-chrome-button`;
  the pill box hugs its label (`min-inline-size: 72px` + auto).
- Sources: [Apple HIG — Navigation bars](https://developer.apple.com/design/human-interface-guidelines/navigation-and-search) (bar buttons = Body 17pt, weight not size),
  [Material 3 — Applying type](https://m3.material.io/styles/typography/applying-type) (button = Label Large; title is the large bar element),
  [IBM Carbon — Button usage](https://carbondesignsystem.com/components/button/usage/) (box hugs label; don't mix sizes in a group),
  [Brad Frost — themeable design systems](https://bradfrost.com/blog/post/the-many-faces-of-themeable-design-systems/) (skin ≠ new component),
  [NN/g — Visual hierarchy](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/) (size = importance).
- Related: [ADR-0009](0009-mode-button-from-atoms.md), [ADR-0010](0010-settings-header-buttons.md), [ADR-0020](0020-settings-body-typography-role-scale.md), [ADR-0022](0022-settings-nav-tabs-typography.md).
