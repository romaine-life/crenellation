---
status: "accepted"
date: 2026-06-27
deciders: Nelson, Claude
---

# ADR-0015: Doodads frame the unit, they do not bury it

## Context and Problem Statement

Doodads are decorative props (grass tufts, ferns, flowers, rocks) placed on board
tiles to give terrain depth and texture. A unit can stand on a tile that has a
doodad, so we render each doodad as a **split-layer** prop — a back half and a
front half split at the ground-contact plane — and z-sort the unit between them
(see the `split-layer doodad` glossary entry). The unit then appears to stand
*inside* the prop instead of being awkwardly pasted on top of flat terrain.

The split mechanism works, but we shipped it with **no sizing rule**, and the
foliage came out tall: full-height clumps swallowed the knight to the chest. That
looks lush in isolation, but it hides the one object on the tile the player must
actually read. This ADR pins down how big a doodad may be and which props are even
eligible for the stand-inside treatment — so "more decoration" can never quietly
win against unit readability again.

## Decision Drivers

- **The unit is the primary game object.** Its type, facing, and team colour must
  be identifiable at a glance, and it must read as selectable. This is an in-game
  surface, so per [ADR-0006](0006-ui-decision-criteria.md) we lean game-UI
  (immersion, depth) — but the usability floor (legibility, glanceability) comes
  first and is non-negotiable.
- Doodads should add depth, texture, and world cohesion to terrain.
- A doodad belongs to a terrain (a grass tuft is not on stone).
- Assets must stay recoverable/regenerable (source mesh + recipe, not binaries in git).

## Considered Options

- **Full-height props** — the unit stands fully enveloped.
- **No overlap** — the doodad sits strictly behind or beside the unit, never in front.
- **Ankle/shin-height foliage that brackets only the feet.**

## Decision Outcome

Chosen: **shin-height foliage that brackets the feet.** Full-height burying is
rejected because it defeats the unit; no-overlap is rejected because it throws away
the depth the split-layer model exists to create.

The rules a doodad must obey:

1. **Split-layer.** Back half at `z = base − 1`, front half at `z = base + 1`, the
   unit at `z = base`, all sharing the `(48,69)` contact anchor. The unit sorts
   between the halves.

2. **Cover the feet, not the unit (the load-bearing rule).** A doodad's front
   layer may occlude **at most the unit's feet and shins — roughly its lower
   quarter.** The torso, head, weapon, and overall silhouette stay clear. Concretely,
   a doodad's standing height should be **≲ ⅓ of a unit's height** (~shin level), not
   chest- or head-high.

   **Why over-coverage is wrong:** the player identifies a unit by its silhouette
   (type + facing) and clicks it to select it. Foliage to the chest hides the type
   and facing, makes the unit look like it is sinking into the ground rather than
   standing on it, and erodes the affordance that it is a movable, selectable piece.
   A doodad is set dressing; it must never outrank the unit it dresses. Depth is the
   goal, concealment is the failure mode — and the line between them is the ankle.

3. **Foliage nests; solids do not.** Only see-through foliage — grass, ferns,
   flowers, reeds, small plants — is eligible for the stand-inside treatment, because
   you can see the unit *through* it. Solid masses (boulders, stumps) occlude rather
   than veil: their front half hides the whole lower body regardless of height, so
   they are **not** unit-shared stand-inside doodads. Solid obstacles, if wanted, are
   a separate concept (their own tile, no unit on top) and out of scope here.

4. **Terrain-gated.** A doodad places only on a tile of its home terrain; off-terrain
   placement is refused (the board brush hard-gates on `terrains`).

5. **Recoverable pipeline.** Each doodad renders from a CC0 source mesh through
   `render_doodad_gltf.py` (stand up, normalise, ground to the contact, bisect
   front/back). The slug + recipe + `SOURCES.md` are the record; meshes stay out of git.

### Consequences

- Good: units stay readable and selectable on decorated tiles; terrain still gains
  depth and texture; "is this doodad too big?" has a concrete answer (shin height).
- Cost: per-prop sizing has to be tuned to the shin-height budget (scale + scatter
  density), and the appealing-but-wrong full-height look is off the table. Solid-prop
  obstacles are deferred.

## Pros and Cons of the Options

### Full-height props

- Good: lushest look in isolation; strongest "world" feel.
- Bad: buries the unit — hides type/facing, breaks selection read, looks like sinking.

### No overlap (behind/beside only)

- Good: unit never occluded.
- Bad: throws away the nested-depth effect; the unit reads as pasted on flat ground
  again, which is the original problem the split-layer model solved.

### Shin-height foliage bracketing the feet

- Good: keeps the unit fully readable while still nesting it for depth; gives a clear,
  enforceable size budget.
- Bad: requires sizing discipline; rules out solid props as stand-inside doodads.

## More Information

- Mechanism: `split-layer doodad` glossary entry (in-app Studio → Glossary).
- Pipeline: [`../art/doodad-concepts/render_doodad_gltf.py`](../art/doodad-concepts/render_doodad_gltf.py),
  [`../art/doodad-concepts/SOURCES.md`](../art/doodad-concepts/SOURCES.md).
- Surface tradeoff rubric: [ADR-0006](0006-ui-decision-criteria.md).
- Board seating/contract: [`../board-render-contract.md`](../board-render-contract.md).
