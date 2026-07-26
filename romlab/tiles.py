"""Is the playfield composed of gfx-ROM tiles?

If every 8x8 block of captured bitmap RAM matches a tile from the graphics
ROM (modulo a palette-bank offset), then a level is a grid of tile indices —
which is the level format worth porting, not a picture.
"""
import json
import pathlib
from collections import Counter

HERE = pathlib.Path(__file__).parent
GFX = HERE / "rom" / "136082-1009.2n"
CAP = HERE / "out" / "caps" / "bitmap-23.bin"
OUT = HERE / "out" / "levels"

W = 512
VIS_W, VIS_H = 336, 240

gfx = GFX.read_bytes()
TILE_BYTES = 32
n_tiles = len(gfx) // TILE_BYTES

# Decode every ROM tile to a 64-value tuple (4bpp, high nibble first).
tile_patterns = {}
for t in range(n_tiles):
    base = t * TILE_BYTES
    px = []
    for i in range(TILE_BYTES):
        byte = gfx[base + i]
        px.append(byte >> 4)
        px.append(byte & 0xF)
    tile_patterns.setdefault(tuple(px), t)

print(f"gfx ROM: {n_tiles} tiles, {len(tile_patterns)} distinct patterns")

data = CAP.read_bytes()
matched = 0
unmatched = 0
grid = []
offsets = Counter()

for by in range(VIS_H // 8):
    row = []
    for bx in range(VIS_W // 8):
        block = []
        for y in range(8):
            o = (by * 8 + y) * W + bx * 8
            block.extend(data[o : o + 8])
        lo = min(block)
        # A tile's 16 colours sit in one palette bank; normalise by the bank base.
        base = (lo // 16) * 16
        norm = tuple(v - base for v in block)
        if max(norm) < 16 and norm in tile_patterns:
            row.append([tile_patterns[norm], base])
            offsets[base] += 1
            matched += 1
        else:
            row.append(None)
            unmatched += 1
    grid.append(row)

total = matched + unmatched
print(f"blocks: {total}  matched tiles: {matched} ({matched * 100 // total}%)  unmatched: {unmatched}")
print(f"palette banks in use: {dict(offsets)}")

if matched:
    used = Counter(c[0] for r in grid for c in r if c)
    print(f"distinct tiles used: {len(used)}")
    print(f"most common: {used.most_common(8)}")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "map-tilegrid.json").write_text(
        json.dumps({"width": VIS_W // 8, "height": VIS_H // 8, "cells": grid}, indent=1)
    )
    print(f"wrote {OUT / 'map-tilegrid.json'}")
