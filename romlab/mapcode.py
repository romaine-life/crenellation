"""Build a function map of the program: boundaries, call graph, data refs.

Ad-hoc memory probing keeps landing on library and hardware code. A structural
map is the thing that makes "which routine implements X" answerable: functions
are recovered from call targets, and each is summarised by what it calls, what
absolute addresses it touches, and how big it is.

Strategy: seed from every jsr/bsr target found by a linear sweep, then
disassemble each seed until RTS/RTE/JMP, recording references.
"""
import json
import pathlib
import struct
from collections import defaultdict

import capstone

HERE = pathlib.Path(__file__).parent
UPPER = (HERE / "prog_upper.bin").read_bytes()   # overlay: CPU 0x00000-0x1FFFF
MAIN = (HERE / "prog_main.bin").read_bytes()     # full image; above 0x20000 is authoritative

md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)
md.detail = True


def byte_at(addr: int) -> int:
    if addr < len(UPPER):
        return UPPER[addr]
    return MAIN[addr] if addr < len(MAIN) else 0


def code_bytes(addr: int, length: int) -> bytes:
    src = UPPER if addr < len(UPPER) else MAIN
    return src[addr : addr + length]


def find_call_targets():
    """Linear sweep for jsr/bsr with absolute or pc-relative targets."""
    targets = set()
    sites = defaultdict(list)
    for base, blob, limit in ((0, UPPER, len(UPPER)), (0x20000, MAIN, len(MAIN))):
        for i in range(base, limit - 6, 2):
            b = blob if base == 0 else MAIN
            off = i
            if off + 6 > len(b):
                break
            w = struct.unpack_from(">H", b, off)[0]
            if w == 0x4EB9:  # jsr abs.l
                t = struct.unpack_from(">I", b, off + 2)[0]
                if t < 0x100000:
                    targets.add(t)
                    sites[t].append(off)
            elif w == 0x6100:  # bsr.w
                d = struct.unpack_from(">h", b, off + 2)[0]
                t = off + 2 + d
                if 0 <= t < 0x100000:
                    targets.add(t)
                    sites[t].append(off)
            elif (w & 0xFF00) == 0x6100 and (w & 0x00FF) not in (0x00, 0xFF):  # bsr.b
                d = struct.unpack_from(">b", b, off + 1)[0]
                t = off + 2 + d
                if 0 <= t < 0x100000:
                    targets.add(t)
                    sites[t].append(off)
    return targets, sites


def walk_function(entry: int, max_len: int = 0x800):
    """Disassemble from entry to the first terminator; collect references."""
    calls, data_refs = set(), set()
    size = 0
    ok = True
    for ins in md.disasm(code_bytes(entry, max_len), entry):
        size = ins.address + ins.size - entry
        m = ins.mnemonic
        if m in ("jsr", "bsr"):
            op = ins.op_str
            if op.startswith("$"):
                try:
                    calls.add(int(op.split(".")[0].lstrip("$"), 16))
                except ValueError:
                    pass
        # absolute long addresses that look like RAM or ROM data
        for tok in ins.op_str.replace(",", " ").split():
            if tok.startswith("$") and tok.endswith(".l"):
                try:
                    v = int(tok[1:-2], 16)
                except ValueError:
                    continue
                if 0x3E0000 <= v <= 0x3EFFFF or 0x20000 <= v < 0x100000 or 0x200000 <= v <= 0x21FFFF:
                    data_refs.add(v)
        if m in ("rts", "rte", "rtr"):
            break
        if size > max_len - 8:
            ok = False
            break
    return {"size": size, "calls": sorted(calls), "data": sorted(data_refs), "clean": ok}


if __name__ == "__main__":
    targets, sites = find_call_targets()
    print(f"call targets discovered: {len(targets)}")

    funcs = {}
    for t in sorted(targets):
        info = walk_function(t)
        if info["size"] < 4:
            continue
        info["callers"] = len(sites[t])
        funcs[t] = info

    print(f"functions mapped: {len(funcs)}")
    out = HERE / "out" / "codemap.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({hex(k): v for k, v in funcs.items()}, indent=1))

    # Functions touching the framebuffer or the known score words are the
    # interesting ones for game logic.
    def touches(f, lo, hi):
        return any(lo <= d <= hi for d in f["data"])

    print("\nfunctions referencing the framebuffer (0x200000-0x21FFFF):")
    for a, f in sorted(funcs.items()):
        if touches(f, 0x200000, 0x21FFFF):
            print(f"  {a:#08x} size {f['size']:5d} callers {f['callers']:3d} calls {len(f['calls'])}")

    print("\nfunctions referencing work RAM near the score words (0x3E2000-0x3E2200):")
    for a, f in sorted(funcs.items()):
        if touches(f, 0x3E2000, 0x3E2200):
            print(f"  {a:#08x} size {f['size']:5d} callers {f['callers']:3d} data {[hex(d) for d in f['data'][:6]]}")
