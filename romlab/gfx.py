"""Decode the motion-object ROM to PNG contact sheets.

Atari's 4bpp packed layout: 8x8 tile = 32 bytes, one byte per two pixels.
Nibble order isn't self-evident from the data, so render both and look.
"""
import pathlib

from PIL import Image

HERE = pathlib.Path(__file__).parent
ROM = HERE / "rom" / "136082-1009.2n"
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)

data = ROM.read_bytes()
TILE_W = TILE_H = 8
BYTES_PER_TILE = TILE_W * TILE_H // 2
tiles = len(data) // BYTES_PER_TILE

# 16-level ramp so pixel VALUES stay legible (the real palette lives in RAM,
# written by the program — a ramp is enough to judge whether shapes decode).
palette = []
for i in range(16):
    v = i * 17
    palette += [v, v, v]
palette += [0, 0, 0] * (256 - 16)


def render(high_first: bool, cols: int = 64) -> Image.Image:
    rows = (tiles + cols - 1) // cols
    img = Image.new("P", (cols * TILE_W, rows * TILE_H))
    img.putpalette(palette)
    px = img.load()
    for t in range(tiles):
        base = t * BYTES_PER_TILE
        ox = (t % cols) * TILE_W
        oy = (t // cols) * TILE_H
        for i in range(BYTES_PER_TILE):
            byte = data[base + i]
            hi, lo = byte >> 4, byte & 0xF
            a, b = (hi, lo) if high_first else (lo, hi)
            x = (i * 2) % TILE_W
            y = (i * 2) // TILE_W
            px[ox + x, oy + y] = a
            px[ox + x + 1, oy + y] = b
    return img


print(f"{ROM.name}: {len(data)} bytes -> {tiles} tiles of {TILE_W}x{TILE_H} 4bpp")
for label, high_first in (("hi-first", True), ("lo-first", False)):
    img = render(high_first)
    full = OUT / f"mo-{label}.png"
    img.save(full)
    # A zoomed crop of the first rows is what's actually readable at a glance.
    crop = img.crop((0, 0, 64 * TILE_W, 24 * TILE_H)).resize((64 * TILE_W * 2, 24 * TILE_H * 2), Image.NEAREST)
    crop.save(OUT / f"mo-{label}-crop.png")
    print(f"  wrote {full.name} ({img.width}x{img.height}) + crop")
