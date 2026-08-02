"""Why did `roles.py` decline to name this parameter?

`roles.py` runs at lift time and names a parameter from what its own routine
does with it. It is the bottom of the naming chain: `paramnames.py` and
`callernames.py` both only move names that already exist, so every unnamed
parameter is one `roles.py` had nothing to say about.

This replays its decision against the *emitted* source and reports which test
came out empty, so the answer to "what rule is missing" is a count rather than
a guess.

    python3 whyrole.py [--sample N]
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


def main():
    sample = 0
    if "--sample" in sys.argv:
        sample = int(sys.argv[sys.argv.index("--sample") + 1])
    text = SRC.read_text(encoding="utf-8")

    bins = collections.Counter()
    examples = collections.defaultdict(list)
    for fn, sig, body in split_functions(text):
        repointed = set(REPOINT.findall(body))
        for p in [s.strip() for s in sig.split(",") if s.strip()]:
            nm = p.split(":")[0].strip()
            if not REG_PARAM.match(nm):
                continue
            name = nm.rstrip("_")
            got = roles.role(name, body, name.startswith("a"))
            if got and name in repointed:
                kind = f"role `{got}`, refused because the register is repointed"
            elif got:
                kind = f"role `{got}` - should already be named"
            elif name in repointed:
                kind = "no role, and the register is repointed"
            else:
                # Nothing the routine does with it says anything. Split by
                # whether it does anything with it at all.
                n = re.escape(name)
                uses = re.findall(r"(?<![\w'])" + n + r"_?(?![\w'])", body)
                spills = re.findall(r"setReg\('\w+', " + n + r"\)", body)
                if len(uses) - len(spills) <= 2:
                    kind = "never read - preserved across the body and nothing else"
                else:
                    kind = "read, but no rule matches what it is read for"
            bins[kind] += 1
            if len(examples[kind]) < sample:
                examples[kind].append(f"{fn}({nm})")

    print(f"unnamed parameters: {sum(bins.values())}")
    for kind, count in bins.most_common():
        print(f"{count:6}  {kind}")
        for e in examples[kind]:
            print(f"          {e}")


if __name__ == "__main__":
    main()
