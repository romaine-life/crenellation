"""Render each selector value's battlefield and emit terrain grids.

Picks, per value, the capture with the most terrain visible (least covered by
score banners), classifies it into land/water/structure, and writes JSON plus
a side-by-side contact sheet.
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


rows = []
for v in range(1, 9):
    d = FINAL / f"val{v}"
    best = None
    for bmp_path in sorted(d.glob("bitmap-*.bin")):
        n = bmp_path.stem.split("-")[1]
        pal_path = d / f"palette-{n}.bin"
        if not pal_path.exists():
            continue
        data = bmp_path.read_bytes()
        lut = lut_for(pal_path.read_bytes())
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
        terrain = sum(1 for r in grid for c in r if c in ("land", "water"))
        if best is None or terrain > best[0]:
            best = (terrain, grid, data, lut)
    if not best:
        continue
    _, grid, data, lut = best
    img = Image.new("RGB", (VIS_W, VIS_H))
    px = img.load()
    for y in range(VIS_H):
        o = y * W
        for x in range(VIS_W):
            px[x, y] = lut[data[o + x]][0]
    vis = Image.new("RGB", (COLS * CELL, ROWS * CELL))
    vp = vis.load()
    for cy in range(ROWS):
        for cx in range(COLS):
            col = LEGEND[grid[cy][cx]]
            for y in range(CELL):
                for x in range(CELL):
                    vp[cx * CELL + x, cy * CELL + y] = col
    img.save(OUT / f"level{v}-source.png")
    vis.save(OUT / f"level{v}-terrain.png")
    water = tuple(1 if c == "water" else 0 for r in grid for c in r)
    (OUT / f"level{v}.json").write_text(
        json.dumps({"selector": "0x3E1952", "value": v, "cell": CELL,
                    "width": COLS, "height": ROWS, "grid": grid}, indent=1)
    )
    rows.append((v, img, vis, water, sum(water)))
    print(f"value {v}: water cells={sum(water)}")

# Which values are genuinely distinct battlefields?
print("\ndistinct check (water-layout differences):")
uniq = []
for v, img, vis, water, wc in rows:
    match = None
    for uv, uwater in uniq:
        diff = sum(a != b for a, b in zip(water, uwater))
        if diff < len(water) * 0.05:
            match = uv
            break
    if match:
        print(f"  value {v}: same as value {match}")
    else:
        uniq.append((v, water))
        print(f"  value {v}: NEW map")

if rows:
    tw, th = VIS_W, VIS_H
    sheet = Image.new("RGB", (tw * 2, th * len(rows)), (15, 15, 15))
    for i, (v, img, vis, _, _) in enumerate(rows):
        sheet.paste(img, (0, i * th))
        sheet.paste(vis, (tw, i * th))
    sheet.save(OUT / "all-levels.png")
    print(f"\nwrote {len(rows)} levels + all-levels.png ({len(uniq)} distinct)")
