---
status: "accepted"
date: 2026-06-27
deciders: Nelson, Claude
---

# ADR-0018: Active/selected frame states are whole-frame palette swaps (body + border, not just the accent)

Extends [ADR-0009](0009-mode-button-from-atoms.md) — which made the active mode
button a palette swap of the **corner atom only** — by generalizing the swap to
the **whole frame**, and builds on the registry palettes/variants introduced in
[ADR-0016](0016-single-source-nine-slice-registry.md). It keeps the
atom-assembled discipline of [ADR-0012](0012-nine-slice-frames-are-atom-assembled.md):
a state is still one corner + edge + fill, just recolored.

## Context and Problem Statement

ADR-0009 produced `mode-button-active.png` by palette-swapping **only the corner
atom**: the 4 gold ramp colours went cyan, the navy/steel structure was left
alone. The result reads as a *cyan-bracket accent over an otherwise steel/navy
button* — the gold turns, the body and border do not.

But the accepted concept for a selected tab is a **distinct blue card**: the
whole chrome — fill, keyline, and accent — reads as a different colour, not a
steel button with a recolored corner. A corner-only swap can't express that, and
hand-drawing a second full frame per state would reintroduce exactly the bespoke,
drift-prone per-state art that ADR-0012 retired.

ADR-0016 already gives us the machinery to do better: named `palettes` and
per-asset `variants` with a `swap` key, baked through one `buildAsset()`. The
question this ADR settles is **how wide the swap goes** — accent only, or the
entire frame.

## Decision Drivers

- A selected state must read as a **distinct card** (recolored body + border),
  not an accent tweak on the inactive frame.
- State variation must stay **declarative** — a named palette in the registry
  plus one variant entry — never hand-drawn per state.
- The inactive frame must stay **byte-identical** — adding a state must not
  perturb the base PNG.

## Decision Outcome

Chosen: **a variant's palette swap recolors the whole frame — corner + edge +
fill — via a named palette in the registry**, so an active/selected state changes
the body and borders, not only the corner accent.

In `buildAsset()` (`frontend/scripts/nine-slice-kit.mjs`) the swap is applied to
**all three atoms** before assembly:

```js
const c  = v.swap ? swapPalette(corner, v.swap) : corner;
const e  = v.swap ? swapPalette(edge,   v.swap) : edge;
const fl = v.swap ? swapPalette(fill,   v.swap) : fill;
const frame = buildFrameFrom(c, e, fl, w, h, !!rec.flipSides);
```

A variant with no `swap` reuses the untouched atoms, so the inactive output is
unchanged. `mode-button-active.png` is produced this way — registry entry
`{ "out": "mode-button-active.png", "swap": "active", "inspect": "corner-cyan" }`.

The `active` palette is a **luminance-matched hue swap of the whole frame**, not
just the gold ramp: the gold ramp → cyan, the steel keyline → blue, and the navy
fill → a deeper blue. From `frontend/config/nine-slice-registry.json`
(`palettes.active`):

- Gold ramp → cyan: `faefbb→d6f4ff`, `c79b55→4fbdf0`, `a7793d→2f93dd`, `5b4124→14507f`
- Steel keyline → blue: `414e61→2896c3`, `2f3a48→1c608c`
- Navy fill → deep blue: `121c23→1c3a5a`, `0f181f→152f4c`, `0d151c→122a46`, `101921→183452`

This is the same indexed palette-swap lineage as ADR-0009's cyan brackets and the
unit team colours — an exact hex→hex remap on a clean, low-colour sprite, **not**
a hue filter — now applied across all three atoms instead of one.

### Consequences

- Good: any state = a named palette + a variant `{ swap }`; no new art, no new
  generator. Fully reproducible from the registry.
- Good: the swap reads as a recolored **card** (body + border + accent), which is
  what the concept calls for.
- Good: a variant without `swap` is byte-identical to the base — adding a state
  never touches the inactive frame.
- Cost: the palette must be **luminance-matched by hand** so the swap reads as a
  recolor rather than a repaint — the fill, keyline, and accent ramps each need a
  same-value counterpart, which is more entries to tune than a corner-only swap.

## Pros and Cons of the Options

- **Corner-only swap (ADR-0009 status quo)** — cheap (4 colours), but only the
  accent turns; the body/border stay steel/navy, so a selected state can't read
  as a distinct card.
- **Hand-drawn second frame per state** — full control, but bespoke per-state art
  that drifts and duplicates work — exactly what ADR-0012 retired.
- **Whole-frame palette swap (chosen)** — one named palette recolors all three
  atoms; declarative, reproducible, inactive untouched; cost is the manual
  luminance-matching of the palette.

## More Information

- Bake: `frontend/scripts/nine-slice-kit.mjs` — `buildAsset()` applies
  `swapPalette()` to corner, edge, and fill; assembled via `buildFrameFrom`.
- Registry: `frontend/config/nine-slice-registry.json` — `palettes.active` and
  the `mode-button` variants (`swap: "active"`).
- Extends [ADR-0009](0009-mode-button-from-atoms.md) (corner-only → whole-frame
  swap); built on [ADR-0016](0016-single-source-nine-slice-registry.md)
  (registry palettes/variants); same atom-assembled discipline as
  [ADR-0012](0012-nine-slice-frames-are-atom-assembled.md); same indexed-swap
  lineage as the unit team colours referenced in
  [ADR-0009](0009-mode-button-from-atoms.md).
