---
status: "accepted"
date: 2026-06-27
deciders: Nelson, Claude
---

# ADR-0030: Scrollbars never vanish — always-visible bare rail, skinned grip thumb

Codifies the scrollbar policy that was researched at length (a multi-source pass on
always-visible vs conditional/overlay scrollbars, the discoverability evidence, and a
grip bake-off) but never written down. The catalog side is governed by
[ADR-0029](0029-catalog-category-requirements.md); this governs how a scrollbar
*behaves and renders* in the app.

## Context and Problem Statement

Scroll regions need one consistent treatment. The default web habit — `overflow: auto`
(conditional) or OS overlay scrollbars — makes the bar **appear and disappear**, which
(a) reflows the layout as content crosses the scrollable threshold and (b) hides the
fact that content is scrollable at all. The usability evidence is one-sided: NN/g and
Baymard find auto-hidden / vanishing scrollbars cause users to miss scrollable content
and even abandon tasks. The studio's own `studio-control-architecture.md` already states
the **"frame never moves"** rule for exactly this reason.

A first implementation skinned the *native* scrollbar (`::-webkit-scrollbar`). Two
problems sank it: (a) Chrome stops painting the custom bar entirely when there is no
thumb, so the rail genuinely **vanished** on an empty pane — the exact failure this rules
out; and (b) puppeteer-driven Chrome never paints a native scrollbar skin, so "always
visible" could not be screenshot-verified. The rail is therefore **drawn as real DOM**
instead of skinning the native bar.

## Decision Outcome

Chosen: **scrollbars never vanish.** Concretely:

1. **Always-visible rail.** The rail is a real DOM element that is **always rendered** —
   never `overflow: auto` (conditional), never hidden-until-hover / OS overlay, and never a
   browser-painted bar that the engine can drop. With nothing to scroll, the **bare rail
   stays** and must read as a visibly recessed groove, distinct from the panel behind it —
   not a near-invisible line.

2. **No thumb when empty (honest negative affordance).** The thumb appears **only** when
   content overflows. A thumb with nothing to scroll is a *false affordance* — it promises
   more content and frustrates a drag that does nothing (NN/g; affordance theory). So:
   **bare rail when empty, the carved grip thumb when scrollable.** This is the inert state
   the catalog Viewer already shows.

3. **The frame never moves.** The rail occupies fixed reserved space on the right (the
   content is padded clear of it), so adding or removing scrollable content never reflows
   the panel.

4. **Render — a drawn rail + grip thumb, via one shared `<KitScroll>` primitive.** The
   native scrollbar is **hidden** (`scrollbar-width: none` + `::-webkit-scrollbar{width:0}`);
   `<KitScroll>` draws an **always-present rail** (the recessed groove) and a **grip thumb**
   — the catalog's **preferred grip** (currently PixelLab oak — ADR-0029) — that is mounted
   only when the content overflows and whose height + position track `scrollTop` /
   `scrollHeight`. The content still scrolls natively (wheel, keys, drag-the-thumb); we only
   paint and drive the bar. Consequences of drawing it rather than skinning the native bar:
   - It **cannot vanish** on an empty pane — it is unconditional DOM, not a browser-painted
     bar the engine drops when there's no thumb.
   - It **renders in headless screenshots**, so "always visible" is verifiable, not assumed
     (native `::-webkit` skins never paint under puppeteer — see the capture memory).
   - It works the **same in every browser** (no Chrome-only `::-webkit` dependency, no
     `scrollbar-color` inheritance trap, no Firefox `@supports` fallback to maintain).
   A rounded scroll container still clips its bar; the rail sits inside the wrapper's
   padding so it never squares off the corner.

5. **Accessibility.** The active thumb meets WCAG 1.4.11 (≥3:1 thumb/track contrast) and
   2.5.x target size; the inert rail is exempt (not interactive) but must still read as a
   recessed groove.

### Consequences

- Good: every scrollbar is present, discoverable, on-theme, and cross-browser; the layout
  never jumps; one primitive (`<KitScroll>`) carries the policy so panels inherit it; and the
  bar is screenshot-verifiable like any other element.
- Cost: we re-implement scroll-bar mechanics (thumb size/position, drag) in JS rather than
  leaning on the browser — a small, contained component. The grip is a sprite stretched to
  the thumb, so it squishes when the thumb is short — a future refinement 9-slices it (caps
  fixed, shaft tiled) so it holds shape at any height.

## More Information

- Catalog of grips + the requirements that hold them: [ADR-0029](0029-catalog-category-requirements.md).
- Spec it sits in: `docs/studio-control-architecture.md` (the "frame never moves" rule).
- Implementation: the `<KitScroll>` primitive in `frontend/src/ui/KitScroll.tsx` + its
  `.kit-scroll-*` styles in `frontend/src/style.css`; the chosen grip at
  `public/assets/ui/scrollbars/oak-pixellab.png`. First applied to the level-editor palette.
