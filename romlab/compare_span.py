"""Port of the flood-fill span scanner at 0x65AA, checked against the ROM.

The territory fill works from a stack of seed coordinates. This routine walks a
column of the board between two coordinates and pushes the **start of every run
of cells that differ from the given value**. Cells matching the value are the
boundary; everything else is territory still to claim.

The stack pointer at 0x3E209C is pre-incremented, so the first entry lands two
bytes above the base rather than at it.
"""
import pathlib
import re

STRIDE = 32
CASES = {
    "allsame":    (10, 5, 15, 0x41, []),
    "alldiff":    (10, 5, 15, 0x41, [(5, 15, 0x00)]),
    "onerun":     (10, 5, 15, 0x41, [(8, 10, 0x00)]),
    "tworuns":    (10, 5, 15, 0x41, [(6, 7, 0x00), (11, 13, 0x00)]),
    "atstart":    (10, 5, 15, 0x41, [(5, 6, 0x00)]),
    "atend":      (10, 5, 15, 0x41, [(14, 15, 0x00)]),
    "alternate":  (10, 5, 15, 0x41, [(5, 5, 0), (7, 7, 0), (9, 9, 0), (11, 11, 0), (13, 13, 0)]),
    "single":     (10, 7, 7, 0x41, [(7, 7, 0x00)]),
    "singlesame": (10, 7, 7, 0x41, []),
    "othercol":   (25, 0, 29, 0x00, [(10, 20, 0x41)]),
}


def scan_span(board, col, y0, y1, value):
    """Returns the list of pushed (col, y) coordinates."""
    a4 = col * STRIDE + y0
    end = col * STRIDE + y1 + 1
    y = y0
    out = []
    while a4 != end:
        if board[a4] == value:
            a4 += 1
            y += 1
            continue
        out.append((col, y))                 # start of a differing run
        a4 += 1
        y += 1
        while a4 != end and board[a4] != value:
            a4 += 1
            y += 1
    return out


ok = bad = 0
for line in pathlib.Path("out/verify19/v.log").read_text().splitlines():
    m = re.match(r"^Q (\S+) (\d+) ([0-9A-F]+)$", line)
    if not m:
        continue
    name, ptr, dump = m[1], int(m[2]), bytes.fromhex(m[3])
    col, y0, y1, val, fill = CASES[name]
    board = bytearray([val]) * (42 * STRIDE)
    for a, b, v in fill:
        for y in range(a, b + 1):
            board[col * STRIDE + y] = v
    mine = scan_span(board, col, y0, y1, val)
    # the stack is pre-incremented, so entry k lands at offset 2 + 2k
    buf = bytearray(32)
    for k, (cx, cy) in enumerate(mine):
        buf[2 + k * 2] = cx
        buf[2 + k * 2 + 1] = cy
    if bytes(buf) == dump and len(mine) * 2 == ptr:
        ok += 1
    else:
        bad += 1
        print(f"  {name}: rom ptr {ptr} {dump.hex()}")
        print(f"        port ptr {len(mine)*2} {bytes(buf).hex()}")

print(f"\n{ok} match, {bad} differ")
print("VERIFIED" if bad == 0 else "NOT VERIFIED")
