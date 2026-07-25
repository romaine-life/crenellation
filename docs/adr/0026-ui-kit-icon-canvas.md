---
status: "accepted"
date: 2026-06-27
deciders: Nelson, Claude
---

# ADR-0026: UI-kit icons live on one canonical 64×64 centered canvas, with a normalized safe area the forge enforces

Generalizes [ADR-0007](0007-brand-shield-baseline-size-and-placement.md)'s
"art is centered in a fixed canvas with equal margins" reasoning — decided there
for the one brand shield — into a rule for the whole **kit icon set**
(`frontend/public/assets/ui/kit/icons/`). Sits alongside
[ADR-0014](0014-ui-chrome-low-fidelity-aesthetic.md), which owns icon *fidelity*
(palette budget, chunky edges); this ADR owns icon *geometry* (the canvas the
glyph sits on). It adopts the spine of [ADR-0024](0024-ui-typography-system.md) —
make an implicit dimension a single canonical value, "reference the standard,
don't hand-pick," enforced rather than requested. The canvas is an output
contract of the forge ([ADR-0011](0011-chrome-art-generated-not-extracted.md)
generation, [ADR-0013](0013-transparency-chroma-key-via-subscription.md)
transparency), and this ADR formally retires the canvas geometry that still
lives, un-homed, in `docs/art/kit-briefs/icons.md`.

## Context and Problem Statement

The icon "bounding box" was never written down, yet a de-facto standard exists —
and a new pipeline step just broke it.

Measured (Python/PIL `getbbox` over alpha, on the real PNGs):

- **15 of the 16 kit icons are exactly `64×64`**, glyph centered. (The 16th,
  `brand-shield`, is a `256×256` source sprite — a documented exception, governed
  for *display* by the brand lockup, not by this canvas.)
- But the glyphs inside that 64 box are **not** consistent. Opaque longer-side
  spans **32→49px**; side margins span **7→19px** (median ~13). Most cluster at a
  ~13px margin (a ~40px centered glyph), but `info.png` is a hard outlier —
  `49×49`, only 7–8px of margin — it crowds the canvas edge, while
  `interface-sounds` sits at `32×32` with room to spare.
- **Nothing enforces any of this.** `kit-forge.mjs` (the glyph forge) only puts
  `"Size 64x64"` in the codex *prompt prose* — it never measures or asserts the
  result; it passes codex's raw PNG straight through. `forge-atom.mjs` (the
  9-slice atom painter, used off-label to forge two glyphs) ends with
  `trimToEdge`, which crops to the opaque bbox — so the two newest icons shipped
  as bare `36×41` (lyre) and `38×48` (bell) PNGs that do not align with the kit.

The consequence is concrete and about to bite: a new icon lands at whatever size
its silhouette happens to trim to, "consistent" is eyeballed per-icon, and there
is **no canonical box to target** for the upcoming re-forge of the whole set.

## Decision Drivers

- A 16-icon re-forge must be coherent **by construction**, not by eye — that needs
  one box to aim at.
- The box must be **enforced** (a dimension assertion), not asked for in a prompt.
  The prose-request approach already failed silently.
- Don't invent a number. **Ratify** the box the kit already uses; only *normalize*
  what is genuinely inconsistent.

## Decision Outcome

**Every UI-kit content icon is authored and shipped on one canonical `64×64`
transparent canvas — glyph centered, fitting within a normalized centered safe
area — and the forge enforces that canvas as an output contract, never a bare
bounding box.**

### A. The canonical canvas — `64×64`, centered, equal margins

| Property | Value |
|---|---|
| Canvas | `64×64` transparent PNG, every kit content icon |
| Placement | glyph centered; equal left/right and top/bottom margins |
| Rendering | per [ADR-0014](0014-ui-chrome-low-fidelity-aesthetic.md) (low-fi, chunky); this ADR governs only the box |

`brand-shield` is the one documented exception: a `256×256` source sprite whose
*display* size is owned by the brand lockup. It is part of the icon set but not a
content glyph.

### B. The safe area — a centered `40×40` box, normalized going forward

- Glyphs fit within a **centered `40×40` safe area** (≈12px margin per side) — the
  median glyph longer-side (40) and median tightest margin (12) of the existing
  set, so the typical icon already conforms.
- This is a **normalization, not a description.** The set is inconsistent today;
  `info.png` (`49×49`) is the standing outlier to re-canvas into the safe area, and
  the smallest glyphs may grow toward it. Bringing the set onto the safe area is a
  staged re-forge (see Consequences), not part of accepting this ADR.
- Glyphs are **never scaled up to fill `64`.** A tall glyph reaches the `40` box on
  its long axis; a small one sits at its natural size, centered. Optical coherence
  comes from *the same box + the same centering*, not from forcing every glyph to
  one size.

### C. The forge output contract — pad to canvas, assert the dimensions

- Any pipeline that produces a kit glyph icon must emit a uniform `64×64` centered
  PNG with the safe-area margin, verified by a **hard dimension assertion**. The
  `64×64` stops being prose in a prompt and becomes a checked output.
- **`kit-forge.mjs` (glyph icons):** add a pad-to-`64×64`-centered step **and** a
  dimension assertion after generation. Today it enforces nothing on size.
- **`forge-atom.mjs` (9-slice atoms):** its `trimToEdge` edge-flush behavior is
  *correct for actual 9-slice atoms* and stays. When it is used to produce a
  **glyph**, the output must be padded back into the centered `64×64` canvas — keep
  `trimToEdge` to *find* the glyph's true bbox, then center it in the canvas; never
  ship the bare bbox.

### D. Display boxes are per-context; the source canvas is the one invariant

The same `64×64` PNG is intentionally shown at different sizes per screen — settings
row `36px`, settings tab `34px` in a `40px` slot, brand mark `clamp(40–54px)`. That
stays per-context. **This ADR governs the source canvas, not the display box.**

- Guidance, not law: where `image-rendering: pixelated` is in play, prefer a display
  box that is an **integer divisor of 64** (`32` or `64`) over a fractional one — the
  current `36px` row is `0.5625×`, which shimmers — *or* render that box
  `image-rendering: auto` (smooth), as `.brand-lockup-mark` already does.

### E. Supersession & enforcement

- Formally **supersedes the canvas geometry in `docs/art/kit-briefs/icons.md`**
  (mark it retired for this rule). [ADR-0011](0011-chrome-art-generated-not-extracted.md)
  already retired that brief's *extraction method*; only its still-correct
  "`64×64`, centered" geometry is carried forward — into this ADR.
- Enforcement is the forge dimension-assert in (C), plus a CI/forge guard that
  fails if a shipped kit content icon is not `64×64` — the same "the rule is the
  law, checked in CI" stance as [ADR-0024](0024-ui-typography-system.md).

### Consequences

- Good: a 16-icon re-forge aims at one box; new icons can't drift; "consistent"
  is guaranteed by construction rather than by eyeball.
- **Honest flag on the two new icons.** Re-canvasing lyre (`36×41`) and bell
  (`38×48`) into `64×64` **preserves their pixels** (both are already under the
  safe area, so nothing rescales) — but it **shrinks them optically** in any fixed
  display box versus the bare-bbox versions just approved, because the box now
  holds a `64` canvas instead of a tight crop. The approved *look* must be
  **re-confirmed by sight after re-canvas**, not assumed to carry over.
- Bringing `info.png` (and any other off-safe-area icons) onto the safe area is a
  **staged re-forge**, done icon-by-icon behind the screenshot harness — a separate
  effort from accepting this ADR.

## More Information

- Canonical canvas + safe area live in the source PNGs:
  `frontend/public/assets/ui/kit/icons/*.png`.
- Forge: `frontend/scripts/kit-forge.mjs` (glyph icons),
  `frontend/scripts/forge-atom.mjs` (9-slice atoms). Method
  [ADR-0011](0011-chrome-art-generated-not-extracted.md) / transparency
  [ADR-0013](0013-transparency-chroma-key-via-subscription.md); the verify-the-method
  discipline is in `docs/kit-forge.md`.
- Display consumers: `.settings-row-icon`, `.settings-tab-icon img`
  (`frontend/src/style.css`), `.brand-lockup-mark`
  (`frontend/src/ui/BrandLockup.tsx`).
- Superseded geometry: `docs/art/kit-briefs/icons.md`.
- Precedent: [ADR-0007](0007-brand-shield-baseline-size-and-placement.md) (centered
  fixed canvas), [ADR-0014](0014-ui-chrome-low-fidelity-aesthetic.md) (fidelity),
  [ADR-0024](0024-ui-typography-system.md) (canonicalize + enforce an implicit
  dimension).
