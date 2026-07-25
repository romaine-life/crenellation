# Asset Terminology

Canonical vocabulary for the asset catalog (`frontend/src/asset-catalog.json`,
explored at `/design/catalog`). **Every term here is attested by an engine
authority** (Unity, Unreal, or Godot documentation) — no informal terms. Pairs
with `docs/asset-generation-contract.md` (what *becomes* an asset) and
`docs/asset-pipeline-proposal.md` (how art is normalized).

## Core split: asset vs. widget

- **Asset** — a reusable piece the game operates on, stored as data (an image +
  a contract). 9-slices and icons are assets. Test: the *Convert To Assets* rule
  in `asset-generation-contract.md`. *(Unity / Unreal: "asset".)*
- **Widget** — an interactive element the player manipulates (a button),
  **assembled at runtime** from assets + live data; not stored as one image.
  Also called a **control**. *(Wikipedia: "a graphical widget … is an element of
  interaction, such as a button"; Unreal UMG: "Widget".)*

## Roles (the assets)

- **9-slice** — a texture that scales while keeping its corners fixed: the
  reusable, icon-less button background. The fixed border sizes are **patch
  margins**. *(Unity Manual: "9-slicing"; Godot: `NinePatchRect`.)* Ours
  (`button-9slice.main-menu`) is currently fixed-size — a 9-slice that doesn't
  stretch yet.
- **icon** — a standalone image composited into a slot. *(Universal.)*
- **sprite atlas** — one image packing several unrelated sprites (our source
  `*.png` sheets). A *sprite sheet* specifically means sequential animation
  frames; we have none, so "atlas" is the right word. *(Unity: "Sprite Atlas";
  Wikipedia: "Texture atlas".)*

## Anatomy of the 9-slice

- **state** — a named variant the widget switches between: **normal**,
  **pressed** (later **highlighted**, **selected**, **disabled**). *(Unity UI
  transition states.)*
- **slot** (named slot) — a region exposed for content, filled at assembly time
  by an asset (icon) or live text (label): `iconSlot`, `textInset`, `arrowSlot`.
  *(Unreal UMG: "Named Slots … expose a slot … others can put whatever they want
  in this named slot".)*
- **rect** — a pixel rectangle `{x, y, w, h}` (a state's bounds, a slot's
  bounds). *(Unity: `Rect`; Godot: `region_rect`.)*
- **hitbox** — for UI, the widget's clickable rect (Unity: "raycast target").

## Widget = template + instance

A menu button is a **widget**, built from a **template** (the reusable
definition) instantiated with specific values:

| Ingredient | Value (for "Solo Skirmish") | Kind |
| --- | --- | --- |
| 9-slice | `button-9slice.main-menu` (state `pressed`) | asset |
| icon | `button-icon.main-menu.sword` | asset |
| label | "Solo Skirmish" | live text |
| action | `party` | code |

"Solo Skirmish" is an **instance** of the *Main Menu Button* **template**.
*(Unreal: "UI Templates"; Unity's equivalent is a "Prefab"; a specific one is an
"instance".)* Today the instances live in code (`MENU_MODES` in
`frontend/src/app.js`); they could become data later.

## Naming convention

`<role>.<category>[.<member>]`

- `button-9slice.main-menu` — the main-menu button **9-slice** (asset).
- `button-icon.main-menu.sword` — a main-menu button **icon** (asset).
- `button.main-menu` — **reserved** for the **widget** (the assembled button);
  not a stored asset.

## Quick reference

| Term | Asset? | Example | Authority |
| --- | --- | --- | --- |
| 9-slice | yes | `button-9slice.main-menu` | Unity / Godot |
| icon | yes | `button-icon.main-menu.sword` | universal |
| sprite atlas | yes (source) | source `*.png` | Unity |
| state | variant of a 9-slice | `normal`, `pressed` | Unity |
| slot | region of a 9-slice | `iconSlot` | Unreal |
| rect | a rectangle | `{x,y,w,h}` | Unity / Godot |
| widget | no (assembled) | the general interactive element | Unreal / Wikipedia |
| button | no (a kind of widget) | "Main Menu Button" | Unity / Unreal / Godot |
| template / instance | no (code today) | the five menu buttons | Unreal / Unity |

## Rejected terms (do not use)

| Loose term | Use instead |
| --- | --- |
| frame | **9-slice** (the background) or **rect** (a rectangle) |
| assembly | **widget** |
| part | name the asset: **9-slice** / **icon** |
| unpressed | **normal** |
| sheet (for packed art) | **sprite atlas** |
| bounds | **rect** |

Authorities: Unity Manual (9-slicing; Sprite Atlas; UI transition states),
Unreal Engine UMG (Widgets; Named Slots; UI Templates), Godot (NinePatchRect;
Control; `region_rect`), Wikipedia (Graphical widget; Texture atlas).
