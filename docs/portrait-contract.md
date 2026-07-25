# Piece portrait contract

The **portrait** is the framed bust shown in the Skirmish HUD's "Selected Unit" card. It
is a **separate render contract from the true-isometric board sprite** — the board needs a
top-down gameplay projection; a portrait needs an eye-level, dimensional "hero" shot.

## Camera
- **Perspective** lens, 55mm on a 36mm sensor (mild, flattering portrait depth) — *not*
  orthographic.
- **Eye-level**: elevation **+10°** above the look-at point.
- **Frontal-¾**: azimuth **30°** off dead-front for **every** piece. The unit keeps its
  standard orientation (front → local −Y = in-game south, per the unit-facing
  convention); only the *camera* orbits, so every portrait faces south like the board
  sprite. No per-unit aesthetic facing offset — the knight is viewed frontal-¾ like the
  rest (its horse head reads fine at 30°), not turned to profile.
- **Adaptive bust framing**: from each unit's actual top (`topZ`), the camera looks at
  `Tz = 0.62·topZ` and frames a vertical span of `0.96·topZ`, so the distinctive top
  (crown / mitre / tiara / helmet / horse head / battlements) and the upper body fill the
  frame and the body **bleeds off the bottom edge** — a portrait, not a full figurine. Two
  failure modes to avoid, both anchored by the HUD's `object-position:center bottom`: a base
  sliced flat reads as "cut off", and showing the whole piece down to its base reads as a
  figurine standing on its feet. Cropping through the (roughly vertical) column, flush to
  the bottom edge, avoids both. Override per piece via the `PORTRAIT_TZ` / `PORTRAIT_SPAN`
  env vars if a piece needs it. Adapts to each piece's height automatically.
- 512×512, transparent background (`film_transparent`), Cycles, Standard view transform.
  Lighting + materials come from the unit's source `.blend` (same look as the board).

## Hero yaw
All pieces (pawn, knight, bishop, rook, queen, king): `30°` (frontal-¾). The unit faces
in-game south; the camera orbits 30° off the front.

## Palettes
One portrait **per team palette** (`navy-blue`, `crimson`, `golden`, `emerald`) — same
material-swap recipe as the board sprites: the body "navy stone" material is recolored, gold
accents are kept, except `golden` which swaps accents to dark iron and makes the body a
polished metal. Body base colours (linear RGB) for `portrait_render.py`:

| palette   | body RGB (linear)       | accent | body metal |
|-----------|-------------------------|--------|------------|
| navy-blue | `0.045  0.10   0.16`    | keep   | –          |
| crimson   | `0.2925 0.0483 0.0509`  | keep   | –          |
| golden    | `0.566  0.392  0.088`   | iron   | `0.6`      |
| emerald   | `0.0332 0.1570 0.0808`  | keep   | –          |

(`navy-blue` is the canonical `navy stone` base from `pieces_claude.py`; crimson/golden/
emerald were recovered by calibrating against the navy renders, since the original ad-hoc
commands were never committed.) The knight is procedural and carries its own per-palette fur
tones in `knight_portrait.py`.

The piece blends are the **ornamented "production" set**, not the plainer `claude-pieces`
lathe set: helmeted pawn (`docs/art/archive/units/pawn/pawn_helmet.blend`), ornate mitre
(`bishop-mitre`), badass keep (`rook-badass-keep`), beaded tiara (`queen-tiara`), gold crown
(`king-crown`). See `render_all.sh` for the exact map.

## Asset path & wiring (live render — PR #189)
The HUD does **not** load a pre-baked PNG. The Selected-Unit portrait, the roster slots, and the
Portrait editor previews all render **live in the browser** through one shared `<UnitPortrait>`
component (`frontend/src/ui/PortraitEditor.tsx`) and the `.unit-portrait` CSS box
(`frontend/src/style.css`):
- **Master render:** `/assets/portrait-editor/<piece>/<palette>.png` (full-body, transparent).
- **Crop:** per-piece `cx, cy, s` from `frontend/src/art/portraitCrops.json` (the committed
  source of truth the HUD reads), applied via `CroppedView` so the bust fills the box at the
  dialled framing — including the intentional off-center "lead room" placement.
- **Frame:** the transparent `panel-line` 9-slice, filling to the panel Fill-box boundary
  (`config/nine-slice/panel.json` `fill`) with the bracket ornament bleeding over. The
  Selected-Unit portrait composites a backdrop scene behind the bust; the roster shows a cyan ring
  when selected. Non-roster pieces fall back to the badge glyph.

Because all three surfaces read the same master + crop, framing / fill / placement are defined once
and can't diverge — change the crop in the editor, commit it to `portraitCrops.json`, and every
surface updates. No re-bake.

## The baked PNGs are superseded (decision, PR #189 follow-up)
`/assets/units/<piece>/portrait/<palette>.png` (via `portraitPath()` in `frontend/src/core/pieces.ts`)
and the bake that produces them (`bake_finals.sh` below) are **no longer consumed by the game** —
the HUD renders live from the masters above. They are **retained only as studio catalog artwork**
(`frontend/src/ui/design/artworkManifest.json` lists them as a rendered reference gallery).
**Decision:** keep the baked PNGs as catalog artwork; treat the live master+crop render as the
source of truth; run the bake only to refresh that catalog reference — it is not required for the
HUD, and re-baking does not affect what the HUD shows.

## Framing workflow (current)
1. Open the **Portrait Editor** (`/portrait-editor`, `frontend/src/ui/PortraitEditor.tsx`) — the
   full-body master with a draggable/zoomable square crop and a live `<UnitPortrait>` preview at
   HUD size.
2. Dial the crop, **Copy JSON**, and commit the per-piece `cx, cy, s` to
   `frontend/src/art/portraitCrops.json`. The HUD reads it directly — done, no bake.

Editor masters live at `/assets/portrait-editor/<piece>/<palette>.png`. The master *render* framing
(`Tz`/`span` per piece — `pawn/knight/bishop/queen/king` Tz 0.50 span 1.45; `rook` Tz 0.45 span
1.75), used only to regenerate the masters/baked catalog, is recorded in
`docs/art/unit-concepts/portraits/crops.json` (distinct from the HUD's `portraitCrops.json`).

## Reproduce (low-level)
- Single blend piece: `blender -b --python docs/art/unit-concepts/portraits/portrait_render.py -- <blend> <outfile> <palette> <r> <g> <b> <keep|iron> <yaw> [metal] [rough]` (`PORTRAIT_TZ`/`PORTRAIT_SPAN`/`PORTRAIT_RES` env override framing/resolution)
- Knight (procedural): `blender -b --python docs/art/unit-concepts/portraits/knight_portrait.py -- <palette> <outfile> <yaw>`
- `render_all.sh` renders the older full-bust framing directly to the final paths — superseded by the editor+bake workflow above (running it overwrites the baked crops).

Background art is intentionally **not** baked in — portraits ship transparent so a backdrop
can be composited behind them later.
