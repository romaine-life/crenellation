"""What slots does the lifter actually bind for this routine, and which are unnamed?

Naming a parameter means writing a slot into `params.curated.json`, and a slot
that the lifter does not bind is rejected - correctly, but only after the fact.
Half the names written in one batch were for registers the routine touches but
does not TAKE: a constant loaded inside the body, an address register the
routine points somewhere itself. Reading the disassembly shows what a register
does; it does not show whether the register arrived.

So ask first. This prints, for each address given, every slot in the DECOMPILED
table with its current name, marking the ones still called after a register or
a stack offset.

    python3 showparams.py 0x2338 0x25f4
"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
SRC = HERE.parent / "frontend" / "src" / "rom" / "decompiled.ts"

FUNC = re.compile(r"^export function (\w+)\(([^)]*)\): void \{$", re.M)
ENTRY = re.compile(
    r"\{ at: (0x[0-9a-f]+), fn: (\w+) as [^,]*, params: \[(.*?)\] \}")
SOURCE = re.compile(
    r"\{ from: 'reg', name: '(\w+)' \}|\{ from: 'stack', off: (-?\d+) \}")
UNNAMED = re.compile(r"^(?:arg\d+|[ad]\d+_?\d*)$")


def main():
    want = {int(a, 16) for a in sys.argv[1:]}
    if not want:
        raise SystemExit(__doc__)
    src = SRC.read_text(encoding="utf-8")
    sig = {m.group(1): m.group(2) for m in FUNC.finditer(src)}
    for m in ENTRY.finditer(src):
        a, fn = int(m.group(1), 16), m.group(2)
        if a not in want:
            continue
        names = [p.strip().split(":")[0].strip()
                 for p in sig.get(fn, "").split(",") if p.strip()]
        slots = SOURCE.findall(m.group(3))
        if len(slots) != len(names):
            print(f"0x{a:05x} {fn}: table and signature disagree")
            continue
        print(f"0x{a:05x} {fn}")
        for (reg, off), name in zip(slots, names):
            slot = reg or f"stack{off}"
            mark = "  <- unnamed" if UNNAMED.match(name.rstrip("_")) else ""
            print(f"    {slot:9} {name}{mark}")


if __name__ == "__main__":
    main()
