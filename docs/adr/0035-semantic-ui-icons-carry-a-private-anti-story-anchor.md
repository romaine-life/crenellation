---
status: "accepted"
date: 2026-06-28
deciders: Nelson, Claude
---

# ADR-0035: Semantic UI icons that depict world objects carry a private anti-story anchor

[ADR-0025](0025-world-scene-art-anti-story-lore.md) binds **world / scene /
portrait** art to the anti-story lore and notes the lore "informs UI accents" —
but it does not say *how* a single semantic UI icon that depicts a world object
(a door, a bell, a lock) gets its subject. So such icons risk being drawn from a
generic UI-symbol library (the stock "logout = arrow flying out of a box") that
has nothing to do with this world. This ADR fills that gap. It governs *subject /
meaning*; the canvas + placement are [ADR-0026](0026-ui-kit-icon-canvas.md) /
[ADR-0027](0027-icon-optical-keylines.md), the fidelity is
[ADR-0014](0014-ui-chrome-low-fidelity-aesthetic.md), and the forge method is
[ADR-0011](0011-chrome-art-generated-not-extracted.md) /
[ADR-0013](0013-transparency-chroma-key-via-subscription.md). The **sign-out
door** is the founding instance.

## Context and Problem Statement

Most kit glyphs are abstract marks (gear, chevron, info-i) with no world
referent — they need no lore. But some kit icons **depict a real object from the
medieval dream-board** — the kit already ships a wooden `lyre` and a bronze
`bell`, both material objects straight out of the lore's "religion as matter"
vocabulary. An action icon that depicts such an object (the **door** behind a
sign-out control) sits in the same class. Left ungoverned, the next agent forging
one reaches for the stock UI symbol and the object lands off-world, or it lands
on-world by luck with no recorded reason — so it drifts on the next re-forge.
ADR-0025's whole point is that the *reason* must be **discoverable through the
ADR trail**, not re-pointed by hand. The reason for these icons currently lives
nowhere.

## Decision Outcome

**A semantic UI icon that depicts a world object takes its subject from
[ADR-0025](0025-world-scene-art-anti-story-lore.md)'s material vocabulary, and
carries a one-line *private anchor* documented here — a meaning that is for us,
never surfaced to the player. The icon must still read functionally at a glance
(its action is also carried by a text label, [ADR-0023](0023-app-title-bar-layout-and-controls.md)).**

Three rules:

1. **Subject from the world, not the symbol library.** The object is one the lore
   already owns — `docs/lore-anti-story.md` "religion as matter" (chapels, bells,
   *worn thresholds*, *carved doors*, grave markers, cloisters, old stone), "war
   as residue", "roads / ancient movement". Material palette per-image
   (ADR-0025: wood/stone/bronze, the precedent the `lyre` and `bell` already set),
   never a forced UI-blue; the one prohibition is purple-heavy.
2. **A private anchor, written down.** Where the object has a referent, it is tied
   to one of the historical anchors (`docs/lore/historical-anchors/`) and that tie
   is recorded here. The anchor is **for us** — consistency and intent — and is
   **never** shown to the player: no caption, tooltip-lore, or copy explains it
   (ADR-0025: "for us, not for the viewer to identify"). The anti-story rule holds:
   the icon shows the residue (a door that remains), never the catastrophe.
3. **Function survives the meaning.** The glyph must still read as its action at a
   glance on the kit canvas (ADR-0026/0027, low-fi ADR-0014). Meaning grounds the
   *form*; it never costs legibility. The text label is the redundant carrier.

### The anchor table

| Icon | Object (subject) | Private anchor | Reading (for us, never shown) |
|---|---|---|---|
| `sign-out` | a humble carved/planked medieval **door, slightly ajar, in worn gray stone with a dished threshold stone** at its foot — warm wood + cool stone, low-fi | **Dissolution of the Monasteries** — "Stone After Prayer" (`docs/lore/historical-anchors/dissolution-of-the-monasteries.md`) | A stripped cloister door that **outlives the institution that built it** — "religion as matter", the threshold worn by repeated passage. Signing out is crossing a worn threshold that *remains while the people don't*: you leave the board the way the village still passes the emptied abbey — ordinarily, through a door that endures. *Life continuing around the residue.* |

New semantic icons extend this table with their own one-line anchor; they do not
re-litigate the rule.

### Consequences

- **Good:** action icons get a coherent, **governed** subject discoverable through
  the ADR trail (the ADR-0025 goal), so they don't drift to stock symbols or
  drift between re-forges; the kit's existing material icons (`lyre`, `bell`) gain
  a stated home for the same instinct.
- **Cost:** each such icon needs a one-line anchor (cheap) and the discipline that
  it **never leaks** into player-facing copy. A purely abstract glyph (chevron,
  info) is out of scope — it has no world object to anchor, and forcing one would
  be lore for its own sake, which ADR-0025 forbids.

## More Information

- **Lore (authoritative):** `docs/lore-anti-story.md`;
  `docs/lore/historical-anchors/dissolution-of-the-monasteries.md` (+ README).
- **Governs subject/theme**, alongside: [ADR-0025](0025-world-scene-art-anti-story-lore.md)
  (the lore pointer this extends to single UI icons),
  [ADR-0026](0026-ui-kit-icon-canvas.md) / [ADR-0027](0027-icon-optical-keylines.md)
  (canvas / placement), [ADR-0014](0014-ui-chrome-low-fidelity-aesthetic.md)
  (fidelity), [ADR-0011](0011-chrome-art-generated-not-extracted.md) /
  [ADR-0013](0013-transparency-chroma-key-via-subscription.md) (forge method /
  transparency), [ADR-0023](0023-app-title-bar-layout-and-controls.md) (label is
  the redundant carrier).
- **Forge:** `frontend/scripts/kit-forge.mjs` (the `sign-out` spec). Method
  discipline: `docs/kit-forge.md`.
- **Asset:** `frontend/public/assets/ui/kit/icons/sign-out.png` (64×64).
- **Consumer:** `frontend/src/ui/shared/AccountMenu.tsx` (the main-menu account menu).
