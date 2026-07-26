"""Recursive-traversal disassembly of the overlay.

The earlier sweep walked each entry linearly to its first terminator, which
undercounts: a function with branches past its first rts, or code reached only
by a jump, never gets marked. This follows control flow properly - every branch,
call and jump target is queued - starting from the 68000 exception vectors and
every call target found anywhere.

Output is a byte-level map: reached[i] is true for every byte that is part of a
decoded instruction, so anything left over is data by construction.
"""
import json
import pathlib
import struct

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
LIMIT = 0x20000

md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)
md.detail = True

BRANCH = {"bra", "bsr", "beq", "bne", "bcc", "bcs", "bge", "bgt", "ble", "blt",
          "bhi", "bls", "bmi", "bpl", "bvc", "bvs", "jsr", "jmp"}
STOP = {"rts", "rte", "rtr", "jmp", "bra"}
DBCC = {"dbra", "dbf", "dbeq", "dbne", "dbcc", "dbcs", "dbge", "dbgt", "dble",
        "dblt", "dbhi", "dbls", "dbmi", "dbpl", "dbvc", "dbvs", "dbt"}


def seeds():
    s = set()
    # exception vectors: 256 longs at 0x000
    for v in range(1, 256):
        t = struct.unpack_from(">I", UP, v * 4)[0]
        if 0x400 <= t < LIMIT and (t & 1) == 0:
            s.add(t)
    # every call target expressible in the instruction stream
    for i in range(0, LIMIT - 6, 2):
        w = struct.unpack_from(">H", UP, i)[0]
        t = None
        if w in (0x4EB9, 0x4EF9):
            t = struct.unpack_from(">I", UP, i + 2)[0]
        elif w in (0x4EB8, 0x4EF8):
            t = struct.unpack_from(">H", UP, i + 2)[0]
        if t is not None and 0x400 <= t < LIMIT and (t & 1) == 0:
            s.add(t)
    # the event handler table
    for a in range(0x11A80, 0x11B60, 2):
        v = struct.unpack_from(">I", UP, a)[0]
        if 0x400 <= v < LIMIT and (v & 1) == 0:
            s.add(v)
    # every address the CPU was observed executing - the only way to reach code
    # entered through jump tables and stored function pointers
    p = HERE / "out" / "exec" / "e.log"
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                try:
                    v = int(line, 16)
                except ValueError:
                    continue
                if 0x400 <= v < LIMIT and (v & 1) == 0:
                    s.add(v)
    return s


def target_of(ins):
    op = ins.op_str.split(",")[-1].strip()
    if op.startswith("$"):
        tok = op.split(".")[0].lstrip("$")
        try:
            return int(tok, 16)
        except ValueError:
            return None
    return None


def call_targets():
    """Real function entries: exception vectors, call targets, handler table.
    The execution trace is used for coverage, not for entry points - every
    traced address is an instruction, but only a few are function starts."""
    s = set()
    for v in range(1, 256):
        t = struct.unpack_from(">I", UP, v * 4)[0]
        if 0x400 <= t < LIMIT and (t & 1) == 0:
            s.add(t)
    for i in range(0, LIMIT - 6, 2):
        w = struct.unpack_from(">H", UP, i)[0]
        t = None
        if w == 0x4EB9:
            t = struct.unpack_from(">I", UP, i + 2)[0]
        elif w == 0x4EB8:
            t = struct.unpack_from(">H", UP, i + 2)[0]
        elif w == 0x6100:
            t = i + 2 + struct.unpack_from(">h", UP, i + 2)[0]
        elif (w & 0xFF00) == 0x6100 and (w & 0xFF) not in (0x00, 0xFF):
            t = i + 2 + struct.unpack_from(">b", UP, i + 1)[0]
        if t is not None and 0x400 <= t < LIMIT and (t & 1) == 0:
            s.add(t)
    for a in range(0x11A80, 0x11B60, 2):
        v = struct.unpack_from(">I", UP, a)[0]
        if 0x400 <= v < LIMIT and (v & 1) == 0:
            s.add(v)
    return s


def run():
    reached = bytearray(LIMIT)
    entries = call_targets()
    queue = list(seeds())
    seen = set()
    while queue:
        pc = queue.pop()
        if pc in seen or not (0x400 <= pc < LIMIT):
            continue
        seen.add(pc)
        addr = pc
        while 0x400 <= addr < LIMIT:
            if reached[addr]:
                break
            chunk = UP[addr:addr + 16]
            ins = next(md.disasm(chunk, addr, 1), None)
            if ins is None:
                break
            for k in range(ins.size):
                if addr + k < LIMIT:
                    reached[addr + k] = 1
            m = ins.mnemonic
            if m in BRANCH or m in DBCC:
                t = target_of(ins)
                if t is not None and 0x400 <= t < LIMIT and t not in seen:
                    queue.append(t)
                    if m in ("jsr", "bsr"):
                        entries.add(t)
            if m in STOP:
                break
            addr += ins.size
    return reached, entries


if __name__ == "__main__":
    reached, entries = run()
    n = sum(reached)
    print(f"code bytes reached: {n} of {LIMIT} ({100*n/LIMIT:.1f}%)")
    print(f"function entries: {len(entries)}")
    # contiguous code and data runs
    runs = []
    i, cur = 0, reached[0]
    for j in range(1, LIMIT):
        if reached[j] != cur:
            runs.append((i, j, cur))
            i, cur = j, reached[j]
    runs.append((i, LIMIT, cur))
    code = [(a, b) for a, b, c in runs if c]
    data = [(a, b) for a, b, c in runs if not c]
    print(f"code runs: {len(code)}   data runs: {len(data)}")
    print(f"data bytes: {sum(b-a for a,b in data)}")
    print("\nlargest data runs:")
    for a, b in sorted(data, key=lambda r: -(r[1]-r[0]))[:14]:
        print(f"   {a:05X}..{b:05X}  {b-a:6d}")
    json.dump({"entries": sorted(entries),
               "code": [[a, b] for a, b in code],
               "data": [[a, b] for a, b in data]},
              open(HERE / "out" / "codemap2.json", "w"))
