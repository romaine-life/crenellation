"""Apply role rules to the emitted source, without regenerating it.

`roles.py` runs inside the lifter, so a new rule there costs a full
regeneration - and its rules read the *emitted* body text anyway, which means
they can just as well be applied afterwards. This is where a rule that was
measured with `rolecandidates.py` and found to pay gets applied, in the same
place as the other naming passes and under the same conditions: renames only,
idempotent, and nothing that already has a name is touched.

WHAT IS HERE, AND WHAT WAS MEASURED AND LEFT OUT. `roles.py` carries the
standard - a "shift" role was built, found to name nothing and removed, with
an instruction not to re-add it without checking the count moves - so the
rejects are recorded as loudly as the keeper.

  flag      Only ever tested against zero, and tested BEFORE anything writes
            the local. 22 parameters. Small, and kept because it is right:
            a routine that asks nothing of a value except whether it is set
            has told the reader what the value is for.

  kind, by equality. `roles.py` reads its constants out of `setFlagsCmp`, and
            an equality test puts the constant in the branch instead - so a
            routine that only ever asks whether its parameter equals one of
            several constants has no role at all. Measured: TWO parameters in
            the whole file. Not added. Do not add it without re-measuring.

  stored    A value the routine only ever writes to one fixed address, which
            would take its name from the data map. Measured: ZERO. The shape
            does not occur - a parameter written straight to an absolute
            address without being read or combined first is not something this
            ROM does.

The order guard is the whole discipline and it is why `flag` is 22 rather than
149. `counterStep` replaces the low word of its d2 - `d2 = ((d2 & 0xffff0000)
| (t2 & 65535))` - and only then asks whether it is zero. The test is about a
value the routine computed, so naming the PARAMETER for it would describe
something that arrived later. 127 of the 149 were that shape.

    python3 moreroles.py [--dry]
"""
import pathlib
import re
import sys

import roles
from rolecandidates import cand_flag

HERE = pathlib.Path(__file__).parent
DEST = HERE.parent / "frontend" / "src" / "rom" / "decompiled.ts"

REG_PARAM = re.compile(r"^[ad]\d+_?\d*$")
FUNC = re.compile(r"^export function (\w+)\(([^)]*)\): void \{$", re.M)
REPOINT = re.compile(r"\b(\w+) = \(0x[0-9a-f]{4,6}\) >>> 0;")

RULES = [cand_flag]


def split_functions(text):
    out = []
    for m in FUNC.finditer(text):
        start = m.start()
        end = text.find("\n}\n", start)
        end = len(text) if end < 0 else end + 3
        out.append((m.group(1), m.group(2), text[start:end], (start, end)))
    return out


def main():
    dry = "--dry" in sys.argv
    text = DEST.read_text(encoding="utf-8")
    funcs = split_functions(text)

    moved = 0
    pieces = []
    for name, sig, body, (start, end) in funcs:
        repointed = set(REPOINT.findall(body))
        want = {}
        for p in [s.strip() for s in sig.split(",") if s.strip()]:
            nm = p.split(":")[0].strip()
            if not REG_PARAM.match(nm):
                continue
            local = nm.rstrip("_")
            # The one refusal roles.py makes that this pass keeps: a register
            # later pointed at a constant address is not one thing for the
            # length of the routine, and a role name would claim it is.
            if local in repointed:
                continue
            # roles.py's own rules first, because a parameter that is STILL
            # called `a3` is one its rules never reached - not one they
            # declined. The single-block routines never go through blocks.py,
            # and `roles.apply` is called on the blocks.py output, so 29
            # parameters that roles.py names perfectly well - countOneOffByteA3
            # stores through its a3 and reads through it, which is `dst` - kept
            # the register they arrived in. Asking `role()` here reaches them,
            # and cannot double-name anything: a parameter that already has a
            # role name no longer matches REG_PARAM.
            got = roles.role(local, body, local.startswith("a"))
            if not got:
                for rule in RULES:
                    got = rule(local, body)
                    if got:
                        break
            if got:
                want[local] = got
        if not want:
            continue
        words = set(re.findall(r"[A-Za-z_]\w*", body))
        new = body
        for local, got in sorted(want.items()):
            cand, k = got, 2
            while cand in words:
                cand = f"{got}{k}"
                k += 1
            words.add(cand)
            new = re.sub(r"(?<!')\b" + re.escape(local) + r"(_?)\b(?!')",
                         lambda m: cand + m.group(1), new)
            moved += 1
        pieces.append((start, end, new))

    out, cur = [], 0
    for start, end, new in pieces:
        out.append(text[cur:start])
        out.append(new)
        cur = end
    out.append(text[cur:])
    if not dry:
        DEST.write_text("".join(out), encoding="utf-8")
    print(f"parameters named from a role the lifter's own rules do not have:"
          f" {moved}")


if __name__ == "__main__":
    main()
