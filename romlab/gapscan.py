"""Split the unmapped runs into code and data, and recover entries in the code.

A gap full of link/movem/rts opcodes is unmapped code - functions reached only
through pointers the sweep could not see. A gap without them is a data table,
and several are ones already decoded by name.
"""
import json
import pathlib
import struct

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
LIMIT = 0x20000
md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

KNOWN_DATA = {
    (0x0FCCA, 0x0FF90): "direction tables, entity templates",
    (0x0FF90, 0x10012): "piece group table, owner table",
    (0x10012, 0x11600): "level records",
    (0x11600, 0x11800): "rotation groups, scoring + speed tables",
    (0x11800, 0x11BD8): "text and sound tables",
}

F = {int(k, 16): v for k, v in json.loads((HERE / "out" / "fullmap.json").read_text()).items()}
covered = bytearray(LIMIT)
for a, f in F.items():
    for i in range(a, min(a + f["size"], LIMIT)):
        covered[i] = 1

gaps = []
i = 0x400
while i < LIMIT:
    if not covered[i]:
        j = i
        while j < LIMIT and not covered[j]:
            j += 1
        if j - i >= 32:
            gaps.append((i, j))
        i = j
    else:
        i += 1


def code_score(a, b):
    """Opcode markers per 100 bytes."""
    n = 0
    for i in range(a, b - 1, 2):
        w = struct.unpack_from(">H", UP, i)[0]
        if w in (0x4E75, 0x4E56, 0x48E7, 0x4E5E, 0x4CDF):
            n += 1
    return 100.0 * n / max(1, b - a)


code_gaps, data_gaps = [], []
for a, b in gaps:
    label = None
    for (lo, hi), name in KNOWN_DATA.items():
        if a >= lo and b <= hi:
            label = name
    s = code_score(a, b)
    (data_gaps if (label or s < 0.4) else code_gaps).append((a, b, s, label))

print(f"unmapped runs: {len(gaps)}   look like code: {len(code_gaps)}   data: {len(data_gaps)}")
print(f"  code bytes: {sum(b-a for a,b,_,_ in code_gaps)}   data bytes: {sum(b-a for a,b,_,_ in data_gaps)}")
print("\nlargest code gaps:")
for a, b, s, _ in sorted(code_gaps, key=lambda g: -(g[1]-g[0]))[:10]:
    print(f"   {a:05X}..{b:05X}  {b-a:5d} bytes  markers/100B {s:.2f}")
print("\nlargest data gaps:")
for a, b, s, label in sorted(data_gaps, key=lambda g: -(g[1]-g[0]))[:8]:
    print(f"   {a:05X}..{b:05X}  {b-a:5d} bytes  {label or '(no opcode markers)'}")

# recover entries inside code gaps: a prologue right after a terminator
new = set()
for a, b, _, _ in code_gaps:
    for i in range(a, b - 4, 2):
        w = struct.unpack_from(">H", UP, i)[0]
        if w in (0x4E56, 0x48E7):
            prev = struct.unpack_from(">H", UP, i - 2)[0] if i >= 2 else 0
            if prev in (0x4E75, 0x4E71, 0x4E73) or i == a:
                new.add(i)
        elif w in (0x4E56, 0x48E7):
            new.add(i)
print(f"\ncandidate entries recovered inside code gaps: {len(new)}")
json.dump(sorted(new), open(HERE / "out" / "gapseeds.json", "w"))
