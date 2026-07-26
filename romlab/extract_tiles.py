"""Extract every 8x8 tile of playfield art from the ROM.

The art region is one back-to-back compressed stream: each tile decodes to a
clean terminator and the next begins where the last ended. Walking it yields
the complete tileset - including tiles the game never drew during capture.

Tiles are stored as 4-bit colour indices. The palette bank is applied at draw
time (that is what the pal argument to the decoder does), so a tile is bank
independent and one tile serves every colour scheme it appears in.
"""
import json
import pathlib

from PIL import Image

from romart import decode_strip

HERE = pathlib.Path(__file__).parent
OUT = HERE / "out" / "tileset"
START, END = 0x0D75BB, 0x0FBA11

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    tiles, index, p = [], {}, START
    skipped = 0
    while p < END:
        rows, e = decode_strip(p, 0, 7)
        if e <= p or len(rows) != 8:
            skipped += 1
            if e <= p:
                break
        cells = []
        for r in range(8):
            row = rows[r] if r < len(rows) else []
            cells.append([(row[c] if c < len(row) else None) for c in range(8)])
        index[f"{p:06X}"] = len(tiles)
        tiles.append(cells)
        p = e

    print(f"tiles decoded from ROM: {len(tiles)}  (anomalous streams: {skipped})")

    # dedupe: how much of the art is actually distinct
    uniq = {}
    for t in tiles:
        uniq.setdefault(json.dumps(t), len(uniq))
    print(f"distinct tiles: {len(uniq)}")

    # contact sheet, rendered with a neutral 16-step ramp so shape is visible
    cols = 64
    rowsn = (len(tiles) + cols - 1) // cols
    img = Image.new("RGBA", (cols * 8, rowsn * 8), (0, 0, 0, 0))
    px = img.load()
    for i, t in enumerate(tiles):
        ox, oy = (i % cols) * 8, (i // cols) * 8
        for y in range(8):
            for x in range(8):
                v = t[y][x]
                if v is None:
                    continue
                g = v * 17
                px[ox + x, oy + y] = (g, g, g, 255)
    img.save(OUT / "tiles.png")

    # raw indices: 0-15, or 255 for "transparent / write nothing"
    raw = bytearray()
    for t in tiles:
        for y in range(8):
            for x in range(8):
                v = t[y][x]
                raw.append(255 if v is None else (v & 0x0F))
    (OUT / "tiles.bin").write_bytes(raw)
    (OUT / "index.json").write_text(json.dumps(
        {"start": START, "end": END, "count": len(tiles),
         "distinct": len(uniq), "by_source": index}, indent=1))
    print(f"wrote {OUT/'tiles.png'} ({cols*8}x{rowsn*8}) and tiles.bin ({len(raw)} bytes)")
