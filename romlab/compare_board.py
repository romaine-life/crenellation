"""Ports of the two pure routines the board logic rests on, plus their check.

cell_address (0x11BD8): the board is a byte array at 0x3E0864 with a stride of
32; x is the column and y the row, so a cell is base + x*32 + y. Both operands
are byte sized, so coordinates wrap at 256 rather than being clamped.

distance (0x11D5C): an octagonal approximation of sqrt(dx^2+dy^2) - take the
larger of |dx|,|dy| and add half the smaller minus an eighth of it. When the
two are equal it takes a divide path that can overflow, in which case the
routine substitutes 0x7fff before the shifts.
"""
import pathlib
import re

BOARD = 0x3E0864


def cell_address(x: int, y: int) -> int:
    d0 = (x & 0xFF) << 5          # asl.w #5 on a byte-loaded word
    d0 = (d0 & 0xFFFF)
    lo = (d0 + (y & 0xFF)) & 0xFF  # add.b touches only the low byte
    d0 = (d0 & 0xFFFF00) | lo
    return (d0 + BOARD) & 0xFFFFFFFF


def s16(v):
    v &= 0xFFFF
    return v - 0x10000 if v & 0x8000 else v


def distance(a: int, b: int) -> int:
    """0x11D5C. Not max + min/2 - min/8: the small side is squared and divided
    by the large one first. d0 ends up holding the larger operand, and the
    comparison that decides the swap is SIGNED - so an operand of -32768, whose
    negation overflows back to itself, stays on the small side. The divide is
    unsigned and leaves its destination untouched on overflow, which the
    routine detects and replaces with 0x7fff."""
    d0 = abs(s16(b)) & 0xFFFF          # neg.w; -32768 negates to itself
    if s16(b) == -0x8000:
        d0 = 0x8000
    d1w = s16(a)
    if d1w < 0:
        d1 = (-d1w) & 0xFFFF
    elif d1w == 0:
        if d0 == 0:
            return 0
        d1 = 0
    else:
        d1 = d1w & 0xFFFF
    if s16(d1) > s16(d0):              # signed compare, then swap
        d0, d1 = d1, d0
    prod = (s16(d1) * s16(d1)) & 0xFFFFFFFF
    if d0 == 0:
        return d0
    q = prod // d0                     # divu.w, unsigned
    d1 = 0x7FFF if q > 0xFFFF else (q & 0xFFFF)
    d1 = (d1 >> 1) & 0xFFFF
    d0 = (d0 + d1) & 0xFFFF
    d1 = (d1 >> 3) & 0xFFFF
    return (d0 - d1) & 0xFFFF


cell_ok = cell_bad = dist_ok = dist_bad = 0
bad = []
for line in pathlib.Path("out/verify8/v.log").read_text().splitlines():
    m = re.match(r"^CELL (-?\d+) (-?\d+) ([0-9A-F]+)$", line)
    if m:
        x, y, got = int(m[1]), int(m[2]), int(m[3], 16)
        if cell_address(x, y) == got:
            cell_ok += 1
        else:
            cell_bad += 1
            bad.append(("cell", x, y, hex(got), hex(cell_address(x, y))))
    m = re.match(r"^DIST (-?\d+) (-?\d+) ([0-9A-F]+)$", line)
    if m:
        a, b, got = int(m[1]), int(m[2]), int(m[3], 16)
        mine = distance(a, b)
        if mine == (got & 0xFFFF):
            dist_ok += 1
        else:
            dist_bad += 1
            bad.append(("dist", a, b, hex(got), hex(mine)))

print(f"cell address: {cell_ok} match, {cell_bad} differ")
print(f"distance:     {dist_ok} match, {dist_bad} differ")
for b in bad[:8]:
    print("   ", b)
print()
print("VERIFIED" if cell_bad == 0 and dist_bad == 0 else "NOT VERIFIED")
