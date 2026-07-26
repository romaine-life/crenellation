"""Compare the ported decompressor against the original routine.

verify.lua called the real routine at 0x11F2A with controlled registers and
dumped its destination buffer. Run the port on the identical source bytes and
compare byte for byte. The destination is a bitmap-style buffer: the routine
writes 8 pixels then advances by 0x1F8, so the port's strip output maps back to
the same layout.
"""
import pathlib

from unpack import decode_strip

HERE = pathlib.Path(__file__).parent
VER = HERE / "out" / "verify"
ROM = (HERE / "prog_main.bin").read_bytes()

STRIDE = 512
DEST_LEN = 8192

CASES = [
    ("call000", 0xE68C6, 240, 7),
    ("call001", 0xE653E, 240, 7),
    ("call002", 0xE6292, 240, 7),
    ("call003", 0xE4E84, 192, 7),
    ("call004", 0xE4FB4, 192, 7),
    ("call005", 0xD75E0, 48, 7),
    ("call006", 0xE6459, 240, 7),
    ("call007", 0xE69B2, 240, 7),
    ("call008", 0xE6AB3, 240, 7),
    ("call009", 0xD7B51, 32, 7),
    ("call010", 0xE6447, 240, 7),
    ("call011", 0xD7760, 48, 7),
    ("call012", 0xE656A, 240, 7),
    ("call013", 0xE4D12, 192, 7),
    ("call014", 0xE64BB, 240, 7),
    ("call015", 0xE6900, 240, 7),
    ("call016", 0xE50AA, 192, 7),
    ("call017", 0xE694C, 240, 7),
    ("call018", 0xE64EE, 240, 7),
    ("call019", 0xE5062, 192, 7),
    ("call020", 0xE69E5, 240, 7),
    ("call021", 0xE6984, 240, 7),
    ("call022", 0xE4E00, 192, 7),
    ("call023", 0xD76BA, 48, 7),
    ("call024", 0xD7AC8, 32, 7),
    ("call025", 0xD7AF5, 32, 7),
    ("call026", 0xE555A, 192, 7),
    ("call027", 0xE6822, 240, 7),
    ("call028", 0xE633D, 240, 7),
    ("call029", 0xD770C, 48, 7),
    ("call030", 0xE6727, 240, 7),
    ("call031", 0xE6489, 240, 7),
    ("call032", 0xE4FE2, 192, 7),
    ("call033", 0xE675B, 240, 7),
    ("call034", 0xE6A99, 240, 7),
    ("call035", 0xD7AB1, 32, 7),
    ("call036", 0xE4EBA, 192, 7),
    ("call037", 0xE4D95, 192, 7),
    ("call038", 0xE6A21, 240, 7),
    ("call039", 0xE4DCC, 192, 7),
    ("call040", 0xE6918, 240, 7),
    ("call041", 0xE504F, 192, 7),
    ("call042", 0xD7787, 48, 7),
    ("call043", 0xE4E68, 192, 7),
    ("call044", 0xE6775, 240, 7),
    ("call045", 0xE4FFE, 192, 7),
    ("call046", 0xE6A6F, 240, 7),
    ("call047", 0xE4F4E, 192, 7),
    ("call048", 0xD7672, 48, 7),
    ("call049", 0xE4D7B, 192, 7),
    ("call050", 0xD75BB, 48, 7),
    ("call051", 0xE5031, 192, 7),
    ("call052", 0xD76E4, 48, 7),
    ("call053", 0xE4FCB, 192, 7),
    ("call054", 0xE5525, 192, 7),
    ("call055", 0xD7B0E, 32, 7),
    ("call056", 0xD7631, 48, 7),
    ("call057", 0xE68B6, 240, 7),
    ("call058", 0xE68EA, 240, 7),
    ("call059", 0xE6886, 240, 7),
    ("call060", 0xE635E, 240, 7),
    ("call061", 0xE64A6, 240, 7),
    ("call062", 0xD7ADC, 32, 7),
    ("call063", 0xE631F, 240, 7),
    ("call064", 0xE6968, 240, 7),
    ("call065", 0xE683C, 240, 7),
    ("call066", 0xE4F31, 192, 7),
    ("call067", 0xE6A3D, 240, 7),
    ("call068", 0xE6A07, 240, 7),
    ("call069", 0xE6429, 240, 7),
    ("call070", 0xE62AA, 240, 7),
    ("call071", 0xD760A, 48, 7),
    ("call072", 0xE6850, 240, 7),
    ("call073", 0xE62C8, 240, 7),
    ("call074", 0xE553F, 192, 7),
    ("call075", 0xE63B0, 240, 7),
    ("call076", 0xE6587, 240, 7),
    ("call077", 0xD7656, 48, 7),
    ("call078", 0xE5751, 192, 7),
    ("call079", 0xD77A7, 48, 7),
    ("call080", 0xE4EFE, 192, 7),
    ("call081", 0xE67C5, 240, 7),
    ("call082", 0xE64D8, 240, 7),
    ("call083", 0xE4F63, 192, 7),
    ("call084", 0xE678F, 240, 7),
    ("call085", 0xD7736, 48, 7),
    ("call086", 0xE699A, 240, 7),
    ("call087", 0xE4ECE, 192, 7),
    ("call088", 0xE4F94, 192, 7),
    ("call089", 0xE6A89, 240, 7),
]


def port_render(src: int, palbase: int = 0, d4: int = 7):
    """Run the port and lay its pixels out the way the routine does."""
    buf = bytearray(DEST_LEN)
    pixels, _, ok = decode_strip(ROM, src)
    pos = 0  # offset within the destination, as the routine walks it
    left = d4 + 1
    for value in pixels:
        if pos >= DEST_LEN:
            break
        if value is not None:
            buf[pos] = (value + palbase) & 0xFF
        pos += 1
        left -= 1
        if left == 0:
            pos += STRIDE - 8
            left = 8
    return buf, ok


print(f"{'case':16s} {'result':10s} detail")
all_ok = True
for name, src, palbase, d4 in CASES:
    got_path = VER / f"{name}.bin"
    if not got_path.exists():
        print(f"{name:16s} {'NO DUMP':10s} harness produced no output")
        all_ok = False
        continue
    original = got_path.read_bytes()
    mine, ok = port_render(src, palbase, d4)

    # Compare only the region the routine actually touched: up to the last
    # non-zero byte in the original (the buffer was zeroed beforehand).
    # The destination was zeroed before the call, so the whole buffer can be
    # compared - including the all-skips case where nothing should be written.
    a = original
    b = bytes(mine)
    wrote = sum(1 for x in a if x)
    if a == b:
        print(f"{name:16s} {'MATCH':10s} {len(a)} bytes identical ({wrote} written)")
    else:
        diff = sum(1 for x, y in zip(a, b) if x != y)
        first = next(i for i, (x, y) in enumerate(zip(a, b)) if x != y)
        print(f"{name:16s} {'MISMATCH':10s} {diff}/{len(a)} bytes differ, first at {first}")
        all_ok = False

print()
print("VERIFIED" if all_ok else "NOT VERIFIED")
