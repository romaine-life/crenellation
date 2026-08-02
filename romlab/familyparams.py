"""Apply one set of register names to a routine and every inner entry of it.

An inner entry is not a routine. `0x11ea`, `0x1204` and `0x1214` are three
points inside `0xe4e`'s loop, entered by branches from within it, and the
lifter gives each its own signature carrying the same live registers the host
has - because they ARE the same registers, in the same code. So a register read
once is named once and written to every entry of the family.

WHERE THIS DOES NOT APPLY, and it is worth knowing before reaching for it. A
family is safe when the entries are points in ONE piece of logic sharing one
set of registers - a loop's row tail, a test chain's steps. It is NOT safe when
the host is a block of separate handlers side by side, which is what a jump
table produces: 0x1262a's 612 bytes are about ten palette handlers, and its d2
is one colour channel in the first, a 0x7bde7bde mask in the third and
something else again further down. One name across those would be right at the
top and wrong by the bottom, which is the same defect that took namedParams
from 2852 to 2314. Name what the handlers genuinely share - the record they are
handed, the operand the dispatcher pre-fetched - and leave the rest.

Used from `params.curated.json` by hand, this would be the same block of JSON
copied five or ten times. This does the copying, and validates: a name is only
written where the lifter actually binds that slot, and anything it cannot place
is reported rather than silently dropped.

    python3 familyparams.py 0xe4e a3=leftCell "the cell address less one, ..."

More usefully it is imported, and `apply(host, {reg: {name, why}})` returns the
number of entries it reached.
"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
SRC = HERE.parent / "frontend" / "src" / "rom" / "decompiled.ts"
CURATED = HERE / "params.curated.json"
FACTS = HERE / "out" / "facts.json"

FUNC = re.compile(r"^export function (\w+)\(([^)]*)\): void \{$", re.M)
ENTRY = re.compile(
    r"\{ at: (0x[0-9a-f]+), fn: (\w+) as [^,]*, params: \[(.*?)\] \}")
SOURCE = re.compile(
    r"\{ from: 'reg', name: '(\w+)' \}|\{ from: 'stack', off: (-?\d+) \}")


def slots():
    """address -> the set of slots the lifter binds for it."""
    src = SRC.read_text(encoding="utf-8")
    sig = {m.group(1): m.group(2) for m in FUNC.finditer(src)}
    out = {}
    for m in ENTRY.finditer(src):
        a, fn = int(m.group(1), 16), m.group(2)
        names = [p.strip().split(":")[0].strip()
                 for p in sig.get(fn, "").split(",") if p.strip()]
        s = SOURCE.findall(m.group(3))
        if len(s) != len(names):
            continue
        out[a] = {(r or f"stack{o}") for r, o in s}
    return out


def family(host):
    """The host and every routine whose entry address falls inside its extent."""
    funcs = json.loads(FACTS.read_text())["funcs"]
    lo, hi = next(((a, b) for a, b in funcs if a == host), (host, host + 1))
    known = set(slots())
    return sorted(a for a in known if a == host or lo < a < hi)


def apply(host, names, save=True):
    bound = slots()
    cur = json.loads(CURATED.read_text(encoding="utf-8"))
    reached, missed = 0, []
    for a in family(host):
        key = hex(a)
        have = bound.get(a, set())
        here = cur.setdefault(key, {})
        wrote = False
        for reg, spec in names.items():
            if reg not in have:
                missed.append(f"{key}/{reg}")
                continue
            here[reg] = spec
            wrote = True
        if wrote:
            reached += 1
        if not here:
            del cur[key]
    if save:
        CURATED.write_text(json.dumps(cur, indent=2, ensure_ascii=False) + "\n",
                           encoding="utf-8")
    return reached, missed


def main():
    if len(sys.argv) < 4 or "=" not in sys.argv[2]:
        raise SystemExit(__doc__)
    host = int(sys.argv[1], 16)
    reg, name = sys.argv[2].split("=", 1)
    reached, missed = apply(host, {reg: {"name": name, "why": sys.argv[3]}})
    print(f"reached {reached} entries of 0x{host:05x}")
    if missed:
        print("  not bound there: " + ", ".join(missed))


if __name__ == "__main__":
    main()
