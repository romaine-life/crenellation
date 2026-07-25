"""Codex Sheet pipeline · step 3 — slice + frame the navy masters.

Slice the keyed 2x4 sheet (step 2) into 8 frames by detecting the magenta-gutter bands,
then frame each onto a 512 canvas matched to the Blender source's footprint (so the
production unit footprints seat them). Writes the navy masters that step 4 recolors, plus
an at-a-glance rotation strip.

Usage:  python frontend/scripts/codexsheet/3-slice-sheet.py <piece>
Output: frontend/public/assets/units-pixel/codexsheet/<piece>/navy-blue/<dir>.png
        docs/art/unit-concepts/codex-sheets/<piece>-sheet-strip.png
"""
import sys, os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve()
while ROOT.parent != ROOT and not (ROOT / "frontend").exists():
    ROOT = ROOT.parent
piece = sys.argv[1]
DIRS = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]
UNITS = ROOT / "frontend" / "public" / "assets" / "units"
WORK = ROOT / "docs" / "art" / "unit-concepts" / "codex-sheets"
OUT = ROOT / "frontend" / "public" / "assets" / "units-pixel" / "codexsheet" / piece / "navy-blue"
OUT.mkdir(parents=True, exist_ok=True)

sheet = Image.open(WORK / f"{piece}-sheet.png").convert("RGBA")
W, H = sheet.size
ab = sheet.split()[3].tobytes()
colsum = [0] * W
rowsum = [0] * H
for y in range(H):
    base = y * W
    for x in range(W):
        if ab[base + x] > 24:
            colsum[x] += 1; rowsum[y] += 1

def bands(sums, n_expected):
    thr = max(sums) * 0.04
    runs = []; start = None
    for i, v in enumerate(sums):
        if v > thr and start is None: start = i
        elif v <= thr and start is not None: runs.append((start, i - 1)); start = None
    if start is not None: runs.append((start, len(sums) - 1))
    runs = [r for r in runs if (r[1] - r[0]) > (len(sums) * 0.03)]
    runs.sort(key=lambda r: r[1] - r[0], reverse=True)
    return sorted(runs[:n_expected], key=lambda r: r[0])

cols, rows = bands(colsum, 4), bands(rowsum, 2)
cells = []
if len(cols) == 4 and len(rows) == 2:
    for (ry0, ry1) in rows:
        for (cx0, cx1) in cols:
            cells.append(sheet.crop((cx0, ry0, cx1 + 1, ry1 + 1)))
else:  # gutters not clean — fall back to equal 4x2 division of the content bbox
    print("FALLBACK equal division (cols=%d rows=%d)" % (len(cols), len(rows)))
    bb = sheet.getbbox(); gw = (bb[2] - bb[0]) / 4; gh = (bb[3] - bb[1]) / 2
    for r in range(2):
        for c in range(4):
            cells.append(sheet.crop((int(bb[0] + c * gw), int(bb[1] + r * gh), int(bb[0] + (c + 1) * gw), int(bb[1] + (r + 1) * gh))))

def autocrop(im):
    b = im.split()[3].getbbox(); return im.crop(b) if b else im

DESIGN = {"rook": "ruinwall"}  # piece -> Blender design under assets/units/rook/candidate-<design>
def src_dir(p):
    cand = UNITS / "rook" / f"candidate-{DESIGN.get(p, p)}"
    return cand if cand.is_dir() else UNITS / p / "navy-blue"
SRC = src_dir(piece)

def frame(cell, d):
    sb = Image.open(SRC / f"{d}.png").convert("RGBA").split()[3].getbbox()
    sh = sb[3] - sb[1]; cx = (sb[0] + sb[2]) // 2; bottom = sb[3]
    c = autocrop(cell); f = sh / c.height
    c = c.resize((max(1, round(c.width * f)), max(1, round(c.height * f))), Image.NEAREST)
    cv = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    cv.alpha_composite(c, (max(0, cx - c.width // 2), max(0, bottom - c.height)))
    return cv

framed = []
for i, d in enumerate(DIRS):
    fr = frame(cells[i], d); fr.save(OUT / f"{d}.png"); framed.append((d, fr))

def checker(w, h, c=8):
    im = Image.new("RGBA", (w, h), (22, 29, 38, 255)); p = im.load()
    for y in range(h):
        for x in range(w):
            if (x // c + y // c) % 2 == 0: p[x, y] = (28, 37, 48, 255)
    return im
CH = CW = 150
strip = Image.new("RGBA", (CW * 8, CH + 20), (15, 20, 27, 255)); dr = ImageDraw.Draw(strip)
try: font = ImageFont.truetype("arial.ttf", 12)
except Exception: font = ImageFont.load_default()
for i, (dirn, fr) in enumerate(framed):
    x0 = i * CW; strip.alpha_composite(checker(CW, CH), (x0, 20))
    im = autocrop(fr); sc = (CH - 16) / im.height; im = im.resize((round(im.width * sc), CH - 16), Image.NEAREST)
    if im.width > CW - 6:
        sc2 = (CW - 6) / im.width; im = im.resize((CW - 6, round(im.height * sc2)), Image.NEAREST)
    strip.alpha_composite(im, (x0 + (CW - im.width) // 2, 20 + (CH - im.height) // 2))
    dr.text((x0 + 4, 4), dirn, fill=(150, 200, 230, 255), font=font)
strip.convert("RGB").save(WORK / f"{piece}-sheet-strip.png")
print("SLICED", piece, "->", OUT)
