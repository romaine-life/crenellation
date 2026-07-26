"""Render captured bitmap-RAM dumps to PNG.

Playfield is 512x256, one byte per pixel, indexing a 1024-entry palette.
Palette words come back byte-reversed from MAME's Lua share reads, and the
packing is Atari's intensity+RGB555 (verified pixel-accurate against MAME's
own snapshot). Visible screen is the top-left 336x240.
"""
import pathlib
import struct

from PIL import Image

HERE = pathlib.Path(__file__).parent
CAPS = HERE / "out" / "caps"
OUT = HERE / "out" / "levels"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 512, 256
VIS_W, VIS_H = 336, 240


def decode_palette(raw: bytes) -> list[tuple[int, int, int]]:
    cols = []
    for i in range(0, len(raw), 2):
        (w,) = struct.unpack_from("<H", raw, i)
        i_bit = (w >> 15) & 1
        r = ((w >> 9) & 0x3E) | i_bit
        g = ((w >> 4) & 0x3E) | i_bit
        b = ((w << 1) & 0x3E) | i_bit
        cols.append((r * 255 // 63, g * 255 // 63, b * 255 // 63))
    return cols


def render(idx: str) -> Image.Image | None:
    bmp = CAPS / f"bitmap-{idx}.bin"
    pal = CAPS / f"palette-{idx}.bin"
    if not (bmp.exists() and pal.exists()):
        return None
    data = bmp.read_bytes()
    cols = decode_palette(pal.read_bytes())
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        row = y * W
        for x in range(W):
            px[x, y] = cols[data[row + x]]
    return img


if __name__ == "__main__":
    frames = []
    for bmp_path in sorted(CAPS.glob("bitmap-*.bin")):
        idx = bmp_path.stem.split("-")[1]
        img = render(idx)
        if img is None:
            continue
        vis = img.crop((0, 0, VIS_W, VIS_H))
        vis.save(OUT / f"level-{idx}.png")
        frames.append((idx, vis))
        print(f"level-{idx}.png")

    # One contact sheet so all captures can be compared at a glance.
    if frames:
        cols_n = 6
        rows_n = (len(frames) + cols_n - 1) // cols_n
        tw, th = VIS_W // 2, VIS_H // 2
        sheet = Image.new("RGB", (cols_n * tw, rows_n * th), (20, 20, 20))
        for i, (idx, img) in enumerate(frames):
            sheet.paste(img.resize((tw, th), Image.NEAREST), ((i % cols_n) * tw, (i // cols_n) * th))
        sheet.save(OUT / "contact-sheet.png")
        print(f"contact-sheet.png ({len(frames)} frames)")
