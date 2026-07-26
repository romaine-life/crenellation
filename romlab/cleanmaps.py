"""Produce clean terrain plates from the captured battlefields.

Objects are detected from the pixels, not from the terrain grid: the grid's
consensus deliberately votes "land" underneath a wall or a HUD panel, so it
cannot be used to find them. A pixel counts as terrain if it is grass, water,
or shoreline bank; anything else (stone, castle checks, white text) marks the
cell as carrying an object, and that cell is repainted with a clean tile of
the terrain its neighbours suggest.
"""
import json
import pathlib
import random
from collections import Counter

from PIL import Image

HERE = pathlib.Path(__file__).parent
FINAL = HERE / "out" / "maps_final"
OUT = HERE / "out" / "webart"
OUT.mkdir(parents=True, exist_ok=True)

CELL = 16
COLS, ROWS = 21, 15


def pixel_kind(p) -> str:
    r, g, b = p
    if g > r + 28 and g > b + 28:
        return "land"
    if b > r + 34 and b > g + 18:
        return "water"
    # Shoreline bank: warm brown, distinctly not grey.
    if r > g + 18 and g > b + 8 and 60 < r < 190:
        return "bank"
    return "object"


def cell_profile(img: Image.Image, cx: int, cy: int) -> Counter:
    px = img.load()
    votes: Counter = Counter()
    for y in range(CELL):
        for x in range(CELL):
            votes[pixel_kind(px[cx * CELL + x, cy * CELL + y])] += 1
    return votes


rng = random.Random(11)
report = {}
for i in range(1, 7):
    src = FINAL / f"map{i}-source.png"
    if not src.exists():
        continue
    img = Image.open(src).convert("RGB")

    profiles = [[cell_profile(img, cx, cy) for cx in range(COLS)] for cy in range(ROWS)]
    total = CELL * CELL

    def dominant(cy: int, cx: int) -> str:
        v = profiles[cy][cx]
        if v["object"] > total * 0.09:
            return "object"
        return "water" if v["water"] > v["land"] else "land"

    kinds = [[dominant(cy, cx) for cx in range(COLS)] for cy in range(ROWS)]

    # Clean donors: cells with essentially no object pixels at all.
    donors = {"land": [], "water": []}
    for cy in range(ROWS):
        for cx in range(COLS):
            v = profiles[cy][cx]
            if v["object"] > total * 0.06:
                continue
            donors["water" if v["water"] > v["land"] else "land"].append((cx, cy))

    out = img.copy()
    replaced = 0
    for cy in range(ROWS):
        for cx in range(COLS):
            if kinds[cy][cx] != "object":
                continue
            near: Counter = Counter()
            for dy in (-2, -1, 0, 1, 2):
                for dx in (-2, -1, 0, 1, 2):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < ROWS and 0 <= nx < COLS and kinds[ny][nx] != "object":
                        near[kinds[ny][nx]] += 1
            kind = near.most_common(1)[0][0] if near else "land"
            pool = donors[kind] or donors["land"] or donors["water"]
            if not pool:
                continue
            sx, sy = rng.choice(pool)
            out.paste(img.crop((sx * CELL, sy * CELL, (sx + 1) * CELL, (sy + 1) * CELL)), (cx * CELL, cy * CELL))
            replaced += 1

    out.save(OUT / f"map{i}.png")
    report[f"map{i}"] = {
        "repainted": replaced,
        "donor_land": len(donors["land"]),
        "donor_water": len(donors["water"]),
    }
    print(f"map{i}: repainted {replaced}/{COLS * ROWS} cells, donors {len(donors['land'])}L/{len(donors['water'])}W")

(OUT / "terrain.json").write_text(json.dumps(report, indent=1))
