"""What each field of the game's structures is, from how the code uses it.

Routine names like `playerStateAccess` are shared by forty-six routines because
"touches player state" is all the evidence said. The distinguishing fact is
which *field* each one touches, and what that field is for - so this walks
every routine, records each access to a known structure by offset, size and
direction, and reports what the code does with it.

The structures and their strides come from the layout the port already relies
on: the board at 0x3E0864, players at 0x3E1968 with a 0x7E stride, motion
objects at 0x3E02D8 with 80, units at 0x3E1BC6 with 0x12.
"""
import json
import pathlib
import re
from collections import defaultdict

from cfg import decode
from decomp import split_ops

HERE = pathlib.Path(__file__).parent

STRUCTS = [
    ("player", 0x3E1968, 0x7E, 3),
    ("mob", 0x3E02D8, 80, 16),
    ("unit", 0x3E1BC6, 0x12, 7),
    ("cell", 0x3E0864, 32, 42),
]

SIZE = {"b": 1, "w": 2, "l": 4}
ADDRS = {f"a{n}" for n in range(8)}


def struct_of(addr):
    """Which structure and field an absolute address names, if any."""
    for name, base, stride, count in STRUCTS:
        if base <= addr < base + stride * count:
            return name, (addr - base) % stride
    return None


def main():
    facts = json.loads((HERE / "out" / "facts.json").read_text())
    funcs = sorted((f["at"] if isinstance(f, dict) else f[0],
                    f["end"] if isinstance(f, dict) else f[1]) for f in facts["funcs"])

    # offset -> what the code does there
    use = defaultdict(lambda: defaultdict(set))
    touch = defaultdict(set)          # routine -> {(struct, offset)}
    for lo, hi in funcs:
        try:
            ins = decode(lo, hi)
        except Exception:             # noqa: BLE001 - a bad extent is not this pass's problem
            continue
        # Which address register currently points into which structure, and at
        # what offset. The ROM loads a base once and then works through it, so
        # the field is the displacement on the register, not an address in the
        # instruction.
        holds = {}
        for i in ins:
            mn = i.mnemonic
            b = mn.split(".")[0]
            size = SIZE.get(mn.rsplit(".", 1)[1], 2) if "." in mn else 2
            ops = split_ops(i.op_str or "")

            for n, tok in enumerate(ops):
                tok = tok.strip()
                how = "write" if n == len(ops) - 1 and len(ops) > 1 else "read"
                m = re.fullmatch(r"\$([0-9a-fA-F]+)\.(w|l)", tok)
                if m:
                    got = struct_of(int(m.group(1), 16))
                    if got:
                        use[got[0]][got[1]].add((size, how, b))
                        touch[lo].add(got)
                    continue
                m = re.fullmatch(r"(-?\$?[0-9a-fA-F]+)?\((a\d)\)(\+)?|-\((a\d)\)", tok)
                if not m:
                    continue
                reg = m.group(2) or m.group(4)
                if reg not in holds:
                    continue
                struct, base = holds[reg]
                disp = 0
                if m.group(1):
                    d = m.group(1)
                    disp = -int(d[2:], 16) if d.startswith("-$") else (
                        int(d[1:], 16) if d.startswith("$") else int(d, 10))
                use[struct][(base + disp) % 0x1000].add((size, how, b))
                touch[lo].add((struct, (base + disp) % 0x1000))

            # Track what the address registers hold afterwards.
            if b in ("lea", "movea") and len(ops) == 2 and ops[1].strip() in ADDRS:
                dst = ops[1].strip()
                m = re.fullmatch(r"\$([0-9a-fA-F]+)\.(w|l)", ops[0].strip())
                got = struct_of(int(m.group(1), 16)) if m else None
                m2 = re.fullmatch(r"(-?\$?[0-9a-fA-F]+)?\((a\d)\)", ops[0].strip())
                if got:
                    holds[dst] = got
                elif b == "lea" and m2 and m2.group(2) in holds:
                    s, o = holds[m2.group(2)]
                    d = m2.group(1) or "0"
                    off = -int(d[2:], 16) if d.startswith("-$") else (
                        int(d[1:], 16) if d.startswith("$") else int(d, 10))
                    holds[dst] = (s, o + off)
                else:
                    holds.pop(dst, None)
            elif ops and ops[-1].strip() in ADDRS:
                holds.pop(ops[-1].strip(), None)

    # What a routine's *parameters* are, taken from its callers. A routine that
    # is always called with a2 pointing at a player has a player as its second
    # argument, whatever the register happens to be called.
    argof = defaultdict(lambda: defaultdict(set))
    for lo, hi in funcs:
        try:
            ins = decode(lo, hi)
        except Exception:                     # noqa: BLE001
            continue
        holds = {}
        for i in ins:
            b = i.mnemonic.split(".")[0]
            ops = split_ops(i.op_str or "")
            if b in ("jsr", "bsr"):
                tok = (ops[0] if ops else "").strip()
                m = re.fullmatch(r"\$([0-9a-fA-F]+)(\.(w|l))?", tok)
                if m:
                    for reg, what in holds.items():
                        argof[int(m.group(1), 16)][reg].add(what[0])
                continue
            if b in ("lea", "movea") and len(ops) == 2 and ops[1].strip() in ADDRS:
                dst = ops[1].strip()
                m = re.fullmatch(r"\$([0-9a-fA-F]+)\.(w|l)", ops[0].strip())
                got = struct_of(int(m.group(1), 16)) if m else None
                if got:
                    holds[dst] = got
                else:
                    holds.pop(dst, None)
            elif ops and ops[-1].strip() in ADDRS:
                holds.pop(ops[-1].strip(), None)

    named = {a: {r: next(iter(v)) for r, v in regs.items() if len(v) == 1}
             for a, regs in argof.items()}
    named = {a: r for a, r in named.items() if r}
    (HERE / "out" / "argnames.json").write_text(json.dumps(
        {hex(a): r for a, r in named.items()}))
    print(f"routines whose callers agree on what a register holds: {len(named)}")
    print(f"  parameters named that way: {sum(len(r) for r in named.values())}")

    lines = []
    for struct, _, _, _ in STRUCTS:
        fields = use[struct]
        if not fields:
            continue
        lines.append(f"{struct}: {len(fields)} distinct offsets")
        for off in sorted(fields):
            what = sorted(fields[off])
            sizes = sorted({s for s, _, _ in what})
            ops = sorted({o for _, _, o in what})
            dirs = sorted({d for _, d, _ in what})
            lines.append(f"  +0x{off:02x}  {'/'.join(map(str, sizes))}B"
                         f"  {','.join(dirs)}  {' '.join(ops[:8])}")
    (HERE / "out" / "fields.txt").write_text("\n".join(lines))
    (HERE / "out" / "fields.json").write_text(json.dumps(
        {"touch": {hex(a): sorted(f"{s}+{o:#x}" for s, o in v) for a, v in touch.items()}}))
    print("\n".join(lines[:1]))
    print(f"routines touching a known structure: {len(touch)}")
    print("wrote out/fields.txt and out/fields.json")


if __name__ == "__main__":
    main()
