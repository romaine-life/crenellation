"""Drop accumulated inner entries nothing can reach.

inner_entries.json accumulates across runs by design, so it still holds
entries derived by logic since fixed - 0x1996A is one, twelve bytes of index
table lifted as a function whose body is `or` noise and a movep with a wild
displacement. A function nothing reaches is not an entry, it is an artefact.

An entry is kept when any mechanism can reach it:
- a callRom/jumpRom in some kept routine's lifted source targets it
- the current jump-table bounding derives it (jtentries.py logic)
- the running port observed it (runtime-entries.json, missing-entries.json)
- a pointer table names it (ptrtargets.json)
- its address is loaded into an address register in kept lifted source (the
  lea (pc),a6 continuation pattern), or appears as an aligned 32-bit value in
  the overlay, where the program's own pointer tables live

A bare literal in a load or store expression is not reach - it is the
opposite. 0x1996A survived a first draft of this net because three routines
read load8(0x1996A + index): the address is a byte table's base, cited as
data everywhere it appears, and the "entry" there lifted twelve bytes of
index table into or-noise. Data citations argue for dropping.

Junk functions cite junk targets, so the keep set is iterated to a fixpoint
with only kept rows contributing references. The bias is deliberate: a false
keep is a harmless dead function, a false drop breaks the running game - and
a wrong drop heals loudly, because the pure decompiled run throws with the
address in hand and the runtime census feeds it back.

Writes inner_entries.json pruned, and out/dropped-entries.json with reasons.
"""
import bisect
import json
import pathlib
import re

HERE = pathlib.Path(__file__).parent
CALL = re.compile(r"(?:callRom|jumpRom)\(0x([0-9a-fA-F]+)")
# an address literal loaded into an address register is a continuation the
# scan cannot otherwise follow; a literal inside load8(...) is a data base
AREG = re.compile(r"setReg\('a[0-6]',\s*0x([0-9a-fA-F]{4,6})\)")
# the lifter materialises an address constant as a bare local assignment -
# `a6 = (0x137a0) >>> 0` is the lea (pc),a6 continuation, but the same shape
# also takes a table base for reading (`src = (0x1996a) >>> 0`), so this
# tier keeps by default and defers to reviewed_entries.json where the use
# has been read and judged
BARE = re.compile(r"= \(0x([0-9a-fA-F]{4,6})\) >>> 0")

blocks = json.loads((HERE / "out" / "blocks.json").read_text())
facts = json.loads((HERE / "out" / "facts.json").read_text())
funcs = sorted((a, b) for a, b in facts["funcs"])
starts = {a for a, _ in funcs}
inner = sorted(set(json.loads((HERE / "out" / "inner_entries.json").read_text())))
runtime = set(json.loads((HERE / "out" / "runtime-entries.json").read_text()))
missing = set(json.loads((HERE / "out" / "missing-entries.json").read_text()))
ptrs = set(json.loads((HERE / "out" / "ptrtargets.json").read_text()))

# pointers are looked for in the overlay only: the upper image is pictures,
# and a million bytes of art encodes every small value somewhere by accident
rom = (HERE.parent / "frontend" / "src" / "rom" / "rom.bin").read_bytes()
image_ptrs = set()
for off in range(0, 0x20000 - 4, 2):
    v = int.from_bytes(rom[off:off + 4], "big")
    if v < 0x20000:
        image_ptrs.add(v)


def fresh_jump_targets():
    """Targets the current jtentries.py bounding derives."""
    import cfg
    bounds = {}
    for lo, hi in funcs:
        for i in cfg.decode(lo, hi):
            bounds.setdefault(lo, set()).add(i.address)
    los = [a for a, _ in funcs]

    def host(a):
        k = bisect.bisect_right(los, a) - 1
        return funcs[k] if k >= 0 and funcs[k][0] <= a < funcs[k][1] else None

    found = set()
    for lo, hi in funcs:
        for i in cfg.decode(lo, hi):
            if i.mnemonic.split(".")[0] != "jmp":
                continue
            m = re.fullmatch(r"\$([0-9a-fA-F]+)\(pc,\s*[ad]\d\.w\)",
                             (i.op_str or "").strip())
            if not m:
                continue
            base = int(m.group(1), 16)
            limit = base + 0x200
            k = 0
            while base + k * 2 < limit:
                off = int.from_bytes(cfg.UP[base + k * 2:base + k * 2 + 2],
                                     "big", signed=True)
                t = base + off
                h = host(t)
                if off == 0 or h is None or t not in bounds.get(h[0], ()):
                    break
                limit = min(limit, t)
                if t != h[0]:
                    found.add(t)
                k += 1
    return found


jt = fresh_jump_targets()
always = jt | runtime | missing | ptrs | image_ptrs

reviewed_path = HERE / "reviewed_entries.json"
reviewed = json.loads(reviewed_path.read_text()) if reviewed_path.exists() else {}
judged_data = {int(k, 16) for k, v in reviewed.items()
               if v.get("verdict") == "data"}

kept = set(inner)
bare_kept = set()
while True:
    refs = set()
    areg = set()
    bare = set()
    for row in blocks:
        at = row["at"]
        if at in inner and at not in kept:
            continue
        src = row.get("src", "")
        for m in CALL.finditer(src):
            refs.add(int(m.group(1), 16))
        for m in AREG.finditer(src):
            areg.add(int(m.group(1), 16))
        for m in BARE.finditer(src):
            bare.add(int(m.group(1), 16))
    nxt = {e for e in kept
           if e in always or e in refs or e in areg
           or (e in bare and e not in judged_data)}
    bare_kept = {e for e in nxt
                 if e not in always and e not in refs and e not in areg}
    if nxt == kept:
        break
    kept = nxt

if bare_kept:
    print("kept only by a bare address assignment - read these:")
    for e in sorted(bare_kept):
        print(f"  {e:06x}")

dropped = sorted(set(inner) - kept)
why = {}
for e in sorted(kept):
    r = []
    if e in jt:
        r.append("jump table")
    if e in runtime or e in missing:
        r.append("runtime")
    if e in ptrs:
        r.append("pointer table")
    if e in image_ptrs:
        r.append("image pointer")
    why[hex(e)] = r or ["lifted reference"]

print(f"inner entries: {len(inner)}   kept: {len(kept)}   dropped: {len(dropped)}")
for e in dropped:
    print(f"  dropped {e:06x}")

json.dump(sorted(kept), open(HERE / "out" / "inner_entries.json", "w"))
json.dump({"dropped": dropped, "kept_because": why},
          open(HERE / "out" / "dropped-entries.json", "w"), indent=1)
print("wrote out/inner_entries.json, out/dropped-entries.json")
