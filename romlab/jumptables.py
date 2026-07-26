"""Enumerate the targets of pc-relative jump tables.

`jmp $BASE(pc, dN.w)` reads a signed 16-bit offset out of a table and jumps to
BASE plus it. The table is data, so the classifier stops the enclosing function
at it and the code on the far side is never given an entry point. At run time
the port then has no case for the address and the call dies.

The table's length is not stored anywhere. It is bounded by its own contents:
the table cannot run past the first instruction it jumps to, so the lowest
target seen so far is the end of the table.
"""
import json
import pathlib
import re

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
LIMIT = 0x20000
JMPIDX = re.compile(r"^\$([0-9a-fA-F]+)\((?:pc),\s*d\d\.w\)$")


def table_targets(base):
    """Targets reachable from the table at `base`, and where the table ends."""
    targets = []
    end = base + 0x400          # generous upper bound before the contents narrow it
    i = base
    while i < end and i + 2 <= LIMIT:
        off = int.from_bytes(UP[i:i + 2], "big", signed=True)
        t = base + off
        if t < 0 or t >= LIMIT or off == 0:
            break
        # the table stops where the code it points at starts
        end = min(end, t) if t > base else end
        targets.append(t)
        i += 2
    return sorted(set(targets)), i


def main():
    md = capstone.Cs(capstone.CS_ARCH_M68K,
                     capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)
    facts = json.loads((HERE / "out" / "facts.json").read_text())
    funcs = sorted((a, b) for a, b in facts["funcs"])
    starts = {a for a, _ in funcs}

    def covered(addr):
        for a, b in funcs:
            if a <= addr < b:
                return True
        return False

    found = {}
    for a, b in funcs:
        addr = a
        while addr < b:
            ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
            if ins is None:
                addr += 2
                continue
            if ins.mnemonic.startswith("jmp"):
                m = JMPIDX.match(ins.op_str.strip())
                if m:
                    base = int(m.group(1), 16)
                    tg, tend = table_targets(base)
                    if tg:
                        found[base] = (tg, tend, ins.address)
            addr += ins.size

    new = set()
    for base, (tg, tend, site) in sorted(found.items()):
        # a target inside a function is already reachable: the switch has a
        # case for every instruction address in the extent, so dispatch can
        # enter mid-routine. Only targets outside every function need one.
        outside = [t for t in tg if not covered(t)]
        print("%05x  table at %05x..%05x  %d targets, %d needing an entry"
              % (site, base, tend, len(tg), len(outside)))
        new.update(outside)
    print("\njump-table targets needing a function entry: %d" % len(new))
    json.dump(sorted(new), open(HERE / "out" / "jumptargets.json", "w"))


if __name__ == "__main__":
    main()
