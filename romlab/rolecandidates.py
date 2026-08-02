"""Measure a candidate role rule before adding it.

`roles.py` carries its own standard, twice over: a "shift" role was built,
found to name nothing, and removed, with a note saying not to re-add it
without checking the count moves; and a widened comparison detector was
measured at 15 parameters against 149 before the wider form was kept. This is
the instrument that makes that cheap - it runs a candidate predicate over
every still-unnamed parameter in the emitted source and says how many it would
reach, with examples to read.

Candidates live in `CANDIDATES` as (name, predicate). A predicate takes the
parameter's local name and the routine's body and returns a role word or None.

    python3 rolecandidates.py [--sample N]
"""
import collections
import pathlib
import re
import sys

import roles

HERE = pathlib.Path(__file__).parent
SRC = HERE.parent / "frontend" / "src" / "rom" / "decompiled.ts"

REG_PARAM = re.compile(r"^[ad]\d+_?\d*$")
FUNC = re.compile(r"^export function (\w+)\(([^)]*)\): void \{$", re.M)
REPOINT = re.compile(r"\b(\w+) = \(0x[0-9a-f]{4,6}\) >>> 0;")


def split_functions(text):
    out = []
    for m in FUNC.finditer(text):
        start = m.start()
        end = text.find("\n}\n", start)
        end = len(text) if end < 0 else end + 3
        out.append((m.group(1), m.group(2), text[start:end]))
    return out


def equality_constants(name, body):
    """The distinct constants this parameter is compared EQUAL or UNEQUAL to.

    `roles.py` reads its constants out of `setFlagsCmp((x ...), K, w)`, which
    is the flag write. The branch that follows is a JavaScript comparison, and
    for an equality test that is the only place the constant appears in a form
    worth reading: `if (((d0 & 65535)) !== ((0) & 65535))`. Nothing in roles.py
    matches it, so a routine that only ever asks whether its parameter equals
    something has no role at all.
    """
    n = re.escape(name)
    out = set()
    for m in re.finditer(
            rf"\({n}\b[^;\n]{{0,80}}?\)\s*[!=]==\s*\(*(0x[0-9a-f]+|\d+)",
            body):
        out.add(m.group(1))
    for m in re.finditer(
            rf"\(*(0x[0-9a-f]+|\d+)[^;\n]{{0,20}}?\)*\s*[!=]==\s*\(*{n}\b",
            body):
        out.add(m.group(1))
    return out


def cand_kind(name, body):
    """Two or more different constants, by equality: the routine is asking
    which of several things it was handed."""
    if len(equality_constants(name, body)) >= 2:
        return "kind"
    return None


def cand_flag(name, body):
    """Only ever tested against zero, and nothing else: a yes or no.

    With the order guard `roles.py` already carries, and it is the whole rule
    rather than a detail. `counterStep`'s d2 has its low word replaced -
    `d2 = ((d2 & 0xffff0000) | (t2 & 65535))` - and only then is asked whether
    it is zero, so the test is about a value the routine computed and calling
    the PARAMETER `flag` would describe something that arrived later. That is
    the defect this file's history is full of: negateStore's d3 was called
    `limit` for a comparison against a byte it had just overwritten. The test
    is order - the zero test must happen before anything writes the local.
    """
    n = re.escape(name)
    if equality_constants(name, body) != {"0"}:
        return None
    tested = re.search(rf"\({n}\b[^;\n]{{0,80}}?\)\s*[!=]==\s*\(*0", body)
    reassigned = re.search(rf"^  +{n} = (?!{n}_;)", body, re.M)
    if not tested or not roles.tested_first(tested, reassigned):
        return None
    # Nothing else may be done with it, or the zero test is incidental.
    if re.search(rf"load\d+\({n}\b|store\d+\({n}\b", body):
        return None
    if re.search(rf"{n} = \({n} [-+*&|^]", body):
        return None
    return "flag"


def cand_written_to(name, body):
    """A value the routine only ever stores to one fixed address."""
    n = re.escape(name)
    if re.search(rf"load\d+\({n}\b|store\d+\({n}\b", body):
        return None
    dests = set(re.findall(rf"store\d+\((0x[0-9a-f]+), \(?{n}\b", body))
    if len(dests) == 1:
        return "stored"
    return None


CANDIDATES = [
    ("kind (equality, two or more constants)", cand_kind),
    ("flag (only ever tested against zero)", cand_flag),
    ("stored (only ever written to one address)", cand_written_to),
]


def main():
    sample = 0
    if "--sample" in sys.argv:
        sample = int(sys.argv[sys.argv.index("--sample") + 1])
    text = SRC.read_text(encoding="utf-8")

    hits = collections.Counter()
    examples = collections.defaultdict(list)
    unnamed = 0
    for fn, sig, body in split_functions(text):
        repointed = set(REPOINT.findall(body))
        for p in [s.strip() for s in sig.split(",") if s.strip()]:
            nm = p.split(":")[0].strip()
            if not REG_PARAM.match(nm):
                continue
            unnamed += 1
            name = nm.rstrip("_")
            if roles.role(name, body, name.startswith("a")):
                continue
            if name in repointed:
                continue           # roles.py refuses these, and is right to
            for label, fn_ in CANDIDATES:
                if fn_(name, body):
                    hits[label] += 1
                    if len(examples[label]) < sample:
                        examples[label].append(f"{fn}({nm})")

    print(f"still unnamed: {unnamed}")
    for label, _ in CANDIDATES:
        print(f"{hits[label]:6}  would be named by: {label}")
        for e in examples[label]:
            print(f"          {e}")


if __name__ == "__main__":
    main()
