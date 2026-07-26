"""Reduce many playfield captures to the set of distinct maps.

Walls and castles change constantly during play, so the map's fingerprint is
its WATER layout — rivers and coastline are fixed terrain. Group captures by
that signature and keep the least-built example of each as the base map.
"""
import json
import pathlib
import struct
from collections import Counter

from PIL import Image

HERE = pathlib.Path(__file__).parent
CAPS = HERE / "out" / "poke"
OUT = HERE / "out" / "mapsk"
OUT.mkdir(parents=True, exist_ok=True)

W = 512
VIS_W, VIS_H = 336, 240
CELL = 8
COLS, ROWS = VIS_W // CELL, VIS_H // CELL

LEGEND = {"water": (48, 96, 200), "land": (60, 150, 60), "structure": (200, 200, 210), "other": (30, 30, 30)}


def palette_classes(raw: bytes):
    """index -> (rgb, class) for all 256 byte values."""
    out = []
    for v in range(256):
        (w,) = struct.unpack_from("<H", raw, v * 2)
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


def cell_grid(data: bytes, lut) -> list[list[str]]:
    grid = []
    for cy in range(ROWS):
        row = []
        for cx in range(COLS):
            votes = Counter()
            for y in range(CELL):
                o = (cy * CELL + y) * W + cx * CELL
                for v in data[o : o + CELL]:
                    votes[lut[v][1]] += 1
            row.append(votes.most_common(1)[0][0])
        grid.append(row)
    return grid


records = []
for bmp in sorted(CAPS.glob("bitmap-*.bin")):
    idx = bmp.stem.split("-")[1]
    pal = CAPS / f"palette-{idx}.bin"
    if not pal.exists():
        continue
    data = bmp.read_bytes()
    lut = palette_classes(pal.read_bytes())
    grid = cell_grid(data, lut)
    water = tuple(1 if c == "water" else 0 for row in grid for c in row)
    built = sum(1 for row in grid for c in row if c == "structure")
    records.append({"idx": idx, "grid": grid, "water": water, "built": built, "data": data, "lut": lut})

print(f"captures: {len(records)}")

# Group by water-layout similarity.
THRESH = int(COLS * ROWS * 0.04)
groups: list[dict] = []
for rec in records:
    for g in groups:
        dist = sum(a != b for a, b in zip(rec["water"], g["water"]))
        if dist <= THRESH:
            g["members"].append(rec)
            if rec["built"] < g["best"]["built"]:
                g["best"] = rec
                g["water"] = rec["water"]
            break
    else:
        groups.append({"water": rec["water"], "members": [rec], "best": rec})

groups.sort(key=lambda g: len(g["members"]), reverse=True)
print(f"distinct maps: {len(groups)}")

sheets = []
for n, g in enumerate(groups):
    best = g["best"]
    waters = sum(g["best"]["water"])
    print(f"  map {n}: {len(g['members'])} captures, water cells={waters}, cleanest=capture {best['idx']} (built={best['built']})")

    img = Image.new("RGB", (VIS_W, VIS_H))
    px = img.load()
    for y in range(VIS_H):
        o = y * W
        for x in range(VIS_W):
            px[x, y] = best["lut"][best["data"][o + x]][0]
    img.save(OUT / f"map{n}-source.png")

    vis = Image.new("RGB", (COLS * CELL, ROWS * CELL))
    vp = vis.load()
    for cy in range(ROWS):
        for cx in range(COLS):
            col = LEGEND[best["grid"][cy][cx]]
            for y in range(CELL):
                for x in range(CELL):
                    vp[cx * CELL + x, cy * CELL + y] = col
    vis.save(OUT / f"map{n}-terrain.png")
    sheets.append((img, vis))

    (OUT / f"map{n}.json").write_text(
        json.dumps(
            {
                "source": f"rampart capture {best['idx']} ({len(g['members'])} captures matched)",
                "cell": CELL,
                "width": COLS,
                "height": ROWS,
                "grid": best["grid"],
            },
            indent=1,
        )
    )

if sheets:
    tw, th = VIS_W // 2, VIS_H // 2
    sheet = Image.new("RGB", (2 * tw, len(sheets) * th), (20, 20, 20))
    for i, (src, vis) in enumerate(sheets):
        sheet.paste(src.resize((tw, th), Image.NEAREST), (0, i * th))
        sheet.paste(vis.resize((tw, th), Image.NEAREST), (tw, i * th))
    sheet.save(OUT / "maps-sheet.png")
    print(f"wrote {len(sheets)} maps + maps-sheet.png")
