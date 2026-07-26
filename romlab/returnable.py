"""How many of the never-exercised routines could return at all.

Both harnesses judge a routine by calling it and waiting for it to come back to
a sentinel return address. A routine with no `rts` anywhere in it never does -
it ends by jumping into something else, or it is a loop the game only leaves by
interrupt. Calling those in isolation cannot produce a result no matter what
arguments they are given, so they are a different thing from a routine that
merely has not been reached yet, and the two should not be reported as one
number.
"""
import json
import pathlib

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
VERIFIED = HERE.parent / "frontend" / "src" / "rom" / "verified.json"


def main():
    facts = json.loads((HERE / "out" / "facts.json").read_text())
    ext = {a: b for a, b in facts["funcs"]}
    never = json.loads(VERIFIED.read_text())["neverExercised"]
    md = capstone.Cs(capstone.CS_ARCH_M68K,
                     capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

    no_rts = []
    has_rts = []
    for a in never:
        b = ext.get(a, a + 16)
        found = False
        addr = a
        while addr < b:
            ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
            if ins is None:
                addr += 2
                continue
            if ins.mnemonic.split(".")[0] in ("rts", "rte", "rtr"):
                found = True
                break
            addr += ins.size
        (has_rts if found else no_rts).append(a)

    print("never exercised: %d" % len(never))
    print("  cannot return - no rts in the routine at all : %d" % len(no_rts))
    print("  has an rts, so the arguments never reached it: %d" % len(has_rts))
    json.dump({"noReturn": no_rts, "couldReturn": has_rts},
              open(HERE / "out" / "returnable.json", "w"))


if __name__ == "__main__":
    main()
