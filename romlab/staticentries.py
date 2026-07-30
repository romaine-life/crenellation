"""Call and jump targets the lifter itself emits, landing where no routine is.

The census's linear scan fabricates references when it decodes inline data
(the exception stubs keep their message text after the jsr). The lifter does
not: blocks.json carries each routine's lifted source, and every callRom and
jumpRom in it is a control transfer the lifter proved reachable by following
the routine's own flow. Any such target outside every facts.json routine is
code the port cannot run today - the static analogue of the runtime census.

Writes out/static-entries.json for describe.py to consume, and prints each
find with its callers so the verdict can be read rather than assumed.
"""
import json
import pathlib
import re

HERE = pathlib.Path(__file__).parent
CALL = re.compile(r"(?:callRom|jumpRom)\(0x([0-9a-fA-F]+)")

blocks = json.loads((HERE / "out" / "blocks.json").read_text())
facts = json.loads((HERE / "out" / "facts.json").read_text())
funcs = sorted((a, b) for a, b in facts["funcs"])

# A decompiled function has one entry, so a transfer target has to BE an
# entry - being inside some routine's extent is not enough. The arm-join at
# 0x3CCC was the lesson: adding an entry at 0x3C44 split its host, the other
# arm's bra.w now crossed a function boundary to a mid-function address, and
# the extent test called that covered while the dispatcher called it fatal.
entries_now = {row["at"] for row in blocks}


def covered(t):
    return t in entries_now


# targets inside a range that has been read and judged data are the lifter's
# dead fall-throughs past a noreturn call, not code - the exception stubs'
# message text is the case that produced the rule
reviewed_path = HERE / "reviewed_entries.json"
reviewed = json.loads(reviewed_path.read_text()) if reviewed_path.exists() else {}
judged = [(int(r["lo"], 16), int(r["hi"], 16))
          for r in reviewed.get("ranges", []) if r.get("verdict") == "data"]
judged_addrs = {int(k, 16) for k, v in reviewed.items()
                if isinstance(v, dict) and v.get("verdict") == "data"}

refs = {}
for row in blocks:
    for m in CALL.finditer(row.get("src", "")):
        t = int(m.group(1), 16)
        if t in judged_addrs or any(lo <= t < hi for lo, hi in judged):
            continue
        refs.setdefault(t, set()).add(row["at"])

missing = {t: sorted(srcs) for t, srcs in refs.items() if not covered(t)}
print(f"lifted transfer targets: {len(refs)}   uncovered: {len(missing)}")
for t in sorted(missing):
    srcs = ", ".join("%05x" % s for s in missing[t][:6])
    print(f"  {t:06x}  from {srcs}")

# The set accumulates, the same rule as unproven.json: an uncovered target is
# only uncovered relative to the funcs of the moment, and a routine created
# from an earlier find stops being listed the moment it exists. Overwriting
# would forget every consumed entry and regress the map by exactly that many
# routines - which happened once, 804 functions back to 791.
p = HERE / "out" / "static-entries.json"
cur = set(json.loads(p.read_text())) if p.exists() else set()
cur -= judged_addrs
merged = sorted(cur | set(missing))
json.dump(merged, open(p, "w"))
print(f"wrote out/static-entries.json ({len(merged)} accumulated)")
