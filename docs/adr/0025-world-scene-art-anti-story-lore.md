---
status: "accepted"
date: 2026-06-27
deciders: Nelson, Claude
---

# ADR-0025: World / scene / portrait art is governed by the anti-story lore

Back-fills a standing decision into the ADR system (per
[ADR-0001](0001-use-adrs-for-decisions.md)'s migration rule) so that an agent
generating ANY world, background, or portrait art is bound to — and can *find* —
the art lore through the normal ADR/contract trail, instead of the human having to
hand-point each new agent at it.

## Context and Problem Statement

The project's world/background/portrait art follows a deliberate, written
**"anti-story"** framework. But that framework lives only in `docs/lore-anti-story.md`,
`docs/lore/historical-anchors/`, and the background contracts — none of it is
surfaced as a *decision*. An agent booting with wiped context doesn't reach it via
the ADRs or contracts, so it invents a generic "fantasy chess" direction and
generates off-theme art. The recurring cost is the human re-pointing every agent
at the lore by hand.

## Decision Outcome

Chosen: **the anti-story lore is the binding art direction for all generated
world / scene / portrait art (and informs UI accents)** — recorded here so it is
discoverable and governed, not improvised.

**Read before generating any scene or portrait art (authoritative):**

- `docs/lore-anti-story.md` — the thematic bible.
- `docs/lore/historical-anchors/` (+ its `README.md`) — real historical events used
  as **pressure sources** (Jerusalem / Second Temple 70 CE, the Dissolution of the
  Monasteries, WWI Lijssenthoek / "The Farm Behind the Line", the Year Without a
  Summer 1816, plus a wider candidate roster), each with briefs.
- `docs/background-art-contract.md` + `docs/background-set-briefs.md` — how an anchor
  becomes a hidden background set.

**The binding themes** (summary; the docs above are authoritative):

- **The anti-story rule:** *"the tragedy happened, but the image does not show it
  directly; the image shows life continuing around its residue."* Survival, repair,
  reuse, endurance — **never** active battle, spectacle, gore, or heroic-poster energy.
- **Medieval dream-board:** chess pieces / meeples are how the dream remembers
  people — **faceless** (no readable face, anywhere, ever), objective-driven, sitting
  on the object/person boundary.
- **Ordinary life beside an unseen catastrophe**, grounded in a real historical
  anchor that is **for us, not for the viewer to identify** from the image.
- **War as residue; religion as matter** (chapels, bells, grave markers — power
  because the matter remains, not because it explains itself); **ancient roads /
  movement** (no overt chessboard motif in scenes); **life as motif** (small
  pawn/meeple figures that deepen the emptiness).
- **Palette is per-image** — no forced color grade; consistency comes from restraint,
  subject, facelessness, material, absence, and atmosphere (`lore-anti-story.md`). The
  one hard palette prohibition is **purple-heavy** (`ui-art-direction.md`). This is
  what permits, e.g., a wood lyre or a bronze bell instead of a forced UI-blue.

### Consequences

- Good: an agent orients to the art lore through the ADR trail; the human stops
  hand-pointing. "What themes / what colors" has a governed answer.
- Cost: this ADR must stay a **pointer** — the lore docs are authoritative. If the
  lore evolves, update the docs and note it here; do not let this summary drift.

## More Information

- Canon: `docs/lore-anti-story.md`; `docs/lore/historical-anchors/` (+ README);
  `docs/background-art-contract.md`; `docs/background-set-briefs.md`.
- Related (these govern *method/fidelity*, this governs *subject/theme*):
  [ADR-0011](0011-chrome-art-generated-not-extracted.md) (generated, not extracted),
  [ADR-0013](0013-transparency-chroma-key-via-subscription.md) (transparency),
  [ADR-0014](0014-ui-chrome-low-fidelity-aesthetic.md) (low-fi aesthetic).
