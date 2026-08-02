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


def tested_first(compared, reassigned):
    """Does the comparison happen before the register is reused?"""
    return reassigned is None or compared.start() < reassigned.start()


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
    #
    # Two spellings, because the lifted form of a comparison is not `x < y`.
    # A `cmp` becomes `setFlagsCmp(...)` and the branch becomes a condition
    # several layers of masking and sign extension deep, so an operator next
    # to the name almost never appears. Measured 2026-08-02: the adjacent
    # form matched 15 parameters in the whole file and the second one 149.
    # The second is bounded to a single line so it cannot run past the
    # statement it is in.
    # A bound is a value the routine tests BEFORE it starts using the
    # register for something else. `limit` and `end` both mean "a value
    # this routine only ever tests against", and neither had checked.
    # `negateStore` had a d3 called `limit` while the routine overwrites
    # its low byte first and asks `>= 0` about the result - a working
    # value, not a bound. `written_through` does not catch that: it looks
    # for a store through the pointer, not for the local being written.
    #
    # The test is ORDER, not reassignment. Measured 2026-08-02: only two
    # parameters in the whole file are overwritten before ever being
    # read, so these registers really are inputs - they are just reused
    # as scratch afterwards, and a name for what the routine was GIVEN is
    # honest as long as the test it names happens before the reuse.
    reassigned = re.search(rf"^  +{n} = (?!{n}_;)", body, re.M)
    compared = (re.search(rf"[<>]=? *{n}\b|{n} *[<>]=?", body)
                or re.search(rf"\({n}\b[^;\n]{{0,120}}?\)\s*(?:<=?|>=?)\s", body))

    if is_addr:
        if written_through and deref:
            return "dst" if re.search(rf"store\d+\({n}\b", body) else "ptr"
        if deref:
            return "src" if stepped else "ptr"
        if compared and not stepped and tested_first(compared, reassigned):
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
    # A value compared against two or more DIFFERENT constants is a selector:
    # the routine is asking which of several things it was given, not whether
    # a number is in range. `kind` says that; one constant does not qualify,
    # because a single comparison is a bound and `limit` below already says so.
    # Measured before adding, as this file's own note about the dropped
    # "shift" role demands: 92 parameters match, and each is also a seed for
    # paramnames.py, which names whatever is handed to them.
    kinds = set(re.findall(rf"setFlagsCmp\(\({n}[^,]*, (0x[0-9a-f]+|\d+), ", body))
    if len(kinds) >= 2:
        return "kind"
    # A value nothing writes through, indexes with, or counts down, but which
    # a comparison tests, is a bound. `limit` says that; `d3_` says which
    # register it arrived in, which the reader can already see.
    if compared and not stepped and tested_first(compared, reassigned):
        return "limit"
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
        # A register that is later pointed at an unrelated constant address is
        # not one thing for the length of the routine, and a role name claims it
        # is. fn_07dce takes d4 as `player_` and fifty lines later does
        # `player = (0x3e1968) >>> 0` and uses it as a pointer, so the name is
        # right on entry and misleading by the end - which is worse for someone
        # editing than d4 would have been, and this file's own standard says so.
        # 331 of 2,852 named parameters had this shape when it was measured.
        # Better to say nothing than to say something that stops being true.
        if re.search(r"\b" + re.escape(r) + r" = \(0x[0-9a-f]{4,6}\) >>> 0;", body):
            continue
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
