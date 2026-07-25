---
status: "accepted"
date: 2026-06-27
deciders: Nelson, Claude
---

# ADR-0034: A surface behind kit chrome uses a transparent-interior "line" frame, not a per-material baked frame

Extends the atom-assembled 9-slice kit ([ADR-0012](0012-nine-slice-frames-are-atom-assembled.md))
and the low-fidelity chrome aesthetic ([ADR-0014](0014-ui-chrome-low-fidelity-aesthetic.md)).
It answers a recurring question: **how do you put a texture (a stone / wood surface)
*behind* a piece of kit chrome — a panel, a tab button, a row — when the chrome is a
9-slice that bakes its own fill colour in?** This came up building the settings
"dressing room" (the surface-placement tool on the Studio page) and will recur every
time we want a surface to read through a framed element.

## Context and Problem Statement

Every kit frame is an atom-assembled 9-slice (ADR-0012): `corner` + `edge` + `fill`
atoms composed into one PNG, applied with CSS `border-image: url(frame.png) <slice>
fill / <width>`. The `fill` keyword paints the frame's **center** slice — that is
where the navy interior of `panel.png` / `mode-button.png` / `row.png` comes from.

To reveal a surface behind such an element the obvious move — **drop the `fill`
keyword** — does not work. A 9-slice has **eight edge slices plus the center**, and
the navy is baked into the *edge* slices too (the rail's inner band). Dropping `fill`
removes only the center; the eight edge slices still ring the element navy. The
result is a navy frame/ring around the surface — the "fill problem." It bit us first
on the settings panels and again, identically, on the tab buttons and rows.

The tempting wrong fix is a **dedicated per-material frame** — bake a "wood button,"
a "stone panel," etc. That explodes combinatorially (every frame × every material),
and a baked-in fill is a fixed bitmap: it cannot tile, cannot share one continuous
surface across regions, and cannot take a zoom/offset — it undoes the whole
surface-as-a-separate-layer model.

## Decision Drivers

- **One surface layer, many frames** — the texture is authored once and tiles; the
  frame is just ornament over it. Never bake the surface into the frame.
- **Reproducible, not hand-carved** — the transparent-interior frame must regenerate
  from the same atoms as its filled twin, so the two can't drift (ADR-0012).
- **Low-fi, native pixels** — the line twin is whole-pixel, `image-rendering: pixelated`
  (ADR-0014).
- **Cover the 9-slice, not just the center** — the fix must remove the *edge*-slice
  bleed, which is the actual cause.

## Decision Outcome

A surfaced element is **transparent-interior "line" frame (ornament only) + the
surface as a separate `background` layer**. Never a per-material baked frame.

### A. The "line" frame — ornament only

For any frame that needs to sit over a surface, bake a **line** twin by assembling the
*same* corner + edge atoms with a **transparent fill** — nothing else. The navy interior
lives entirely in the fill atom, so this alone is the full ornament over a see-through
center; there is no fill to ring it. Two cleanup passes were tried and rejected: a global
dark-pixel **mask** ate dark ornament down to a bright keyline; **carveExterior** ate a
dark rail's outer bevel, pulling the frame *off* the element edge. So neither — just
assemble. The decisive constraint (see §D): a line frame's ornament must reach the element
**edge**, so the surface fills *up to* it and never spills past it. `bakeLine(assetId)` in
`frontend/scripts/nine-slice-kit.mjs` is the single implementation; it reuses the asset's
committed corner tune, so the line twin can never diverge from the filled frame's geometry.

### B. First-class, registry-declared, parity-tested

A frame opts in with a **`line: "<name>.png"`** field in
`config/nine-slice-registry.json`. `buildAsset` (so `apply-nine-slice.mjs`) and the
focused `bake-line-frames.mjs` both write it to
`public/assets/ui/explore/frames/`, and the bake-parity test
(`src/ui/design/nineSliceBake.test.ts`) re-bakes it and asserts it equals the
committed PNG — exactly as for the filled variants. So a line frame is a normal,
regenerable kit output, not a one-off. Today only `panel` carries the flag, and because
`panel.png === mode-button.png` (identical atoms) the one **`panel-line.png` serves the
panels, the tab buttons, *and* the rows** (per §D the row borrows it). The steel `row`
frame gets no line twin — its rail is inset (§D), so it can't be surfaced cleanly.

### C. The surface is a separate background layer

The element keeps the line frame as `border-image` and paints the surface as its own
`background`, reaching the edge with `background-clip / -origin: border-box`, and
`background-attachment: fixed` so multiple regions sample **one continuous sheet**
(the texture flows unbroken across panel / button / row seams rather than restarting
per element).

### D. A surfaced element keeps a frame — but the ornament must reach the edge

A surfaced element keeps a frame just like a filled one (never dropped); the texture fills
the see-through interior **up to** the frame. For that to read cleanly the frame's ornament
must reach the element **edge**, so the surface stops at it. **Corner brackets** (panel /
mode-button) do. The settings **row's** native frame is a steel rail **inset** from the edge
(a transparent margin is baked into its edge atom); surface-filled, that margin sits *outside*
the rail and the rail floats with surface spilling around it — no `background-clip` value
lands on the rail's edge to stop it. So a surfaced row borrows the **bracket** frame
(`panel-line`, the same one the tabs use), not its own rail. Rule: surface a frame only if its
ornament reaches the edge; an inset rail must be re-tooled (rail flush in its atom) or
substituted. (Missteps this session, all wrong: the row was over-masked to a keyline, then
dropped to frameless, then shown with the inset rail that spilled.)

### Consequences

- **Good:** any element can be surfaced with `line-frame + surface-background`; no
  navy ring; one texture tiles continuously behind all of them; new frames get a line
  twin by adding one registry field, covered by the existing parity test.
- **Good:** the hand-made `panel-line.png` is replaced by the baked one (byte-pinned
  by the test), so it is regenerable like everything else.
- **Cost:** the line twin assumes the navy interior is isolated in the **fill atom**
  (true for every current kit frame). A frame that baked its body colour into the
  corner/edge atoms instead would carry it into the line twin — that frame would need
  its atoms split, not a post-hoc mask (the mask route ate a dark rail; see §A).

## More Information

- **Where it bit:** the settings dressing room (`frontend/src/ui/SurfaceDressingRoom.tsx`)
  — surfaces behind the title bar, tabs box, buttons, rows box, and rows.
- **Implementation:** `bakeLine` + `LINE_DIR` + the `line` registry field in
  `frontend/scripts/nine-slice-kit.mjs`; `frontend/scripts/bake-line-frames.mjs`;
  parity in `frontend/src/ui/design/nineSliceBake.test.ts`.
- **Assets:** `frontend/public/assets/ui/explore/frames/panel-line.png` (serves panels,
  tab buttons, and rows).
- **Related:** ADR-0012 (atom-assembled 9-slice frames — the line twin reuses the
  atoms), ADR-0014 (low-fi / native pixels / pixelated render).
