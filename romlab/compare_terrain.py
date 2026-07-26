"""Compare the ported terrain painter against the original routine."""
import pathlib
import re

from unpack2 import decode

HERE = pathlib.Path(__file__).parent
VER = HERE / "out" / "verify2"

cases = []
for line in (VER / "verify2.log").read_text().splitlines():
    m = re.match(r"case (\w+) src=([0-9A-F]+) rot=([0-9A-F]+)", line)
    if m:
        cases.append({"name": m.group(1), "src": int(m.group(2), 16), "rot": int(m.group(3), 16)})
    m2 = re.match(r"\s+ok rot_after=([0-9A-F]+)", line)
    if m2 and cases:
        cases[-1]["rot_after"] = int(m2.group(1), 16)

print(f"{'case':8s} {'buffer':22s} {'rotation':20s}")
all_ok = True
for c in cases:
    path = VER / f"{c['name']}.bin"
    if not path.exists():
        print(f"{c['name']:8s} NO DUMP")
        all_ok = False
        continue
    original = path.read_bytes()
    mine, rot_after = decode(c["src"], c["rot"], len(original))
    buf_ok = bytes(mine) == original
    rot_ok = ("rot_after" not in c) or (rot_after & 0xFF) == (c["rot_after"] & 0xFF)
    wrote = sum(1 for b in original if b)
    bstat = f"MATCH ({wrote} written)" if buf_ok else f"MISMATCH {sum(1 for x,y in zip(original,mine) if x!=y)} bytes"
    rstat = "MATCH" if rot_ok else f"got {rot_after & 0xFF:02X} want {c.get('rot_after',0) & 0xFF:02X}"
    print(f"{c['name']:8s} {bstat:22s} {rstat:20s}")
    if not (buf_ok and rot_ok):
        all_ok = False

print()
print("VERIFIED" if all_ok else "NOT VERIFIED")
