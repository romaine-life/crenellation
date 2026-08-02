"""Is the parameter an input at all?

`whyrole.py` bins the unnamed parameters by which of `roles.py`'s tests came
out empty, and its largest bin is "read, but no rule matches what it is read
for". `readparam.py` shows what that reading looks like, and mostly it is not
reading:

    let d1 = d1_;
    d1 = (0xaaaaaaaa) >>> 0;      // overwritten before anything looks at it
    push(d1, 4);

    let d2 = d2_;
    push(d2, 4);                  // saved, then overwritten
    d2 = (-1) >>> 0;

The lifter makes every register live across a routine into a parameter of it,
so a routine that merely has to preserve d3 takes d3 and does nothing with the
value. No rule will ever name those, because the routine has nothing to say -
and that is worth knowing as a number rather than as an impression.

This bins every unnamed parameter by what the FIRST thing the routine does
with it is, which is the only question that decides whether it is an input:

  overwritten   the first statement assigns it something that does not mention
                it. The incoming value is dead; the parameter carries nothing.
  narrowed      the first statement keeps some bits and replaces others -
                `d0 = ((d0 & 0xffffff00) | ...)`. The incoming value survives
                only in the bits nothing replaced.
  saved-then-overwritten
                the first thing is `push` - the value put back for the caller -
                and then it is overwritten. Preserved, never used.
  input         something reads it before anything overwrites it, INCLUDING an
                overwrite that only happens on some path: an assignment deeper
                than the routine's own brace level does not settle the
                question, so it counts as an input and the parameter stays.

AND THERE ARE NO PURELY LIVE-THROUGH ONES LEFT, measured 2026-08-02 after the
last few were named by hand: of the unnamed register parameters, ZERO have
every appearance be a spill. Every one is genuinely read, written or otherwise
used, which closes the last question about whether a rule could still name them
in bulk. It cannot. What is left is reading.

`narrowed` is not "carries nothing": the bits the routine does not replace are
still what the caller passed. It is reported separately for that reason, and
`dropunread.py` leaves it alone.

    python3 whyunread.py [--sample N]
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


# The classifier lives in `dropunread.py`, which is the pass that acts on it.
# It was copied here once and the two drifted the moment a guard was added to
# one of them: this file went on reporting 197 parameters as carrying nothing
# that the rewrite had already decided were inputs. A measurement that
# justifies a rewrite has to be the rewrite's own decision, not a second
# opinion that looks like it.
from dropunread import first_use


def main():
    sample = 0
    if "--sample" in sys.argv:
        sample = int(sys.argv[sys.argv.index("--sample") + 1])
    text = SRC.read_text(encoding="utf-8")

    bins = collections.Counter()
    examples = collections.defaultdict(list)
    for fn, sig, body in split_functions(text):
        for p in [s.strip() for s in sig.split(",") if s.strip()]:
            nm = p.split(":")[0].strip()
            if not REG_PARAM.match(nm):
                continue
            kind = first_use(body, nm.rstrip("_"))
            bins[kind] += 1
            if len(examples[kind]) < sample:
                examples[kind].append(f"{fn}({nm})")

    total = sum(bins.values())
    print(f"unnamed parameters: {total}")
    for kind, count in bins.most_common():
        print(f"{count:6}  {kind}")
        for e in examples[kind]:
            print(f"          {e}")
    dead = sum(c for k, c in bins.items()
               if k not in ("input", "narrowed"))
    print()
    print(f"{dead} of {total} carry nothing into the routine:"
          f" the lifter made a parameter of a register the routine never reads")
    print(f"{bins['narrowed']} more carry only the bits the routine does not"
          f" replace, and stay")


if __name__ == "__main__":
    main()
