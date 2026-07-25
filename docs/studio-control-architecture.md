# Studio control architecture

The studio is **one tool** with a single, consistent control architecture across
every mode and category. New things added to it (assets, portraits, …) inherit
this shape rather than inventing their own. This is the spec; the UI must match it.

## Intent (the why everything else serves)

The studio is a **continuous, direct-manipulation workspace**, not a set of
screens you toggle. A **surface** is the persistent thing you work on (the board).
**Focus** is what you're currently attending to within that surface — and the
**controls follow your focus**, they come to *you*. Clicking a tile on the board
focuses you on tiles and brings up the tile controls; the board never goes away.
You never jump between disjoint views:

> **Navigation (mode → surface) decides *where you are*. Focus and its controls
> flow from *what you touch* there.**

So "does picking a focus change the view or the controls?" is the wrong question —
the surface stays put, and the controls are simply what follows focus. Every rule
below serves this: one Controls panel that reflows to your focus, a persistent
surface, and no sub-headers or mode-jumps to break the continuity.

**Not everything is manipulated.** Some catalog categories hold *finished,
read-only* things — UI-kit assets, authored artwork — that you inspect but never
edit. They have no workbench, so they don't belong in the Lab. They get the
**Viewer**: a read-only destination that shows one item big, with a Details
readout instead of a Controls cascade. The Lab is for things you *change*; the
Viewer is for things you *look at and test but don't edit* — read-only means
non-editable, not lifeless: the Viewer stage presents the asset at **optimal
interactivity** (you scroll a real scrollbar; a surface tiles in context), never a
dead still image. (This corrects an earlier draft that
called the asset stage a "surface you work on" and parked it in the Lab — assets
fail the direct-manipulation test exactly as artwork does.)

## Stability — the frame never moves

The topbar, the Controls panel, and the main pane are **fixed structural
regions**. Switching mode / category / surface / focus changes what is *inside*
those regions — never their position, size, or whether they exist. The
"Controls" heading sits at the **same place** in Catalog and in Lab. Nothing
slides down; nothing appears in one mode that displaces what's below it in
another. The cascade reflows the *contents* of the Controls panel **in place**;
the panel itself is anchored.

A sub-header — or any element present in one mode and absent in another — is
forbidden, because it shifts everything below it. That displacement is the single
clearest tell of an amateur UI. A serious instrument holds still: you operate it;
it does not rearrange itself under you. **If the layout jumps when you change
modes, it is wrong**, no matter how correct the contents are.

## Layout — the same in every mode

- **Topbar:** brand · **breadcrumb** (where you are) · the **mode** toggle.
- The mode toggle is **three fixed tabs**: **Catalog · Lab · Viewer**. They are
  **persistent destinations**, always present and always live — never disabled,
  never relabeled, never reordered. They are **decoupled from the category**: the
  category only governs what the Catalog shows; Lab and Viewer are standing
  workspaces you can jump to at any time. Each tab **remembers its own last
  state** (the Lab keeps its board; the Viewer keeps the last item it opened), so
  a tab is always a safe place to land — clicking it shows the sensible last/default
  thing, it never says "you can't do that here."
- **One right-hand panel** (fixed width), headed **Controls** in every mode. It
  is the cascading control unit: in Catalog its tier selector is the category;
  in Lab, the Board/Tile/Unit focus; in the Viewer, the **kind** selector
  (Asset, Artwork, Portrait, 9-Slice, …). Asset/Artwork are read-only (a Details
  readout); **Portrait** and **9-Slice** are the embedded light-editing kinds — the
  unit-portrait crop editor and the kit 9-slice frame editor — reached from their
  catalog's edit affordance, never from a separate route. The heading and panel
  never move.
- **Main pane:** content only. The catalog grid, the lab surface, or the Viewer
  stage.
- **No sub-headers, no per-pane titles, no "Back" button.** The breadcrumb
  conveys location; the Catalog tab *is* back. A sub-header is always a bug here.

## The control system is a namespaced cascade

Every control is **owned by exactly one node** in the tree below. The Controls
panel renders only the controls along the **active path**. Nothing is a sibling
of the mode toggle except itself, so no control can leak or duplicate across
modes. Depth varies per branch — that's fine; namespacing, not symmetry, is the
rule.

```
mode  (Catalog · Lab · Viewer)                 ← topbar · tier-1 · 3 persistent tabs
│                                                 (always present, decoupled from category)
├─ Catalog
│   └─ category (Tiles | Units | Assets | Artwork)  ← tier-2 · top of Controls
│       ├─ Tiles   → search · family/collection filters · zoom
│       ├─ Units   → search
│       ├─ Assets  → search · process filter (All/Forged/Unverified) · zoom
│       └─ Artwork → search · zoom
│
├─ Lab   (the board workbench — holds its last board)
│   └─ surface (Board)                         ← the only workbench
│       └─ focus (Board | Tile | Unit)         ← tier-3 · each focus = a control set
│           ├─ Board focus → board-level controls (tools, layers, zoom)
│           ├─ Tile focus  → tile controls (brush, picker, …)
│           └─ Unit focus  → unit controls (brush, facing, …)
│
└─ Viewer  (single-item stage — holds the last item it opened)
    └─ kind (Asset | Artwork | Portrait | 9-Slice | …)  ← tier-2 · top of Controls
        ├─ Asset    → preview-in-context stage + gate/provenance details (read-only)
        ├─ Artwork  → full-art preview stage + group/size/path details (read-only)
        ├─ Portrait → embedded unit-portrait crop editor (pan/zoom, per-piece)
        └─ 9-Slice  → embedded kit 9-slice frame editor (nudge/align, dev-save)

"View Selected" in the Catalog routes BY ITEM TYPE — a tile/unit opens in the Lab,
an asset/artwork opens in the Viewer. The tabs themselves never route by type;
they are standing destinations.
```

## The concepts, named

- **Mode** — the tier-1 destination, in the topbar. Three exist and **all three
  show as fixed tabs**: **Catalog** (browse many), **Lab** (work on the board),
  **Viewer** (look at one finished thing, read-only). They are persistent
  workspaces, decoupled from the category — each remembers its last state, so any
  tab is always a valid place to land.
- **Category** — the *kind of thing* you're browsing in Catalog (Tiles, Units,
  Assets, Artwork). It governs **only the Catalog grid**. It does *not* gate the
  tabs. What it does decide is where **"View Selected" sends a chosen item**: a
  tile/unit lands in the Lab (you place it), an asset/artwork lands in the Viewer
  (you look at it).
- **Surface** — the *workbench* in the Lab. There is one: the **Board** (tiles and
  units are placed on it). Surfaces group by workbench, **not by category** — and
  read-only categories have no workbench, so they have no surface.
- **Focus** — *within a surface*, a set of controls scoped to one thing. The Board
  surface has three focuses — **Board / Tile / Unit** — each its own control set
  on the same board. They are **not** surfaces and **not** separate views; they
  are control sets that share the surface.
- **Viewer** — the single-item destination for finished things with no board
  workbench. Its panel carries one tier selector — the **kind** (Asset, Artwork,
  Portrait, 9-Slice, …). Asset and Artwork are read-only (a Details readout);
  **Portrait** and **9-Slice** are the embedded editing kinds — the unit-portrait
  crop editor and the kit 9-slice frame editor — light, single-item work, not board
  manipulation, which is why they live here rather than in the Lab. They are reached
  from their catalog's edit affordance (a pencil / "✎ Edit" button that switches the
  Viewer kind in place), **never** a separate route or page. Any future finished-art
  library (lore plates, a cutscene gallery) becomes another kind here.

## Visual standard — instrument-grade, not boxes

Dense and restrained. A tier selector is a tight **segmented control** — one
cohesive unit, small — never a stack of fat full-width buttons that wrap to two
rows. Chrome is quiet: thin borders, compact spacing, a clear figure/ground where
the **surface is the star** and the controls recede around it. Hierarchy comes
from weight, grouping, and whitespace — not from giant boxes all shouting at the
same volume. The reference is a serious instrument (Grafana, a DAW, Figma's
panels), not a form made of big buttons. If a control is large enough to dominate
the surface it serves, it's wrong.

## Adding to the studio

A new thing (e.g. portraits) is: a new **category** in Catalog, plus its
non-catalog destination — a **Lab surface** with focuses **if it's
board-placeable**, or nothing extra **if it's read-only** (it inherits the
shared **Viewer** for free). It inherits the topbar, breadcrumb, right panel, and
content-only main automatically. If adding it requires a new layout, the
architecture (not the new thing) is wrong.

**Mechanism — the catalog category registry.** Parity is enforced by code, not
discipline. The Catalog is driven by a single `catalogCategories` array in
`TilePreview.tsx`; each entry is `{ id, label, hint, main, controls }`. The
selector tabs, main pane, and the controls body are all rendered **by mapping
over that array / reading the active entry** (`activeCatalog`) — never by
per-category `if`/ternary branches. So adding a category means adding **one
entry**: you supply its `main` (the grid) and its `controls` (the rail body —
Search/Zoom/View-Selected/taxonomy, via the shared `CatalogControls` for
descriptor-backed categories), and you get the selector tab and the stable frame
for free. There is no second place to update, which is the whole point — a
category cannot ship missing from the selector. If you find yourself writing
`category === '…'` in the catalog controls, that's the regression this registry
exists to prevent.

A **read-only** category needs nothing in the Lab: it sets no surface, and its
catalog "View Selected" calls `openViewer(kind)` — it sets the Viewer's `viewerKind`
and enters `studioMode === 'viewer'`. The Viewer's read-only Details panel is shared
across all read-only categories, and it renders by **`viewerKind`, not the catalog
category** — that's what makes the Viewer tab a standing destination you can reach
even while browsing Tiles. Each read-only kind owns its **own** selection state
(`selectedAssetName` vs `selectedArtworkName`) — never one shared field, or a stale
id from one leaks into the other's stage.
