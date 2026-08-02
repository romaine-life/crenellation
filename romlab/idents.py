"""Turn each routine's stated purpose into the identifier it gets in TypeScript.

`fn_0ccb2` says where a routine came from and nothing about what it does. The
material for a real name already exists: name_all.py derives a purpose for most
routines from evidence - the hardware they write, the table they index, who
calls them - and fullmap.json carries the ones that were named by hand.

This turns those sentences into identifiers, and reports what is left over.
Anything without a purpose keeps its address, visibly, rather than being given
a plausible name that nobody checked.
"""
import json
import pathlib
import re
from collections import defaultdict

HERE = pathlib.Path(__file__).parent

# Words that carry no information in an identifier - every routine in a ROM
# "handles" or "does" something.
NOISE = {"a", "an", "the", "of", "for", "to", "from", "that", "this", "its",
         "and", "or", "with", "by", "in", "on", "at", "is", "it", "as"}


def camel(text, limit=5):
    """`sprite entity update` -> `spriteEntityUpdate`."""
    # An address in a name says nothing a reader wants: `trampoline to 0x18df6`
    # becomes `trampoline`, and the address is already the key.
    text = re.sub("0x[0-9a-f]+", " ", text.lower())
    words = [w for w in re.findall(r"[a-zA-Z0-9]+", text) if w not in NOISE]
    if not words:
        return ""
    # An identifier cannot start with a digit, and `1010 except` does. Lead
    # with the first word that can, keeping the rest in order after it.
    lead = next((k for k, w in enumerate(words) if w[0].isalpha()), None)
    if lead is None:
        return ""
    words = [words[lead]] + words[:lead] + words[lead + 1:]
    words = words[:limit]
    return words[0] + "".join(w.capitalize() for w in words[1:])


def load():
    names = {}
    forced = {}
    n = json.loads((HERE / "out" / "names.json").read_text())
    for k, v in (n.get("names", n)).items():
        names[int(k, 16)] = v
    curated = {}
    full = json.loads((HERE / "out" / "fullmap.json").read_text())
    for k, v in full.items():
        if isinstance(v, dict) and v.get("name"):
            curated[int(k, 16)] = v["name"]
    # Hand-written names win over everything, and live in a file meant to be
    # edited: naming a routine should be a data change, not a code change.
    hand = HERE / "names.curated.json"
    if hand.exists():
        # A duplicate key here is silent: json keeps the last one and the
        # earlier name simply disappears. In a file whose entire point is
        # being edited by hand that is a trap - a name can be added, appear
        # to do nothing, and leave no sign of why. Refuse instead.
        def no_dupes(pairs):
            seen = {}
            for k, v in pairs:
                if k in seen:
                    raise SystemExit(
                        f"names.curated.json names {k} twice: {seen[k]!r} then "
                        f"{v!r}. json keeps only the last, so the first is "
                        f"silently lost - delete one.")
                seen[k] = v
            return seen
        for k, v in json.loads(hand.read_text(),
                               object_pairs_hook=no_dupes).items():
            # Two shapes. A bare string is a name and nothing else, which is
            # how this file started. An object is a name plus the evidence for
            # it - `{"name": ..., "why": ...}` - which is the bar DELIVERY.md
            # sets: every name backed by something recorded, the way
            # reviewed_entries.json records data verdicts. A wrong name is
            # worse than an address, and the only defence against one is being
            # able to read afterwards why it was chosen. New names take the
            # object form; the older bare strings are left as they are rather
            # than given invented justifications.
            if isinstance(v, dict):
                if not v.get("why"):
                    raise SystemExit(
                        f"names.curated.json: {k} is an object with no `why`. "
                        f"Either record the evidence or write a bare string, "
                        f"which at least does not claim to have any.")
                # An explicit identifier, for when the prose does not survive
                # camelisation. `camel` drops hex - `trampoline to 0x18df6`
                # should not carry the address - and truncates to five words,
                # so four names differing only in an offset all collapsed to
                # `signExtendByteOffsetRecord` and three of them were silently
                # dropped as collisions. Say the identifier when the name needs
                # one.
                if v.get("ident"):
                    forced[int(k, 16)] = v["ident"]
                v = v.get("name")
            if v:
                curated[int(k, 16)] = v
    return names, curated, forced


def main():
    described, curated, forced = load()
    facts = json.loads((HERE / "out" / "facts.json").read_text())
    addrs = sorted((f["at"] if isinstance(f, dict) else f[0]) for f in facts["funcs"])

    # A description that only says how a routine is reached says nothing about
    # what it does, so it does not count as named.
    def useless(text):
        return (not text
                or "reached through" in text
                or text.startswith("jump-table case")
                or text.startswith("computed-jump entry")
                or text.startswith("helper for handler"))

    idents, source = {}, {}
    for a in addrs:
        if a in curated:
            idents[a], source[a] = forced.get(a) or camel(curated[a]), "curated"
        elif not useless(described.get(a)):
            idents[a], source[a] = camel(described[a]), "evidence"

    # Two routines that do the same job to different things need telling apart,
    # and a number does not do that. Flag them instead of pretending.
    groups = defaultdict(list)
    for a, name in idents.items():
        groups[name].append(a)
    collisions = {n: v for n, v in groups.items() if len(v) > 1}

    unnamed = [a for a in addrs if a not in idents]
    # A hand-written name that collides is silently discarded below, and
    # silence is the one thing this file must not do: the whole point of
    # names.curated.json is that adding a name has a visible effect. Say which
    # ones lost, and to what, so the fix is obvious - usually an `ident` field.
    lost = [(a, idents[a]) for a in curated
            if a in idents and len(groups[idents[a]]) > 1]
    if lost:
        print(f"  HAND-WRITTEN NAMES THAT COLLIDE AND SO DO NOT APPLY: {len(lost)}")
        for a, n in sorted(lost):
            print(f"    0x{a:05x}  {n}  (shared with "
                  f"{', '.join('0x%05x' % x for x in groups[n] if x != a)})")
        print("    give each an \"ident\" in names.curated.json, or make the"
              " prose differ in its first five words")
    print(f"routines: {len(addrs)}")
    print(f"  named from a stated purpose: {len(idents)}"
          f" ({sum(1 for a in source if source[a] == 'curated')} of them by hand)")
    print(f"  colliding names: {len(collisions)} names over "
          f"{sum(len(v) for v in collisions.values())} routines")
    print(f"  no stated purpose at all: {len(unnamed)}")
    for name, v in sorted(collisions.items(), key=lambda kv: -len(kv[1]))[:8]:
        print(f"    {len(v):3}  {name}")
    # A name shared by forty-six routines is not a name, and two functions
    # cannot share one in TypeScript anyway. Those keep their address until
    # something actually distinguishes them.
    unique = {a: n for a, n in idents.items() if len(groups[n]) == 1}

    # A routine whose whole body is `jmp $X` is a stub that goes somewhere, and
    # where it goes is the only thing worth saying about it. `trampoline` said
    # by sixty-seven of them says nothing.
    import re as _re
    hop = {}
    for a in addrs:
        d = described.get(a) or ""
        m = _re.fullmatch(r"trampoline to (0x[0-9a-f]+)", d)
        if m:
            hop[a] = int(m.group(1), 16)
    def name_stubs():
        """Name jump stubs after where they go. Returns how many were named.

        Run inside the wrapper fixed point rather than once before it: a stub
        whose target is itself a wrapper cannot be named until that wrapper is,
        and the loop below skips `hop` addresses, so a single pass left every
        such stub as an address for ever. Same argument as the wrappers - each
        name added is a target for the next round.
        """
        taken = set(unique.values())
        got = 0
        for a, target in hop.items():
            if a in unique:
                continue
            want = unique.get(target) or (idents.get(target) if
                                          len(groups.get(idents.get(target, ""), [])) == 1 else None)
            if not want or want.startswith("fn_"):
                continue
            name = f"{want}Stub"
            if name in taken:
                continue
            unique[a], got = name, got + 1
            taken.add(name)
        return got

    import bisect
    _inner_p = HERE / "out" / "inner_entries.json"
    _inner = sorted(json.loads(_inner_p.read_text())) if _inner_p.exists() else []
    _ends = {a: e for a, e in
             ((f["at"], f["end"]) if isinstance(f, dict) else (f[0], f[1])
              for f in facts["funcs"])}
    _starts = sorted(_ends)

    def name_inner():
        """Name entry points after the routine they sit inside. Returns how many.

        Numbered in address order within their host, which is the one thing
        that distinguishes them - they are the same routine entered at
        different places, so there is nothing finer to say.
        """
        seen_host, got = {}, 0
        for e in _inner:
            k = bisect.bisect_right(_starts, e) - 1
            if k < 0:
                continue
            host = _starts[k]
            if not host < e < _ends[host] or host not in unique:
                continue
            seen_host[host] = seen_host.get(host, 0) + 1
            if e in unique:
                continue
            want = f"{unique[host]}From{seen_host[host]}"
            if want not in set(unique.values()):
                unique[e] = want
                got += 1
        return got

    stubbed = name_stubs()

    # Callees name their callers. A routine with no stated purpose that calls
    # exactly one named routine and nothing else is a wrapper around it: it
    # sets something up, calls, and returns. That is the same argument the
    # trampoline rule above makes - where it goes is the only thing worth
    # saying - except a wrapper does work either side of the call, so it is
    # named for what it wraps rather than treated as a jump.
    #
    # Deliberately the narrow case. A routine calling *several* named routines
    # that share a theme can also be named from them (0x010DE calls cellDraw,
    # cellOwnerDraw and cellOverlayDrawSecondForm, so it is doing cell work),
    # but choosing that name needs judgement about what the combination means,
    # and a plausible-but-unchecked name is worse than an address. This case
    # needs none: one callee, one name.
    #
    # It compounds - every name added here is a callee for the next round - so
    # run idents.py to a fixed point, the way staticentries.py is run.
    calls = {int(k, 16): v for k, v in facts.get("calls", {}).items()}
    wrapped, rounds = 0, 0
    while True:
        # To a fixed point: a wrapper named this round is a named callee for
        # the next, so a chain of them resolves from the inside out. Two
        # rounds is convergence, exactly as with staticentries.py.
        taken = set(unique.values())
        found = 0
        for a in addrs:
            if a in unique or a in hop:
                continue
            callees = [c for c in (calls.get(a) or []) if c != a]
            if len(set(callees)) != 1:
                continue
            want = unique.get(callees[0])
            if not want:
                continue
            name = f"{want}Wrapper"
            if name in taken:
                continue
            unique[a], found = name, found + 1
            taken.add(name)
        # Stubs again, now that this round's wrappers have names: a stub whose
        # target was just named becomes nameable, and a wrapper around a stub
        # named here becomes nameable next round. The two rules feed each other,
        # so both belong inside the fixed point.
        more = name_stubs()
        entries = name_inner()
        stubbed += more
        wrapped += found
        rounds += 1
        if not found and not more and not entries:
            break
    print(f"  wrappers named after the one routine they call: {wrapped}"
          f" (converged in {rounds} rounds)")
    print(f"  jump stubs named after where they go: {stubbed} of {len(hop)}")

    # The mirror of the wrapper rule: a routine with no stated purpose whose
    # only caller is named, and which is that caller's only callee, is one
    # half of a 1:1 pair. `<caller>Inner` says which - and because the pairing
    # is one-to-one, the name is unique by construction rather than by a
    # suffix nobody can interpret.
    #
    # Not extended to callers with several callees on purpose: that is the
    # `helper for X` shape, and idents.py already refuses to number those -
    # sixteen routines called `helperMainGameStateMachine1..16` would be a
    # name for the caller, not for any of them. They need telling apart by
    # what they touch, which is what distinguish.py --fields is for.
    callers = {int(k, 16): v for k, v in facts.get("callers", {}).items()}
    inner = 0
    for a in addrs:
        if a in unique or a in hop:
            continue
        cs = {c for c in (callers.get(a) or []) if c != a}
        if len(cs) != 1:
            continue
        caller = next(iter(cs))
        if len({c for c in (calls.get(caller) or []) if c != caller}) != 1:
            continue
        want = unique.get(caller)
        if not want:
            continue
        name = f"{want}Inner"
        if name in set(unique.values()):
            continue
        unique[a] = name
        inner += 1
    print(f"  one-to-one callees named after their only caller: {inner}")

    # A two-byte routine is a bare `rts`: a handler that exists so something
    # has an address to call, and does nothing when called. Worth saying so.
    extent = {(f["at"] if isinstance(f, dict) else f[0]):
              (f["end"] if isinstance(f, dict) else f[1]) for f in facts["funcs"]}
    blank = [a for a in addrs if extent.get(a, a) - a == 2 and a not in unique]
    for k, a in enumerate(sorted(blank), start=1):
        unique[a] = f"doesNothing{k}"
    print(f"  routines that are a bare rts: {len(blank)}")

    # The entry points are not separate routines - they are places inside one,
    # reached by a tail jump or a jump table because a decompiled function has
    # only one way in. Named after the routine they continue, and numbered in
    # address order, which is what they are.
    #
    # Run inside the fixed point above as well as here, for the same reason the
    # stub rule is: a jump stub whose target is an entry point cannot be named
    # until that entry point is, and this used to run afterwards - so twenty-odd
    # stubs into the C runtime's formatter stayed addresses for ever, waiting on
    # names that were assigned one step too late.
    name_inner()
    print(f"  entry points named after the routine they continue: "
          f"{sum(1 for a in unique if a in set(_inner))}")
    print(f"  usable, unique names: {len(unique)}")
    (HERE / "out" / "idents.json").write_text(json.dumps(
        {"idents": {hex(a): n for a, n in unique.items()},
         "collisions": {n: [hex(x) for x in v] for n, v in collisions.items()},
         "unnamed": [hex(a) for a in unnamed]}))
    print("wrote out/idents.json")


if __name__ == "__main__":
    main()
