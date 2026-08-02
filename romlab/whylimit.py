"""Which parameters called `limit` or `end` are not bounds?

`unnamedParams` counts parameters that are still called `d0` or `arg3`. It
cannot see one confidently called `limit` that holds a packed coordinate, and
this repo's standard is that such a name costs MORE than the register would
have. Two of those were found by accident while reading routines for other
reasons - 0x3ba4's `limit` was a coordinate, 0x2698's `limit` was a coordinate
and its `limit2` a kind - so the third one was worth looking for on purpose.

`roles.py` gives `limit` to a value nothing writes through, indexes with or
counts down, but which a comparison tests. A comparison against ZERO passes
that test, and "limit" then claims a bound the routine never applies. Worse,
`paramnames.py` and `callernames.py` propagate a name along the call graph
without re-checking it, so one bad `limit` spreads to everything it is handed
to - which is why `negateStore`'s still says `limit` although baseline.json
recorded that exact parameter as a working value and not a bound, and the
order guard that was added for it fires at the ROLE stage only.

This prints the parameters whose name claims a bound and whose only constant
comparison is against zero. They are not renamed in bulk: "only ever tested
against zero" could be a flag, a count checked for exhaustion or a pointer
checked for null, and picking one would be another guess. They get fixed as
their routines are read, and the count here is how many are left.

    python3 whylimit.py [--list]
"""
import collections
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
SRC = HERE.parent / "frontend" / "src" / "rom" / "decompiled.ts"
FUNC = re.compile(r"^export function (\w+)\(([^)]*)\): void \{$", re.M)
CLAIMS_BOUND = re.compile(r"^(limit|end)\d*$")


def split_functions(text):
    out = []
    for m in FUNC.finditer(text):
        start = m.start()
        end = text.find("\n}\n", start)
        end = len(text) if end < 0 else end + 3
        out.append((m.group(1), m.group(2), text[start:end]))
    return out


def main():
    show = "--list" in sys.argv
    text = SRC.read_text(encoding="utf-8")
    bins = collections.Counter()
    suspect = []
    for fn, sig, body in split_functions(text):
        for p in [s.strip() for s in sig.split(",") if s.strip()]:
            name = p.split(":")[0].strip().rstrip("_")
            if not CLAIMS_BOUND.match(name):
                continue
            consts = set(re.findall(
                rf"setFlagsCmp\(\(?{re.escape(name)}\b[^,]*, (0x[0-9a-f]+|\d+),",
                body))
            if consts == {"0"}:
                bins["compared only against zero - not a bound"] += 1
                suspect.append(f"{fn}({name})")
            elif consts:
                bins["compared against a non-zero constant"] += 1
            else:
                bins["no constant comparison - compared against a value"] += 1

    print(f"parameters whose name claims a bound: {sum(bins.values())}")
    for k, v in bins.most_common():
        print(f"{v:5}  {k}")
    if show:
        for s in suspect:
            print("   ", s)


if __name__ == "__main__":
    main()
