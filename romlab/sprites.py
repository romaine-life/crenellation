"""Extract object sprites (walls, castles, cannons, ships) from real frames.

Rather than decode the motion-object list format, diff a gameplay capture
against the same battlefield's bare terrain: any 16x16 cell that changed holds
a drawn object. Crop those, deduplicate, and emit a tileset PNG + index.
"""
import hashlib
import json
import pathlib
import struct
from collections import Counter

from PIL import Image

HERE = pathlib.Path(__file__).parent
OUT = HERE / "out" / "sprites"
OUT.mkdir(parents=True, exist_ok=True)

W, VIS_W, VIS_H, CELL = 512, 336, 240, 16
COLS, ROWS = VIS_W // CELL, VIS_H // CELL


def lut_for(pal: bytes):
    out = []
    for v in range(256):
        (w,) = struct.unpack_from("<H", pal, v * 2)
        i = (w >> 15) & 1
        r = (((w >> 9) & 0x3E) | i) * 255 // 63
        g = (((w >> 4) & 0x3E) | i) * 255 // 63
        b = (((w << 1) & 0x3E) | i) * 255 // 63
        out.append((r, g, b))
    return out


def frame_image(bmp: pathlib.Path, pal: pathlib.Path) -> Image.Image:
    data = bmp.read_bytes()
    lut = lut_for(pal.read_bytes())
    img = Image.new("RGB", (VIS_W, VIS_H))
    px = img.load()
    for y in range(VIS_H):
        o = y * W
        for x in range(VIS_W):
            px[x, y] = lut[data[o + x]]
    return img


def cell_key(img: Image.Image, cx: int, cy: int) -> str:
    crop = img.crop((cx * CELL, cy * CELL, (cx + 1) * CELL, (cy + 1) * CELL))
    return hashlib.sha1(crop.tobytes()).hexdigest()


def collect(cap_dir: pathlib.Path, limit: int = 60):
    """Every distinct 16x16 cell seen across a capture set, with counts."""
    seen: dict[str, Image.Image] = {}
    counts: Counter = Counter()
    n = 0
    for bmp in sorted(cap_dir.glob("bitmap-*.bin")):
        stem = bmp.stem.split("-")[1]
        pal = cap_dir / f"palette-{stem}.bin"
        if not pal.exists():
            continue
        img = frame_image(bmp, pal)
        for cy in range(ROWS):
            for cx in range(COLS):
                k = cell_key(img, cx, cy)
                counts[k] += 1
                if k not in seen:
                    seen[k] = img.crop((cx * CELL, cy * CELL, (cx + 1) * CELL, (cy + 1) * CELL))
        n += 1
        if n >= limit:
            break
    return seen, counts, n


if __name__ == "__main__":
    caps = HERE / "out" / "caps3"
    seen, counts, frames = collect(caps)
    print(f"scanned {frames} frames, {len(seen)} distinct 16x16 cells")

    # Rank by how often each appears: terrain fills dominate, objects are rarer
    # but still recurrent; one-off cells are mostly explosion frames.
    ranked = [(k, counts[k]) for k in seen]
    ranked.sort(key=lambda kv: -kv[1])
    keep = [k for k, c in ranked if c >= 3][:512]
    print(f"keeping {len(keep)} cells seen 3+ times")

    cols = 16
    rows = (len(keep) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * CELL, rows * CELL), (0, 0, 0))
    index = []
    for i, k in enumerate(keep):
        sheet.paste(seen[k], ((i % cols) * CELL, (i // cols) * CELL))
        index.append({"i": i, "count": counts[k]})
    sheet.save(OUT / "cells.png")
    sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST).save(OUT / "cells-zoom.png")
    (OUT / "cells.json").write_text(json.dumps({"cell": CELL, "cols": cols, "tiles": index}, indent=1))
    print(f"wrote cells.png ({sheet.width}x{sheet.height}) and cells-zoom.png")
