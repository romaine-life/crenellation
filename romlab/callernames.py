"""Callers name their callee's parameters, where the callee has nothing to say.

`paramnames.py` runs the call graph one way: a local handed to a named callee
parameter takes that name. This is the other way, and it was tried once before
and withdrawn - the note in `paramnames.py` records why. It reported 3,247
renames and moved the named-parameter count by zero, because it was rewriting
parameters that already had names.

The measurement that withdrew it also says how to try it again: restrict it to
parameters that have no name, and judge it by the count in `names.txt` rather
than by the number of renames. That is what this does.

The evidence is the same evidence, and for these parameters it is stronger.
`whypassed.py` says the reason 2,847 of the 3,142 unnamed parameters were not
named by the callee direction is that they are never handed to a call in that
register at all: the routine receives the register, never reads it, and spills
it back to the machine at every sync point and at return. The lifter makes
every live register a parameter, so a routine that merely has to preserve d3
across its body takes d3 as a parameter and does nothing with it. There is
nothing the routine can say about such a value - but the caller knows exactly
what it is, because the caller computed it.

The rule:

  - Find every call site of a routine: `setReg('d1', local); ... callRom(F)`.
  - A parameter takes a name only if the call sites AGREE on it, and that name
    is not itself a register, a temporary or an argN slot.
  - At least one call site must exist. A routine nobody calls has no evidence.

Agreement is the whole discipline. A parameter fed `count` by one caller and
`colour` by another is not either of those things, and picking the more common
one would be a guess dressed as a measurement.

It runs in two passes and the order matters. The first demands that EVERY call
site hands the same name. The second accepts a name that every caller which
says anything agrees on, and there the callers handing a bare `d3` are not
disagreeing - they have nothing to say, because the lifter made a parameter of
a register their own routine never reads. That is a weaker claim than
unanimity and it is stated separately for that reason, but it is not the
majority rule this file rejects: no caller contradicts the name, and one
caller stating it is one more than none. Measured at 91 parameters after the
strict pass had run to a fixed point. Strict runs first so a name all callers
agree on is never displaced by one only some of them state.

Run after `paramnames.py`, which is the last step of the regeneration chain.
It rewrites `decompiled.ts` in place and is idempotent - a parameter that has
a name is left alone, so a second run reports zero.

    python3 callernames.py [--dry]
"""
import collections
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
DEST = HERE.parent / "frontend" / "src" / "rom" / "decompiled.ts"

REG_PARAM = re.compile(r"^[ad]\d+_?\d*$")
ENTRY = re.compile(
    r"\{ at: (0x[0-9a-f]+), fn: (\w+) as [^,]+, params: \[(.*?)\] \}")
REG_SOURCE = re.compile(r"\{ from: 'reg', name: '(\w+)'")
SPILL = re.compile(r"setReg\('(\w+)', (\w+)\);")
CALL = re.compile(r"call(?:Rom|Decompiled)\((0x[0-9a-f]+)")
FUNC = re.compile(r"^export function (\w+)\(([^)]*)\): void \{$", re.M)
# A name that says nothing: the register it arrived in, or a stack slot with a
# number on it. Propagating either is propagating the non-answer.
SAYS_NOTHING = re.compile(r"^(?:[ad]\d+_?\d*|arg\d+|t\d+|_t\d+)$")
# A spilled value can be a constant - `setReg('d0', 5)` - and `\w+` matches
# it. stackargnames.py renamed a parameter to `02` before this guard existed.
IDENT = re.compile(r"^[A-Za-z_]\w*$")


def split_functions(text):
    out = []
    for m in FUNC.finditer(text):
        start = m.start()
        end = text.find("\n}\n", start)
        end = len(text) if end < 0 else end + 3
        out.append((m.group(1), m.group(2), text[start:end], (start, end)))
    return out


def call_sites(funcs):
    """For every callee address, the local each caller spills into each register.

    A spill belongs to the call that follows it within a few lines: the lifter
    emits a routine's arguments immediately before its transfer. The same
    window `paramnames.py` uses, for the same reason.
    """
    sites = collections.defaultdict(lambda: collections.defaultdict(list))
    for _, _, body, _ in funcs:
        lines = body.split("\n")
        pending = []
        for line in lines:
            spills = SPILL.findall(line)
            c = CALL.search(line)
            if spills and not c:
                # An interrupt spill is not an argument: it is the whole live
                # set written back so a handler can run. It is recognisable -
                # it sits inside the `if (_tN || SPILL_ALL)` guard - and it
                # would otherwise make every live register look like an
                # argument to whatever call comes next.
                if "SPILL_ALL" in line or "takeIrq" in line:
                    pending = []
                    continue
                pending.extend(spills)
                if len(pending) > 24:
                    pending = pending[-24:]
                continue
            if c:
                target = int(c.group(1), 16)
                for reg, local in spills + pending:
                    sites[target][reg].append(local)
            pending = []
    return sites


def pass_over(text, strict):
    """Name what the callers agree on, to a fixed point. Returns text, count."""
    total, rounds = 0, 0
    while True:
        rounds += 1
        funcs = split_functions(text)
        by_name = {n: (sig, body) for n, sig, body, _ in funcs}
        sites = call_sites(funcs)

        # Which routine sits at each address, and which register each of its
        # parameters arrives in.
        want = {}
        for m in ENTRY.finditer(text):
            addr, fn = int(m.group(1), 16), m.group(2)
            if fn not in by_name:
                continue
            sig = [p.strip().split(":")[0].strip()
                   for p in by_name[fn][0].split(",") if p.strip()]
            sources = [s.strip() for s in m.group(3).split("}, ") if s.strip()]
            for i, s in enumerate(sources):
                r = REG_SOURCE.match(s)
                if not r or i >= len(sig):
                    continue
                param = sig[i].rstrip("_")
                if not REG_PARAM.match(param):
                    continue                      # it already says something
                handed = sites.get(addr, {}).get(r.group(1))
                if not handed:
                    continue
                names = {h.rstrip("_") for h in handed}
                speaking = {n for n in names
                            if not SAYS_NOTHING.match(n) and IDENT.match(n)}
                if len(speaking) != 1:
                    continue                      # callers disagree, or none
                if strict and len(names) != 1:
                    continue                      # some caller had no name
                want.setdefault(fn, {})[param] = speaking.pop()

        if not want:
            break
        moved = 0
        pieces = []
        for name, sig, body, (start, end) in funcs:
            renames = want.get(name)
            if not renames:
                continue
            words = set(re.findall(r"[A-Za-z_]\w*", body))
            new = body
            for local, got in sorted(renames.items()):
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
        text = "".join(out)
        total += moved
        # A parameter named this round is a named local at every call site of
        # whatever it is handed to next round, so this compounds the same way
        # `paramnames.py` does.
        if not moved or rounds > 8:
            break
    return text, total


def main():
    dry = "--dry" in sys.argv
    text = DEST.read_text(encoding="utf-8")
    # Unanimity first, then the weaker reading of it, and in that order so a
    # name that ALL callers agree on is never displaced by one only some of
    # them state.
    text, strict = pass_over(text, True)
    text, loose = pass_over(text, False)
    if not dry:
        DEST.write_text(text, encoding="utf-8")
    print(f"parameters named from what every caller calls them: {strict}"
          f" unanimously, {loose} where every caller that says anything agrees")


if __name__ == "__main__":
    main()
