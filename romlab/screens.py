"""Rebuild game screens from ROM tiles and check them against the hardware.

A screen is not a picture in the ROM: it is a placement map. artmap.lua logged
every (tile source, palette, destination) the game issued plus framebuffer
snapshots. Replaying the placements between two snapshots onto the earlier one
must reproduce the later one wherever tiles were drawn - which verifies the
decoded art and its placement together.
"""
import pathlib
import re
import struct

from PIL import Image

from romart import decode_strip

HERE = pathlib.Path(__file__).parent
MAP = HERE / "out" / "artmap"
OUT = HERE / "out" / "screens"
BASE, W, H, STRIDE = 0x200000, 512, 256, 512


def lut(pal):
    """MAME expands a 6-bit channel as (x<<2)|(x>>4); x*255/63 is a step off."""
    def e6(x):
        return ((x << 2) | (x >> 4)) & 0xFF
    out = []
    for v in range(len(pal) // 2):
        (w,) = struct.unpack_from("<H", pal, v * 2)
        i = (w >> 15) & 1
        out.append((e6(((w >> 9) & 0x3E) | i), e6(((w >> 4) & 0x3E) | i),
                    e6(((w << 1) & 0x3E) | i)))
    return out


calls, snaps = [], []
for line in (MAP / "map.log").read_text().splitlines():
    m = re.match(r"^C (\d+) ([0-9A-F]+) ([0-9A-F]+) (\d+) (\d+)$", line)
    if m:
        calls.append((int(m[1]), int(m[2], 16), int(m[3], 16), int(m[4]), int(m[5])))
    elif line.startswith("SNAP"):
        snaps.append(int(line.split()[1]))

OUT.mkdir(parents=True, exist_ok=True)
print(f"placements {len(calls)}, snapshots {snaps}")

tot_px = tot_bad = 0
for a, b in zip(snaps, snaps[1:]):
    fb = bytearray((MAP / f"fb-{a}.bin").read_bytes())
    ref = (MAP / f"fb-{b}.bin").read_bytes()
    touched = set()
    n = 0
    for fr, src, dst, pal, d4 in calls:
        if not (a < fr <= b):
            continue
        n += 1
        rows, _ = decode_strip(src, pal, d4)
        off = dst - BASE
        for r in range(8):
            row = rows[r] if r < len(rows) else []
            for c in range(8):
                v = row[c] if c < len(row) else None
                if v is None:
                    continue
                o = off + r * STRIDE + c
                if 0 <= o < len(fb):
                    fb[o] = v
                    touched.add(o)
    bad = sum(1 for o in touched if fb[o] != ref[o])
    tot_px += len(touched)
    tot_bad += bad
    print(f"  frames {a}->{b}: {n:5d} placements, {len(touched):6d} px covered, {bad:5d} differ")

    palette = lut((MAP / f"pal-{b}.bin").read_bytes())
    img = Image.new("RGB", (336, 240))
    px = img.load()
    for y in range(240):
        for x in range(336):
            px[x, y] = palette[fb[y * STRIDE + x]]
    img.save(OUT / f"screen-{b}.png")

print(f"\ntotal: {tot_px} pixels rebuilt from ROM tiles, {tot_bad} differ")
print("VERIFIED" if tot_bad == 0 else f"{100*(tot_px-tot_bad)/tot_px:.3f}% exact")
