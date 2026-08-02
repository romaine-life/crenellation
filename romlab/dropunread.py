"""A register the routine never reads is not a parameter of it.

The lifter makes every register live across a routine into a parameter of that
routine, because the whole live set has to survive an interrupt. That is right
for the machine and wrong for the signature: `pieceWalker` takes fourteen
registers and reads six of them, and a reader cannot tell which six without
reading the body - which is the thing a signature exists to save them from.

`whyunread.py` counts them by what the routine does with the value it arrives
with, and two of its bins are not interface at all:

    let d1 = d1_;
    d1 = (0xaaaaaaaa) >>> 0;      // `overwritten` - nothing ever reads it

    let d2 = d2_;
    push(d2, 4);                  // `saved-then-overwritten` - read once, to
    save_d2_0 = d2;               // put it back for the caller, and never for
    d2 = (-1) >>> 0;              // anything this routine does

Neither carries anything into the routine. Both move into the body, where they
say what they actually are:

    let d1 = getReg('d1');

and that is an *exactly* equivalent rewrite rather than an approximation. The
dispatcher builds a `{from: 'reg'}` argument as `(M as Record)[name] >>> 0`,
`getReg` is that same expression, and nothing runs between the two - so the
read happens on the same machine state either way. The table entry loses the
parameter with the signature, and the two stay positional.

What is NOT dropped, deliberately:

  - `narrowed` - `d0 = ((d0 & 0xffffff00) | ...)` keeps the bits it does not
    replace, so the incoming value is still an input, just a partial one.
  - `input` - anything read before it is overwritten, including a value handed
    straight to a callee, which is a use even though the routine does nothing
    else with it.
  - stack parameters, which are arguments the ROM pushed and are interface by
    construction.
  - any parameter not in the plain `let x = x_;` form, because the rewrite is
    only obviously equivalent when the declaration is exactly that.

CONSIDERED, MEASURED AND NOT DONE, so it is not re-derived. A spill before a
call counts as a read here, and for a good number of the parameters that
survive, being spilled is ALL the routine does with them. Some of those spills are not arguments: the
lifter writes the whole live set back before every call so the callee sees
consistent machine state, and if no callee reads that register the entry value
is dead and the parameter is not interface either. Deciding which is which is an
inter-procedural liveness question, and it was worked out rather than left
vague: propagate "declares this register, or reads it with `getReg`" forwards
over the call graph to a fixed point, then ask whether anything a routine
reaches wants the register it is spilling. Measured 2026-08-02: 231 parameters
are only ever spilled, and for 92 of them nothing downstream declares the
register at all.

92 is not enough to take the risk, and the risk is specific. The call graph
that analysis walks is built from `callRom`/`jumpRom` with a CONSTANT address.
It cannot see an indirect transfer - 0x357a's whole purpose is `jsr (a3)` with
a3 from its caller, and a jump table has the same problem - so a routine that
dispatches indirectly looks like it reaches nothing, and every register spilled
through it would read as unwanted. The rewrite would still RUN correctly,
because `getReg` is what the dispatcher would have read; only the signature
would be wrong, and a signature that lies is what this pass exists to stop.
Making it safe means teaching the graph about indirect targets, which is a
bigger piece of work than 92 parameters justifies.

THE OTHER CONSERVATIVE LIMIT WAS MEASURED TOO. The depth guard - an overwrite
deeper than the routine's own brace level is called `input`, because it only
happens on some paths - holds back 91 parameters of the 1,093 unnamed registers
left. Loosening it needs real dominance information rather than brace counting,
and 91 does not pay for that either. The remaining 1,002 are read before they
are written, or written at the routine's own level and read after: genuine
inputs and genuine locals, and both want a name from reading rather than a
pass.

Run after `handedits.py` and before `paramnames.py`, which reads the table.
Idempotent: a routine with nothing left to drop reports nothing.

    python3 dropunread.py [--dry]
"""
import collections
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
DEST = HERE.parent / "frontend" / "src" / "rom" / "decompiled.ts"

FUNC = re.compile(r"^export function (\w+)\(([^)]*)\): void \{$", re.M)
ENTRY = re.compile(
    r"(\{ at: 0x[0-9a-f]+, fn: (\w+) as [^,]+, params: \[)(.*?)(\] \})")
SOURCE = re.compile(r"\{ from: 'reg', name: '(\w+)' \}|\{ from: 'stack', off: (-?\d+) \}")
TRANSFER = re.compile(r"call(?:Rom|Decompiled)\(|jumpRom\(|setSr\(")


def split_functions(text):
    out = []
    for m in FUNC.finditer(text):
        start = m.start()
        end = text.find("\n}\n", start)
        end = len(text) if end < 0 else end + 3
        out.append((m.group(1), m.group(2), text[start:end], (start, end)))
    return out


def first_use(body, name):
    """What the routine does with `name` before anything overwrites it.

    `whyunread.py` imports this rather than carrying its own copy. It had one
    for an afternoon and the two drifted the moment a guard was added to this
    one: the measurement went on reporting 197 parameters as carrying nothing
    that the rewrite had already decided were inputs. A measurement that
    justifies a rewrite has to BE the rewrite's decision.
    """
    n = re.escape(name)
    use = re.compile(r"(?<![\w'])" + n + r"(?![\w'])")
    assign = re.compile(r"^\s*" + n + r" = (.*);$")
    lines = body.split("\n")
    saved = False
    depth = 0
    for i, line in enumerate(lines):
        # An overwrite inside an `if` or a loop only happens on some paths, so
        # the incoming value can still reach a read further down and the first
        # mention does not settle the question. Textual order answers it only
        # at the routine's own level; anywhere deeper, say `input` and keep the
        # parameter. The rewrite would still be equivalent - `getReg` is what
        # the dispatcher would have read - but the signature would have lost
        # something the routine genuinely takes.
        was = depth
        depth += line.count("{") - line.count("}")
        if re.match(r"^\s*let " + n + r" = " + n + r"_;$", line):
            continue
        if "SPILL_ALL" in line or "takeIrq" in line:
            continue
        # A line that is nothing but `setReg` calls - one of them, or the whole
        # live set on a single line, with or without a `return;` - is the
        # registers going back to the machine. If a transfer follows, they are
        # that transfer's arguments and this is a read; if nothing follows,
        # they restore what arrived and carry nothing.
        #
        # The lifter emits the whole live set on one line before a tail
        # return - `setReg('a0', dst); setReg('a1', dst2); ... return;` - and
        # matching only the single-setReg form left that shape falling through
        # every other test to come out `input`. It reaches no parameter that
        # some other line does not also reach: measured after the widening, no
        # parameter in the file appears ONLY in its declaration and in spill
        # lines, and the pass drops nothing new. Kept because the narrow form
        # was right by accident rather than by argument, and the next shape of
        # emitted spill would not be.
        if re.fullmatch(r"(?:\s*setReg\('\w+', \w+\);)+(?:\s*return;)?\s*",
                        line) and use.search(line):
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
                if was > 1:
                    return "input"        # conditional: some path still reads
                return "saved-then-overwritten" if saved else "overwritten"
            if re.match(r"^\(\(" + n + r" & 0x[0-9a-f]+\) \|", rhs):
                return "narrowed"
            return "input"
        if re.fullmatch(r"\s*push\(" + n + r", \d+\);", line):
            if was > 1:
                return "input"
            saved = True
            continue
        if re.fullmatch(r"\s*save_\w+ = " + n + r";", line):
            continue
        return "input"
    return "saved-and-never-read" if saved else "never-mentioned"


DROP = {"overwritten", "saved-then-overwritten",
        "saved-and-never-read", "never-mentioned"}


def main():
    dry = "--dry" in sys.argv
    text = DEST.read_text(encoding="utf-8")
    funcs = split_functions(text)
    by_name = {n: (sig, body) for n, sig, body, _ in funcs}

    # Which signature positions each routine can lose, and which register each
    # of them arrives in. The table is positional against the signature, so a
    # position dropped from one is dropped from the other.
    drop_at = {}
    reasons = collections.Counter()
    for m in ENTRY.finditer(text):
        fn = m.group(2)
        if fn not in by_name or fn in drop_at:
            continue
        sig_txt, body = by_name[fn]
        sig = [p.strip().split(":")[0].strip()
               for p in sig_txt.split(",") if p.strip()]
        sources = SOURCE.findall(m.group(3))
        if len(sources) != len(sig):
            continue                       # not the shape this understands
        for i, (reg, _off) in enumerate(sources):
            if not reg:
                continue                   # a stack argument: interface
            name = sig[i]
            if not name.endswith("_"):
                continue                   # not the `let x = x_;` form
            local = name[:-1]
            if f"  let {local} = {name};\n" not in body:
                continue
            why = first_use(body, local)
            if why not in DROP:
                continue
            reasons[why] += 1
            drop_at.setdefault(fn, {})[i] = (name, local, reg)

    if not drop_at:
        print("no register parameters to drop")
        return

    # Rewrite the bodies.
    pieces = []
    for name, sig_txt, body, (start, end) in funcs:
        drops = drop_at.get(name)
        if not drops:
            continue
        sig = [p.strip() for p in sig_txt.split(",") if p.strip()]
        keep = ", ".join(p for i, p in enumerate(sig) if i not in drops)
        new = body.replace(f"export function {name}({sig_txt}): void {{",
                           f"export function {name}({keep}): void {{", 1)
        for _i, (param, local, reg) in sorted(drops.items()):
            new = new.replace(f"  let {local} = {param};\n",
                              f"  let {local} = getReg('{reg}');\n", 1)
        pieces.append((start, end, new))
    out, cur = [], 0
    for start, end, new in pieces:
        out.append(text[cur:start])
        out.append(new)
        cur = end
    out.append(text[cur:])
    text = "".join(out)

    # And the table, which has to stay positional with them.
    def fix(m):
        drops = drop_at.get(m.group(2))
        if not drops:
            return m.group(0)
        # Whole `{ ... }` items, so the spacing inside one survives: other
        # scripts match the table with `{ from: 'reg', name: '(\w+)' }` and a
        # rebuilt-by-splitting item loses the space before the brace.
        items = re.findall(r"\{[^}]*\}", m.group(3))
        keep = [s for i, s in enumerate(items) if i not in drops]
        return m.group(1) + ", ".join(keep) + m.group(4)

    text = ENTRY.sub(fix, text)

    if not dry:
        DEST.write_text(text, encoding="utf-8")
    total = sum(len(v) for v in drop_at.values())
    print(f"register parameters moved into the body as getReg: {total}"
          f" across {len(drop_at)} routines")
    for why, count in reasons.most_common():
        print(f"  {count:6}  {why}")


if __name__ == "__main__":
    main()
