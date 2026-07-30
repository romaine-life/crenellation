"""What tells two routines with the same name apart.

`name_all.py` names a routine for the *region* it touches, so forty-two
routines that read the player structs are all called "player state access".
That is true and useless: it is a name for a region, not for a routine.

The distinguishing fact is one level finer and already sits in the
disassembly - *which field* of the struct, which slot of the table, which
register of the chip. This extracts it. It does not invent names: it prints,
for every routine in a colliding group, the evidence a person needs to name
it, so naming six hundred routines is six hundred short reads instead of six
hundred disassemblies.

    python3 distinguish.py                  # every colliding group
    python3 distinguish.py playerStateAccess   # one group
    python3 distinguish.py 0x1a2b4          # one routine

Fields are the displacements in `d(An)` operands, which is how a 68000
addresses a struct; slots are absolute addresses landing inside a known
region, reported as base+offset.
"""
import json
import pathlib
import re
import sys
from collections import Counter

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
FACTS = json.loads((HERE / "out" / "facts.json").read_text())
IDENT = json.loads((HERE / "out" / "idents.json").read_text())
NAMES = json.loads((HERE / "out" / "names.json").read_text())
NAMES = NAMES.get("names", NAMES)
md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

FUNCS = {a: b for a, b in FACTS["funcs"]}
CALLERS = {int(k, 16): v for k, v in FACTS["callers"].items()}
CALLS = {int(k, 16): v for k, v in FACTS["calls"].items()}

# Same table describe.py uses. A routine is named for the region it touches;
# the offset inside the region is what this file is for.
HW = [
    (0x200000, 0x21FFFF, "framebuffer"),
    (0x3C0000, 0x3C07FF, "palette"),
    (0x460000, 0x460FFF, "oki"),
    (0x480000, 0x499FFF, "ym"),
    (0x3E0864, 0x3E0DA4, "board"),
    (0x3E1968, 0x3E1AE2, "player"),
    (0x3E02D8, 0x3E0778, "entity"),
    (0x3E1CF4, 0x3E1D60, "eventq"),
    (0x3E1BC6, 0x3E1C2C, "unit"),
    (0x3E0F48, 0x3E15AC, "shots"),
]

# Strides, so a slot can be reported as "player 1, field 0x1c" rather than as
# an address. Measured from the region sizes and the player count, not
# assumed: 0x17a bytes over three players is 0x7e each.
STRIDE = {"player": 0x7E, "entity": 0x1A, "unit": 0x0E, "shots": 0x1C}

# Displacements off a7 are stack frame, not struct fields, and saying so for
# every routine drowns the fields that matter.
FRAME = re.compile(r"\(a7|sp\)")
DISP = re.compile(r"(-?(?:0x[0-9a-f]+|\d+))\((a[0-7])\)")
ABS = re.compile(r"0x([0-9a-f]{4,8})")


def region(addr):
    for lo, hi, name in HW:
        if lo <= addr <= hi:
            return name, lo
    return None, 0


def evidence(a):
    """Everything about routine `a` that could tell it from its namesakes."""
    end = FUNCS.get(a, a)
    fields = Counter()      # d(An) displacements: struct field offsets
    slots = Counter()       # absolute addresses inside a known region
    consts = Counter()      # immediates, which name magic numbers
    mnem = Counter()
    at = a
    while at < end:
        ins = next(md.disasm(UP[at:at + 16], at, 1), None)
        if ins is None:
            at += 2
            continue
        mnem[ins.mnemonic] += 1
        text = ins.op_str
        for disp, reg in DISP.findall(text):
            if reg == "a7":
                continue
            fields[int(disp, 16) if disp.startswith(("0x", "-0x")) else int(disp)] += 1
        for m in ABS.findall(text):
            v = int(m, 16)
            r, base = region(v)
            if r:
                slots[(r, v - base)] += 1
        for m in re.findall(r"#(?:0x([0-9a-f]+)|(\d+))", text):
            v = int(m[0], 16) if m[0] else int(m[1])
            if v > 8:
                consts[v] += 1
        at += ins.size
    return {"size": end - a, "fields": fields, "slots": slots,
            "consts": consts, "mnem": mnem}


def slotword(r, off):
    s = STRIDE.get(r)
    if not s:
        return f"{r}+0x{off:x}"
    return f"{r}[{off // s}]+0x{off % s:x}"


def line(a):
    e = evidence(a)
    bits = [f"0x{a:05x}", f"{e['size']:4}B"]
    if e["fields"]:
        bits.append("fields " + ",".join(
            f"0x{f:x}" if f >= 0 else f"-0x{-f:x}"
            for f, _ in e["fields"].most_common(6)))
    if e["slots"]:
        bits.append("slots " + ",".join(
            slotword(r, o) for (r, o), _ in e["slots"].most_common(4)))
    if e["consts"]:
        bits.append("consts " + ",".join(
            f"0x{c:x}" for c, _ in e["consts"].most_common(4)))
    callers = CALLERS.get(a) or []
    if callers:
        named = [IDENT["idents"].get(hex(c), hex(c)) for c in callers[:3]]
        bits.append("from " + ",".join(named))
    callees = CALLS.get(a) or []
    if callees:
        named = [IDENT["idents"].get(hex(c), hex(c)) for c in callees[:3]]
        bits.append("calls " + ",".join(named))
    d = NAMES.get(hex(a))
    if d:
        bits.append(f'"{d}"')
    return "  " + "  ".join(bits)


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    if arg and arg.startswith("0x"):
        print(line(int(arg, 16)))
        return
    groups = IDENT["collisions"]
    if arg:
        groups = {k: v for k, v in groups.items() if k == arg}
        if not groups:
            print(f"no colliding group named {arg}")
            return
    else:
        # The unnamed have no group, and they need this as much. Give them one.
        groups = dict(groups)
        if IDENT["unnamed"]:
            groups["(no stated purpose)"] = IDENT["unnamed"]
    for name, members in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        print(f"\n{name}  ({len(members)})")
        for h in sorted(members, key=lambda x: int(x, 16)):
            print(line(int(h, 16)))


if __name__ == "__main__":
    main()
