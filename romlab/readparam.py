"""Print the lines that mention an unnamed parameter, so a reader can see what
rule would name it.

`whyrole.py` counts the bins; this one shows the contents of a bin, because
"read, but no rule matches what it is read for" is 2,171 parameters and the
next rule is in the text rather than in the count.

    python3 readparam.py [count] [--bin SUBSTRING] [--fn NAME]
"""
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
    want = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 12
    only_fn = None
    if "--fn" in sys.argv:
        only_fn = sys.argv[sys.argv.index("--fn") + 1]
    text = SRC.read_text(encoding="utf-8")

    shown = 0
    for fn, sig, body in split_functions(text):
        if only_fn and fn != only_fn:
            continue
        repointed = set(REPOINT.findall(body))
        for p in [s.strip() for s in sig.split(",") if s.strip()]:
            nm = p.split(":")[0].strip()
            if not REG_PARAM.match(nm):
                continue
            name = nm.rstrip("_")
            if not only_fn:
                if roles.role(name, body, name.startswith("a")):
                    continue
                if name in repointed:
                    continue
            n = re.escape(name)
            use = re.compile(r"(?<![\w'])" + n + r"_?(?![\w'])")
            lines = [l.strip() for l in body.split("\n")
                     if use.search(l) and "SPILL_ALL" not in l]
            lines = [l for l in lines
                     if not re.fullmatch(rf"setReg\('\w+', {n}\);(?: return;)?", l)]
            if not lines:
                continue
            print(f"--- {fn}({nm})")
            for l in lines[:14]:
                print(f"    {l}")
            shown += 1
            if shown >= want:
                return


if __name__ == "__main__":
    main()
