# ADR-0048: Animated tile tops are baked frame sheets (water ripple)

- Status: accepted
- Date: 2026-07-01

## Context

The board's water tiles were static. We want the "loose indie pixel-art" idle
life of animated water without violating two standing rules: motion on the
board is **generated art, not CSS effects** (ADR/no-CSS-for-visual-treatment),
and pixel art is never fractionally rescaled.

A tile is already two stacked layers in one cell z-band (ADR-0039): a `-side`
cliff half under a `-top` walkable-surface half, both authored at the 96x180
frame. That split is exactly the animation seam: the surface can move while the
cube body stays frozen.

An earlier animated-water experiment (pre-ADR-0039, single-layer tiles) proved
the generation mechanism — PixelLab v3 `animate_object` with
`custom_start_frame_base64` = the canonical tile PNG returns frames at the
input's exact dimensions — but its assets were pruned in the board-rendering
unification (PR #120).

## Decision

1. **The motion is BAKED art.** Each water variant ships
   `water-<n>-top-anim.png`: a horizontal sheet of 8 full 96x180 frames.
   Frames are PixelLab v3 candidates generated from the variant's own static
   top as the start frame, then **locked** by `scripts/build-water-anim.py`:
   every frame's alpha channel is copied verbatim from the static top (bit-
   identical silhouette; nothing moves outside the diamond; socket edges stay
   put), generated RGB is kept only inside it, and any pixel the model erased
   falls back to the static art. Frame 0 IS the static top, so the loop wraps
   onto the exact shipped art. Raw candidate frames are archived under
   `docs/art/pixellab-runs/` (the local pipeline owns acceptance, per
   `docs/pixellab-api-notes.md`).

2. **Code only advances the frame index.** The shared `<TileTopLayer>`
   (`src/render/TileTopLayer.tsx`) renders an animated top as a span over the
   sheet driven by a CSS `steps(N)` background-position animation — the same
   model as the ground-cover sway. Both render paths consume it: the game
   board (`BoardLabBoard`) and the Studio/Level-Editor cell art
   (`studioCellArt`, which switches to split side+top layers for animated
   assets; top ∪ side == the combined sprite, so statics are unchanged).

3. **Opt-in via the registry.** `TileSocketAsset.topAnimFrames` marks an asset
   animated (`tileset.ts` sets 8 for the water family). Static tiles are
   untouched single-`<img>` paths.

4. **Per-cell phase, never unison.** Each cell gets a deterministic
   whole-frame negative delay from its board coords, so a body of water
   shimmers loosely instead of pulsing.

5. **Reduced motion.** The animation clears the global OS-reduce
   `* { animation: none !important }` reset with `!important`, following the
   deploy-drop precedent: Windows "animations off" reports
   `prefers-reduced-motion: reduce` falsely, and ambient board scenery must
   not freeze for those players. The EXPLICIT in-game choice
   (`:root.reduce-motion`) freezes it to frame 0 = the static art.

## Consequences

- Animating another family/variant = bake a sheet with the same script and set
  `topAnimFrames`; no new code.
- The sheets add ~8x the top-half bytes for water only (~40KB/variant).
- The water cliff *sides* stay static; the river/waterfall edge remains a
  separate, deferred feature (see tileset.ts notes).
- The Studio catalog cards still show the static combined sprite; the live
  boards (level editor, campaign viewer, skirmish) all animate.
