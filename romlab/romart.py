"""Decode the game's art directly out of the ROM.

The compressed art is one back-to-back stream: every image decodes to a clean
0xFF terminator and the next image begins where the last ended (confirmed for
132 of 140 captured sources). Each call to the decompressor paints one
8-pixel-wide vertical strip, so an image is a run of consecutive strips whose
destinations advance by 8 and whose sources chain.

This groups the recorded calls back into images, decodes each from ROM through
the verified decoder, and colours it with the hardware palette. The pixels come
from the ROM, not from a screenshot.
"""
import json
import pathlib
import re
import struct

from PIL import Image

HERE = pathlib.Path(__file__).parent
ROM = (HERE / "prog_main.bin").read_bytes()
ART = HERE / "out" / "art"
OUT = HERE / "out" / "romart"
STRIDE = 512


def decode_strip(src, pal=0, d4=7):
    """Verified decoder (0x11F2A). Returns (column pixels, end offset)."""
    col = []
    row = []
    left = d4 + 1
    p = src

    def put(v):
        nonlocal left
        row.append(None if v is None else (v + pal) & 0xFF)
        left -= 1
        if left == 0:
            col.append(row[:])
            row.clear()
            left = 8

    while True:
        if p >= len(ROM):
            return col, p
        c = ROM[p]
        p += 1
        if not (c & 0x80):
            for _ in range((c >> 4) + 1):
                put(c & 0x0F)
            continue
        count = (c & 0x1F) + 1
        if c & 0x40:
            if c & 0x20:
                if c == 0xFF:
                    if row:
                        col.append(row[:])
                    return col, p
                a, b = ROM[p], ROM[p + 1]
                p += 2
                for _ in range(count):
                    put(a)
                    put(b)
            else:
                b = ROM[p]
                p += 1
                for _ in range(count):
                    put(b)
        else:
            if c & 0x20:
                rem = count
                while rem > 0:
                    b = ROM[p]
                    p += 1
                    put(b >> 4)
                    rem -= 1
                    if rem == 0:
                        break
                    put(b & 0x0F)
                    rem -= 1
            else:
                for _ in range(count):
                    put(None)


def lut(pal: bytes):
    out = []
    for v in range(256):
        (w,) = struct.unpack_from("<H", pal, v * 2)
        i = (w >> 15) & 1
        r = (((w >> 9) & 0x3E) | i) * 255 // 63
        g = (((w >> 4) & 0x3E) | i) * 255 // 63
        b = (((w << 1) & 0x3E) | i) * 255 // 63
        out.append((r, g, b))
    return out


def load_calls():
    calls = []
    for line in (ART / "calls.log").read_text().splitlines():
        m = re.match(r"^C (\d+) ([0-9A-F]+) ([0-9A-F]+) (\d+) (\d+)$", line)
        if m:
            calls.append(dict(frame=int(m[1]), src=int(m[2], 16),
                              dst=int(m[3], 16), pal=int(m[4]), d4=int(m[5])))
    return calls


def group(calls):
    """A run of strips whose destination advances by 8 is one image."""
    images = []
    cur = []
    for c in calls:
        if cur and c["dst"] == cur[-1]["dst"] + 8 and c["pal"] == cur[-1]["pal"]:
            cur.append(c)
        else:
            if cur:
                images.append(cur)
            cur = [c]
    if cur:
        images.append(cur)
    return images


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    palette = lut((ART / "after-palette.bin").read_bytes())
    calls = load_calls()
    images = group(calls)
    print(f"{len(calls)} recorded strips -> {len(images)} images")

    manifest = []
    for n, strips in enumerate(images):
        cols = []
        height = 0
        for s in strips:
            col, _ = decode_strip(s["src"], s["pal"], s["d4"])
            cols.append(col)
            height = max(height, len(col))
        w = len(cols) * 8
        if w < 8 or height < 4:
            continue
        img = Image.new("RGBA", (w, height), (0, 0, 0, 0))
        px = img.load()
        for ci, col in enumerate(cols):
            for y, row in enumerate(col):
                for x, v in enumerate(row):
                    if v is None:
                        continue
                    r, g, b = palette[v & 0xFF]
                    px[ci * 8 + x, y] = (r, g, b, 255)
        dst = strips[0]["dst"]
        name = f"img{n:03d}-{strips[0]['src']:06X}-{w}x{height}"
        img.save(OUT / f"{name}.png")
        manifest.append(dict(index=n, src=strips[0]["src"], strips=len(strips),
                             w=w, h=height, dst=dst, pal=strips[0]["pal"],
                             screen_x=(dst - 0x200000) % STRIDE,
                             screen_y=(dst - 0x200000) // STRIDE))
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"wrote {len(manifest)} PNGs to {OUT}")
    for m in manifest[:14]:
        print(f"  {m['w']:4d}x{m['h']:<4d} at ({m['screen_x']:3d},{m['screen_y']:3d})"
              f"  src {m['src']:06X}  pal {m['pal']}")
