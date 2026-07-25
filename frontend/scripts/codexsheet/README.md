# Codex Sheet — unit pixel-art pipeline

The shipped chess units are pixel art produced by restyling the Blender renders with
Codex, **one whole rotation per pass** (not per-direction — independent per-frame restyles
drift: gate/crown/muzzle flip between frames). This folder reproduces that.

## Steps

| # | Script | Does | Output |
|---|--------|------|--------|
| 0 | `docs/art/unit-concepts/blender-units/rook-claude/render_versions.py` | Render a piece's 8 Blender angles. Only needed for designs without renders — the rook uses **ruinwall**: `blender --background --python …/render_versions.py -- ruinwall` → `assets/units/rook/candidate-ruinwall/`. The other 5 pieces reuse their existing `assets/units/<piece>/navy-blue/` renders. | `candidate-<piece>/` |
| 1 | `1-build-grid.py <piece>` | Assemble the 8 angles into one 2×4 magenta grid (the structure reference). | `docs/art/unit-concepts/codex-sheets/<piece>-blender-grid.png` |
| 2 | `2-restyle-sheet.py <piece>` | One Codex img2img pass: redraw the whole grid in the target style (`assets/art/skirmish-style-target.png`), keeping each cell's pose. Chroma-keys magenta → alpha. | `…/<piece>-sheet.png` (+ `-raw`) |
| 3 | `3-slice-sheet.py <piece>` | Slice the grid (magenta-gutter band detection) and frame each onto a 512 canvas matched to the source footprint. Writes the **navy masters** + a rotation strip. | `assets/units-pixel/codexsheet/<piece>/navy-blue/<dir>.png` |
| 4 | `4-recolor-teams.py` | Selective hue recolor of the navy masters → team palettes (navy/crimson/golden/emerald), shifting only the stone and **preserving warm accents** (gold crowns, gate wood). Writes the live game roster. Run `4-recolor-teams.py test` to preview one piece. | `assets/units/<piece>/<palette>/<dir>.png` |

Run 1→3 per piece, then 4 once for all pieces.

## Requirements

- **Pillow** (`pip install pillow`) — all steps.
- **Codex CLI** with the built-in `image_generation` tool — step 2 only. Set `CODEX_BIN`
  to the `codex` executable (else the default Windows install is globbed). Step 2 also uses
  Codex's bundled `remove_chroma_key.py`.
- Step 0 needs **Blender** (5.x).

## Notes

- All scripts derive the repo root by walking up to the dir containing `frontend/`, so they
  run from anywhere in a checkout.
- **PixelLab was rejected for units** — it reinvents geometry/angle. Filter ×2/×3 and
  Codex→Filter remain as *speculative* catalog comparison libraries, not production.
- Rook = the **ruinwall** design (square keep, barred gate), not the v4 calibrated rook.
