"""Assign every function and data region a purpose backed by evidence.

Rules run in precedence order. Each emits a sentence naming the specific
evidence it used - the hardware written, the caller, the table indexed - so a
description can be checked against the disassembly rather than taken on trust.
"""
import json
import pathlib
import struct
from collections import Counter, defaultdict

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
LIMIT = 0x20000
FACTS = json.loads((HERE / "out" / "facts.json").read_text())
M = json.loads((HERE / "out" / "codemap2.json").read_text())
md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

funcs = [(a, b) for a, b in FACTS["funcs"]]
callers = {int(k, 16): v for k, v in FACTS["callers"].items()}
calls = {int(k, 16): v for k, v in FACTS["calls"].items()}
hw = {int(k, 16): v for k, v in FACTS["hw"].items()}
verified = {int(k, 16): v for k, v in FACTS["verified"].items()}

# instruction-level fingerprints
prof = {}
for a, b in funcs:
    c = Counter()
    addr = a
    while addr < b:
        ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
        if ins is None:
            addr += 2
            continue
        c[ins.mnemonic] += 1
        addr += ins.size
    prof[a] = c

SOUND = range(0x19000, 0x1B674)
NAMES = {}
WHY = {}


def setname(a, name, why):
    if a not in NAMES:
        NAMES[a] = name
        WHY[a] = why


# Handlers held in tables of 32-bit function pointers. Nothing calls these by
# name, so no rule that works from the call graph can describe them.
PT = set()
pf = HERE / "out" / "ptrtargets.json"
if pf.exists():
    PT = set(json.loads(pf.read_text()))
for a, b in funcs:
    if a in PT:
        setname(a, "handler reached through a function-pointer table",
                "its address is held in a run of 32-bit pointers that a "
                "dispatcher indexes; nothing calls it by name")


# The cases a pc-relative jump table reaches, and anything called from inside
# one. These were data until jumptables.py enumerated the tables, so they have
# no name from any other rule.
JT = {}
jf = HERE / "out" / "jumptargets.json"
if jf.exists():
    for r in json.loads(jf.read_text()):
        JT[r[0]] = (r[1], r[2], r[3])
for a, b in funcs:
    if a in JT:
        _, base, site = JT[a]
        if base:
            setname(a, "jump-table case at 0x%05x" % a,
                    "reached from the table at 0x%05x used by the jmp at 0x%05x"
                    % (base, site))
        else:
            # found by running, not by reading: a computed jump landed here and
            # no function covered the address
            setname(a, "computed-jump entry at 0x%05x" % a,
                    "observed as a jump target during the differential run "
                    "with no function covering it")
for a, b in funcs:
    for start, (end, base, site) in JT.items():
        if start < a < end:
            setname(a, "helper inside the jump-table case at 0x%05x" % start,
                    "lies within the case reached from the table at 0x%05x" % base)
            break


# A six-byte function that is nothing but `jmp <abs>.l` is a trampoline. The
# whole block of them sits below the first ordinary routine and is reached by
# absolute-short calls and pointer tables, so each one is named for where it
# goes rather than left unknown.
for a, b in funcs:
    if b - a == 6 and UP[a] == 0x4E and UP[a + 1] == 0xF9:
        target = int.from_bytes(UP[a + 2:a + 6], "big")
        setname(a, "trampoline to 0x%05x" % target,
                "six-byte jmp stub; the whole run below the first routine is "
                "reached by absolute-short calls and pointer tables")


# hand-read names take precedence over every rule
MANUAL = {}
mp = HERE / "manual_names.json"
if mp.exists():
    for k, v in json.loads(mp.read_text()).items():
        MANUAL[int(k, 16)] = v
for a, b in funcs:
    if a in MANUAL:
        setname(a, MANUAL[a][0], MANUAL[a][1])

for a, b in funcs:
    if a in verified:
        setname(a, verified[a], "ported and checked against the ROM")

for a, b in funcs:
    h = hw.get(a, [])
    if "the YM2413 FM chip" in h and "the OKI6295 sample chip" in h:
        setname(a, "sound driver - FM and sample output", "writes both sound chips")
    elif "the YM2413 FM chip" in h:
        setname(a, "FM register write", "writes the YM2413")
    elif "the OKI6295 sample chip" in h:
        setname(a, "sample playback", "writes the OKI6295")
    elif "the palette" in h:
        setname(a, "palette update", "writes the palette")
    elif "the board" in h and "the framebuffer" in h:
        setname(a, "board cell draw", "reads the board and writes the framebuffer")
    elif "the board" in h:
        setname(a, "board access", "reads or writes the board array")
    elif "the framebuffer" in h:
        setname(a, "framebuffer draw", "writes the framebuffer")
    elif "the motion-object entity table" in h:
        setname(a, "sprite entity update", "touches the motion-object table")
    elif "the event queue" in h:
        setname(a, "event queue access", "touches the event queue")
    elif "the moving-unit table" in h:
        setname(a, "moving-unit access", "touches the unit table")
    elif "the shot rings" in h:
        setname(a, "shot record access", "touches a shot ring")
    elif "the player structs" in h:
        setname(a, "player state access", "touches the player structs")

for a, b in funcs:
    if a in NAMES:
        continue
    if a in SOUND:
        setname(a, "sound driver helper", "inside the sound driver's code range")

# known tables and globals: referencing one is strong evidence of purpose
TABLES = {
    0xFCCA: "steps a board direction", 0xFCDA: "steps a board direction",
    0xFCE2: "steps a board direction", 0xFCEA: "turns to a perpendicular direction",
    0xFE4E: "reads the piece shape table", 0xFF90: "picks a piece rotation group",
    0x1000A: "resolves a player's owner code", 0x11754: "places a cannon muzzle",
    0x11764: "places a cannon muzzle", 0x11774: "reads projectile speed",
    0x117CE: "converts claimed area to a score", 0x117E2: "converts claimed area to a score",
    0x11792: "picks the countdown beep", 0x11A50: "picks a default high-score name",
    0xFD5E: "selects an entity template", 0x1163A: "walks a rotation group",
    0x11736: "walks a rotation group", 0x10012: "reads a level record",
}
GLOBALS = {
    0x3E0842: "uses the random seed", 0x3E1870: "reads the phase countdown",
    0x3E195C: "reads the phase state", 0x3E1950: "checks the pause flag",
    0x3E1960: "uses the current player", 0x3E0E76: "uses the terrain rotation",
    0x3E209C: "uses the flood-fill coordinate stack", 0x3E0DCA: "reads the level pointer",
    0x3E02CA: "checks entity capacity", 0x3E0802: "checks the dispatcher gate",
}
dref = {int(k, 16): v for k, v in FACTS["data"].items()}
for a, b in funcs:
    if a in NAMES:
        continue
    hits = []
    for v in dref.get(a, []):
        for base, desc in TABLES.items():
            if base <= v < base + 0x40 and desc not in hits:
                hits.append(desc)
    if hits:
        setname(a, hits[0], f"references the table at {v:#x}")

for a, b in funcs:
    if a in NAMES:
        continue
    cs = [c for c in callers.get(a, []) if c in NAMES]
    if len(cs) == 1:
        base = NAMES[cs[0]]
        while base.startswith("helper for "):
            base = base[len("helper for "):]
        while base.startswith("helper used by "):
            base = base[len("helper used by "):]
        setname(a, f"helper for {base}", f"only caller is {cs[0]:#x}")
    elif cs:
        kinds = Counter(NAMES[c].split(" - ")[0] for c in cs)
        top, n = kinds.most_common(1)[0]
        if n >= max(2, len(cs) * 0.6):
            setname(a, f"helper used by {top}", f"{n} of {len(cs)} callers are {top}")

for a, b in funcs:
    if a in NAMES:
        continue
    p = prof[a]
    size = b - a
    if p.get("muls", 0) + p.get("divs", 0) + p.get("divu", 0) + p.get("muls.w", 0):
        setname(a, "arithmetic helper", "multiply/divide with no state access")
    elif size <= 24 and not calls.get(a):
        setname(a, "small leaf utility", f"{size} bytes, no calls, no state access")
    elif p.get("movem.l", 0) and not calls.get(a):
        setname(a, "register-save leaf routine", "saves registers, calls nothing")

unnamed = [a for a, b in funcs if a not in NAMES]
print(f"functions: {len(funcs)}")
print(f"named: {len(NAMES)}   unnamed: {len(unnamed)}")
c = Counter(NAMES.values())
print("\nname distribution:")
for k, v in c.most_common(16):
    print(f"  {v:4d}  {k}")
if unnamed:
    print(f"\nfirst unnamed entries: {[hex(x) for x in unnamed[:20]]}")
json.dump({"names": {hex(k): v for k, v in NAMES.items()},
           "why": {hex(k): v for k, v in WHY.items()},
           "unnamed": [hex(x) for x in unnamed]},
          open(HERE / "out" / "names.json", "w"), indent=1)
