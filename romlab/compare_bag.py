"""Port of the piece-bag builder at 0x59EE, checked against the ROM.

Rampart does not pick a piece at random each time. It builds a **bag**: a
weight list chosen by player kind and level says how many copies of each
rotation group to include, the bag is terminated with 0xFF, and then it is
**riffle shuffled eight times** - four rounds of dest -> scratch -> dest.

Each riffle cuts the bag at `count/4 + random(count/2)` and interleaves the two
halves a byte at a time. The random draw is the already-verified RNG at
0x11E58, so fixing its seed makes the whole thing reproducible.
"""
import pathlib
import re
import struct

HERE = pathlib.Path(__file__).parent
ROM = (HERE / "prog_upper.bin").read_bytes()
KIND_TABLES = {0: 0xFFC8, 1: 0xFFE0}
FIXED = 0xFFF8


def s16(v):
    v &= 0xFFFF
    return v - 0x10000 if v & 0x8000 else v


def s32(v):
    v &= 0xFFFFFFFF
    return v - 0x100000000 if v & 0x80000000 else v


def rng(seed, n):
    """0x11E58, verified."""
    d0 = s16(seed) * 0x3619
    low = (d0 + 0x5D35) & 0xFFFF
    new_seed = low
    d0 = s16(low) * s16(n & 0xFFFF)
    d1 = s32((n & 0xFFFF) << 16) >> 1
    total = (d0 + d1) & 0xFFFFFFFF
    return s16((total >> 16) & 0xFFFF), new_seed


def riffle(count, src, dst, seed):
    d3 = count >> 2
    r, seed = rng(seed, count >> 1)
    d3 = (d3 + r) & 0xFFFFFFFF
    if d3 < 0:
        d3 &= 0xFFFFFFFF
    d2 = count - d3
    i, j, o = 0, d3, 0
    while d3 > 0 or d2 > 0:
        if d3 > 0:
            dst[o] = src[i]; o += 1; i += 1; d3 -= 1
        if d2 > 0:
            dst[o] = src[j]; o += 1; j += 1; d2 -= 1
    return seed


DEST = {0: 0x3E1E76, 1: 0x3E1EA0, 2: 0x3E1ECA}
SCRATCH = 0x3E1EE0
LO, HI = 0x3E1E70, 0x3E1F40


def build(kind, level, seed):
    """The three destination buffers and the shuffle scratch are real addresses
    that OVERLAP: for kind 2 the destination is 0x3E1ECA and the scratch is
    0x3E1EE0, only 22 bytes later, so the shuffle's intermediate copy lands
    inside the bag's own buffer. Modelling flat memory reproduces that instead
    of hiding it."""
    level = min(level, 4)
    if kind in KIND_TABLES:
        ptr = struct.unpack_from(">I", ROM, KIND_TABLES[kind] + level * 4)[0]
    else:
        ptr = FIXED
    mem = bytearray(bytes([0xAA]) * (HI - LO))
    dest = DEST.get(kind, DEST[2]) - LO
    scratch = SCRATCH - LO

    o = dest
    idx = 0
    p = ptr
    while p < len(ROM) and ROM[p] < 0x80:
        for _ in range(ROM[p]):
            mem[o] = idx
            o += 1
        idx += 1
        p += 1
    count = o - dest
    mem[o] = 0xFF

    for _ in range(4):
        seed = riffle_mem(mem, count, dest, scratch, seed)
        seed = riffle_mem(mem, count, scratch, dest, seed)
    return mem[dest:dest + 48], seed


def riffle_mem(mem, count, src, dst, seed):
    d3 = count >> 2
    r, seed = rng(seed, count >> 1)
    d3 = (d3 + r) & 0xFFFFFFFF
    d2 = count - d3
    i, j, o = src, src + d3, dst
    while d3 > 0 or d2 > 0:
        if d3 > 0:
            mem[o] = mem[i]; o += 1; i += 1; d3 -= 1
        if d2 > 0:
            mem[o] = mem[j]; o += 1; j += 1; d2 -= 1
    return seed


ok = bad = 0
for line in (HERE / "out" / "verify18" / "v.log").read_text().splitlines():
    m = re.match(r"^B ([0-9A-F]{4}) (\d) (\d) ([0-9A-F]{4}) ([0-9A-F]+)$", line)
    if not m:
        continue
    seed, kind, level = int(m[1], 16), int(m[2]), int(m[3])
    rom_seed, rom_buf = int(m[4], 16), bytes.fromhex(m[5])
    mine, mseed = build(kind, level, seed)
    if bytes(mine) == rom_buf and mseed == rom_seed:
        ok += 1
    else:
        bad += 1
        if bad <= 4:
            print(f"  seed {seed:04X} kind {kind} level {level}:")
            print(f"     rom  {rom_buf.hex()} seed {rom_seed:04X}")
            print(f"     port {bytes(mine).hex()} seed {mseed:04X}")

print(f"\n{ok} match, {bad} differ")
print("VERIFIED" if bad == 0 else "NOT VERIFIED")
