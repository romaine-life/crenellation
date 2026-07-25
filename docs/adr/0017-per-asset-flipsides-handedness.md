---
status: "accepted"
date: 2026-06-27
deciders: Nelson, Claude
---

# ADR-0017: Per-asset flipSides handedness so one assembler serves flat keylines and beveled rails

Extends [ADR-0012](0012-nine-slice-frames-are-atom-assembled.md) (one assembler,
symmetric by construction) with the handedness control a **beveled** edge needs,
and uses the registry from [ADR-0016](0016-single-source-nine-slice-registry.md)
as the place that control is declared.

## Context and Problem Statement

`buildFrameFrom(corner, edge, fill, W, H, flipSides = false)` in
`scripts/assemble-frame.mjs` builds all four side edges from the **one** horizontal
`edge` atom: it `rot90`s the edge to get a vertical rail, then derives left and
right from that rotation. Which rotated edge lands on the **left** vs the **right**
is the asset's *handedness*.

A flat keyline edge (the mode button, the panel) reads the same either way — the
edge is just a line, so left/right handedness is invisible. A **beveled rail** (the
settings row) does not: its `row-edge` atom has a **directional** bevel — a
highlight on one side, a shadow on the other. With the wrong handedness the rail's
bevel runs **against** the corner's bevel at the join, so the lit and shadowed
faces don't meet correctly where edge butts corner.

A single **global** handedness constant can only satisfy one of these at a time.
This is exactly why the row frame got "fixed over and over": a commit that
corrected the mode button by flipping the global `rot90` handedness **silently
reversed the row's bevel at the same instant**. The defect lives at the
**corner/edge bevel join**, not in the center rail — and measuring the center pixel
looks symmetric, so the center test masked it every time. The two assets were
fighting over one global knob.

## Decision Drivers

- One assembler must serve **both** flat keyline edges and directionally-beveled
  edges — splitting the assembler would re-break ADR-0012's "one way to build a
  frame."
- Handedness is a property of **the atom/asset**, not a global constant two assets
  take turns breaking.
- ADR-0012's symmetry-by-construction guarantee must hold at the **joins**, not just
  the centers — a center-pixel check is not sufficient evidence of a correct frame.

## Decision Outcome

Chosen: **make edge handedness a per-asset boolean, `flipSides`**, defaulted to
`false` and declared per asset in the nine-slice registry, because it lets the one
assembler build a flat keyline and a beveled rail correctly without either asset
disturbing the other.

In `scripts/assemble-frame.mjs`, `buildFrameFrom` derives the side edges as:

```js
const r = rot90(edge), eB = flipV(edge);
const eR = flipSides ? flipH(r) : r;
const eL = flipSides ? r : flipH(r);
```

So with the default (`flipSides = false`) the right side is the raw rotation `r`
and the left is `flipH(r)`; `flipSides: true` swaps which side gets the extra
`flipH`, reversing the bevel handedness for that asset only. Top/bottom are
unaffected (`top = edge`, `bottom = flipV(edge)`), and the four corners are still
the one corner mirrored (`flipH` / `flipV` / both) per ADR-0012.

In `config/nine-slice-registry.json` the flat frames omit the flag (so they take
the safe `false` default): `mode-button` and `panel` carry no `flipSides`. Only the
beveled rail sets it — the `row` asset declares `"flipSides": true` (alongside
`"carve": true` and its `row-corner` / `row-edge` / `row-fill` atoms).

### Consequences

- Good: both frame kinds come out correct from the **one** assembler; flipping the
  mode button's handedness can no longer silently reverse the row's bevel.
- Good: the fix is data, not code — a new beveled frame sets `flipSides` in the
  registry, no assembler edit.
- Cost: a new beveled frame is one flag the author must remember to set; the
  `false` default is safe for flat frames, so the failure mode is "new bevel looks
  wrong," caught on the live review (ADR-0005), not a regression in a shipped frame.
- Cost: correctness must be judged at the corner/edge **join**, not by a
  center-pixel symmetry check — that check is what hid this defect.

## More Information

- Assembler + the `eL`/`eR`/`rot90`/`flipH` handedness logic:
  `frontend/scripts/assemble-frame.mjs` (`buildFrameFrom`).
- Where the flag is declared: `frontend/config/nine-slice-registry.json`
  (`row.flipSides: true`; `mode-button` and `panel` default to `false`).
- Refines: [ADR-0012](0012-nine-slice-frames-are-atom-assembled.md) (atom assembly,
  symmetry by construction). Declared via:
  [ADR-0016](0016-single-source-nine-slice-registry.md). Mechanism:
  [ADR-0002](0002-nine-slice-border-image-for-pixel-art-chrome.md) (9-slice
  `border-image`).
