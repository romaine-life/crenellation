"""Compare the ported recolor_block against the original routine at 0x11FF8.

Port: for each of 8 rows, take 8 pixels; keep the low nibble and add the
palette base; then advance a full row. The harness dumped the input block and
the block the routine produced, so the port runs on the identical input.
"""
import pathlib
import re

HERE = pathlib.Path(__file__).parent
VER = HERE / "out" / "verify3"


def recolor_block(block: bytes, palbase: int) -> bytes:
    out = bytearray(block)
    for i in range(64):
        out[i] = ((block[i] & 0x0F) + palbase) & 0xFF
    return bytes(out)


cases = []
for line in (VER / "verify3.log").read_text().splitlines():
    m = re.match(r"case (\w+) pal=([0-9A-F]+) seed=(\d+)", line)
    if m:
        cases.append({"name": m.group(1), "pal": int(m.group(2), 16)})

print(f"{'case':6s} {'result':10s} detail")
all_ok = True
for c in cases:
    fin = VER / f"{c['name']}-in.bin"
    fout = VER / f"{c['name']}-out.bin"
    if not (fin.exists() and fout.exists()):
        print(f"{c['name']:6s} {'NO DUMP':10s}")
        all_ok = False
        continue
    src = fin.read_bytes()
    original = fout.read_bytes()
    mine = recolor_block(src, c["pal"])
    if mine == original:
        print(f"{c['name']:6s} {'MATCH':10s} 64 pixels identical (pal {c['pal']:#04x})")
    else:
        diff = sum(1 for x, y in zip(mine, original) if x != y)
        print(f"{c['name']:6s} {'MISMATCH':10s} {diff}/64 differ")
        all_ok = False

print()
print("VERIFIED" if all_ok else "NOT VERIFIED")
