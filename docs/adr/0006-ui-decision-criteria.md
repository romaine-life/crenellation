---
status: "accepted"
date: 2026-06-25
deciders: Nelson, Claude
---

# ADR-0006: Criteria for weighing game-UI vs product-UI per surface

## Context and Problem Statement

UI choices in this app repeatedly pit **game-UI** guidance (immersion, theme,
density, world cohesion) against **product-UI** guidance (clarity, breathing
room, convention). These two literatures genuinely conflict, and we were deciding
case by case ("which is better"). We need a reusable rubric, grounded in both, so
choices are consistent and defensible instead of re-argued each time.

This app is a pixel-art browser tactics game with a binding art direction and
accepted concept art. It has both **in-game** surfaces (board, HUD, skirmish) and
**menu/chrome** surfaces (settings, studio, editors), which is why a single
blanket rule from either world is wrong.

## Decision Drivers

- Stop ad-hoc "which is better" debates.
- Ground decisions in cited guidance from both game UI and product UI.
- Honor the binding art direction without letting it break usability.
- Respect that in-game and menu surfaces sit at different points on the spectrum.

## Considered Options

- Decide case by case (status quo).
- Adopt product-UI conventions wholesale.
- Adopt game-UI conventions wholesale.
- A synthesized rubric with a surface-based tie-break.

## Decision Outcome

Chosen: **a synthesized rubric plus a surface-based tie-break.** Wholesale
adoption of either world is rejected — product-only sands off the game's
identity; game-only erodes the clarity the menus need.

### The criteria

1. **Usability floor (non-negotiable).** Legibility, contrast, hit-target size,
   label↔control proximity. Nothing below clears this if it breaks here.
2. **Fidelity to the accepted art direction.** For *look* questions the concept
   art is the reference — but it was one-shot-generated, so it's authoritative for
   mood/intent, not infallible; if it violates #1, #1 wins.
3. **Visual hierarchy.** One clear focal order per surface — via spacing/contrast
   (product) and framing/ornament (game).
4. **Breathing room ↔ density.** The contradiction axis (resolved by surface).
5. **Theme / world cohesion.** Does it feel like one crafted object in the game's
   material language (gold brackets, navy, cyan), not a generic widget?
6. **Consistency / no reinvention.** Same problem solved the same way everywhere.
7. **Glanceability & priority.** Vital info readable at a glance; don't clutter
   the play view (mostly HUD/board).
8. **Feasibility & accessibility.** 2D-browser-renderable; text stays live
   (resize / screen reader).

### The tie-break when game-UI and product-UI conflict

1. Does it break the **usability floor** (#1)? If yes, usability wins, full stop.
2. Otherwise, **which surface is it?**
   - **In-game (board, HUD, skirmish):** lean game-UI — immersion, theme,
     glanceability, protect play space; density is fine.
   - **Menus / chrome (settings, studio, editors):** lean product-UI — clarity,
     breathing room, scannability — while still wearing the game skin.
3. Within that lean, the **accepted concept** is the reference for the look.

This is consistent with `ui-art-direction.md`, which already splits "colorful
board / low-glare quiet chrome" and warns against "decorative borders that reduce
information density."

### Consequences

- Good: consistent, defensible UI decisions; honors the art direction; explicitly
  hands the subjective calls (theme-feel, art fidelity) to the owner rather than
  faking them.
- Cost: requires a judgment of "which surface is this," and criteria #2 and #5 are
  subjective — only the owner can settle them.

## More Information

- Game UI: [Pixune](https://pixune.com/blog/game-ui-design/),
  [Justinmind – game UI](https://www.justinmind.com/ui-design/game),
  [kreonit](https://kreonit.com/idea-generation-and-game-design/ui-ux-design-in-games/).
- Product UI / whitespace: [Justinmind – white space](https://www.justinmind.com/blog/white-space-design/).
- Games vs products: [Medium – Fadlan Azhari](https://fadlanazhari.medium.com/ui-ux-in-games-vs-ui-ux-in-conventional-products-a-personal-take-850e4f9145a5).
- Consolidated current-state: [`../ui-art-direction.md`](../ui-art-direction.md) ("Deciding UI Tradeoffs").
