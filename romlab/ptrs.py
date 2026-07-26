"""Find pointer tables indexing the big compressed data region.

Level/asset blobs are almost always reached through a table of 32-bit
pointers. Look for runs of increasing longwords that land inside the data
region, then disassemble around whoever references the table.
"""
import pathlib
import struct

import capstone

HERE = pathlib.Path(__file__).parent
data = (HERE / "prog_main.bin").read_bytes()
DATA_LO, DATA_HI = 0x053000, 0x0FF000
MIN_RUN = 6

print("=== pointer-table candidates ===")
tables = []
off = 0
while off < len(data) - 4:
    val = struct.unpack_from(">I", data, off)[0]
    if not (DATA_LO <= val < DATA_HI):
        off += 2
        continue
    run = [val]
    p = off + 4
    while p < len(data) - 4:
        nxt = struct.unpack_from(">I", data, p)[0]
        if DATA_LO <= nxt < DATA_HI and nxt >= run[-1]:
            run.append(nxt)
            p += 4
        else:
            break
    if len(run) >= MIN_RUN:
        tables.append((off, run))
        off = p
    else:
        off += 2

tables.sort(key=lambda t: len(t[1]), reverse=True)
for addr, run in tables[:10]:
    span = run[-1] - run[0]
    print(f"  table @ {addr:#08x}: {len(run):>4d} pointers, {run[0]:#08x}..{run[-1]:#08x} (span {span // 1024} KB)")
    deltas = [run[i + 1] - run[i] for i in range(min(6, len(run) - 1))]
    print(f"      first entries: {[hex(v) for v in run[:6]]}")
    print(f"      deltas: {deltas}")

if not tables:
    print("  none found")
    raise SystemExit

# Who loads the biggest table? Disassemble code blocks looking for its address.
best_addr = tables[0][0]
print(f"\n=== references to the largest table ({best_addr:#08x}) ===")
needle = struct.pack(">I", best_addr)
hits = [i for i in range(0, len(data) - 4, 2) if data[i : i + 4] == needle]
print(f"  {len(hits)} raw address matches: {[hex(h) for h in hits[:8]]}")

md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)
for hit in hits[:3]:
    start = max(0, hit - 24)
    print(f"\n  --- context around {hit:#08x} ---")
    for insn in md.disasm(data[start : hit + 24], start):
        mark = "  <<<" if insn.address <= hit < insn.address + insn.size else ""
        print(f"    {insn.address:06x}  {insn.mnemonic:10s} {insn.op_str}{mark}")
