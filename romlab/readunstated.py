"""Dump the routines whose name was derived by rule, for reading.

`names.txt` reports 455 of 1,182 with no *stated* purpose: their name came
from a rule - a wrapper after its callee, a stub after its target, an entry
point after the routine it continues - and nothing anywhere says what the
routine is for. `readsmall.py` cannot show them, because it skips anything
already named, and every one of these is named.

Sorted by how much a reader would gain, which is not size: an entry point with
several callers that runs 200 bytes is worth more than a six-byte trampoline.
The default order is callers first, then size.

    python3 readunstated.py [from] [count] [--max BYTES] [--kind fromn|other]
"""
import json
import pathlib
import re
import sys

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_ext.bin").read_bytes()
UPPER = (HERE / "prog_upper.bin").read_bytes()
FACTS = json.loads((HERE / "out" / "facts.json").read_text())
IDENT = json.loads((HERE / "out" / "idents.json").read_text())["idents"]
CURATED = json.loads((HERE / "names.curated.json").read_text())
MANUAL = json.loads((HERE / "manual_names.json").read_text())
SRC = (HERE.parent / "frontend" / "src" / "rom" / "decompiled.ts").read_text(
    encoding="utf-8")

md = capstone.Cs(capstone.CS_ARCH_M68K,
                 capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

HEADS = {lo: hi for lo, hi in FACTS["funcs"]}
CALLERS = {int(k, 16): v for k, v in FACTS.get("callers", {}).items()}
CALLS = {int(k, 16): v for k, v in FACTS.get("calls", {}).items()}
STATED = {int(k, 16) for k in CURATED} | {int(k, 16) for k in MANUAL}
TABLE = {int(m.group(1), 16): m.group(2)
         for m in re.finditer(r"\{ at: (0x[0-9a-f]+), fn: (\w+) as ", SRC)}


def ident(a):
    return IDENT.get("0x%x" % a) or "fn_%05x" % a


def image(a):
    if a < len(UP):
        return UP, a
    if 0x100000 <= a < 0x100000 + len(UPPER):
        return UPPER, a - 0x100000
    return None, 0


def host(a):
    """The routine whose extent contains `a`, if it is an inner entry."""
    for lo, hi in FACTS["funcs"]:
        if lo < a < hi:
            return lo, hi
    return None, None


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 0
    count = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 8
    cap = int(sys.argv[sys.argv.index("--max") + 1]) if "--max" in sys.argv else 10**9
    kind = sys.argv[sys.argv.index("--kind") + 1] if "--kind" in sys.argv else None

    want = []
    for a, name in TABLE.items():
        if a in STATED:
            continue
        is_from = bool(re.search(r"From\d+$", name))
        if kind == "fromn" and not is_from:
            continue
        if kind == "other" and is_from:
            continue
        hi = HEADS.get(a)
        size = (hi - a) if hi else 0
        if size > cap:
            continue
        want.append((len(CALLERS.get(a) or []), size, a, name))
    # Most callers first, then largest: what a reader gains most by reading.
    want.sort(key=lambda r: (-r[0], -r[1], r[2]))

    print(f"{len(want)} routines with a rule-derived name and no stated"
          f" purpose; showing {start}..{start + count}")
    for ncall, size, a, name in want[start:start + count]:
        hi = HEADS.get(a)
        hlo, hhi = (None, None) if hi else host(a)
        callers = [ident(c) for c in (CALLERS.get(a) or [])][:6]
        callees = [ident(c) for c in (CALLS.get(a) or [])][:6]
        print(f"--- 0x{a:05x} {name}"
              + (f" ({size}B)" if hi else
                 f"  [inner entry of 0x{hlo:05x} ({ident(hlo)})]"
                 if hlo else "  [no extent]"))
        if callers:
            print("    from " + ", ".join(callers))
        if callees:
            print("    calls " + ", ".join(callees))
        end = hi if hi else min(a + 120, hhi or a + 120)
        buf, off = image(a)
        if buf is None:
            print("    [outside both program images]")
            continue
        for i in md.disasm(buf[off:off + (end - a)], a):
            print("    %06x  %-9s %s" % (i.address, i.mnemonic, i.op_str))


if __name__ == "__main__":
    main()
