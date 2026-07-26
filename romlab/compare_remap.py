"""Compare the ported remap_rect against the original at 0x1217E."""
import pathlib
import re

VER = pathlib.Path(__file__).parent / "out" / "verify4"


def remap_rect(block: bytes, table: bytes, w: int, h: int) -> bytes:
    out = bytearray(block)
    for i in range(w * h):
        px = block[i]
        bank = px >> 4
        colour = px & 0x0F
        out[i] = (colour + table[bank]) & 0xFF
    return bytes(out)


cases = []
for line in (VER / "v.log").read_text().splitlines():
    m = re.match(r"case (\w+) w=(\d+) h=(\d+)", line)
    if m:
        cases.append({"name": m.group(1), "w": int(m.group(2)), "h": int(m.group(3))})

print(f"{'case':5s} {'result':10s} detail")
all_ok = True
for c in cases:
    fin, fout, ftbl = (VER / f"{c['name']}-in.bin"), (VER / f"{c['name']}-out.bin"), (VER / f"{c['name']}-in.tbl")
    if not (fin.exists() and fout.exists() and ftbl.exists()):
        print(f"{c['name']:5s} {'NO DUMP':10s}")
        all_ok = False
        continue
    src, original, table = fin.read_bytes(), fout.read_bytes(), ftbl.read_bytes()
    mine = remap_rect(src, table, c["w"], c["h"])
    if mine == original:
        print(f"{c['name']:5s} {'MATCH':10s} {c['w']}x{c['h']} = {len(original)} pixels identical")
    else:
        diff = sum(1 for x, y in zip(mine, original) if x != y)
        print(f"{c['name']:5s} {'MISMATCH':10s} {diff}/{len(original)} differ")
        all_ok = False

print()
print("VERIFIED" if all_ok else "NOT VERIFIED")
