---
status: "accepted"
date: 2026-06-25
deciders: Nelson, Claude
---

# ADR-0007: Brand shield — keep baseline size; heraldic rook placement is intentional

## Context and Problem Statement

In the standardized ~72px title bar (ADR-0004), the brand shield looked tight to
the corner bracket, which raised two questions: should the shield be smaller, and
is the rook off-center inside the shield?

## Decision Drivers

- Keep the brand prominent and faithful to the accepted art.
- The decision rubric (ADR-0006): this is menu/chrome, so breathing room matters,
  but not at the cost of the brand reading as the brand.
- Don't "fix" something that is actually correct by convention.

## Considered Options

- Shrink the shield (tried ~40px — too small; ~46px and ~50px were also mocked
  live in the artwork-compare tool).
- Keep the shield at its baseline size (~54px).
- Re-center the rook vertically within the shield.

## Decision Outcome

Chosen: **keep the shield at its baseline size** — `clamp(40px, 4vw, 54px)`
(up to 54px) — and **leave the rook placement as-is**.

- Size: 40px read as too small; 54px is accepted as fine in the standard bar.
- Centering (measured, not eyeballed): the shield art is symmetric and perfectly
  centered in its 256×256 canvas (equal margins — left 20 = right 20, top 3 =
  bottom 3), so there is no centering bug.
- Rook placement: the rook is centered horizontally and sits high in the field,
  with the shield tapering to its point below it. That is the standard heraldic
  placement of a charge (the "honour point"), not a defect — vertically centering
  it would crowd the point. So it is intentional and stays.

No code or asset change results; the live CSS is already at this baseline.

### Consequences

- Good: the brand stays prominent and on-convention; the question is settled and
  shouldn't be reopened.
- Cost: in the standard 72px bar the shield sits fairly close to the frame; this
  is accepted rather than chased with a smaller mark or a taller bar.

## More Information

- Evaluated live in `/artwork-compare` (ADR-0005) by mocking 46/50px speculations.
- Decision rubric: [ADR-0006](0006-ui-decision-criteria.md). Bar height: [ADR-0004](0004-standard-app-title-bar.md).
- Asset: `frontend/public/assets/ui/kit/icons/brand-shield.png` (the forged gen-5 shield).
