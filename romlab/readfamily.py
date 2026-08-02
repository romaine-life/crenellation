"""Everything needed to name one family's parameters, in one call.

`showparams.py` says which slots are bound and `readsmall.py` prints a routine,
but naming a family means having both at once plus the family's OWN extent -
and getting the extent wrong is the mistake that costs the most here, because
`decode(lo, lo+90)` cuts the last instruction and capstone then reports a
different one entirely. This takes the extent from facts.json, prints the
disassembly, and for every register still called after itself lists the
instructions that mention it, which is the question naming actually asks.

    python3 readfamily.py 0x6460 [--full]

Without `--full` the disassembly is elided to the lines that touch an unnamed
register, which is usually the whole of what a reading needs and is short
enough to hold. The per-register digest is always printed.
"""
import json
import pathlib
import re
import sys

import capstone

HERE = pathlib.Path(__file__).parent
SRC = HERE.parent / "frontend" / "src" / "rom" / "decompiled.ts"
IMAGE = HERE / "prog_ext.bin"
FACTS = HERE / "out" / "facts.json"

FUNC = re.compile(r"^export function (\w+)\(([^)]*)\): void \{$", re.M)
ENTRY = re.compile(
    r"\{ at: (0x[0-9a-f]+), fn: (\w+) as [^,]*, params: \[(.*?)\] \}")
SOURCE = re.compile(
    r"\{ from: 'reg', name: '(\w+)' \}|\{ from: 'stack', off: (-?\d+) \}")
UNNAMED = re.compile(r"^(?:arg\d+|[ad]\d+_?\d*)$")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        raise SystemExit(__doc__)
    host = int(args[0], 16)
    full = "--full" in sys.argv

    funcs = json.loads(FACTS.read_text())["funcs"]
    lo, hi = next(((a, b) for a, b in funcs if a == host), (None, None))
    if lo is None:
        raise SystemExit(f"0x{host:05x} is not a routine head in facts.json")

    src = SRC.read_text(encoding="utf-8")
    sig = {m.group(1): m.group(2) for m in FUNC.finditer(src)}
    slots, unnamed = {}, set()
    for m in ENTRY.finditer(src):
        a, fn = int(m.group(1), 16), m.group(2)
        if not (a == host or lo < a < hi):
            continue
        names = [p.strip().split(":")[0].strip()
                 for p in sig.get(fn, "").split(",") if p.strip()]
        s = SOURCE.findall(m.group(3))
        if len(s) != len(names):
            continue
        here = {}
        for (reg, off), name in zip(s, names):
            key = reg or f"stack{off}"
            here[key] = name
            if UNNAMED.match(name.rstrip("_")):
                unnamed.add(key)
        slots[a] = (fn, here)

    print(f"0x{lo:05x}..0x{hi:05x}  ({hi - lo} bytes, {len(slots)} entries)")
    for a, (fn, here) in sorted(slots.items()):
        marks = [f"{k}={v}" + ("*" if UNNAMED.match(v.rstrip("_")) else "")
                 for k, v in here.items()]
        print(f"  0x{a:05x} {fn}")
        print("      " + "  ".join(marks))
    print(f"\nunnamed slots across the family: "
          f"{', '.join(sorted(unnamed)) or 'none'}\n")

    image = IMAGE.read_bytes()
    md = capstone.Cs(capstone.CS_ARCH_M68K,
                     capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)
    regs = {k for k in unnamed if re.match(r"^[ad]\d$", k)}
    per = {r: [] for r in regs}
    lines, elided = [], 0
    for i in md.disasm(image[lo:hi], lo):
        text = f"  {i.address:06x}  {i.mnemonic:<9} {i.op_str}"
        touched = [r for r in regs if r in i.op_str]
        for r in touched:
            per[r].append(text)
        if full or touched:
            if elided:
                lines.append(f"       ... {elided} lines")
                elided = 0
            lines.append(text)
        else:
            elided += 1
    if elided:
        lines.append(f"       ... {elided} lines")
    print("\n".join(lines))

    print()
    for r in sorted(per):
        print(f"=== {r}: {len(per[r])} instructions")
        for t in per[r][:14]:
            print(t)
        if len(per[r]) > 14:
            print(f"       ... {len(per[r]) - 14} more")


if __name__ == "__main__":
    main()
