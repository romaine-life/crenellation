"""Extract the real wall-piece shapes from placements.

Wall pixels are not grey: the blue player's wall is lavender (r==g, b higher)
and the red player's is rose (g==b, r higher). Sampling a wall region gave
(121,121,178) and (121,80,80). With that, a placement shows up as a connected
clump of new wall cells between consecutive frames — which is the piece.
"""
import json
import pathlib
import struct
from collections import Counter

HERE = pathlib.Path(__file__).parent
CAPS = HERE / "out" / "pieces"
OUT = HERE / "out" / "sprites"
OUT.mkdir(parents=True, exist_ok=True)

W, CELL = 336, 16
COLS, ROWS = 21, 15

pal = (CAPS / "pal.bin").read_bytes()


def is_wall(v: int) -> bool:
    (w,) = struct.unpack_from("<H", pal, v * 2)
    k = (w >> 15) & 1
    r = (((w >> 9) & 0x3E) | k) * 255 // 63
    g = (((w >> 4) & 0x3E) | k) * 255 // 63
    b = (((w << 1) & 0x3E) | k) * 255 // 63
    blue_wall = abs(r - g) < 14 and b > r + 28 and r > 35
    red_wall = abs(g - b) < 14 and r > g + 22 and g > 35
    return blue_wall or red_wall


LUT = [is_wall(v) for v in range(256)]


def wall_grid(path: pathlib.Path):
    b = path.read_bytes()
    grid = []
    for cy in range(ROWS):
        for cx in range(COLS):
            n = 0
            for y in range(CELL):
                o = (cy * CELL + y) * W + cx * CELL
                for v in b[o : o + CELL]:
                    if LUT[v]:
                        n += 1
            grid.append(1 if n > (CELL * CELL) // 5 else 0)
    return grid


frames = [(p.name, wall_grid(p)) for p in sorted(CAPS.glob("f-*.bin"))]
print(f"frames: {len(frames)}")

shapes: Counter = Counter()
prev = None
for name, g in frames:
    if prev is not None:
        new = [i for i, v in enumerate(g) if v and not prev[i]]
        if 2 <= len(new) <= 6:
            cells = {(i % COLS, i // COLS) for i in new}
            start = next(iter(cells))
            seen = {start}
            stack = [start]
            while stack:
                c, r = stack.pop()
                for nc, nr in ((c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1)):
                    if (nc, nr) in cells and (nc, nr) not in seen:
                        seen.add((nc, nr))
                        stack.append((nc, nr))
            if len(seen) == len(cells):
                mnx = min(c for c, _ in cells)
                mny = min(r for _, r in cells)
                shapes[tuple(sorted((c - mnx, r - mny) for c, r in cells))] += 1
    prev = g

print(f"connected placements: {sum(shapes.values())}, distinct shapes: {len(shapes)}")
kept = []
for shape, n in shapes.most_common():
    w = max(c for c, _ in shape) + 1
    h = max(r for _, r in shape) + 1
    kept.append({"cells": [list(c) for c in shape], "w": w, "h": h, "seen": n})
    print(f"  {len(shape)} cells {w}x{h} seen {n}: {list(shape)}")

(OUT / "pieces.json").write_text(json.dumps({"shapes": kept}, indent=1))
print(f"wrote pieces.json ({len(kept)} shapes)")
