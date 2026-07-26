"""Verify decoded ROM art byte-exact against the hardware.

artverify.lua logged, for every call the game made to the decompressor, the
arguments and the actual 8x8 pixels the hardware left at the destination. The
port must reproduce those pixels exactly. Skip runs write nothing, so those
pixels keep whatever was already on screen and are excluded from the compare.
"""
import pathlib
import re

from romart import decode_strip

HERE = pathlib.Path(__file__).parent
LOG = HERE / "out" / "artverify" / "tiles.log"

total = matched = 0
px_total = px_bad = 0
bad_examples = []
seen_src = set()

for line in LOG.read_text().splitlines():
    m = re.match(r"^C ([0-9A-F]+) ([0-9A-F]+) (\d+) (\d+) ([0-9A-F]+)$", line)
    if not m:
        continue
    src, dst, pal, d4 = int(m[1], 16), int(m[2], 16), int(m[3]), int(m[4])
    actual = bytes.fromhex(m[5])
    rows, _ = decode_strip(src, pal, d4)
    total += 1
    seen_src.add(src)
    ok = True
    for r in range(8):
        row = rows[r] if r < len(rows) else []
        for c in range(8):
            v = row[c] if c < len(row) else None
            if v is None:          # skip run: nothing was written
                continue
            px_total += 1
            if v != actual[r * 8 + c]:
                px_bad += 1
                ok = False
    if ok:
        matched += 1
    elif len(bad_examples) < 5:
        bad_examples.append((src, dst, pal, d4))

print(f"tiles compared: {total}   distinct ROM sources: {len(seen_src)}")
print(f"tiles matching exactly: {matched}/{total}")
print(f"pixels compared: {px_total}   mismatching: {px_bad}")
if bad_examples:
    print("first mismatches:", [(hex(s), hex(d), p, q) for s, d, p, q in bad_examples])
print()
print("VERIFIED" if px_bad == 0 else "NOT VERIFIED")
