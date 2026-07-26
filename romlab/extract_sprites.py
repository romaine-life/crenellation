"""Extract the motion-object (sprite) tiles from the graphics ROM.

Layout is Atari's packed 4bpp: an 8x8 tile is 32 bytes, 4 bytes per row, one
byte per two pixels, high nibble first. Pen 0 is transparent. The palette bank
is (0x100 + color*16), applied per display-list entry, so a tile is bank
independent - the same tile appears in several colour schemes.
"""
import json
import pathlib

from PIL import Image

HERE = pathlib.Path(__file__).parent
GFX = (HERE / "out" / "mob" / "gfx.bin").read_bytes()
OUT = HERE / "out" / "sprites-rom"


def tile(code):
    t = (code % (len(GFX) // 32)) * 32
    rows = []
    for y in range(8):
        row = []
        for x in range(8):
            b = GFX[t + y * 4 + (x >> 1)]
            row.append((b >> 4) if (x & 1) == 0 else (b & 0x0F))
        rows.append(row)
    return rows


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    n = len(GFX) // 32
    tiles = [tile(c) for c in range(n)]
    distinct = len({json.dumps(t) for t in tiles})
    nonblank = sum(1 for t in tiles if any(v for r in t for v in r))
    print(f"sprite tiles in the graphics ROM: {n}  distinct: {distinct}  non-blank: {nonblank}")

    cols = 64
    rows = (n + cols - 1) // cols
    img = Image.new("RGBA", (cols * 8, rows * 8), (0, 0, 0, 0))
    px = img.load()
    for i, t in enumerate(tiles):
        ox, oy = (i % cols) * 8, (i // cols) * 8
        for y in range(8):
            for x in range(8):
                v = t[y][x]
                if v == 0:
                    continue
                g = v * 17
                px[ox + x, oy + y] = (g, g, g, 255)
    img.save(OUT / "sprite-tiles.png")

    raw = bytearray()
    for t in tiles:
        for y in range(8):
            for x in range(8):
                raw.append(t[y][x])
    (OUT / "sprite-tiles.bin").write_bytes(raw)
    (OUT / "index.json").write_text(json.dumps(
        {"tiles": n, "distinct": distinct, "nonblank": nonblank,
         "format": "8x8, 4bpp, pen 0 transparent",
         "palette": "0x100 + color*16 + pen"}, indent=1))
    print(f"wrote {OUT/'sprite-tiles.png'} and sprite-tiles.bin ({len(raw)} bytes)")
