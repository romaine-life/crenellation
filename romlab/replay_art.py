"""Whole-pipeline verification of the art decoder.

artcalls.lua snapshotted the framebuffer, recorded every call the game made to
the decompressor (source, destination, palette base, row counter), then
snapshotted it again. Replaying those calls through the port onto the first
snapshot must reproduce the second snapshot exactly. That verifies the decoder
against real in-game arguments across thousands of calls, not just hand-picked
ones.
"""
import pathlib
import re

HERE = pathlib.Path(__file__).parent
ART = HERE / "out" / "art"
ROM = (HERE / "prog_main.bin").read_bytes()

BITMAP_BASE = 0x200000
BMP_SIZE = 0x20000
STRIDE = 512


def decode_calls():
    calls = []
    for line in (ART / "calls.log").read_text().splitlines():
        m = re.match(r"^C (\d+) ([0-9A-F]+) ([0-9A-F]+) (\d+) (\d+)$", line)
        if m:
            calls.append(
                {
                    "frame": int(m.group(1)),
                    "src": int(m.group(2), 16),
                    "dst": int(m.group(3), 16),
                    "pal": int(m.group(4)),
                    "d4": int(m.group(5)),
                }
            )
    return calls


def run_call(buf: bytearray, src: int, dst_off: int, pal: int, d4: int) -> bool:
    """Replay one decompressor call directly against the framebuffer.

    Mirrors the routine: emit pixels left to right; after (d4+1) of them the
    destination jumps a full row (stride 512) and the counter resets to 7.
    """
    pos = dst_off
    left = d4 + 1
    p = src

    def put(value):
        nonlocal pos, left
        if value is not None and 0 <= pos < BMP_SIZE:
            buf[pos] = (value + pal) & 0xFF
        pos += 1
        left -= 1
        if left == 0:
            pos += STRIDE - 8
            left = 8

    while True:
        if p >= len(ROM):
            return False
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
                    return True
                if p + 1 >= len(ROM):
                    return False
                a, b = ROM[p], ROM[p + 1]
                p += 2
                for _ in range(count):
                    put(a)
                    put(b)
            else:
                if p >= len(ROM):
                    return False
                b = ROM[p]
                p += 1
                for _ in range(count):
                    put(b)
        else:
            if c & 0x20:
                # count is PIXELS, not source bytes
                remaining = count
                while remaining > 0:
                    if p >= len(ROM):
                        return False
                    b = ROM[p]
                    p += 1
                    put(b >> 4)
                    remaining -= 1
                    if remaining == 0:
                        break
                    put(b & 0x0F)
                    remaining -= 1
            else:
                for _ in range(count):
                    put(None)


before = bytearray((ART / "before-bitmap.bin").read_bytes())
after = (ART / "after-bitmap.bin").read_bytes()
calls = decode_calls()

in_bitmap = [c for c in calls if BITMAP_BASE <= c["dst"] < BITMAP_BASE + BMP_SIZE]
other = len(calls) - len(in_bitmap)
print(f"recorded calls: {len(calls)}  targeting the framebuffer: {len(in_bitmap)}  elsewhere: {other}")

ok_count = 0
for c in in_bitmap:
    if run_call(before, c["src"], c["dst"] - BITMAP_BASE, c["pal"], c["d4"]):
        ok_count += 1

print(f"calls replayed to a clean terminator: {ok_count}/{len(in_bitmap)}")

diff = sum(1 for x, y in zip(before, after) if x != y)
print(f"framebuffer bytes differing after replay: {diff}/{len(after)}")
if diff == 0:
    print("\nVERIFIED - replay reproduces the framebuffer exactly")
else:
    firsts = [i for i, (x, y) in enumerate(zip(before, after)) if x != y][:8]
    print("first differing offsets:", [hex(i) for i in firsts])
    print("\nNOT VERIFIED")
