"""Compare the ported dissolve LFSR against the order the original clears.

From the disassembly at 0x11E10:
    d1 = 0xB400 (polynomial), d0 = d1
    loop: lsr.l #1, d0; if carry: d0 ^= d1
          repeat while d0 >= 0xF000
          offset = d0 * 2; clear the word there
    61441 iterations (d2 = 0xF000, dbra)
"""
import pathlib

ORDER = pathlib.Path(__file__).parent / "out" / "dissolve" / "order.txt"

recorded = [int(x, 16) for x in ORDER.read_text().split()]
print(f"recorded clears: {len(recorded)}")


def dissolve_sequence(n: int):
    poly = 0xB400
    d0 = poly
    out = []
    for _ in range(n):
        while True:
            carry = d0 & 1
            d0 >>= 1
            if carry:
                d0 ^= poly
            if d0 < 0xF000:
                break
        # the routine bases at 0x200004, so offsets carry a +4
        out.append(d0 * 2 + 4)
    return out


# The capture spans more than one dissolve; compare the first full run.
mine = dissolve_sequence(min(len(recorded), 61441))
match = 0
for a, b in zip(mine, recorded):
    if a != b:
        break
    match += 1

print(f"leading identical entries: {match}")
if match >= 61441:
    print("\nVERIFIED - full dissolve sequence reproduced")
elif match > 0:
    print(f"first divergence at {match}: port {mine[match]:#x} vs original {recorded[match]:#x}")
    print("\nNOT VERIFIED")
else:
    print(f"port starts {[hex(x) for x in mine[:4]]}, original {[hex(x) for x in recorded[:4]]}")
    print("\nNOT VERIFIED")
