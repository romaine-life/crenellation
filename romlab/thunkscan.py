"""Find who reaches the jmp-thunk tables at 0x118-0x284.

A search for 32-bit absolute call targets misses these entirely, because a
target under 0x8000 is reachable with absolute-short addressing and capstone
prints it with a .w suffix. That is the same blind spot that made an earlier
pass report a routine as having no callers when it had four.
"""
import collections
import pathlib
import re

import capstone

ROM = pathlib.Path(__file__).parent.parent / "frontend" / "src" / "rom" / "rom.bin"
LO, HI = 0x118, 0x284
TARGET = re.compile(r"^\$([0-9a-fA-F]+)(?:\.[wl])?$")


def main():
    rom = ROM.read_bytes()
    md = capstone.Cs(capstone.CS_ARCH_M68K,
                     capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)
    hits = collections.Counter()
    where = collections.defaultdict(list)
    a = 0x430
    while a < len(rom):
        ins = next(md.disasm(rom[a:a + 10], a, 1), None)
        if ins is None:
            a += 2
            continue
        if ins.mnemonic in ("jsr", "bsr", "jmp"):
            m = TARGET.match(ins.op_str.strip())
            if m:
                t = int(m.group(1), 16)
                if LO <= t < HI:
                    hits[t] += 1
                    if len(where[t]) < 3:
                        where[t].append("%05x" % ins.address)
        a += ins.size
    print("thunks reached by a direct call: %d   call sites: %d"
          % (len(hits), sum(hits.values())))
    for t, n in hits.most_common(10):
        print("  %05x  called %d times, e.g. from %s" % (t, n, ", ".join(where[t])))

    # also look for the thunk addresses appearing as data, which is how a
    # pointer table would reach them
    asdata = collections.Counter()
    for a in range(0, len(rom) - 4, 2):
        v = int.from_bytes(rom[a:a + 4], "big")
        if LO <= v < HI:
            asdata[v] += 1
    print("thunk addresses appearing as 32-bit data: %d distinct, %d places"
          % (len(asdata), sum(asdata.values())))


if __name__ == "__main__":
    main()
