"""Codex Sheet pipeline · step 1 — build the structure grid.

Assemble a piece's 8 Blender rotation renders into one 2x4 grid on flat magenta
(row-major: south, south-east, east, north-east / north, north-west, west, south-west).
This grid is the STRUCTURE reference Codex restyles in a single cohesive pass (step 2),
which is what keeps the 8 directions consistent — per-direction restyles drift.

Source per piece: assets/units/rook/candidate-<piece>/ if it exists (e.g. the ruinwall
rook rendered by render_versions.py), else assets/units/<piece>/navy-blue/.

Usage:  python frontend/scripts/codexsheet/1-build-grid.py <piece>
Output: docs/art/unit-concepts/codex-sheets/<piece>-blender-grid.png
"""
import sys, os
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve()
while ROOT.parent != ROOT and not (ROOT / "frontend").exists():
    ROOT = ROOT.parent
piece = sys.argv[1]
DIRS = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]
MAG = (255, 0, 255, 255)
CELL, GUT, COLS, ROWS = 320, 16, 4, 2  # magenta gutter (GUT) keeps cells separable for slicing
UNITS = ROOT / "frontend" / "public" / "assets" / "units"
WORK = ROOT / "docs" / "art" / "unit-concepts" / "codex-sheets"; WORK.mkdir(parents=True, exist_ok=True)

def autocrop(im):
    bb = im.split()[3].getbbox(); return im.crop(bb) if bb else im

DESIGN = {"rook": "ruinwall"}  # piece -> Blender design under assets/units/rook/candidate-<design>
def src_dir(p):
    cand = UNITS / "rook" / f"candidate-{DESIGN.get(p, p)}"
    return cand if cand.is_dir() else UNITS / p / "navy-blue"

SRC = src_dir(piece)
grid = Image.new("RGBA", (COLS * CELL + (COLS + 1) * GUT, ROWS * CELL + (ROWS + 1) * GUT), MAG)
for i, d in enumerate(DIRS):
    im = autocrop(Image.open(SRC / f"{d}.png").convert("RGBA"))
    f = min((CELL - 40) / im.width, (CELL - 40) / im.height)
    im = im.resize((max(1, round(im.width * f)), max(1, round(im.height * f))), Image.LANCZOS)
    r, c = divmod(i, COLS)
    cell = Image.new("RGBA", (CELL, CELL), MAG)
    cell.alpha_composite(im, ((CELL - im.width) // 2, (CELL - im.height) // 2))
    grid.alpha_composite(cell, (GUT + c * (CELL + GUT), GUT + r * (CELL + GUT)))
out = WORK / f"{piece}-blender-grid.png"
grid.convert("RGB").save(out)
print("WROTE", out, grid.size, "(source:", SRC, ")")
