---
status: "accepted"
date: 2026-06-27
deciders: Nelson, Claude
---

# ADR-0027: Shape-varied icon sets are placed by per-shape optical keyline within the canonical canvas

Refines [ADR-0026](0026-ui-kit-icon-canvas.md) — the canonical **64×64** icon canvas
— for icon sets whose glyphs have **very different aspect ratios**, like the carved
main-menu mode icons. ADR-0026 places a glyph "centered, with equal margins," which
is right for the similar-aspect kit glyphs; but equal-margin centering makes a
tall-thin shape and a wide shape read at **unequal optical mass**. This ADR keeps
ADR-0026's canvas and adds the per-shape **optical keyline** that equalizes optical
weight. Sits alongside [ADR-0014](0014-ui-chrome-low-fidelity-aesthetic.md)
(fidelity), [ADR-0021](0021-settings-button-label-sizing.md) /
[ADR-0022](0022-settings-nav-tabs-typography.md) (sizes are role-governed, never
floating), and [ADR-0007](0007-brand-shield-baseline-size-and-placement.md)
(mock-and-measure).

## Context and Problem Statement

The five carved-stone main-menu icons (blade, route-map, scroll, pawns, gear —
subject governed by [ADR-0025](0025-world-scene-art-anti-story-lore.md)) were forged
**trimmed-to-content** at five footprints (blade `26×44` … gear `52×50`) and five
optical weights. [ADR-0026](0026-ui-kit-icon-canvas.md) just established the
canonical `64×64` canvas with a centered ~`40×40` safe area — but its placement rule
is **"glyph centered, equal margins."** For glyphs this varied in aspect that fails:
drop the tall blade and the wide pawns into equal margins and the blade towers while
the pawns shrink — the exact Material/Carbon **keyline** problem (equal-width shapes
do not read equal-weight). The canvas is settled; the **placement rule for
shape-varied sets** is the gap.

## Decision Drivers

- **Equal OPTICAL weight, not equal margins**, for shape-varied sets (Material /
  Carbon / Apple keyline canon).
- **Don't fragment the canvas** — adopt ADR-0026's `64×64`, never a rival size.
- Native footprint, no fractional downscale (ADR-0014).
- One role token, never floating (ADR-0021 / ADR-0022).
- Mock-and-measure, then don't reopen (ADR-0007).

## Decision Outcome

Within ADR-0026's canonical **`64×64`** canvas, an icon set whose glyphs vary in
aspect (the carved menu icons) places each glyph by its **shape-class optical
keyline** instead of equal centered margins.

### A. Canvas — ADR-0026's `64×64` (adopted, not redefined)

Every menu icon PNG is `64×64` transparent, per ADR-0026. No separate size is
introduced; this ADR only changes *placement within* that canvas for shape-varied
sets.

### B. Safe area

ADR-0026's centered ~`40×40` safe area is the base. A **tall / pointed** glyph may
reach into the surrounding margin (the Material keyline exception for pointed forms);
a **wide** glyph is held inside it.

### C. Per-shape optical keylines — the refinement

Each icon is scaled to its **shape-class keyline**, not to equal margins, so all five
carry **equal optical mass**. The main-menu set is a **hero set** on a sparse screen,
so it uses a raised keyline band that fills toward the canvas margin (not the ~40 kit
safe area) — equal optical mass is preserved, only the baseline scale is lifted:

| Icon | Shape class | Hero keyline (on the 64 canvas) |
|---|---|---|
| route-map | **full / square** | fill to **52** on the long axis (largest — a full form reads lightest) |
| blade | **tall / pointed** | grow height to **56** (into the margin) |
| gear | **round / full** | fill to **52** on the long axis (a round/full form reads lightest) |
| pawns | **wide** | hold **width** to **48** (a wide cluster reads heavier → shrink) |
| scroll | **upright / blocky** | conservative **48** |

Rule: full/round grows largest; tall/pointed gain **height, never width**; wide is
held back on width; blocky is conservative (Material keylines; Helena Zhang, *Icon
grids & keylines demystified*). A *functional* (non-hero) set on the same canvas keeps
ADR-0026's ~40 safe area instead.

### C.1 Display size — the lead-emblem ratio

On a sparse, atmospheric menu the emblem **leads**, so it is sized off the row, not
the dense-icon floor: a lead emblem runs **~0.75 of row height** (defensible
0.62–0.82, the top earned by whitespace — Material's icon→avatar→thumbnail ladder;
NN/g visual hierarchy). The **ceiling** is where the emblem stops being the label's
co-equal and becomes its headline (visual weight inverts, scannability drops). The
main-menu mode buttons are pinned at an **80px row / 64px emblem** (`--menu-btn-h` /
`--menu-icon-size`) — the top of the band, still ≤ the 64 native footprint so it is a
clean downscale with **no reforge** (ADR-0014). Rendering an emblem **above 64px**
requires a reforge to a **128×128** native (clean 2× of the grid), never an upscale.

### D. Optical centering frozen as padding

Each icon's **optical** center is placed on the canvas center and the nudge baked
into the `64×64` PNG's transparent padding (Apple HIG). Downstream centers naively
and gets optical centering for free — no per-icon offset config.

### E. Pixel discipline

Whole-pixel coordinates; nearest-neighbour resampling and `image-rendering: pixelated`
at render (ADR-0014 chunky edge); one stroke weight family-wide.

### F. Consumption — applies when the stone chrome is wired into the live menu

A single role token **`--menu-icon-size`** declares the display size once (ADR-0021 /
ADR-0022 discipline); the slot paints the whole `64×64` asset at that size and never
re-sizes per icon. The `iconSlot` rect stays the layout contract (ADR-0019). Active /
hover emphasis is by color, never resize.

### Method — re-pack, not re-forge

`frontend/scripts/pack-menu-icons.mjs` scales each forged icon's despilled `-smooth`
source to its keyline by a LANCZOS down-scale (the down-scale *is* the pixelation —
ADR-0014), quantizes to a limited palette, and optical-centers it on a fresh `64×64`
canvas. The forged art is good; only scale + placement were wrong, so no regeneration.

### Consequences

- **Good:** the carved set reads at one optical weight inside the *same* canvas the
  kit icons use (ADR-0026) — no fragmentation; a new shape-varied set picks a keyline
  class instead of re-inventing a size.
- **Cost:** the keyline table is hand-tuned per shape class (~5 classes); a genuinely
  new shape needs a new keyline — extend the table and mock-and-measure (ADR-0007).
- ADR-0026's plain "centered equal margins" remains correct for the similar-aspect
  kit glyphs; this ADR is the exception for shape-varied sets, not a replacement.

## More Information

- **Canon:** Material — [System icons](https://m2.material.io/design/iconography/system-icons.html)
  & [keylines](https://m1.material.io/style/icons.html); Helena Zhang —
  [Icon grids & keylines demystified](https://medium.com/@helenazhang/icon-grids-keylines-demystified-4ba07d8b5c63);
  Apple — [HIG: Icons](https://developer.apple.com/design/human-interface-guidelines/icons);
  IBM Carbon — [Icons usage](https://carbondesignsystem.com/elements/icons/usage/).
- **Related:** ADR-0026 (the canonical 64×64 canvas this refines), ADR-0014 (low-fi /
  native footprint), ADR-0019 (slot / padding), ADR-0007 (mock-and-measure sizing),
  ADR-0021 / ADR-0022 (role-governed sizes), ADR-0025 (icon subject/theme).
- **Script:** `frontend/scripts/pack-menu-icons.mjs`.
- **Assets:** `frontend/public/assets/ui/main-menu/icons-carved/{solo-skirmish,campaign-editor,level-editor,lobbies,settings}.png` (each `64×64`).
