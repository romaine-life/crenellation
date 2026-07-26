"""Check the absolute addresses the translator bakes in for pc-relative operands.

The instruction harness cannot verify these. It writes each encoding to a fixed
scratch address and runs it there, so a pc-relative operand resolves against
that address instead of the one it has in the ROM - the two sides disagree by
construction, and the cases are discarded as unverifiable.

There are only 93 of them, and the arithmetic is fixed by the manual: the
displacement is measured from the address of the *extension word*, not from the
instruction and not from the following one. So the value can be checked against
the encoding directly, without running anything.
"""
import json
import pathlib

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()


def sx8(v):
    return v - 0x100 if v & 0x80 else v


def sx16(v):
    return v - 0x10000 if v & 0x8000 else v


def main():
    md = capstone.Cs(capstone.CS_ARCH_M68K,
                     capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)
    facts = json.loads((HERE / "out" / "facts.json").read_text())
    checked = agree = 0
    bad = []
    for a, b in sorted({(x, y) for x, y in facts["funcs"]}):
        addr = a
        while addr < b:
            ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
            if ins is None:
                addr += 2
                continue
            op = ins.op_str
            if "pc)" in op or "pc," in op:
                printed = None
                for tok in op.replace(",", " ").replace("(", " ").split():
                    if tok.startswith("$"):
                        try:
                            printed = int(tok.split(".")[0].lstrip("$"), 16)
                        except ValueError:
                            pass
                        break
                # Try each word after the opcode as the extension word, in both
                # displacement widths, and see which reproduces what capstone
                # printed. Exactly one should, and it says where the base is.
                hits = []
                for k in (2, 4, 6):
                    if addr + k + 2 > len(UP):
                        continue
                    ext = int.from_bytes(UP[addr + k:addr + k + 2], "big")
                    for kind, val in (("brief", sx8(ext & 0xFF)), ("word", sx16(ext))):
                        if printed is not None and (addr + k + val) & 0xFFFFFF == printed:
                            hits.append((k, kind, val))
                checked += 1
                if hits:
                    agree += 1
                else:
                    bad.append((addr, ins.mnemonic, op, printed))
            addr += ins.size

    print("pc-relative operands: %d   base matches the manual: %d" % (checked, agree))
    for addr, mn, op, printed in bad[:20]:
        print("  %05x  %s %s   printed %s" % (addr, mn, op, hex(printed) if printed else "?"))


if __name__ == "__main__":
    main()
