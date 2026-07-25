---
status: "accepted"
date: 2026-06-26
deciders: Nelson, Claude
---

# ADR-0012: Scalable 9-slice chrome frames are atom-assembled — whole-frame generation is retired for chrome

Resolves an ambiguity left open by
[ADR-0011](0011-chrome-art-generated-not-extracted.md) and generalizes
[ADR-0009](0009-mode-button-from-atoms.md) from the mode button to every kit
frame.

## Context and Problem Statement

ADR-0011 settled that chrome art is **generated or atom-assembled** (never
extracted/redrawn) — but it presented those two as **co-equal options** and never
said *which to use when*. There is no single place an agent lands on, at the
moment of building a kit frame, that says "this kind of asset is made this way."

The cost was concrete and just played out over many turns on the settings row: I
**whole-frame generated** it (one codex image of the entire box). Whole-frame
generation draws the four corners **independently**, so one came out a malformed
"J" hook. Patching that one corner would still leave four independently-drawn
corners free to drift again.

Atom assembly cannot have that defect: `assemble-frame.mjs` takes **one** corner
atom and mirrors it into all four (plus a tiled edge and fill). The frame is
**symmetric by construction** — there is only one corner to get right, and the
other three are guaranteed identical.

## Decision Drivers

- Make the right method the obvious one *at the point of building a frame*, not a
  fact scattered across ADR-0002 / ADR-0009 / a script comment / a memory note.
- Kill the class of defect (asymmetric / lopsided / "J" corners) by construction,
  not by review.
- One method for all kit frames (panel, row, button, tab, header) — consistent
  with how `panel.png` and the mode button are already built.

## Decision Outcome

**Any scalable 9-slice chrome frame** — anything rendered via `border-image` and
tiled/stretched (panel, row, button, tab, header strip, etc.) — has its source
PNG **assembled from atoms** via `scripts/assemble-frame.mjs`
(`buildFrameFrom(corner, edge, fill, W, H)`). Codex's *generation* job is the
**atoms** (above all the single corner), never the whole frame.

**Whole-frame image generation is retired for scalable chrome.** It remains valid
only for **provably-static, non-tiled sprites** reviewed as a whole (e.g. a fixed
icon or badge) — never for a frame that gets 9-sliced.

This refines ADR-0011 (which method, when) and is **settled**: do not whole-frame
a kit frame because a script for it happens to exist. If a frame seems to need
whole-frame generation, that is a new ADR proposal, not an in-passing choice.

### The process (authoritative)

1. **Get the corner atom in the right palette.** Either a luminance-matched
   **palette swap** of an existing atom (the cyan-mode-button technique, ADR-0009)
   or have codex **paint a single corner atom** — img2img, method-verified via an
   `image_generation_call` in the rollout (`kit-forge.md`), transparency by
   chroma-key + `remove_chroma_key.py` (codex imagegen skill), never a prose
   "transparent" request. Same for a new `edge` / `fill` if the palette is new.
2. **Assemble** at the target size with `assemble-frame.mjs` (`buildFrameFrom`).
3. **Review live** in `/artwork-compare` (ADR-0005) against the concept before
   landing.

### Consequences

- Good: asymmetric corners become impossible; you review **one** corner, not four;
  every kit frame is built the same way.
- Action-point visibility: `assemble-frame.mjs` is the canonical entry and should
  announce this process on its output; whole-frame chrome scripts (e.g.
  `forge-row.mjs`) are retired/repurposed and must say on their output that they
  are **not** for scalable chrome.
- Note: a frame in a non-atom palette (the row is steel; kit atoms are gold)
  needs a recolored corner atom first — that is step 1, not a reason to whole-frame.

## More Information

- Assembler: `scripts/assemble-frame.mjs` (mirrors one corner → four).
- Worked example: ADR-0009 (`scripts/generate-mode-button.mjs`).
- Mechanism: ADR-0002 (9-slice `border-image`). Source method: ADR-0011.
