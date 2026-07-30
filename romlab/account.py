"""Account for every byte of the overlay.

Coverage does not require all bytes to be code. It requires every byte to be
either part of a named function or part of a named data table. This pairs the
code/data partition from trace_code.py with evidence about what each region is:
which functions reference it, what it looks like, and what is already known.
"""
import json
import pathlib
import struct
from collections import defaultdict

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
LIMIT = 0x20000
M = json.loads((HERE / "out" / "codemap2.json").read_text())
md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

# every absolute reference made anywhere in the code, with the referring address
refs = defaultdict(set)
for a, b in M["code"]:
    addr = a
    while addr < b:
        ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
        if ins is None:
            addr += 2
            continue
        for tok in ins.op_str.replace(",", " ").replace("(", " ").replace(")", " ").split():
            if tok.startswith("$"):
                tok2 = tok.split(".")[0].lstrip("$")
                try:
                    v = int(tok2, 16)
                except ValueError:
                    continue
                if 0 <= v < LIMIT:
                    refs[v].add(addr)
        addr += ins.size

# The complement of the current function map, not the old classifier's
# partition - funcs has grown past codemap2, and rows computed against the
# old partition double-claim every byte the newer routines cover.
FACTS = json.loads((HERE / "out" / "facts.json").read_text())
_funcs = sorted((a, b) for a, b in FACTS["funcs"])
_covered = bytearray(LIMIT)
for _a, _b in _funcs:
    for _i in range(_a, min(_b, LIMIT)):
        _covered[_i] = 1
data = []
_i = 0
while _i < LIMIT:
    if not _covered[_i]:
        _j = _i
        while _j < LIMIT and not _covered[_j]:
            _j += 1
        data.append((_i, _j))
        _i = _j
    else:
        _i += 1
print(f"data runs: {len(data)}  bytes {sum(b-a for a,b in data)}")
print(f"code bytes covered: {sum(b-a for a,b in _funcs if a < LIMIT)}")

# for each data run, who points into it and what does it look like?
rows = []
for a, b in data:
    who = set()
    for v in range(a, b):
        who |= refs.get(v, set())
    blob = UP[a:b]
    printable = sum(1 for c in blob if 32 <= c < 127)
    zeros = blob.count(0)
    # do the longs in it look like pointers into the overlay?
    ptrs = 0
    for i in range(0, len(blob) - 3, 4):
        v = struct.unpack_from(">I", blob, i)[0]
        if 0x400 <= v < LIMIT:
            ptrs += 1
    rows.append(dict(a=a, b=b, n=b - a, refs=sorted(who)[:6], nrefs=len(who),
                     printable=printable, zeros=zeros, ptrs=ptrs))

rows.sort(key=lambda r: -r["n"])
print("\nlargest data runs with their referrers:")
for r in rows[:22]:
    kind = []
    if r["ptrs"] > r["n"] / 8:
        kind.append("pointer-table")
    if r["printable"] > r["n"] * 0.6:
        kind.append("text")
    if r["zeros"] > r["n"] * 0.7:
        kind.append("mostly-zero")
    print(f"  {r['a']:05X}..{r['b']:05X} {r['n']:6d}  refs {r['nrefs']:3d} "
          f"{[hex(x) for x in r['refs'][:4]]} {' '.join(kind)}")
json.dump(rows, open(HERE / "out" / "dataruns.json", "w"), indent=1)
