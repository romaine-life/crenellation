"""Replay calls to BOTH verified decoders and compare against the framebuffer.

artcalls.lua recorded, in order, every call to decompressor 1 (0x11F1C) and
decompressor 2 / terrain painter (0x124D8), plus framebuffer snapshots before
and after. Replaying both through the verified ports onto the "before" snapshot
should reproduce "after" exactly.
"""
import pathlib
import re

from unpack import decode_strip
import unpack2

HERE = pathlib.Path(__file__).parent
ART = HERE / "out" / "art"
ROM = (HERE / "prog_main.bin").read_bytes()

BASE = 0x200000
SIZE = 0x20000
STRIDE = 512


def emit_strip(buf, src, dst_off, pal, d4):
    """Decoder 1, writing into the framebuffer at dst_off."""
    pixels, _, _ = decode_strip(ROM, src)
    pos, left = dst_off, d4 + 1
    for v in pixels:
        if v is not None and 0 <= pos < SIZE:
            buf[pos] = (v + pal) & 0xFF
        pos += 1
        left -= 1
        if left == 0:
            pos += STRIDE - 8
            left = 8


def emit_terrain(buf, src, dst_off, rot):
    """Decoder 2, writing into the framebuffer at dst_off. Returns new rot."""
    block, rot_after = unpack2.decode(src, rot, SIZE)
    # unpack2 lays out from offset 0 with the same stride, so copy the written
    # cells across at the real destination
    pos, left = dst_off, 8
    src_pos, src_left = 0, 8
    # walk both in lockstep
    written = 0
    for _ in range(SIZE):
        if src_pos >= SIZE or pos >= SIZE:
            break
        if block[src_pos]:
            buf[pos] = block[src_pos]
            written += 1
        pos += 1
        src_pos += 1
        left -= 1
        src_left -= 1
        if left == 0:
            pos += STRIDE - 8
            left = 8
        if src_left == 0:
            src_pos += STRIDE - 8
            src_left = 8
    return rot_after


calls = []
for line in (ART / "calls.log").read_text().splitlines():
    m = re.match(r"^([CT]) (\d+) ([0-9A-F]+) ([0-9A-F]+) (\d+) (\d+)$", line)
    if m:
        calls.append(
            {
                "kind": m.group(1),
                "src": int(m.group(3), 16),
                "dst": int(m.group(4), 16),
                "a": int(m.group(5)),
                "d4": int(m.group(6)),
            }
        )

buf = bytearray((ART / "before-bitmap.bin").read_bytes())
after = (ART / "after-bitmap.bin").read_bytes()
print(f"calls: {len(calls)}  decoder1: {sum(1 for c in calls if c['kind']=='C')}  decoder2: {sum(1 for c in calls if c['kind']=='T')}")

for c in calls:
    if not (BASE <= c["dst"] < BASE + SIZE):
        continue
    off = c["dst"] - BASE
    if c["kind"] == "C":
        emit_strip(buf, c["src"], off, c["a"], c["d4"])
    else:
        emit_terrain(buf, c["src"], off, c["a"])

diff = sum(1 for x, y in zip(buf, after) if x != y)
print(f"framebuffer bytes differing: {diff}/{len(after)} ({100*diff/len(after):.2f}%)")
print("VERIFIED" if diff == 0 else "NOT VERIFIED")
