"""Dump the curated names that carry no recorded evidence, for reading.

`names.curated.json` takes two forms: a bare string, which is only the name,
and `{"name": ..., "why": ...}`, which is the name and the instructions it was
read from. `idents.py` refuses an object with no `why` and `names.test.ts`
asserts the same - but a bare STRING slips past both, so the requirement that
every name be backed by evidence has a hole exactly the width of the older
form. 71 entries are bare strings; 17 of those have their evidence in
`manual_names.json`, which stores `[name, why]` pairs, and 54 have none
anywhere.

This prints those 54 the way `readsmall.py` prints unnamed routines - callers,
callees and the disassembly at the routine's real extent from `facts.json`,
never a truncated dump, because `decode(lo, lo+90)` cuts the last instruction
and capstone then reports a different one entirely.

    python3 readunevidenced.py [from] [count]
"""
import json
import pathlib
import sys

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_ext.bin").read_bytes()
UPPER = (HERE / "prog_upper.bin").read_bytes()
FACTS = json.loads((HERE / "out" / "facts.json").read_text())
IDENT = json.loads((HERE / "out" / "idents.json").read_text())["idents"]
CURATED = json.loads((HERE / "names.curated.json").read_text())
MANUAL = json.loads((HERE / "manual_names.json").read_text())

md = capstone.Cs(capstone.CS_ARCH_M68K,
                 capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

HEADS = {lo: hi for lo, hi in FACTS["funcs"]}
CALLERS = {int(k, 16): v for k, v in FACTS.get("callers", {}).items()}
CALLS = {int(k, 16): v for k, v in FACTS.get("calls", {}).items()}


def ident(a):
    return IDENT.get("0x%x" % a) or "fn_%05x" % a


def image(a):
    """Which image the address is in, and its offset there."""
    if a < len(UP):
        return UP, a
    if 0x100000 <= a < 0x100000 + len(UPPER):
        return UPPER, a - 0x100000
    return None, 0


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 10

    want = [k for k, v in CURATED.items()
            if isinstance(v, str) and k not in MANUAL]
    want.sort(key=lambda k: int(k, 16))
    print(f"{len(want)} curated names with no recorded evidence;"
          f" showing {start}..{start + count}")
    for k in want[start:start + count]:
        a = int(k, 16)
        hi = HEADS.get(a)
        callers = [ident(c) for c in (CALLERS.get(a) or [])][:6]
        callees = [ident(c) for c in (CALLS.get(a) or [])][:6]
        print(f"--- {k} \"{CURATED[k]}\""
              + (f" ({hi - a}B)" if hi else "  [no extent in facts.json]"))
        if callers:
            print("    from " + ", ".join(callers))
        if callees:
            print("    calls " + ", ".join(callees))
        if not hi:
            continue
        buf, off = image(a)
        if buf is None:
            print("    [outside both program images]")
            continue
        for i in md.disasm(buf[off:off + (hi - a)], a):
            print("    %06x  %-9s %s" % (i.address, i.mnemonic, i.op_str))


if __name__ == "__main__":
    main()
