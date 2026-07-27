"""Derive a stated purpose for every code and data region of the overlay.

Every description here is evidence-based: what a function calls, what state it
touches, which hardware it writes, how a table is indexed and by whom. Nothing
is guessed from a name.
"""
import json
import pathlib
import struct
from collections import defaultdict

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
LIMIT = 0x20000
M = json.loads((HERE / "out" / "codemap2.json").read_text())
md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

VERIFIED = {
    0x11F2A: "graphics decompressor (verified)", 0x124BE: "terrain painter (verified)",
    0x11FF8: "block recolour (verified)", 0x1217E: "rectangle palette remap (verified)",
    0x11E10: "screen dissolve (verified)", 0x11E58: "random number generator (verified)",
    0x11BD8: "board coordinate to cell address (verified)",
    0x11BEC: "board coordinate to screen address (verified)",
    0x11D5C: "octagonal distance approximation (verified)",
    0x11CF8: "eight-way aiming direction (verified)",
    0xBC2: "enclosure test - wall follower (verified)",
    0x65AA: "flood-fill span scanner (verified)",
    0x8B4: "piece walker and stamper (verified)",
    0x5AFC: "piece rotation (verified)", 0x59EE: "piece bag builder (verified)",
    0x865E: "territory scoring (verified)", 0x8598: "damage script selector (verified)",
    0x8606: "damage step handler (verified)", 0xEE90: "event queue post (verified)",
    0xEEEE: "event queue remove (verified)", 0xEFFA: "event queue membership test (verified)",
    0xEE44: "phase dispatcher (verified)", 0x7008: "projectile flight integration (verified)",
    0xAF72: "moving-unit step (verified)", 0x6C20: "cannon aiming handler (verified)",
    0x6CAE: "cannon fire trigger", 0x6FB4: "projectile scheduler",
    0x5EA2: "territory flood fill", 0x5E38: "seal event post",
    0x220C: "entity spawn wrapper", 0x5B40: "entity allocator",
    0x7A24: "phase countdown tick", 0xCAE2: "scheduled event trigger",
    0x11D96: "scaling blitter", 0x5892: "framebuffer rectangle grab",
    0x59CA - 0x8E: "piece selection", 0xB7FA: "computer player wall scoring",
    0xEE3A: "event queue reset", 0x663C: "coordinate stack push",
    0x661A: "coordinate stack pop", 0xA20: "wall placement enclosure check",
}

HW = [
    (0x200000, 0x21FFFF, "the framebuffer"),
    (0x3C0000, 0x3C07FF, "the palette"),
    (0x460000, 0x460FFF, "the OKI6295 sample chip"),
    (0x480000, 0x499FFF, "the YM2413 FM chip"),
    (0x3E0864, 0x3E0DA4, "the board"),
    (0x3E1968, 0x3E1AE2, "the player structs"),
    (0x3E02D8, 0x3E0778, "the motion-object entity table"),
    (0x3E1CF4, 0x3E1D60, "the event queue"),
    (0x3E1BC6, 0x3E1C2C, "the moving-unit table"),
    (0x3E0F48, 0x3E15AC, "the shot rings"),
]

entries = sorted(set(M["entries"]))
code_runs = [(a, b) for a, b in M["code"]]
data_runs = [(a, b) for a, b in M["data"]]


def thunks_below_first_function():
    """The jmp trampolines that sit before the first ordinary routine.

    Between the exception vectors and the first real function is a run of
    six-byte `jmp <abs>.l` stubs. The classifier read them as data because
    nothing branches into them from nearby code - they are reached by absolute
    short calls and through pointer tables, neither of which the scan followed.
    They are executed: 74 call sites name one directly and 108 pointer slots
    hold their addresses. Left as data they are not ported, and every call
    through one dies with no routine covering the address.
    """
    out = []
    a = 0x100
    while a < 0x430:
        if UP[a] == 0x4E and UP[a + 1] == 0xF9:
            out.append((a, a + 6))
            a += 6
        else:
            a += 2
    return out


def carve(runs, a, b):
    """Remove [a, b) from a list of runs, keeping whatever lies either side."""
    out = []
    for x, y in runs:
        if y <= a or x >= b:
            out.append((x, y))
            continue
        if x < a:
            out.append((x, a))
        if y > b:
            out.append((b, y))
    return out


def jump_table_cases():
    """Entry points a pc-relative jump table reaches.

    `jmp $BASE(pc, dN.w)` adds a signed offset from a table to BASE. The table
    is data, so the classifier ends the function at it and the code past it
    gets no entry point - the port then has no case for the address and every
    call through the table dies. romlab/jumptables.py finds the tables, bounds
    each by its own contents, and follows each target's basic blocks to a
    terminator so the extent is the case itself rather than the whole region.
    """
    f = HERE / "out" / "jumptargets.json"
    return [(r[0], r[1]) for r in json.loads(f.read_text())] if f.exists() else []


def pointer_table_handlers():
    """Handler addresses held in tables of 32-bit function pointers.

    These already sit inside a known code run, so they need no run of their
    own - they are split points. Without them several handlers are merged into
    whichever function starts before them, and the merged block is measured as
    one unit that nothing ever calls as a whole.
    """
    f = HERE / "out" / "ptrtargets.json"
    return json.loads(f.read_text()) if f.exists() else []


for a in pointer_table_handlers():
    entries.append(a)

THUNKS = thunks_below_first_function() + jump_table_cases()
for a, b in THUNKS:
    entries.append(a)
    code_runs.append((a, b))
    data_runs = carve(data_runs, a, b)
entries = sorted(set(entries))
code_runs = sorted(set(code_runs))
data_runs = sorted({(x, y) for x, y in data_runs if y > x})

# map each function to its extent (entry -> next entry within the same code run)
funcs = []
for a, b in code_runs:
    # every code run starts a function: bytes before the first known entry
    # still belong to something, and leaving them out is how coverage leaks
    inside = sorted(set([a] + [e for e in entries if a < e < b]))
    for i, e in enumerate(inside):
        end = inside[i + 1] if i + 1 < len(inside) else b
        funcs.append((e, end))

# An entry has to be somewhere an instruction starts. Two in the map are not:
# 0x404, a split point injected inside a jump-table case, and 0xFBE2, which
# comes from the original classifier. Both are data - one does not disassemble
# at all and the other only as a dc.w - so a "routine" starting there can only
# ever throw. Dropping them folds their bytes into the function before them,
# which is where they belong; coverage does not change.
_starts = {a for a, _ in funcs}
_ok = []
for _a, _b in funcs:
    _i = next(md.disasm(UP[_a:_a + 16], _a, 1), None)
    if _i is None or _i.mnemonic.startswith("dc."):
        continue
    # An entry whose first instruction runs into the next one is not where an
    # instruction starts. 0x18544 is the case: 0x18542 is an rts, the four
    # bytes after it are padding, and reading them as code swallows the `jsr`
    # that begins the exception stub at 0x18548.
    if any(_a < s < _a + _i.size for s in _starts):
        continue
    _ok.append((_a, _b))
# Dropping an entry leaves its bytes belonging to nothing, because the extents
# were worked out before the drop. Give them to the function before them, which
# is where padding after an rts belongs anyway.
_ok.sort()
for _i in range(len(_ok) - 1):
    _a, _b = _ok[_i]
    _n = _ok[_i + 1][0]
    if _b < _n and any(x <= _a and _n <= y for x, y in code_runs):
        _ok[_i] = (_a, _n)
funcs = _ok

# The injected spans overlap the runs they were carved out of, so one address
# can start a function twice. The translator names a function after its start,
# so a duplicate is a duplicate declaration and the whole module fails to
# parse. Keep the widest extent: a longer switch covers more addresses, and
# anything past the end still falls through to the dispatcher.
widest = {}
for a, b in funcs:
    if b > widest.get(a, -1):
        widest[a] = b
funcs = sorted(widest.items())

callers = defaultdict(set)
calls_of = defaultdict(set)
data_of = defaultdict(set)
hw_of = defaultdict(set)

for e, end in funcs:
    addr = e
    while addr < end:
        ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
        if ins is None:
            addr += 2
            continue
        m = ins.mnemonic
        toks = ins.op_str.replace(",", " ").replace("(", " ").replace(")", " ").split()
        for tok in toks:
            if not tok.startswith("$"):
                continue
            try:
                v = int(tok.split(".")[0].lstrip("$"), 16)
            except ValueError:
                continue
            if m in ("jsr", "bsr") and v < LIMIT:
                calls_of[e].add(v)
                callers[v].add(e)
            elif v >= LIMIT:
                for lo, hi, name in HW:
                    if lo <= v <= hi:
                        hw_of[e].add(name)
            elif v < LIMIT:
                data_of[e].add(v)
        addr += ins.size

print(f"functions: {len(funcs)}   code runs: {len(code_runs)}   data runs: {len(data_runs)}")
named = sum(1 for e, _ in funcs if e in VERIFIED)
print(f"already named: {named}")
# how many have some evidence to describe them?
have_ev = sum(1 for e, _ in funcs if hw_of[e] or calls_of[e] or callers[e])
print(f"with evidence (hardware, callers or callees): {have_ev}")
print(f"with no evidence at all: {len(funcs)-have_ev}")

json.dump({
    "funcs": [[e, b] for e, b in funcs],
    "callers": {hex(k): sorted(v) for k, v in callers.items()},
    "calls": {hex(k): sorted(v) for k, v in calls_of.items()},
    "hw": {hex(k): sorted(v) for k, v in hw_of.items()},
    "data": {hex(k): sorted(v)[:40] for k, v in data_of.items()},
    "verified": {hex(k): v for k, v in VERIFIED.items()},
}, open(HERE / "out" / "facts.json", "w"))
print("wrote out/facts.json")
