"""Classify extracted 16x16 cells and build a usable tileset.

Walls are stone: grey, low saturation. Which cell edges the stone touches gives
the connectivity bitmask (N/E/S/W) the renderer needs to join wall runs, so the
result is a proper autotile set rather than one generic block.
"""
import json
import pathlib
import struct
from collections import defaultdict

from PIL import Image

from sprites import COLS, ROWS, VIS_H, VIS_W, W, CELL, frame_image

HERE = pathlib.Path(__file__).parent
OUT = HERE / "out" / "sprites"
OUT.mkdir(parents=True, exist_ok=True)


def is_stone(p):
    r, g, b = p
    return abs(r - g) < 34 and abs(g - b) < 46 and 90 < (r + g + b) / 3 < 215


def is_grass(p):
    r, g, b = p
    return g > r + 30 and g > b + 30


def is_water(p):
    r, g, b = p
    return b > r + 30 and b > g + 10


def stats(img: Image.Image):
    px = img.load()
    n = CELL * CELL
    stone = grass = water = 0
    for y in range(CELL):
        for x in range(CELL):
            p = px[x, y]
            if is_stone(p):
                stone += 1
            elif is_grass(p):
                grass += 1
            elif is_water(p):
                water += 1
    return stone / n, grass / n, water / n


def edge_mask(img: Image.Image) -> int:
    """Bit 1 N, 2 E, 4 S, 8 W — set when stone reaches that edge."""
    px = img.load()
    mask = 0
    mid = range(CELL // 2 - 3, CELL // 2 + 3)
    if any(is_stone(px[x, 0]) for x in mid):
        mask |= 1
    if any(is_stone(px[CELL - 1, y]) for y in mid):
        mask |= 2
    if any(is_stone(px[x, CELL - 1]) for x in mid):
        mask |= 4
    if any(is_stone(px[0, y]) for y in mid):
        mask |= 8
    return mask


if __name__ == "__main__":
    caps = HERE / "out" / "caps3"
    walls: dict[int, Image.Image] = {}
    wall_score: dict[int, float] = {}
    others: dict[str, Image.Image] = {}

    frames = 0
    for bmp in sorted(caps.glob("bitmap-*.bin")):
        stem = bmp.stem.split("-")[1]
        pal = caps / f"palette-{stem}.bin"
        if not pal.exists():
            continue
        img = frame_image(bmp, pal)
        for cy in range(ROWS):
            for cx in range(COLS):
                crop = img.crop((cx * CELL, cy * CELL, (cx + 1) * CELL, (cy + 1) * CELL))
                s, g, w = stats(crop)
                if s > 0.30 and s < 0.95:
                    m = edge_mask(crop)
                    # Prefer the cleanest example of each connectivity: most
                    # stone, least clutter from overlapping sprites.
                    if m not in wall_score or s > wall_score[m]:
                        walls[m] = crop
                        wall_score[m] = s
        frames += 1
        if frames >= 40:
            break

    print(f"wall connectivity variants found: {sorted(walls)}")

    # Lay the 16 masks out in order so the renderer can index by bitmask.
    sheet = Image.new("RGBA", (16 * CELL, CELL), (0, 0, 0, 0))
    present = []
    for m in range(16):
        if m in walls:
            sheet.paste(walls[m], (m * CELL, 0))
            present.append(m)
    sheet.save(OUT / "walls.png")
    sheet.resize((sheet.width * 3, CELL * 3), Image.NEAREST).save(OUT / "walls-zoom.png")
    (OUT / "walls.json").write_text(json.dumps({"cell": CELL, "masks": present}, indent=1))
    print(f"wrote walls.png with masks {present}")
