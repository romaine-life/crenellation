"""Which registers each instruction writes.

A snapshot taken from inside a memory tap can be from part-way through an
instruction: `move.b (a1)+, (a0)+` caught with a1 incremented and a0 not. The
port executes instructions atomically and can never reproduce that, so those
snapshots are not evidence about the translation - but they look exactly like a
failure.

They can be told apart without changing the capture. If the port's state at the
recorded address differs from the chip's *only* in registers that the
instruction at that address writes, the chip was part-way through it. If
anything else differs, it is a real divergence.
"""
import json
import pathlib

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
OUT = HERE.parent / "frontend" / "src" / "rom" / "written-regs.json"
NAMES = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7",
         "a0", "a1", "a2", "a3", "a4", "a5", "a6"]


def main():
    facts = json.loads((HERE / "out" / "facts.json").read_text())
    funcs = sorted({(a, b) for a, b in facts["funcs"]})
    md = capstone.Cs(capstone.CS_ARCH_M68K,
                     capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)
    md.detail = True

    out = {}
    for a, b in funcs:
        addr = a
        while addr < b:
            ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
            if ins is None:
                addr += 2
                continue
            try:
                _, written = ins.regs_access()
            except Exception:
                written = []
            names = set()
            for r in written:
                n = ins.reg_name(r)
                if n in NAMES:
                    names.add(n)
            # capstone's register-access data is thin for this architecture, so
            # the destination is taken from the text as well: for almost every
            # 68000 instruction it is the last operand.
            ops = [o.strip() for o in (ins.op_str or "").split(",")]
            mn = ins.mnemonic.split(".")[0]
            if ops and mn not in ("cmp", "cmpi", "cmpa", "cmpm", "tst", "btst",
                                  "jmp", "jsr", "bsr", "pea", "nop", "rts"):
                last = ops[-1]
                if len(last) == 2 and last[0] in "da" and last[1].isdigit():
                    names.add(last)
            # capstone does not report the side effect of an auto-increment or
            # auto-decrement operand, so take those from the text
            for tok in (ins.op_str or "").replace(",", " ").split():
                t = tok.strip()
                if t.startswith("-(") and t.endswith(")"):
                    n = t[2:-1]
                    if n in NAMES:
                        names.add(n)
                if t.startswith("(") and t.endswith(")+"):
                    n = t[1:-2]
                    if n in NAMES:
                        names.add(n)
            if names:
                out["%x" % addr] = sorted(names)
            addr += ins.size

    OUT.write_text(json.dumps(out))
    print("instructions with a register write: %d -> %s" % (len(out), OUT))


if __name__ == "__main__":
    main()
