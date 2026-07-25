---
status: "accepted"
date: 2026-06-26
deciders: Nelson, Claude
---

# ADR-0010: Settings header buttons unified to bracket frames; header content centered

Extends [ADR-0009](0009-mode-button-from-atoms.md) (the atom-built mode-button
frames) to the settings title-bar buttons.

## Context and Problem Statement

The title-bar buttons looked off vertically. Two causes:

1. **Mismatched families:** Sign In was the filled `button-primary` art while
   Back/Menu were bracket frames, so Sign In rendered ~4px shorter — same box,
   different visible fill.
2. **Content sat low:** measured, the buttons centered at y40 while the bar's
   true centre is y36. The brand shield (54px, ADR-0007) is taller than the
   bar's ~44px inner area (72px bar − 2×14px frame, ADR-0004), so the content
   row exceeds what the bar can centre and anchored low.

## Decision Drivers

- One consistent button family in the bar; equal heights by construction.
- Vertical centring on the bar.
- Stay on the concept and the kit (don't reintroduce a one-off).
- No cheap band-aids (a "just nudge the height" option was explicitly rejected).

## Decision Outcome

1. **Unify the header buttons onto the mode-button frames** — Sign In = cyan
   (`mode-button-active.png`), Back/Menu = gold (`mode-button.png`). Equal height
   by construction, consistent with the nav, and back on the concept (the
   filled-blue Sign In was an earlier deviation, now retired).
2. **Centre the content row on the bar** with `align-content: center` on the
   header grid, so the row centres even though the shield is taller than the
   bar's inner area (buttons now measure y36 = bar centre).
3. Removed the account block's stray `min-height: 54px`.

This supersedes the earlier (never-recorded) "Sign In as filled primary" choice.

### Consequences

- Good: the header reads as one family, equal height, centred; consistent with
  the nav and the concept.
- Note: the 54px shield still slightly exceeds the bar's inner area; centring the
  row keeps it visually fine. If the shield ever needs more breathing room,
  that's a bar-height/border question (ADR-0004), tracked separately.

## More Information

- CSS: `.settings-header-frame` (`align-content: center`), `.settings-header-button`
  / `.settings-header-button-active`, `.settings-account` in `style.css`.
- Frames: `mode-button.png` / `mode-button-active.png` (ADR-0009).
