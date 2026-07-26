"""Complete function map of the overlay - every function, not just call targets.

mapcode.py seeded from call sites, which misses anything reached only through a
jump table or a stored pointer. This sweeps the whole overlay: it seeds from
call targets AND from the event handler table AND from every address that looks
like a function entry, then walks each to its terminator and records size,
callers, callees, data references and which known systems it touches.
"""
import json
import pathlib
import struct
from collections import defaultdict

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
LIMIT = 0x20000

md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

KNOWN = {
    0x11F2A: "graphics decompressor", 0x124BE: "terrain painter", 0x11FF8: "block recolour",
    0x1217E: "rect palette remap", 0x11E10: "screen dissolve", 0x11E58: "RNG",
    0x11BD8: "cell address", 0x11BEC: "screen address", 0x11D5C: "distance",
    0x11CF8: "aiming direction", 0xBC2: "enclosure test", 0x65AA: "span scanner",
    0x8B4: "piece walker", 0x5AFC: "piece rotation", 0x59EE: "piece bag builder",
    0x59CA - 0x50: "piece selection", 0x865E: "territory scoring", 0x8598: "damage selector",
    0x8606: "damage handler", 0xEE90: "event post", 0xEEEE: "event remove",
    0xEFFA: "event test", 0xEE44: "phase dispatcher", 0x7008: "projectile flight",
    0xAF72: "unit movement", 0x6C20: "cannon aiming", 0x6CAE: "fire trigger",
    0x6FB4: "projectile scheduler", 0x5EA2: "territory fill", 0x5E38: "seal event post",
    0x220C: "entity spawn", 0x5B40: "entity allocator", 0x7A24: "phase countdown",
    0xCAE2: "scheduled trigger", 0x11D96: "scaling blitter", 0x5892: "rect grab",
}

TERM = {"rts", "rte", "rtr", "jmp"}


def find_seeds():
    seeds = set(KNOWN)
    sites = defaultdict(list)
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
            seeds.add(t)
            sites[t].append(i)
    # the event handler table: keys are function pointers
    for a in range(0x11A80, 0x11B60, 2):
        v = struct.unpack_from(">I", UP, a)[0]
        if 0x400 <= v < LIMIT and (v & 1) == 0:
            seeds.add(v)
    # anything immediately after an rts is very likely an entry
    for i in range(0x400, LIMIT - 4, 2):
        if struct.unpack_from(">H", UP, i)[0] == 0x4E75:
            n = i + 2
            w = struct.unpack_from(">H", UP, n)[0]
            if w in (0x4E56, 0x48E7):        # link / movem
                seeds.add(n)
    return seeds, sites


def walk(entry, maxlen=0x1000):
    calls, data = set(), set()
    size, clean = 0, False
    for ins in md.disasm(UP[entry:entry + maxlen], entry):
        size = ins.address + ins.size - entry
        m = ins.mnemonic
        if m in ("jsr", "bsr"):
            op = ins.op_str
            if op.startswith("$"):
                try:
                    calls.add(int(op.split(".")[0].lstrip("$"), 16))
                except ValueError:
                    pass
        for tok in ins.op_str.replace(",", " ").split():
            if tok.startswith("$") and tok.endswith(".l"):
                try:
                    v = int(tok[1:-2], 16)
                except ValueError:
                    continue
                if v >= 0x20000:
                    data.add(v)
        if m in TERM:
            clean = True
            break
        if size > maxlen - 8:
            break
    return size, sorted(calls), sorted(data), clean


if __name__ == "__main__":
    seeds, sites = find_seeds()
    print(f"seed entries: {len(seeds)}")
    funcs = {}
    for s in sorted(seeds):
        size, calls, data, clean = walk(s)
        if size < 4:
            continue
        funcs[s] = dict(size=size, calls=calls, data=data, clean=clean,
                        callers=len(sites.get(s, [])), name=KNOWN.get(s))
    print(f"functions walked: {len(funcs)}")
    covered = sum(f["size"] for f in funcs.values())
    print(f"bytes covered: {covered} of {LIMIT} ({100*covered/LIMIT:.1f}%) "
          f"- overlapping walks inflate this")
    named = sum(1 for f in funcs.values() if f["name"])
    print(f"named: {named}   unnamed: {len(funcs)-named}")
    out = HERE / "out" / "fullmap.json"
    out.write_text(json.dumps({hex(k): v for k, v in funcs.items()}, indent=1))
    print(f"wrote {out}")
