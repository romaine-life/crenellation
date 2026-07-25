"""Promote codex-stone portraits to team palettes.

Recolors the navy codex-stone portrait masters into crimson / golden / emerald using the
SAME selective hue-band shift as the board roster (scripts/codexsheet/4-recolor-teams.py):
shift only the navy stone band, preserve warm accents (king's gold crown, rook gate wood).

In:  frontend/public/assets/portrait-candidates/codex-stone/<piece>/navy-blue.png
Out: frontend/public/assets/portrait-candidates/codex-stone/<piece>/<palette>.png
"""
import colorsys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve()
while ROOT.parent != ROOT and not (ROOT / "frontend").exists():
    ROOT = ROOT.parent
BASE = ROOT / "frontend" / "public" / "assets" / "portrait-candidates" / "codex-stone"
PIECES = ["pawn", "knight", "bishop", "rook", "queen", "king"]
# palette -> (target_hue_deg, sat_scale, light_scale)  — matches the board recolor
PALETTES = {
    "crimson": (350, 1.06, 0.94),
    "golden": (43, 1.05, 1.06),
    "emerald": (150, 0.98, 1.0),
}
BAND_LO, BAND_HI, SAT_MIN = 170, 285, 0.08  # navy/blue stone band; warm accents fall outside


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


n = 0
for piece in PIECES:
    navy = Image.open(BASE / piece / "navy-blue.png").convert("RGBA")
    for pal, (hue, ss, ls) in PALETTES.items():
        recolor(navy.copy(), hue, ss, ls).save(BASE / piece / f"{pal}.png"); n += 1
    print("recolored", piece)
print(f"DONE — wrote {n} palette portraits")
