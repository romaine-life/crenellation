"""What a routine does with each of its parameters, as a name.

`fn_0ccb2(a2_, d0_, arg0)` tells a reader nothing. What the routine *does* with
each one is visible in the body it was lifted into, and that is a checkable
description rather than a guess: a register only ever dereferenced is a
pointer, one counted down by a `dbra` is a count, one that only ever indexes
another is an index.

Where the structure a pointer walks is known - the player array, the motion
objects - the name says that instead, because it says more.
"""
import re

# The structures whose base addresses the code loads directly, by the offset
# stride the port already relies on.
STRUCT_AT = {
    0x3E1968: "player",
    0x3E02D8: "mob",
    0x3E1BC6: "unit",
    0x3E0864: "cell",
    0x3E1CF4: "event",
}


def _uses(body, name):
    """Every way `name` appears in the emitted body."""
    return re.findall(r"[^\w]" + re.escape(name) + r"[^\w]", body)


def role(name, body, is_addr):
    """A word for what this parameter is used as, or None if nothing is clear."""
    n = re.escape(name)
    deref = re.search(rf"load\d+\({n}\b|store\d+\({n}\b|load\d+\(\({n} ", body)
    written_through = re.search(rf"store\d+\({n}\b|store\d+\(\({n} ", body)
    counted = re.search(rf"{n} = \(\({n} & 0xffff0000\) \| \(\(\({n} & 0xffff\) - 1\)", body)
    indexes = re.search(rf"\+ \(\(\({n}[ )]", body) or re.search(rf"\(\({n} << 16\) >> 16\)", body)
    stepped = re.search(rf"{n} = \({n} [-+] \d", body)

    # An address register nothing ever reads or writes through, but which a
    # pointer is compared against, is where a walk stops. `cmpa.l a2,a0` with
    # `bcs` back to the top is this ROM's standard loop: a0 steps, a2 is the
    # end. Naming it `end` says what it is; `a2_` says which register it
    # arrived in, which the reader can already see.
    compared = re.search(rf"[<>]=? *{n}\b|{n} *[<>]=?", body)

    if is_addr:
        if written_through and deref:
            return "dst" if re.search(rf"store\d+\({n}\b", body) else "ptr"
        if deref:
            return "src" if stepped else "ptr"
        if compared and not stepped:
            return "end"
        return None
    if counted:
        return "count"
    # Tried and dropped: a "shift" role for a value used as the distance of a
    # shift. It named nothing - every shift in this ROM takes an immediate,
    # not a register parameter - so it was a rule that could only ever be
    # wrong. Do not re-add it without checking the count moves.
    if indexes and not deref:
        return "index"
    if written_through:
        return "value"
    return None


def struct_role(body, name):
    """If a pointer is set from a known structure's base, name the structure."""
    n = re.escape(name)
    m = re.search(rf"{n} = \(0x([0-9a-f]+)\) >>> 0;", body)
    if not m:
        return None
    return STRUCT_AT.get(int(m.group(1), 16))


def rename(body, sig_regs, stack_names, decl, tail):
    """A map from the lifted names to ones that say what they are."""
    taken = set()
    out = {}
    for r in sig_regs:
        want = struct_role(body, r) or role(r, body, r.startswith("a"))
        if not want:
            continue
        base = want
        k = 2
        while want in taken:
            want = f"{base}{k}"
            k += 1
        taken.add(want)
        out[r] = want
    for s in stack_names:
        want = role(s, body, False)
        if not want:
            continue
        base = want
        k = 2
        while want in taken:
            want = f"{base}{k}"
            k += 1
        taken.add(want)
        out[s] = want
    del decl, tail
    return out


def apply(text, mapping):
    """Rewrite the lifted names, including the `_` suffixed parameter forms."""
    if not mapping:
        return text
    # Never inside quotes. `setReg('a0', a0)` names a machine register in the
    # string and a local in the argument; rewriting the string writes the
    # register under a name the machine does not have - silently, because the
    # parameter is a string either way and the type-checker sees nothing wrong.
    pattern = re.compile(r"(?<!')\b(" + "|".join(
        re.escape(k) + "_?" for k in sorted(mapping, key=len, reverse=True)) + r")\b(?!')")

    def sub(m):
        tok = m.group(1)
        if tok.endswith("_") and tok[:-1] in mapping:
            return mapping[tok[:-1]] + "_"
        return mapping.get(tok, tok)

    return pattern.sub(sub, text)
