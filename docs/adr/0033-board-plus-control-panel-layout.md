---
status: "accepted"
date: 2026-06-27
deciders: Nelson, Claude
---

# ADR-0033: Board/canvas + controls views use a clean view and one right-side control panel

The layout precedent for screens that pair a **board/canvas** with **controls** —
the skirmish view and the level editor first, and similar views after. Builds on
[ADR-0023](0023-app-title-bar-layout-and-controls.md) (the shared title bar),
[ADR-0032](0032-no-bland-html-css-every-surface-is-kit.md) (no bland CSS surfaces),
and the [ADR-0006](0006-ui-decision-criteria.md) in-game lean.

## Context and Problem Statement

The skirmish screen had grown ad-hoc: the board sat inside a **raw-CSS box**
(`.skirmish-field::before` — a 1px border + vignette + gradient rectangle, an
ADR-0032 violation that isn't in the concept), and the right side was a loose stack
of separately-framed cards with a floating tab strip whose padding didn't match the
title bar. The level editor is the same *kind* of screen (a board/canvas plus a lot
of controls) and will want the same shape. Nothing said how a "view + controls"
screen is laid out, so each one drifts.

## Decision Drivers

- One consistent shape for every board/canvas-plus-controls view (skirmish, level
  editor, future).
- The board/canvas is the focus — keep it clean; dock the controls.
- No bland boxes, no nested boxes (ADR-0032).
- The controls region reads as one object, consistent with the title bar.

## Decision Outcome

A board/canvas-plus-controls screen has three parts:

1. **Title bar** on top — the shared `.app-titlebar` (ADR-0023), full-bleed.
2. **The view** (board / canvas) — the game art/scene itself, **floating on the
   screen background**, NOT wrapped in a fabricated CSS box (ADR-0032). Pan/zoom are
   gestures; view controls live in the control panel (ADR-0023 / the skirmish work).
3. **One right-side control panel** — a *single* kit panel frame (`panel.png` at the
   same 14px corner as the title bar, so the two read as one system) that houses the
   view's controls: a tab strip at the top, the active tab's content, and the
   primary actions pinned at the bottom. **Inner sections are frameless content, not
   nested boxes** — the control panel is the only frame on that side.

This is the **shared precedent**: the skirmish view and the level editor (and other
similar views) use this same board-left / control-panel-right shape, so they feel
like one app to the user. Density inside the control panel follows ADR-0031
(compact, in-game).

### Consequences

- Good: every "view + controls" screen has the same skeleton; the board is clean;
  the controls are one coherent panel that matches the title bar; no bland or nested
  boxes.
- Cost: each such screen migrates onto the pattern (skirmish done; the level editor
  follows — likely a shared control-panel component rather than re-built per screen).
- Note: the control panel still has interior elements to finish converting to the
  kit (e.g. the skirmish service-record cells) under ADR-0032 — the *frame* is the
  panel; its contents continue migrating.

## More Information

- Builds on: [ADR-0023](0023-app-title-bar-layout-and-controls.md),
  [ADR-0032](0032-no-bland-html-css-every-surface-is-kit.md),
  [ADR-0006](0006-ui-decision-criteria.md), [ADR-0031](0031-ui-spacing-system.md).
- Implementation: `.skirmish-hud` (the control panel) = `panel.png` 14px frame;
  `.skirmish-field` no longer draws a box; classes in `frontend/src/style.css`.
