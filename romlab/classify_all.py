"""Classify every mapped function by the state it touches, and measure real
byte coverage of the overlay so the unmapped gaps are visible."""
import json
import pathlib
from collections import Counter, defaultdict

HERE = pathlib.Path(__file__).parent
F = {int(k, 16): v for k, v in json.loads((HERE / "out" / "fullmap.json").read_text()).items()}
LIMIT = 0x20000

REGIONS = [
    ("board",      lambda a: 0x3E0864 <= a < 0x3E0864 + 42 * 32),
    ("players",    lambda a: 0x3E1968 <= a < 0x3E1968 + 3 * 0x7E),
    ("framebuf",   lambda a: 0x200000 <= a <= 0x21FFFF),
    ("motionobj",  lambda a: 0x3E02D8 <= a < 0x3E02D8 + 16 * 80),
    ("eventq",     lambda a: 0x3E1CF4 <= a < 0x3E1D60),
    ("shots",      lambda a: a in (0x3E0F48, 0x3E1254, 0x3E1560)),
    ("units",      lambda a: 0x3E1BC6 <= a < 0x3E1BC6 + 7 * 0x12),
    ("palette",    lambda a: 0x3C0000 <= a <= 0x3C07FF),
    ("sound",      lambda a: 0x460000 <= a <= 0x499FFF or 0x3E3D00 <= a < 0x3E3E00),
    ("romdata",    lambda a: 0x20000 <= a < 0x100000),
]


def classify(f):
    tags = set()
    for a in f["data"]:
        for name, test in REGIONS:
            if test(a):
                tags.add(name)
    return tags


tags_by_fn = {}
for a, f in F.items():
    tags_by_fn[a] = classify(f)

# propagate: a function that calls a classified one inherits a weaker hint
for _ in range(3):
    for a, f in F.items():
        if tags_by_fn[a]:
            continue
        inherited = set()
        for c in f["calls"]:
            inherited |= tags_by_fn.get(c, set())
        if inherited:
            tags_by_fn[a] = {t + "*" for t in inherited}

counts = Counter()
for a, t in tags_by_fn.items():
    if not t:
        counts["unclassified"] += 1
    for x in t:
        counts[x] += 1
print("functions by what they touch (* = inherited from callees):")
for k, v in counts.most_common():
    print(f"  {k:14s} {v}")

# true byte coverage: union of walked ranges
covered = bytearray(LIMIT)
for a, f in F.items():
    for i in range(a, min(a + f["size"], LIMIT)):
        covered[i] = 1
n = sum(covered)
print(f"\ntrue coverage: {n} of {LIMIT} bytes ({100*n/LIMIT:.1f}%)")

gaps = []
i = 0x400
while i < LIMIT:
    if not covered[i]:
        j = i
        while j < LIMIT and not covered[j]:
            j += 1
        if j - i >= 64:
            gaps.append((i, j - i))
        i = j
    else:
        i += 1
print(f"unmapped runs >= 64 bytes: {len(gaps)}  totalling {sum(g[1] for g in gaps)} bytes")
for a, ln in sorted(gaps, key=lambda g: -g[1])[:12]:
    print(f"   {a:05X} .. {a+ln:05X}  ({ln} bytes)")
json.dump({hex(a): sorted(t) for a, t in tags_by_fn.items()},
          open(HERE / "out" / "classified.json", "w"), indent=1)
