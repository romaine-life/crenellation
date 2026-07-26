"""Name every data region of the overlay.

A region is named from evidence: an already-decoded table keeps its name, one
referenced only by sound code is sound data, one full of overlay pointers is a
pointer table, and so on. Anything left over is reported rather than hidden.
"""
import json
import pathlib
import struct
from collections import Counter

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
LIMIT = 0x20000
M = json.loads((HERE / "out" / "codemap2.json").read_text())
N = json.loads((HERE / "out" / "names.json").read_text())
FACTS = json.loads((HERE / "out" / "facts.json").read_text())
fnames = {int(k, 16): v for k, v in N["names"].items()}
funcs = sorted((a, b) for a, b in FACTS["funcs"])

KNOWN = [
    (0x10002, 0x1010A, "level record table header", "leading records of the level table, read as data by the level loader"),
    (0x0F030, 0x0F13E, "copyright and warning text", "COPYRIGHT 1990 ATARI GAMES CORP and the unauthorised-use notice"),
    (0x18540, 0x18652, "exception name strings", "the name for each exception stub, stored inline after its call"),
    (0x09D76, 0x09D80, "threshold word table", "five ascending words used as thresholds"),
    (0x19976, 0x1997A, "index table", "four consecutive indices"),
    (0x1843E, 0x1851C, "sound parameter table", "per-voice parameter records"),
    (0x1A848, 0x1A8C0, "sound frequency table", "ascending 16-bit values"),
    (0x00000, 0x00400, "68000 exception vector table", "256 longs; the reset vector and every trap"),
    (0x00400, 0x00430, "boot entry stub", "first code after the vectors"),
    (0xFCCA, 0xFCEA, "direction delta tables", "pointer, x and y deltas for the eight board directions"),
    (0xFCEA, 0xFD16, "perpendicular turn table", "the same directions rotated 90 degrees, used by the enclosure test"),
    (0xFD16, 0xFD5E, "entity templates", "12 six-byte records: sprite code and flags"),
    (0xFD5E, 0xFE4E, "entity template pointers", "indexed by the spawn routine's kind argument"),
    (0xFE4E, 0xFF82, "piece shape table", "40 shapes as direction scripts"),
    (0xFF90, 0x10002, "piece rotation group table", "13 group addresses in selection order"),
    (0x1000A, 0x1000E, "player owner codes", "0x40, 0x80, 0xC0"),
    (0x10012, 0x11600, "level records", "0x2E bytes each; leading pointer triple plus level parameters"),
    (0x11600, 0x1163A, "rotation group data", "group runs with their wrap-back pointers"),
    (0x1163A, 0x1173A, "rotation groups", "13 groups of shape pointers"),
    (0x1173A, 0x11754, "level pointer table", "per-level data addresses"),
    (0x11754, 0x11774, "cannon muzzle offsets", "a radius-7 circle in x and y"),
    (0x11774, 0x11792, "projectile speed table", "64, 80, 96, 96, 96"),
    (0x11792, 0x117CE, "countdown beep table", "sound ids for the last five seconds"),
    (0x117CE, 0x117E2, "score thresholds", "perfect squares 9 through 121, then 999"),
    (0x117E2, 0x11800, "score awards", "100 through 1000, then 6420"),
    (0x11800, 0x11A50, "text and message tables", "message ids used by the draw routines"),
    (0x11A50, 0x11A80, "default high-score names", "RAT, DOG, PIG, ANT and the rest"),
    (0x11A80, 0x11B60, "event handler table", "26 records of function pointer, priority and flag"),
    (0x11B60, 0x11BD8, "event handler table (tail)", "further handler records"),
]


def owners(a, b):
    """Which named functions reference into this run."""
    out = Counter()
    for f, _ in funcs:
        for v in FACTS["data"].get(hex(f), []):
            if a <= v < b:
                out[fnames.get(f, "?")] += 1
    return out


rows = []
for a, b in M["data"]:
    name = why = None
    for lo, hi, n, w in KNOWN:
        if a >= lo and b <= hi:
            name, why = n, w
            break
        if lo >= a and hi <= b and name is None:
            name, why = n + " (and neighbours)", w
    if name is None:
        o = owners(a, b)
        blob = UP[a:b]
        ptrs = sum(1 for i in range(0, len(blob) - 3, 4)
                   if 0x400 <= struct.unpack_from(">I", blob, i)[0] < LIMIT)
        if o:
            top, _ = o.most_common(1)[0]
            base = top.split(" - ")[0].replace("helper for ", "")
            if "sound" in base:
                name, why = "sound driver data", f"referenced only by {base}"
            elif "palette" in base:
                name, why = "palette ramp data", f"referenced by {base}"
            elif "RLE" in base or "decompressor" in base:
                name, why = "compressed graphics data", f"consumed by {base}"
            else:
                name, why = f"data for {base}", f"referenced by {base}"
        elif ptrs > (b - a) / 12:
            name, why = "pointer table", f"{ptrs} overlay pointers in {b-a} bytes"
        elif blob.count(0) > (b - a) * 0.8:
            name, why = "reserved / padding", "almost entirely zero"
    rows.append(dict(a=a, b=b, n=b - a, name=name, why=why))

named = [r for r in rows if r["name"]]
un = [r for r in rows if not r["name"]]
print(f"data runs: {len(rows)}  named: {len(named)}  unnamed: {len(un)}")
print(f"named bytes: {sum(r['n'] for r in named)}  unnamed bytes: {sum(r['n'] for r in un)}")
if un:
    print("\nunnamed runs:")
    for r in sorted(un, key=lambda r: -r["n"])[:24]:
        print(f"  {r['a']:05X}..{r['b']:05X} {r['n']:6d}")
json.dump(rows, open(HERE / "out" / "datanames.json", "w"), indent=1)
