"""Why is a parameter still called `d0_`?

The function half of the naming bar is met and the parameter half is not, so
the question is which rule is missing rather than how many are left. This is
the parameter-side counterpart of `WHYDISPATCH=1 python3 blocks.py`: it reads
`decompiled.ts`, finds every parameter still named for the register it arrived
in, and bins it by what the routine actually does with it.

A bin with a large count and an obvious word for it is the next rule. A bin
that is large and genuinely has nothing to say - a register the routine never
touches at all - is not a missing rule and should not get one.

    python3 whyunnamed.py [--sample N]
"""
import collections
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
SRC = HERE.parent / "frontend" / "src" / "rom" / "decompiled.ts"

REG_PARAM = re.compile(r"^[ad]\d+_?\d*$")
FUNC = re.compile(r"^export function (\w+)\(([^)]*)\): void \{$", re.M)


def split_functions(text):
    out = []
    for m in FUNC.finditer(text):
        start = m.start()
        end = text.find("\n}\n", start)
        end = len(text) if end < 0 else end + 3
        out.append((m.group(1), m.group(2), text[start:end]))
    return out


def classify(name, body):
    """One word for what the routine does with this parameter."""
    n = re.escape(name)
    uses = re.findall(r"(?<![\w'])" + n + r"_?(?![\w'])", body)
    # The declaration `let d0 = d0_;` is two of them and says nothing.
    if len(uses) <= 2:
        return "untouched"
    spilled = re.search(rf"setReg\('\w+', {n}\)", body)
    deref = re.search(rf"load\d+\({n}\b|store\d+\({n}\b|load\d+\(\({n} ", body)
    arith = re.search(rf"{n} = \({n} [-+*&|^]", body)
    masked = re.search(rf"{n} & 0x", body)
    tested = re.search(rf"setFlags\w*\(\(?{n}\b", body)
    returned = re.search(r"setReg\('\w+', " + n + r"\);\s*\n\s*(?:return|\})",
                         body)
    if spilled and not (deref or arith or tested):
        return "passed-on-only"
    if deref:
        return "dereferenced"
    if tested and not arith:
        return "tested"
    if arith or masked:
        return "computed"
    if returned:
        return "returned"
    return "other"


def main():
    sample = 0
    if "--sample" in sys.argv:
        sample = int(sys.argv[sys.argv.index("--sample") + 1])
    text = SRC.read_text(encoding="utf-8")

    bins = collections.Counter()
    examples = collections.defaultdict(list)
    argn = 0
    total = named = 0
    for fn, sig, body in split_functions(text):
        for p in [s.strip() for s in sig.split(",") if s.strip()]:
            nm = p.split(":")[0].strip()
            total += 1
            if not REG_PARAM.match(nm):
                named += 1
                if re.match(r"^arg\d+$", nm):
                    argn += 1
                continue
            kind = classify(nm.rstrip("_"), body)
            bins[kind] += 1
            if len(examples[kind]) < sample:
                examples[kind].append(f"{fn}({nm})")

    print(f"parameters {total}, named {named}, unnamed {total - named}")
    print(f"  of the named, {argn} are `argN` - a stack slot with a number,"
          f" which says as little as a register does")
    print()
    for kind, count in bins.most_common():
        print(f"{count:6}  {kind}")
        for e in examples[kind]:
            print(f"          {e}")


if __name__ == "__main__":
    main()
