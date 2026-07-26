"""Build clean terrain plates by painting from tiles, not by patching frames.

Patching a captured frame keeps leaking objects (thin walls, HUD panels whose
interiors read as water). Instead: take the terrain grid, and paint every cell
with a clean grass or water tile sampled from the captures. The result is
arcade pixels with nothing drawn on top. Shore cells get a bank edge so the
coastline still reads.
"""
import json
import pathlib
from collections import Counter

from PIL import Image

HERE = pathlib.Path(__file__).parent
FINAL = HERE / "out" / "maps_final"
OUT = HERE / "out" / "webart"
OUT.mkdir(parents=True, exist_ok=True)

CELL = 16
COLS, ROWS = 21, 15
BANK = (150, 82, 42)


def pixel_kind(p) -> str:
    r, g, b = p
    if g > r + 28 and g > b + 28:
        return "land"
    if b > r + 34 and b > g + 18:
        return "water"
    if r > g + 18 and g > b + 8 and 60 < r < 190:
        return "bank"
    return "object"


def pick_tiles(img: Image.Image):
    """Cleanest pure-grass and pure-water tiles in this capture."""
    best = {"land": (0, None), "water": (0, None)}
    for cy in range(ROWS):
        for cx in range(CELL and COLS):
            votes: Counter = Counter()
            px = img.load()
            for y in range(CELL):
                for x in range(CELL):
                    votes[pixel_kind(px[cx * CELL + x, cy * CELL + y])] += 1
            for kind in ("land", "water"):
                if votes[kind] > best[kind][0] and votes["object"] == 0 and votes["bank"] == 0:
                    best[kind] = (votes[kind], img.crop((cx * CELL, cy * CELL, (cx + 1) * CELL, (cy + 1) * CELL)))
    return best["land"][1], best["water"][1]


def coarse(grid, cx: int, cy: int) -> str:
    votes: Counter = Counter()
    for dy in range(2):
        for dx in range(2):
            votes[grid[cy * 2 + dy][cx * 2 + dx]] += 1
    # structure cells sat on real ground; treat them as land unless surrounded by water
    if votes["water"] >= 3:
        return "water"
    return "land"


# Gather the best grass/water tiles across every capture, so a map with little
# water still gets a good water tile.
grass = water = None
for i in range(1, 7):
    src = FINAL / f"map{i}-source.png"
    if not src.exists():
        continue
    g, w = pick_tiles(Image.open(src).convert("RGB"))
    grass = grass or g
    water = water or w
    if grass and water:
        break

if grass is None or water is None:
    raise SystemExit("could not find clean tiles")

report = {}
for i in range(1, 7):
    meta = FINAL / f"map{i}.json"
    if not meta.exists():
        continue
    grid = json.loads(meta.read_text())["grid"]
    plate = Image.new("RGB", (COLS * CELL, ROWS * CELL))

    # Paint at the terrain grid's own 8px resolution: a one-cell river vanishes
    # if folded to the 16px play grid, and the rivers are what make these maps
    # recognisable. Gameplay still uses the coarse grid.
    FINE = 8
    FCOLS, FROWS = COLS * 2, ROWS * 2
    grass8 = grass.resize((FINE, FINE), Image.NEAREST)
    water8 = water.resize((FINE, FINE), Image.NEAREST)
    fine = [[grid[fy][fx] for fx in range(FCOLS)] for fy in range(FROWS)]
    for fy in range(FROWS):
        for fx in range(FCOLS):
            wet = fine[fy][fx] == "water"
            plate.paste(water8 if wet else grass8, (fx * FINE, fy * FINE))

    kinds = [[coarse(grid, cx, cy) for cx in range(COLS)] for cy in range(ROWS)]

    # Bank edge wherever land meets water, at the fine resolution.
    px = plate.load()
    for fy in range(FROWS):
        for fx in range(FCOLS):
            if fine[fy][fx] == "water":
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = fx + dx, fy + dy
                if not (0 <= nx < FCOLS and 0 <= ny < FROWS) or fine[ny][nx] != "water":
                    continue
                for t in range(FINE):
                    if dx == 1:
                        px[fx * FINE + FINE - 1, fy * FINE + t] = BANK
                    elif dx == -1:
                        px[fx * FINE, fy * FINE + t] = BANK
                    elif dy == 1:
                        px[fx * FINE + t, fy * FINE + FINE - 1] = BANK
                    else:
                        px[fx * FINE + t, fy * FINE] = BANK

    plate.save(OUT / f"map{i}.png")
    land = sum(1 for r in kinds for k in r if k == "land")
    report[f"map{i}"] = {"land": land, "water": COLS * ROWS - land}
    print(f"map{i}: {land} land / {COLS * ROWS - land} water cells")

(OUT / "terrain.json").write_text(json.dumps(report, indent=1))
