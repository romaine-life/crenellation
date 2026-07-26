"""Build the final battlefield set from the wide selector sweep.

For each selector value, pick the capture showing the most bare terrain (UI
panels and built walls classify as structure/other, so maximising land+water
picks the cleanest frame), then deduplicate by water layout across values.
"""
import json
import pathlib
import struct
from collections import Counter

from PIL import Image

HERE = pathlib.Path(__file__).parent
FINAL = HERE / "out" / "final"
OUT = HERE / "out" / "maps_final"
OUT.mkdir(parents=True, exist_ok=True)

W, VIS_W, VIS_H, CELL = 512, 336, 240, 8
COLS, ROWS = VIS_W // CELL, VIS_H // CELL
LEGEND = {"water": (48, 96, 200), "land": (60, 150, 60), "structure": (200, 200, 210), "other": (30, 30, 30)}


def lut_for(pal: bytes):
    out = []
    for v in range(256):
        (w,) = struct.unpack_from("<H", pal, v * 2)
        i = (w >> 15) & 1
        r = (((w >> 9) & 0x3E) | i) * 255 // 63
        g = (((w >> 4) & 0x3E) | i) * 255 // 63
        b = (((w << 1) & 0x3E) | i) * 255 // 63
        if b > r + 24 and b > g + 8:
            k = "water"
        elif g > r + 24 and g > b + 24:
            k = "land"
        elif abs(r - g) < 48 and abs(g - b) < 48 and r + g + b > 180:
            k = "structure"
        else:
            k = "other"
        out.append(((r, g, b), k))
    return out


def grid_of(data: bytes, lut) -> list[list[str]]:
    grid = []
    for cy in range(ROWS):
        row = []
        for cx in range(COLS):
            c = Counter()
            for y in range(CELL):
                o = (cy * CELL + y) * W + cx * CELL
                for b in data[o : o + CELL]:
                    c[lut[b][1]] += 1
            row.append(c.most_common(1)[0][0])
        grid.append(row)
    return grid


picks = []
for d in sorted(FINAL.glob("val*"), key=lambda p: int(p.name[3:])):
    val = int(d.name[3:])
    grids = []
    frames = []
    for bmp_path in sorted(d.glob("bitmap-*.bin")):
        n = bmp_path.stem.split("-")[1]
        pal_path = d / f"palette-{n}.bin"
        if not pal_path.exists():
            continue
        data = bmp_path.read_bytes()
        lut = lut_for(pal_path.read_bytes())
        grids.append(grid_of(data, lut))
        frames.append((data, lut))
    if not grids:
        continue

    # Per-cell consensus across the round. Selection panels and score banners
    # cover a cell in only a few frames, so the majority class is the terrain
    # underneath; a single "cleanest frame" pick can't do this because panel
    # interiors are blue and score as water.
    grid = []
    for cy in range(ROWS):
        row = []
        for cx in range(COLS):
            # Walls/banners (structure) are ignored outright — they cover
            # terrain that is still there. Among the frames that DO show bare
            # terrain, take the majority: real water shows in nearly every
            # frame, while a selection panel's blue interior shows in only a
            # few, so panels lose the vote.
            c = Counter(g[cy][cx] for g in grids if g[cy][cx] in ("land", "water"))
            row.append(c.most_common(1)[0][0] if c else "structure")
        grid.append(row)
    terrain = sum(1 for r in grid for c in r if c in ("land", "water"))

    # Show the frame that best matches the consensus.
    best_i, best_score = 0, -1
    for i, g in enumerate(grids):
        score = sum(1 for cy in range(ROWS) for cx in range(COLS) if g[cy][cx] == grid[cy][cx])
        if score > best_score:
            best_i, best_score = i, score
    data, lut = frames[best_i]
    picks.append((val, (terrain, grid, data, lut, str(best_i))))
    print(f"value {val:3d}: consensus of {len(grids)} frames -> {terrain}/1260 terrain cells")

# Deduplicate by water layout.
uniq = []
for val, (terrain, grid, data, lut, n) in picks:
    water = tuple(1 if c == "water" else 0 for r in grid for c in r)
    dup = None
    for u in uniq:
        diff = sum(a != b for a, b in zip(water, u["water"]))
        if diff < len(water) * 0.05:
            dup = u
            break
    if dup:
        dup["values"].append(val)
        if terrain > dup["terrain"]:
            dup.update(terrain=terrain, grid=grid, data=data, lut=lut)
    else:
        uniq.append({"values": [val], "water": water, "terrain": terrain, "grid": grid, "data": data, "lut": lut})

print(f"\n{len(uniq)} distinct battlefields:")
sheets = []
for i, u in enumerate(uniq, 1):
    img = Image.new("RGB", (VIS_W, VIS_H))
    px = img.load()
    for y in range(VIS_H):
        o = y * W
        for x in range(VIS_W):
            px[x, y] = u["lut"][u["data"][o + x]][0]
    vis = Image.new("RGB", (COLS * CELL, ROWS * CELL))
    vp = vis.load()
    for cy in range(ROWS):
        for cx in range(COLS):
            col = LEGEND[u["grid"][cy][cx]]
            for y in range(CELL):
                for x in range(CELL):
                    vp[cx * CELL + x, cy * CELL + y] = col
    img.save(OUT / f"map{i}-source.png")
    vis.save(OUT / f"map{i}-terrain.png")
    (OUT / f"map{i}.json").write_text(
        json.dumps(
            {
                "source": "arcade Rampart, extracted via RAM selector 0x3E1952",
                "selector_values": u["values"],
                "cell": CELL,
                "width": COLS,
                "height": ROWS,
                "bare_terrain_cells": u["terrain"],
                "grid": u["grid"],
            },
            indent=1,
        )
    )
    sheets.append((img, vis))
    print(f"  map{i}: selector values {u['values']}, {u['terrain']}/1260 bare, water={sum(u['water'])}")

if sheets:
    sheet = Image.new("RGB", (VIS_W * 2, VIS_H * len(sheets)), (15, 15, 15))
    for i, (img, vis) in enumerate(sheets):
        sheet.paste(img, (0, i * VIS_H))
        sheet.paste(vis, (VIS_W, i * VIS_H))
    sheet.save(OUT / "all-maps.png")
    print(f"\nwrote {len(sheets)} maps + all-maps.png")
