# Board render contract (fixed-camera isometric sprites)

## Camera
The skirmish board is a **fixed isometric** view — the camera does **not** rotate, tilt,
or free-orbit (locked for the time being). This is the load-bearing decision: because the
viewing angle never changes, the board is a **2D sprite compositor**, not a runtime 3D
engine. Every tile, unit, rock, and portrait is a 3D model **pre-rendered in Blender to a
flat PNG** at the one true-isometric angle, then laid out isometrically in the DOM
(`frontend/src/render/iso.ts`, `BoardLabBoard.tsx`). Pre-rendered sprites are *optimal*
here, not a compromise — they capture full 3D (relief, self-shadow, protruding geometry)
from the only angle the player will ever see, at zero runtime cost.

If the camera ever needs to move, this contract is void and the board must become a
real-time 3D scene (and the units re-authored as meshes).

## The grid is logical, not a visual cage
A cell is a **gameplay address** (which square a piece occupies; what tessellates with
what). The **art anchored to that cell may spill out of it.** This is already true of
units — a king sprite towers far above its tile; a rook keep is a whole fortress. Tiles
get the same freedom: surfaces can be **bumpy** and **doodads can protrude** (grass tufts
standing up, loose pebbles, mossy stones). It is not rule-breaking; it is the standard
isometric-tilemap technique (Unity supports taller-than-cell tiles overlaying neighbors,
plus props/trees/elevated ground).

### The three real constraints
1. **Consistent contact footprint.** The *ground plane* where a tile meets its neighbors
   and where a unit stands is the same clean diamond on every tile (the 96×140 calibration
   — diamond ~96px wide, equator ~y27). Bumps and doodads live **above** that plane; they
   never move the contact edge. This keeps tiles tessellating and units seated.
2. **Back-to-front draw order** (painter's, by distance to camera) — already done for
   units; protrusions ride it so nearer things overlap farther things.
3. **Don't bury gameplay.** Doodads stay low/sparse enough not to hide a unit or make a
   cell ambiguous. Tall props (trees) would need per-object dynamic sorting — out of scope
   for now.

## Tiles, concretely
Tiles are 3D-rendered sprites (same pipeline as units), NOT flat textures painted on a
block. Use the packs' full content: **displacement/height maps** for real surface relief,
**normal maps** for micro-detail, and the **3D models / alpha grass cards** for protruding
doodads. Source packs ship all of these; rendering only the base-color flat was the bug
this contract corrects.
