"""Callees name their callers' parameters.

`roles.py` names a parameter from what its own routine does with it: a register
only ever dereferenced is a pointer, one counted down by a `dbra` is a count.
That leaves most of them, and the measurement says why - of 3,975 parameters
still called `d0_` or `a2_`, about 2,765 are only ever *passed on*. The routine
does nothing to them that could name them, because naming them is not its job.

The caller does not know, but the callee does. A lifted call looks like

    setReg('d1', d1);
    callRom(0x0255c, 0x01052);

and 0x0255C's parameter list says which of its parameters comes from d1 and
what that parameter is called. So a local handed to a named parameter takes
that name, with the call graph as the recorded evidence - exactly the argument
`idents.py` makes for naming a wrapper after the routine it wraps.

It compounds, so it runs to a fixed point: a parameter named this round is a
named callee parameter for the next, and a chain of forwarding wrappers
resolves from the inside out.

Run after `handedits.py`, last in the chain. It rewrites `decompiled.ts` in
place and is safe to run twice - a parameter that already has a name is left
alone, so a second run is a no-op and reports zero.

    python3 paramnames.py [--dry]
"""
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
DEST = HERE.parent / "frontend" / "src" / "rom" / "decompiled.ts"

# A parameter still named for the register it arrived in.
REG_PARAM = re.compile(r"^[ad]\d+_?\d*$")
# One entry of the DECOMPILED table: address, function name, parameter sources.
ENTRY = re.compile(
    r"\{ at: (0x[0-9a-f]+), fn: (\w+) as [^,]+, params: \[(.*?)\] \}")
REG_SOURCE = re.compile(r"\{ from: 'reg', name: '(\w+)'")
# `setReg('d1', d1);` - the spill that hands a local to the machine before a
# call. The value has to be a bare local: an expression is not the parameter,
# it is something computed from one, and naming it after the callee's
# parameter would be a claim about the arithmetic rather than about the call.
SPILL = re.compile(r"setReg\('(\w+)', (\w+)\);")
CALL = re.compile(r"call(?:Rom|Decompiled)\((0x[0-9a-f]+)")


def split_functions(text):
    """(name, signature, body, span) for each exported function."""
    out = []
    for m in re.finditer(r"^export function (\w+)\(([^)]*)\): void \{$",
                         text, re.M):
        start = m.start()
        end = text.find("\n}\n", start)
        end = len(text) if end < 0 else end + 3
        out.append((m.group(1), m.group(2), text[start:end], (start, end)))
    return out


def main():
    dry = "--dry" in sys.argv
    text = DEST.read_text(encoding="utf-8")
    funcs = split_functions(text)
    by_name = {n: (sig, body) for n, sig, body, _ in funcs}

    # Which register each routine takes each parameter in, and what that
    # parameter is called. The table's `params` list is positional against the
    # signature, so the two zip.
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
            name = sig[i].rstrip("_")
            if REG_PARAM.match(name):
                continue                      # nothing to pass on yet
            reg_param.setdefault(fn, {})[r.group(1)] = name

    # Address -> function name, so a `callRom(0xNNNNN, ...)` can be resolved.
    addr_fn = {int(m.group(1), 16): m.group(2) for m in ENTRY.finditer(text)}

    total, rounds = 0, 0
    while True:
        rounds += 1
        moved = 0
        funcs = split_functions(text)
        pieces = []
        for name, sig, body, (start, end) in funcs:
            # The signature says `src_`; the body says `src`, because the
            # first thing every lifted routine does is `let src = src_;`. The
            # spill hands over the local, so match on the stripped form.
            params = {p.strip().split(":")[0].strip().rstrip("_")
                      for p in sig.split(",") if p.strip()}
            want = {}
            lines = body.split("\n")
            for i, line in enumerate(lines):
                spills = SPILL.findall(line)
                if not spills:
                    continue
                # The call this spill belongs to: the next transfer in the
                # same statement or on one of the next few lines. Spills are
                # emitted immediately before their call.
                target = None
                for j in range(i, min(i + 12, len(lines))):
                    c = CALL.search(lines[j])
                    if c:
                        target = int(c.group(1), 16)
                        break
                    if j > i and SPILL.findall(lines[j]) and "callRom" not in lines[j]:
                        continue
                if target is None:
                    continue
                callee = addr_fn.get(target)
                names = reg_param.get(callee or "", {})
                for reg, local in spills:
                    if local not in params or not REG_PARAM.match(local):
                        continue
                    got = names.get(reg)
                    if got:
                        want.setdefault(local, got)
            if not want:
                continue
            # A rename must not collide with anything the function already
            # says. Every word in the body counts, not just its declarations:
            # a helper called `count` and a local renamed to `count` compile
            # to different things and read as the same one.
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
        if pieces:
            out, cur = [], 0
            for start, end, new in pieces:
                out.append(text[cur:start])
                out.append(new)
                cur = end
            out.append(text[cur:])
            text = "".join(out)
        # WITHDRAWN: the other direction, naming a callee's parameter after
        # what every caller calls the value it hands over. Built, measured
        # and removed on 2026-08-02 - it reported 3,247 renames and moved the
        # named-parameter count by zero, because every parameter it reached
        # already had a name and it was only churning them. roles.py's own
        # note about the dropped "shift" role says it: a rule that names
        # nothing is a rule that can only ever be wrong. If it is tried
        # again, the test is the count in names.txt, not the number of
        # renames the pass reports.
        total += moved
        if not moved or rounds > 8:
            break
        # A parameter named this round is a named callee parameter next round.
        funcs = split_functions(text)
        by_name = {n: (sig, body) for n, sig, body, _ in funcs}
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
                nm = sig[i].rstrip("_")
                if REG_PARAM.match(nm):
                    continue
                reg_param.setdefault(fn, {})[r.group(1)] = nm

    if not dry:
        DEST.write_text(text, encoding="utf-8")
    print(f"parameters named from the callee they are handed to: {total}"
          f" (converged in {rounds} rounds)")


if __name__ == "__main__":
    main()
