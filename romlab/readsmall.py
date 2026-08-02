"""Dump the unnamed routines, smallest first, for reading.

Naming is reading, and reading is faster in batches: the routines that still
carry an address are mostly short, and a screenful of them at a time is enough
to see the family they belong to. `readsmall.py 0 30` prints the first thirty
of the unnamed routine heads in size order, with the evidence line
distinguish.py would give and the disassembly under it.

    python3 readsmall.py [from] [count] [--max BYTES]

Not a naming tool: it prints what a person needs and invents nothing. The names
go in names.curated.json with the evidence beside them.
"""
import json
import pathlib
import sys

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_ext.bin").read_bytes()
FACTS = json.loads((HERE / "out" / "facts.json").read_text())
NAMES = json.loads((HERE / "out" / "names.json").read_text())
NAMES = NAMES.get("names", NAMES)
IDENT = json.loads((HERE / "out" / "idents.json").read_text())["idents"]
md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

HEADS = {lo: hi for lo, hi in FACTS["funcs"]}
CALLERS = {int(k, 16): v for k, v in FACTS.get("callers", {}).items()}
CALLS = {int(k, 16): v for k, v in FACTS.get("calls", {}).items()}


def ident(a):
    return IDENT.get("0x%x" % a) or "fn_%05x" % a


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    cap = 60
    if "--max" in sys.argv:
        cap = int(sys.argv[sys.argv.index("--max") + 1])
    listed = (HERE / "out" / "fnlist.txt").read_text().split()
    addrs = [int(x, 16) for x in listed]
    # fnlist.txt is scraped from the last generated decompiled.ts, so a name
    # added since then is already in idents.json and this must not offer it
    # again. Checking both means a batch can be named, idents.py re-run, and
    # the next batch read without regenerating the whole decompilation.
    addrs = [a for a in addrs if IDENT.get("0x%x" % a) is None]
    heads = sorted((a for a in addrs if a in HEADS),
                   key=lambda a: (HEADS[a] - a, a))
    heads = [a for a in heads if HEADS[a] - a <= cap]
    print(f"{len(heads)} unnamed routine heads at most {cap} bytes;"
          f" showing {start}..{start + count}")
    for a in heads[start:start + count]:
        hi = HEADS[a]
        why = NAMES.get("0x%x" % a) or ""
        callers = [ident(c) for c in (CALLERS.get(a) or [])][:4]
        callees = [ident(c) for c in (CALLS.get(a) or [])][:4]
        print(f"--- 0x{a:05x} ({hi - a}B) {why}")
        if callers:
            print("    from " + ", ".join(callers))
        if callees:
            print("    calls " + ", ".join(callees))
        for i in md.disasm(UP[a:hi], a):
            print("    %06x  %-9s %s" % (i.address, i.mnemonic, i.op_str))


if __name__ == "__main__":
    main()
