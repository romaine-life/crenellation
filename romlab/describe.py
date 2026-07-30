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
# The program ROM is not all the code the game runs: it also calls a small
# routine in the board ROM at 0x140000, which the running port found by
# jumping to it. prog_ext.bin is the program image with that region laid in
# at its real address so the translator can disassemble it like any other.
UP = (HERE / "prog_ext.bin").read_bytes()
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


def board_rom_code():
    """Code the program calls inside the graphics ROM at 0x140000.

    The board ROM is nearly all pictures, but the program jsr's into it:
    0xEE04 calls 0x140010 (moveq #0; rts) and 0x1810 calls 0x1400E4, which
    pulls an argument off the stack and cmpm-compares a table at 0x1432A0
    against the program image - protection living where a copier would not
    look. A call target past the overlay used to be filed as hardware, which
    is how 0x1400E4 went unported while the running game stubbed the call.

    Extents are measured, not guessed: each island is walked to its
    terminator. Both islands are straight-line stubs ending in rts; anything
    less linear would show up in the census as a branch out of the island.
    """
    targets = set()
    for a, b in code_runs:
        addr = a
        while addr < b:
            ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
            if ins is None:
                addr += 2
                continue
            if ins.mnemonic in ("jsr", "jmp", "bsr"):
                op = (ins.op_str or "").strip()
                if op.startswith("$") and op.endswith(".l"):
                    try:
                        t = int(op[1:-2], 16)
                    except ValueError:
                        t = -1
                    if 0x140000 <= t < 0x180000:
                        targets.add(t)
            addr += ins.size
    islands = []
    for t in sorted(targets):
        addr = t
        while addr < min(t + 0x400, 0x180000):
            ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
            if ins is None:
                break
            addr += ins.size
            if ins.mnemonic in ("rts", "rte", "rtr") or \
                    ins.mnemonic.startswith(("jmp", "bra")):
                break
        islands.append((t, addr))
    return islands


def pointer_table_handlers():
    """Handler addresses held in tables of 32-bit function pointers.

    These already sit inside a known code run, so they need no run of their
    own - they are split points. Without them several handlers are merged into
    whichever function starts before them, and the merged block is measured as
    one unit that nothing ever calls as a whole.
    """
    f = HERE / "out" / "ptrtargets.json"
    return json.loads(f.read_text()) if f.exists() else []


def reached_at_runtime():
    """Addresses the running port called and had no routine for.

    The classifier works from what it can see statically, and some routines
    are only ever reached through a computed address, so nothing static points
    at them. The port finds them by running: every call it cannot dispatch is
    an address the game really does execute. Feeding those back is the only
    evidence that settles whether a gap is code - the game jumped to it.
    """
    f = HERE / "out" / "runtime-entries.json"
    return json.loads(f.read_text()) if f.exists() else []


def reached_statically():
    """Targets the lifter itself proves reachable, landing in no routine.

    staticentries.py harvests every callRom and jumpRom out of the lifted
    sources - transfers the lifter derived by following each routine's own
    flow, so inline data cannot fabricate them the way a linear scan does.
    Any such target outside every routine is code the port cannot run today:
    the static analogue of the runtime census, and where 0xAC1C and the rest
    of the self-test's helpers were found without an input pattern reaching
    them first.
    """
    f = HERE / "out" / "static-entries.json"
    return json.loads(f.read_text()) if f.exists() else []


def judged_code():
    """Regions read by a person and judged code, with the reading recorded.

    The census flags runs whose opcode-marker density says prologue but that
    nothing lifted reaches - dead code has no callers by definition, so no
    reachability instrument can find it. reviewed_entries.json holds each
    verdict with its evidence; a "code" verdict here becomes an entry, the
    oracle then proves the lift equal to the machine, and the routine is
    carried as verified-against-oracle, unreached-on-silicon.
    """
    f = HERE / "reviewed_entries.json"
    if not f.exists():
        return []
    reviewed = json.loads(f.read_text())
    return sorted(int(k, 16) for k, v in reviewed.items()
                  if isinstance(v, dict) and v.get("verdict") == "code")


for a in pointer_table_handlers():
    entries.append(a)


def stop_successors():
    """An entry after every stop instruction.

    A stopped 68000 resumes at the instruction after the stop when an
    interrupt above the mask arrives - machine.ts models exactly that in
    halt(). The lifter prunes blocks its entry cannot reach, and nothing
    reaches past a stop by ordinary flow, so without an entry there the
    decompiled game loses the code silicon can still run. The case that
    found the rule: 0x1E8D2 is stop #$2700, and behind it sits the ROM's
    crash screen - raise the mask, save every register, and print them all
    as hex into the playfield through the helpers at 0x1E862-0x1E8C8.
    """
    out = []
    for a, b in code_runs:
        addr = a
        while addr < b:
            ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
            if ins is None:
                addr += 2
                continue
            nxt = addr + ins.size
            if ins.mnemonic == "stop" and nxt < b:
                follow = next(md.disasm(UP[nxt:nxt + 16], nxt, 1), None)
                if follow is not None and not follow.mnemonic.startswith("dc."):
                    out.append(nxt)
            addr = nxt
    return out


_stops = stop_successors()
if _stops:
    print("entries after stop instructions:", ", ".join("%05x" % s for s in _stops))
for a in _stops:
    entries.append(a)

# A runtime address needs a run of its own, not just an entry: an entry that
# falls in a data run is never turned into a function. The run ends at the
# next thing already known to start something, which for a gap between two
# classified functions is exactly the gap. A runtime address inside a measured
# board island is dropped in favour of the island: the fallback extent below
# is a guess (a + 0x200), and for 0x140010 that guess swallowed 508 bytes of
# pictures that then decoded as switch cases nothing could ever enter.
BOARD = board_rom_code()
RUNTIME = []
_bounds = sorted({a for a, _ in code_runs} | set(entries))
for a in sorted(set(reached_at_runtime()) | set(reached_statically())
                | set(judged_code())):
    if any(x <= a < y for x, y in BOARD):
        continue
    nxt = next((b for b in _bounds if b > a), a + 0x200)
    RUNTIME.append((a, nxt))

THUNKS = thunks_below_first_function() + jump_table_cases() + RUNTIME + BOARD
for a, b in THUNKS:
    entries.append(a)
    code_runs.append((a, b))
    data_runs = carve(data_runs, a, b)
entries = sorted(set(entries))
code_runs = sorted(set(code_runs))
data_runs = sorted({(x, y) for x, y in data_runs if y > x})

# Two entries can overlap: one's first instruction covers where the other
# claims to start, and only one of them is real. Which is decided by what
# reaches them, and it has to be decided HERE, before extents are worked out -
# an extent that stops inside an instruction hands the lifter four bytes of a
# six-byte move, capstone reads the truncation as something else entirely, and
# the routine comes out reading 0xAAAAAAAA. 0xFC46 and 0xFC4A are the pair:
# the game transfers to 0xFC46, nothing reaches 0xFC4A.
_reached = (set(reached_at_runtime()) | set(reached_statically())
            | set(pointer_table_handlers())
            | {a for a, _ in jump_table_cases()})
_phantom = set()
for _e in entries:
    _i = next(md.disasm(UP[_e:_e + 16], _e, 1), None)
    if _i is None or _e not in _reached:
        continue
    for _s in entries:
        if _e < _s < _e + _i.size and _s not in _reached:
            _phantom.add(_s)
if _phantom:
    print("phantom entries inside another entry's first instruction:",
          ", ".join("%05x" % s for s in sorted(_phantom)))
entries = [e for e in entries if e not in _phantom]

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
    # Overlapping pairs where one side is reachable were settled before the
    # extents were computed; anything still overlapping here is padding read
    # as code, and the later start is the one to keep.
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
# A `jmp <abs>.l` sitting in the gap between two functions is a trampoline, the
# same as the ones below the first routine. 0x1365C is the case that matters:
# the reset routine branches to it, and without it the machine boots, runs for
# forty-five frames and dies with nothing covering the address. Only gaps that
# begin with one are taken; the other ninety-odd are genuine data.
_ok.sort()
_extra = []
for _i in range(len(_ok) - 1):
    _b, _n = _ok[_i][1], _ok[_i + 1][0]
    if _b < _n and UP[_b] == 0x4E and UP[_b + 1] == 0xF9:
        _extra.append((_b, min(_b + 6, _n)))
_ok.extend(_extra)
_ok.sort()
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

# A call to 0x18652 never comes back: it prints the text sitting after its
# caller's jsr (read through the stacked return address) and jumps to the
# stopped-processor stub at 0x1E8D2. Bytes after such a call are the message,
# not instructions - sixteen exception stubs carry their names that way - so
# the function ends at the call, and the text falls to the data map, which
# already names it. Without this clip the message bytes lift as junk cases
# no execution can reach.
NORETURN = {0x18652}
_clipped = []
for a, b in funcs:
    addr = a
    end = b
    while addr < end:
        ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
        if ins is None:
            # Capstone decodes almost anything, so a word it refuses is data
            # beyond doubt - an extent that runs into one has overshot its
            # code. Seven routines were silently unliftable for exactly this;
            # the lifter hit the junk and bailed on the whole routine. Any
            # real code past the junk is reached by a branch, and the
            # entry-aware harvest gives it a function of its own.
            end = addr
            break
        if ins.mnemonic == "jsr":
            tok = (ins.op_str or "").strip().lstrip("$").split(".")[0]
            try:
                if int(tok, 16) in NORETURN:
                    end = addr + ins.size
                    break
            except ValueError:
                pass
        addr += ins.size
    _clipped.append((a, end))
funcs = _clipped

# Extents that have been read and corrected by hand. The classifier's run for
# 0x13D1E overshoots its closing bra.b by two junk words into the self-test's
# month-name table, and the junk lifts into a block that fabricates a jump
# into the table. The file records address -> measured end; an entry naming
# an address that is no longer a function start is an error, the same rule
# handedits.py applies.
_curated = json.loads((HERE / "extents.curated.json").read_text()) \
    if (HERE / "extents.curated.json").exists() else {}
_starts_now = {a for a, _ in funcs}
for _k in _curated:
    assert int(_k, 16) in _starts_now, \
        f"extents.curated.json names {_k}, which starts no function"
funcs = [(a, min(b, int(_curated.get(hex(a), "0x%x" % b), 16)))
         for a, b in funcs]

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
            if m in ("jsr", "bsr") and (v < LIMIT
                                        or 0x140000 <= v < 0x180000):
                # a call into the board ROM is a call, not a hardware touch -
                # filing it as hardware is how 0x1400E4 went undiscovered
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
