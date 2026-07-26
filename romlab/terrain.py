"""Turn a captured battlefield into a terrain grid crenellation can load.

We want the LAYOUT (land / water / structure), not Atari's pixels — the art
is being redrawn. Classify each 8x8 block of the playfield by its dominant
colour and emit a grid plus a flat-colour visualisation.
"""
import json
import pathlib
from collections import Counter

from PIL import Image

from render_caps import VIS_H, VIS_W, render

HERE = pathlib.Path(__file__).parent
OUT = HERE / "out" / "levels"
CELL = 8
COLS, ROWS = VIS_W // CELL, VIS_H // CELL

LEGEND = {
    "water": (48, 96, 200),
    "land": (60, 150, 60),
    "structure": (190, 190, 200),
    "other": (40, 40, 40),
}


def classify(rgb: tuple[int, int, int]) -> str:
    r, g, b = rgb
    if b > r + 24 and b > g + 8:
        return "water"
    if g > r + 24 and g > b + 24:
        return "land"
    if abs(r - g) < 48 and abs(g - b) < 48 and r + g + b > 180:
        return "structure"
    return "other"


def grid_from(idx: str) -> tuple[list[list[str]], Image.Image]:
    img = render(idx)
    if img is None:
        raise SystemExit(f"no capture {idx}")
    px = img.load()
    grid = []
    vis = Image.new("RGB", (COLS * CELL, ROWS * CELL))
    vp = vis.load()
    for cy in range(ROWS):
        row = []
        for cx in range(COLS):
            votes = Counter()
            for y in range(CELL):
                for x in range(CELL):
                    votes[classify(px[cx * CELL + x, cy * CELL + y])] += 1
            kind = votes.most_common(1)[0][0]
            row.append(kind)
            for y in range(CELL):
                for x in range(CELL):
                    vp[cx * CELL + x, cy * CELL + y] = LEGEND[kind]
        grid.append(row)
    return grid, vis


if __name__ == "__main__":
    # Capture 19 is the battlefield at countdown 20 — the least player-built
    # wall on screen, so closest to the map's base terrain.
    idx = "19"
    grid, vis = grid_from(idx)
    counts = Counter(k for row in grid for k in row)
    print(f"grid {COLS}x{ROWS} from capture {idx}: {dict(counts)}")
    vis.save(OUT / f"terrain-{idx}.png")
    side = Image.new("RGB", (VIS_W * 2, VIS_H))
    side.paste(render(idx).crop((0, 0, VIS_W, VIS_H)), (0, 0))
    side.paste(vis, (VIS_W, 0))
    side.save(OUT / f"terrain-{idx}-compare.png")
    (OUT / f"terrain-{idx}.json").write_text(
        json.dumps({"source": f"rampart attract-mode capture {idx}", "cell": CELL,
                    "width": COLS, "height": ROWS, "grid": grid}, indent=1)
    )
    print(f"wrote terrain-{idx}.json + terrain-{idx}-compare.png")
