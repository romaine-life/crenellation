"""Codex Sheet pipeline · step 4 — team-palette recolor (the production swap).

Selectively shift the navy STONE (blue hue band) of the navy masters to each team hue
while PRESERVING warm accents (gold crowns, gate wood, jewels) — matching the existing
team convention (crimson king keeps its gold crown). Writes the shipped game sprites.

Source: frontend/public/assets/units-pixel/codexsheet/<piece>/navy-blue (step 3 masters)
Output: frontend/public/assets/units/<piece>/<palette>/<dir>.png  (the live game roster)
Run with 'test' to preview king crimson only (no overwrite).
"""
import sys, os, colorsys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve()
while ROOT.parent != ROOT and not (ROOT / "frontend").exists():
    ROOT = ROOT.parent
SRC = ROOT / "frontend" / "public" / "assets" / "units-pixel" / "codexsheet"
DST = ROOT / "frontend" / "public" / "assets" / "units"
PIECES = ["pawn", "rook", "knight", "bishop", "queen", "king"]
DIRS = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]
# palette -> (target_hue_deg or None to copy navy as-is, sat_scale, light_scale)
PALETTES = {
    "navy-blue": (None, 1.0, 1.0),
    "crimson": (350, 1.06, 0.94),
    "golden": (43, 1.05, 1.06),
    "emerald": (150, 0.98, 1.0),
}
# navy/blue stone hue band; warm accents (gold ~43, red ~0, orange ~30) fall outside and are kept.
BAND_LO, BAND_HI, SAT_MIN = 170, 285, 0.08

def recolor(im, hue, sat_scale, light_scale):
    im = im.convert("RGBA"); px = im.load(); w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            hh, ll, ss = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            if BAND_LO <= hh * 360 <= BAND_HI and ss > SAT_MIN:
                nr, ng, nb = colorsys.hls_to_rgb(hue / 360, min(1, ll * light_scale), min(1, ss * sat_scale))
                px[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
    return im

def src(piece, d):
    return SRC / piece / "navy-blue" / f"{d}.png"

if len(sys.argv) > 1 and sys.argv[1] == "test":
    out = ROOT / "docs" / "art" / "unit-concepts" / "codex-sheets" / "king-crimson-test.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    recolor(Image.open(src("king", "south")), 350, 1.06, 0.94).save(out)
    print("WROTE", out); sys.exit(0)

n = 0
for piece in PIECES:
    for pal, (hue, ss, ls) in PALETTES.items():
        d_out = DST / piece / pal
        d_out.mkdir(parents=True, exist_ok=True)
        for d in DIRS:
            im = Image.open(src(piece, d)).convert("RGBA")
            (im if hue is None else recolor(im, hue, ss, ls)).save(d_out / f"{d}.png"); n += 1
    print("recolored", piece)
print(f"DONE — wrote {n} sprites into frontend/public/assets/units")
