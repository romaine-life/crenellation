"""How far can the capture's program counter be trusted?

The instruction-boundary harness matches a snapshot by the address the capture
recorded. If that address does not mean what it appears to, every match built
on it is worth less than it looks - and the piece walker turned up one case
where the recorded address and the register contents cannot both be right.

This measures it. For a routine whose first N instructions are straight line -
no branch, no call, nothing that could take another path - the address after N
instructions is fixed and can be computed from the disassembly. Comparing that
against what the capture recorded says how often, and by how much, the two
disagree.
"""
import collections
import json
import pathlib

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
LOG = HERE.parent / "frontend" / "src" / "rom" / "stepstate.log"
FLOW = {"bra", "beq", "bne", "bcs", "bcc", "bmi", "bpl", "bvs", "bvc", "blt",
        "bge", "ble", "bgt", "bls", "bhi", "bsr", "jsr", "jmp", "rts", "rte",
        "rtr", "trap", "stop", "dbra", "dbf", "dbeq", "dbne", "dbcs", "dbcc",
        "dbmi", "dbpl", "dblt", "dbge", "dble", "dbgt", "dbls", "dbhi", "dbt"}


def main():
    md = capstone.Cs(capstone.CS_ARCH_M68K,
                     capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

    # address after n straight-line instructions, or None if flow leaves it
    def after(entry, n):
        addr = entry
        for _ in range(n):
            ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
            if ins is None or ins.mnemonic.split(".")[0] in FLOW:
                return None
            addr += ins.size
        return addr

    diffs = collections.Counter()
    checked = 0
    for line in LOG.read_text().splitlines():
        p = line.split()
        if not p or p[0] != "S":
            continue
        entry, steps, pc = int(p[1], 16), int(p[3]), int(p[4], 16)
        if steps > 6:
            continue                      # keep the straight-line window short
        want = after(entry, steps)
        if want is None:
            continue
        checked += 1
        # how many instructions the recorded address is away from the computed
        # one, positive meaning the capture is further along
        # walk forward from the computed address, and forward from the
        # recorded one, so the offset is measured in either direction
        def steps_between(lo, hi):
            a, k = lo, 0
            while a < hi and k < 8:
                ins = next(md.disasm(UP[a:a + 16], a, 1), None)
                if ins is None:
                    return None
                a += ins.size
                k += 1
            return k if a == hi else None

        if pc == want:
            diffs[0] += 1
        else:
            fwd = steps_between(want, pc)
            back = steps_between(pc, want)
            if fwd is not None:
                diffs[fwd] += 1
            elif back is not None:
                diffs[-back] += 1
            else:
                diffs["elsewhere"] += 1

    print("straight-line snapshots checked: %d" % checked)
    for k, n in sorted(diffs.items(), key=lambda kv: -kv[1]):
        label = ("exactly where the count says" if k == 0
                 else "%d instructions further on" % k if isinstance(k, int) and k > 0
                 else "%d instructions short" % -k if isinstance(k, int)
                 else "not on the straight-line path at all")
        print("   %5d  %s" % (n, label))


if __name__ == "__main__":
    main()
