"""Find executable code the classifier filed as data.

A byte can be accounted for and still be accounted for wrongly. The coverage
figure counts every byte as code or data, but a jump table read as data is
never ported, and every call through it dies at run time with no routine
covering the address. This looks for the opposite of a coverage hole: targets
of real calls and jumps that land outside every known function.

Absolute-short addressing matters here. A target below 0x8000 is printed with a
.w suffix, and a scan that only accepts .l silently misses exactly the low
addresses these tables live at.
"""
import collections
import json
import pathlib
import re

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
LIMIT = 0x20000
TARGET = re.compile(r"^\$([0-9a-fA-F]+)(?:\.[wl])?$")


def main():
    facts = json.loads((HERE / "out" / "facts.json").read_text())
    funcs = sorted((a, b) for a, b in facts["funcs"])
    md = capstone.Cs(capstone.CS_ARCH_M68K,
                     capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

    def covered(addr):
        for a, b in funcs:
            if a <= addr < b:
                return True
        return False

    targets = collections.Counter()
    where = collections.defaultdict(list)
    for a, b in funcs:
        addr = a
        while addr < b:
            ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
            if ins is None:
                addr += 2
                continue
            if ins.mnemonic in ("jsr", "bsr", "jmp"):
                m = TARGET.match(ins.op_str.strip())
                if m:
                    t = int(m.group(1), 16)
                    if t < LIMIT and not covered(t):
                        targets[t] += 1
                        if len(where[t]) < 3:
                            where[t].append("%05x" % ins.address)
            addr += ins.size

    print("call or jump targets outside every function: %d distinct, %d sites"
          % (len(targets), sum(targets.values())))
    for t, n in sorted(targets.items()):
        ins = next(md.disasm(UP[t:t + 16], t, 1), None)
        text = "%s %s" % (ins.mnemonic, ins.op_str) if ins else "??"
        print("  %05x  %2d sites  %-28s from %s" % (t, n, text, ", ".join(where[t])))
    json.dump(sorted(targets), open(HERE / "out" / "codeindata.json", "w"))


if __name__ == "__main__":
    main()
