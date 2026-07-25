---
status: "accepted"
date: 2026-06-28
deciders: Nelson, Claude
---

# ADR-0037: The app title bar is full-bleed with a bottom RULE, not a 4-sided frame

Refines [ADR-0004](0004-standard-app-title-bar.md) (one shared full-bleed title bar) and
scopes an exception to [ADR-0034](0034-nine-slice-line-frames-for-surface-fill.md) (line
frames for surfaced chrome) for the title bar specifically.

## Context and Problem Statement

The shared app title bar (`.app-titlebar.settings-header-frame`, used on Main Menu,
Settings, and Campaign) wore the `panel-line` 9-slice frame — a full 4-sided ornament with a
transparent interior — over a fixed oak surface (ADR-0034).

Two problems on a bar that is, by ADR-0004, **full-bleed** (edge-to-edge):

- The frame's transparent outer pixel + `background-clip: padding-box` left a **~1px strip of
  the page background (and the rain) showing at the screen edge**. A hairline near-miss reads
  as a rendering bug, not a design choice (Gestalt continuity; the original report).
- A 4-sided frame on an edge-to-edge bar pins its corner/side ornaments into the literal
  screen corners and runs a side rail down the full height — fighting the top-bar idiom,
  where the bar is a surface separated from content by a single **bottom** boundary.

The bar (oak) and the content beneath it are the same warm-wood/dirt family, so whitespace or
colour can't separate them — a **divider/rule is the correct separator** (Material/HIG: a
divider is for when space and colour can't do the job).

## Decision Outcome

Chosen: **the title bar goes full-bleed with no side/top frame; its only chrome is a bottom
rule** — a forged "nailhead" iron band (a tileable studded strip) capped by a centred diamond
stud — over oak that reaches the element edge.

- `border: 0` so the wood fills to the element edge: **the 1px gap is gone**.
- The rule + stud are **generated low-fi atoms** (codex img2img → chroma-key → low-fi quantize,
  ADR-0011/0014), in `public/assets/ui/titlebar/` (`band-studded.png`, `ornament-nailstud.png`),
  applied as background layers — a generated sprite, not a raw-CSS border (ADR-0032).
- The motif is drawn from the anti-story material vocabulary (forged iron hardware on wood —
  "religion/war as matter"), the chrome-accent application ADR-0025 allows.

The chosen ornament (nailhead band + diamond stud) was picked from six generated candidates
(strap plate, nailhead, keystone, waystone, chip-carved rosette, reliquary boss) compared on
the live bar via a temporary Studio toggle.

### Consequences

- Good: the original 1px edge defect is fixed; the bar reads as an intentional full-bleed top
  bar; the bottom edge carries a quiet, on-lore ornament instead of a generic keyline.
- Scope: this **supersedes the title bar's use of the `panel-line` frame** (ADR-0034) and
  ADR-0004's implied panel chrome for the bottom edge. Panels, rails, and other surfaced
  chrome still use ADR-0034 line frames — only the title bar takes the bottom-rule treatment.
- Follow-up: the `SurfaceDressingRoom` "Title bar" region still references the old `panel-line`
  config; retune or retire it to match.

## More Information

- Related: [ADR-0004](0004-standard-app-title-bar.md), [ADR-0034](0034-nine-slice-line-frames-for-surface-fill.md),
  [ADR-0011](0011-chrome-art-generated-not-extracted.md), [ADR-0014](0014-ui-chrome-low-fidelity-aesthetic.md),
  [ADR-0032](0032-no-bland-html-css-every-surface-is-kit.md), [ADR-0025](0025-world-scene-art-anti-story-lore.md).
- Assets: `frontend/public/assets/ui/titlebar/`; rule in `frontend/src/style.css` (`.settings-header-frame`).
