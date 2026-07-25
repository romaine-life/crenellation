---
status: "accepted"
date: 2026-06-27
deciders: Nelson, Claude
---

# ADR-0029: Every Studio catalog category meets one requirements contract

Back-fills a standing decision into the ADR system (per
[ADR-0001](0001-use-adrs-for-decisions.md)'s migration rule) so that an agent
adding a Studio catalog category is *bound to* — and can *find* — the full
requirements contract through the normal ADR trail, instead of shipping a partial
category and being caught in review.

## Context and Problem Statement

The Studio catalog is a registry: a single `catalogCategories` array in
`frontend/src/ui/TilePreview.tsx`, each entry `{ id, label, hint, main, controls }`.
`docs/studio-control-architecture.md` is the authoritative spec — it already
defines the layout, the Catalog/Lab/Viewer modes, and the rule that *"adding a
category is one entry here — it cannot ship missing a shared control."*

But that guarantee has a hole. The registry only enforces that a category
**appears** (it gets a selector tab and the stable frame). It does **not** enforce
that the category's `controls` are **complete**. Descriptor-backed categories
(Tiles, Units, Doodads) route through the shared `CatalogControls`, which supplies
Search / Zoom / filters / View-Selected by construction — so they cannot omit a
control. The other categories (Assets, Artwork, Glossary, Surfaces) **hand-roll**
their `controls` JSX, and a hand-rolled category can silently leave things out.

It did: a new **Scrollbars** category shipped with **Search only** — no Zoom, no
"View Selected", and no Viewer surface or Details readout — even though it is a
read-only category that should mirror Surfaces exactly. Nothing flagged it,
because "parity enforced by code" stops at the registry; the contents of a
hand-rolled `controls` are unchecked.

## Decision Outcome

Chosen: **every catalog category must satisfy one explicit requirements contract,
and the gap that lets a hand-rolled category ship incomplete is closed.**

A catalog category MUST provide:

1. **A grid** (`main`) — selectable cards (image + label + meta/badge), filtered
   by the category's search, using the shared studio card classes so it matches
   the other grids. **Cards hug their content — no pointless vertical space.** The
   grid packs rows to the top and sizes each card to its content
   (`align-content: start; grid-auto-rows: max-content`, now the default on
   `.tileset-studio-grid`); a sparse category must NOT let its single row stretch to
   fill the tall catalog pane, leaving a dead gap under every card. (Recurring bug —
   first patched per-grid for Surfaces, then Pages, now folded into the default so no
   new category re-hits it.)
2. **Controls** (`controls`):
   - **Search** — always.
   - **Zoom** — every *visual* catalog (all but text-only Glossary).
   - **Taxonomy filters** — where the set has a natural axis (family, terrain,
     type/provenance/gate, …).
   - **"View Selected"** — always.
3. **A destination** for "View Selected", routed BY ITEM TYPE (never by a tab):
   **placeable** things → the **Lab**; **read-only** things → the **Viewer**.
4. For a **read-only** category: a **Viewer** that shows one item big with a
   **Details** readout, reached via its own **`viewerKind`** in the Viewer's kind
   selector, backed by its **own** selection state (`selected<Thing>Name`) — never
   a shared field. The Viewer stage presents the asset at **optimal
   interactivity**: it *exercises the live, real component* — a scrollbar you can
   actually scroll and drag, a surface tiled in context — **never a dead still
   image** of an interactive thing. "Read-only" constrains *editability* (you
   cannot change the asset here), not *liveness*; the stage exists precisely so you
   can test the thing as it truly behaves.
5. Registration as **one** `catalogCategories` entry — no `category === …`
   branches anywhere in the catalog (that branch is the regression the registry
   exists to prevent).

**Closing the hole (enforcement, not discipline):**

- **Prefer the descriptor path.** A new category SHOULD be a `CatalogType`
  descriptor rendered by `CatalogGrid` / `CatalogControls`, which guarantees the
  control set above by construction. Reach for a bespoke `*LibraryStudio` only
  when the grid genuinely cannot be expressed as a descriptor.
- **Bespoke categories carry the whole contract.** A hand-rolled `controls` MUST
  include Search + Zoom (if visual) + View-Selected + any filters, and a read-only
  one MUST wire its `viewerKind` + Viewer + Details — checked against this list in
  review. Treat a category that mirrors an existing one (e.g. a read-only sprite
  catalog ↔ Surfaces) as a copy of that category, not a fresh minimal grid.
- **Direction of travel:** lift the hand-rolled read-only categories onto a shared
  read-only descriptor so completeness becomes structural (like the descriptor
  path) rather than a checklist — at which point requirement 2–4 are guaranteed by
  code for *every* category, and this ADR's checklist is a backstop, not the
  primary defense.

### Consequences

- Good: a category cannot ship a fraction of the controls without it being a named
  ADR violation; reviewers and future agents have a concrete checklist; the
  Scrollbars regression (this ADR's trigger) is the worked example.
- Cost: until the read-only categories share a descriptor, the contract is partly
  enforced by review rather than by construction — the ADR names that as debt to
  pay down, not the desired end state.

## More Information

- Authoritative spec: `docs/studio-control-architecture.md` (layout, modes, the
  "frame never moves" stability rule, the registry mechanism). This ADR governs
  the *requirements contract*; that doc governs the *architecture* it sits in.
- Related: [ADR-0006](0006-ui-decision-criteria.md) (game-UI vs product-UI
  criteria). Registry + components: `catalogCategories`, `CatalogGrid`,
  `CatalogControls` in `frontend/src/ui/TilePreview.tsx`.
