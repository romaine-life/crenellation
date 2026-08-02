"""Is the parameter an input at all?

`whyrole.py` says 2,171 of the unnamed parameters are read for something no
rule matches, and `readparam.py` shows what that reading looks like. It is
mostly not reading:

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
  saved         the first thing is `push`, and nothing else ever reads it. The
                routine preserves it for its caller and does not use it.
  input         something reads it before anything overwrites it.

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


TRANSFER = re.compile(r"call(?:Rom|Decompiled)\(|jumpRom\(|setSr\(")


def first_use(body, name):
    """What the routine does with `name` before anything overwrites it."""
    n = re.escape(name)
    use = re.compile(r"(?<![\w'])" + n + r"(?![\w'])")
    assign = re.compile(r"^\s*" + n + r" = (.*);$")
    lines = body.split("\n")
    saved = False
    for i, line in enumerate(lines):
        # The declaration and the interrupt spill are bookkeeping, not use.
        if re.match(r"^\s*let " + n + r" = " + n + r"_;$", line):
            continue
        if "SPILL_ALL" in line or "takeIrq" in line:
            continue
        # A bare `setReg('a0', a0)` is either an argument being handed to the
        # call that follows it - a real read of the value - or the register
        # being written back on the way out, which restores what arrived and
        # carries nothing. The difference is whether a transfer follows, and
        # getting it wrong is the difference between `kickWatchdogWrapper`
        # taking a0 and passing it straight to 0x618, which it does, and
        # appearing to ignore it, which is what the first version of this
        # measurement reported.
        if re.fullmatch(r"\s*setReg\('\w+', " + n + r"\);(?: return;)?", line):
            if any(TRANSFER.search(lines[j])
                   for j in range(i + 1, min(i + 8, len(lines)))):
                return "input"
            continue
        if not use.search(line):
            continue
        if TRANSFER.search(line):
            return "input"
        a = assign.match(line)
        if a:
            rhs = a.group(1)
            if not use.search(rhs):
                return "saved-then-overwritten" if saved else "overwritten"
            if re.match(r"^\(\(" + n + r" & 0x[0-9a-f]+\) \|", rhs):
                return "narrowed"
            return "input"
        if re.fullmatch(r"\s*push\(" + n + r", \d+\);", line):
            saved = True
            continue
        if re.fullmatch(r"\s*save_\w+ = " + n + r";", line):
            continue
        return "input"
    return "saved-and-never-read" if saved else "never-mentioned"


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
    dead = sum(c for k, c in bins.items() if k != "input")
    print()
    print(f"{dead} of {total} carry nothing into the routine:"
          f" the lifter made a parameter of a register the routine never reads")


if __name__ == "__main__":
    main()
