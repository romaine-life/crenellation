"""Of the parameters that are only ever passed on, why did the callee not name
them?

`paramnames.py` names a parameter after the callee parameter it is handed to,
and `whyunnamed.py` says 1,957 unnamed parameters are handed to a callee and
otherwise untouched. So for each of those the callee declined, and the reason
is one of a small number of things. This counts them.

    python3 whypassed.py
"""
import collections
import pathlib
import re

HERE = pathlib.Path(__file__).parent
SRC = HERE.parent / "frontend" / "src" / "rom" / "decompiled.ts"

REG_PARAM = re.compile(r"^[ad]\d+_?\d*$")
ENTRY = re.compile(
    r"\{ at: (0x[0-9a-f]+), fn: (\w+) as [^,]+, params: \[(.*?)\] \}")
REG_SOURCE = re.compile(r"\{ from: 'reg', name: '(\w+)'")
SPILL = re.compile(r"setReg\('(\w+)', (\w+)\);")
CALL = re.compile(r"call(?:Rom|Decompiled)\((0x[0-9a-f]+)")
FUNC = re.compile(r"^export function (\w+)\(([^)]*)\): void \{$", re.M)


def split_functions(text):
    out = []
    for m in FUNC.finditer(text):
        start = m.start()
        end = text.find("\n}\n", start)
        end = len(text) if end < 0 else end + 3
        out.append((m.group(1), m.group(2), text[start:end]))
    return out


def main():
    text = SRC.read_text(encoding="utf-8")
    funcs = split_functions(text)
    by_name = {n: (sig, body) for n, sig, body in funcs}
    addr_fn = {int(m.group(1), 16): m.group(2) for m in ENTRY.finditer(text)}

    # reg -> parameter name for every routine, named or not.
    reg_param = {}
    for m in ENTRY.finditer(text):
        fn = m.group(2)
        if fn not in by_name:
            continue
        sig = [p.strip().split(":")[0].strip()
               for p in by_name[fn][0].split(",") if p.strip()]
        sources = [s.strip() for s in m.group(3).split("}, ") if s.strip()]
        for i, s in enumerate(sources):
            r = REG_SOURCE.match(s)
            if not r or i >= len(sig):
                continue
            reg_param.setdefault(fn, {})[r.group(1)] = sig[i].rstrip("_")

    why = collections.Counter()
    where = collections.defaultdict(collections.Counter)
    for name, sig, body in funcs:
        params = {p.strip().split(":")[0].strip().rstrip("_")
                  for p in sig.split(",") if p.strip()}
        unnamed = {p for p in params if REG_PARAM.match(p)}
        if not unnamed:
            continue
        lines = body.split("\n")
        reached = collections.defaultdict(list)
        for i, line in enumerate(lines):
            spills = SPILL.findall(line)
            if not spills:
                continue
            target = None
            for j in range(i, min(i + 12, len(lines))):
                c = CALL.search(lines[j])
                if c:
                    target = int(c.group(1), 16)
                    break
            for reg, local in spills:
                if local in unnamed:
                    reached[local].append((target, reg))
        for p in unnamed:
            hits = reached.get(p)
            if not hits:
                why["never handed to a call at all"] += 1
                continue
            reasons = set()
            for target, reg in hits:
                if target is None:
                    reasons.add("spill with no call after it")
                    continue
                callee = addr_fn.get(target)
                if callee is None:
                    reasons.add("callee not in the table")
                    continue
                got = reg_param.get(callee, {}).get(reg)
                if got is None:
                    reasons.add("callee takes no parameter in that register")
                    continue
                if REG_PARAM.match(got):
                    reasons.add("callee's parameter is unnamed too")
                    where["callee's parameter is unnamed too"][callee] += 1
                    continue
                reasons.add("named - should not be in this list")
            for r in sorted(reasons)[:1]:
                why[r] += 1

    print("of the unnamed parameters, the reason the call graph did not name"
          " them:")
    for reason, count in why.most_common():
        print(f"{count:6}  {reason}")
    print()
    print("the callees whose own unnamed parameters block the most:")
    for callee, count in where["callee's parameter is unnamed too"].most_common(15):
        print(f"{count:6}  {callee}")


if __name__ == "__main__":
    main()
