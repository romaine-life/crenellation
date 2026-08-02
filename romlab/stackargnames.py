"""Callers name the arguments they pushed.

`callernames.py` does this for register parameters. Stack parameters are the
other 721, and 636 of them are still called `arg0`, `arg1` - a slot with a
number on it, which says as little as the register a value arrived in. They
are not reached by either existing pass: `paramnames.py` and `callernames.py`
both key on `setReg('d1', x)` before a transfer, and a stack argument is not
spilled to a register, it is pushed.

The lifted form of a call with stack arguments is

    t3 = d0;
    push(t3, 4);
    t4 = index;
    push(t4, 4);
    setReg('d0', d0);
    callRom(0x005b4, 0x0a800);

and inside the callee `a7` points at the return address, so the LAST value
pushed is the parameter at `off: 4`, the one before it sits above it by its own
width, and so on. That is the whole correspondence, and it is the same kind of
evidence the other two passes use: the call graph, read off the emitted source.

Two things are not arguments and are excluded, because counting either would
shift every offset after it and quietly name the wrong parameter:

  - a register save. The lifter writes `push(d2, 4); save_d2_0 = d2;` for a
    `move.l d2,-(a7)` whose value it restores later, and the `save_` line
    immediately after is what distinguishes it.
  - anything pushed before the previous transfer. Pushes are collected from
    the last call or jump, not from the top of the routine.

Unanimity again: a slot takes a name only if every call site pushes a local
with the same name, and that name is not itself a register, a temporary or
another `argN`. Run alongside `callernames.py`, after it.

    python3 stackargnames.py [--dry]
"""
import collections
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
DEST = HERE.parent / "frontend" / "src" / "rom" / "decompiled.ts"

FUNC = re.compile(r"^export function (\w+)\(([^)]*)\): void \{$", re.M)
ENTRY = re.compile(
    r"\{ at: (0x[0-9a-f]+), fn: (\w+) as [^,]+, params: \[(.*?)\] \}")
SOURCE = re.compile(
    r"\{ from: 'reg', name: '(\w+)' \}|\{ from: 'stack', off: (-?\d+) \}")
PUSH = re.compile(r"^\s*push\((\w+), (\d+)\);$")
SAVE = re.compile(r"^\s*save_\w+ = (\w+);$")
CALL = re.compile(r"call(?:Rom|Decompiled)\((0x[0-9a-f]+)")
TRANSFER = re.compile(r"call(?:Rom|Decompiled)\(|jumpRom\(")
SAYS_NOTHING = re.compile(r"^(?:[ad]\d+_?\d*|arg\d+|t\d+|_t\d+|save_\w+)$")
# `t3 = 5;` is a constant being pushed, not a local with a name worth taking.
# `\w+` matches it, and the first version of this pass renamed a parameter to
# `02` - which the type-checker caught as an octal literal in a parameter list
# rather than as the naming fault it was. A name has to be an identifier.
IDENT = re.compile(r"^[A-Za-z_]\w*$")


def split_functions(text):
    out = []
    for m in FUNC.finditer(text):
        start = m.start()
        end = text.find("\n}\n", start)
        end = len(text) if end < 0 else end + 3
        out.append((m.group(1), m.group(2), text[start:end], (start, end)))
    return out


def pushed_at(funcs):
    """callee address -> stack offset -> the locals callers push there."""
    sites = collections.defaultdict(lambda: collections.defaultdict(list))
    for _, _, body, _ in funcs:
        lines = body.split("\n")
        # (local, width) for each push since the last transfer, in order.
        pending = []
        for i, line in enumerate(lines):
            p = PUSH.match(line)
            if p:
                nxt = lines[i + 1] if i + 1 < len(lines) else ""
                s = SAVE.match(nxt)
                if s and s.group(1) == p.group(1):
                    continue                  # a register save, not an argument
                # `t3` is the lifter's copy of whatever was pushed; the name
                # worth propagating is the local it came from, one hop back.
                src = p.group(1)
                for j in range(i - 1, max(i - 4, -1), -1):
                    a = re.fullmatch(r"\s*" + re.escape(src) + r" = (\w+);",
                                     lines[j])
                    if a:
                        src = a.group(1)
                        break
                pending.append((src, int(p.group(2))))
                continue
            if not TRANSFER.search(line):
                continue
            c = CALL.search(line)
            # A call site whose pushes are not all the same width is skipped.
            # `a7` pre-decrements, so the last value pushed is the one nearest
            # the return address and `off: 4` is that one - the machine settles
            # the direction and there is no doubt about it. But the check that
            # would CONFIRM the direction from the data cannot: where every
            # push is four bytes wide, reading them last-first and first-last
            # produce the same set of offsets, so the two models are
            # indistinguishable by which offsets a callee declares. Only the
            # 169 mixed-width sites of 1,619 tell the two apart, and there the
            # data prefers the wrong one - which means something at those sites
            # is not what it looks like, most likely a word-wide save this pass
            # fails to recognise. 274 pushes of 4,262 are two bytes. Dropping
            # every mixed site costs little and removes the only case where a
            # name could be attached to the wrong slot.
            if c and pending and len({w for _, w in pending}) == 1:
                off = 4
                for src, width in reversed(pending):
                    sites[int(c.group(1), 16)][off].append(src)
                    off += width
            pending = []
    return sites


def main():
    dry = "--dry" in sys.argv
    text = DEST.read_text(encoding="utf-8")

    total, rounds = 0, 0
    while True:
        rounds += 1
        funcs = split_functions(text)
        by_name = {n: (sig, body) for n, sig, body, _ in funcs}
        sites = pushed_at(funcs)

        want = {}
        for m in ENTRY.finditer(text):
            addr, fn = int(m.group(1), 16), m.group(2)
            if fn not in by_name:
                continue
            sig = [p.strip().split(":")[0].strip()
                   for p in by_name[fn][0].split(",") if p.strip()]
            sources = SOURCE.findall(m.group(3))
            if len(sources) != len(sig):
                continue
            for i, (_reg, off) in enumerate(sources):
                if not off:
                    continue
                param = sig[i]
                if not re.fullmatch(r"arg\d+", param):
                    continue                  # it already says something
                handed = sites.get(addr, {}).get(int(off))
                if not handed:
                    continue
                names = {h.rstrip("_") for h in handed}
                if len(names) != 1:
                    continue                  # callers disagree
                got = names.pop()
                if SAYS_NOTHING.match(got) or not IDENT.match(got):
                    continue
                want.setdefault(fn, {})[param] = got

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
                new = re.sub(r"(?<!')\b" + re.escape(local) + r"\b(?!')",
                             cand, new)
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
        if not moved or rounds > 8:
            break

    if not dry:
        DEST.write_text(text, encoding="utf-8")
    print(f"stack arguments named from what every caller pushes: {total}"
          f" (converged in {rounds} rounds)")


if __name__ == "__main__":
    main()
