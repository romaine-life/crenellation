"""List the distinct instruction encodings the program actually contains.

The list is built by walking the functions, not the whole overlay. Sweeping the
overlay linearly picks up text and tables as if they were code: the ASCII bytes
`"1111 EXC"` from the exception-message strings disassemble as a 68020
memory-indirect form the 68000 does not even have, and it then sits in the
results forever as one instruction that cannot be reproduced. Data belongs in
the data map, not in a list of instructions to verify.
"""
import json
import pathlib

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
OUT = HERE / "out" / "insn" / "encodings.txt"


def main():
    facts = json.loads((HERE / "out" / "facts.json").read_text())
    funcs = sorted({(a, b) for a, b in facts["funcs"]})
    md = capstone.Cs(capstone.CS_ARCH_M68K,
                     capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

    seen = {}
    for a, b in funcs:
        addr = a
        while addr < b:
            ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
            if ins is None:
                addr += 2
                continue
            hexs = UP[addr:addr + ins.size].hex().upper()
            # `jsr <print>; dc.b "MESSAGE",0` puts the string inline, in the
            # instruction stream. The exception stubs are all written this way
            # ("ADDRESS ERR", "RUNNING INTO VECS"), and disassembling the text
            # invents instructions the 68000 does not have.
            if ins.mnemonic.split(".")[0] in ("jsr", "bsr"):
                s = addr + ins.size
                # the string is bounded by its own terminator, not by the
                # function: several of these extents stop part-way through one
                k = s
                while k < len(UP) and k - s < 64 and 0x20 <= UP[k] < 0x7F:
                    k += 1
                if k - s >= 4 and k < len(UP) and UP[k] == 0:
                    addr = (k + 2) & ~1
                    continue
            # Writing the status register unmasks interrupts. The case then
            # measures the game's interrupt handler - which runs and writes
            # memory before the instruction under test is even finished -
            # rather than the instruction. There is no way to hold the machine
            # still for these, so they are not claimed as verified.
            writes_sr = ins.op_str.strip().endswith(", sr") or ins.op_str.strip() == "sr"
            # Branches and calls encode an absolute or relative target, so the
            # same encoding means something different at another address. They
            # are verified by the routine-level tests instead.
            if ins.mnemonic.split(".")[0] not in SKIP and not writes_sr:
                seen.setdefault(hexs, "%s %s" % (ins.mnemonic, ins.op_str))
            addr += ins.size

    lines = ["%s  %s" % (k, v) for k, v in sorted(seen.items())]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n")
    print("distinct encodings inside functions: %d -> %s" % (len(lines), OUT))


SKIP = {"bra", "beq", "bne", "bcs", "bcc", "bmi", "bpl", "bvs", "bvc", "blt",
        "bge", "ble", "bgt", "bls", "bhi", "bsr", "jsr", "jmp",
        "dbra", "dbf", "dbeq", "dbne", "dbcs", "dbcc", "dbmi", "dbpl",
        "dblt", "dbge", "dble", "dbgt", "dbls", "dbhi", "dbt", "rts", "rte",
        "rtr", "trap", "stop", "reset"}

if __name__ == "__main__":
    main()
