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
        for k, v in json.loads(hand.read_text()).items():
            if v:
                curated[int(k, 16)] = v
    return names, curated


def main():
    described, curated = load()
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
            idents[a], source[a] = camel(curated[a]), "curated"
        elif not useless(described.get(a)):
            idents[a], source[a] = camel(described[a]), "evidence"

    # Two routines that do the same job to different things need telling apart,
    # and a number does not do that. Flag them instead of pretending.
    groups = defaultdict(list)
    for a, name in idents.items():
        groups[name].append(a)
    collisions = {n: v for n, v in groups.items() if len(v) > 1}

    unnamed = [a for a in addrs if a not in idents]
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

    # The entry points are not separate routines - they are places inside one,
    # reached by a tail jump or a jump table because a decompiled function has
    # only one way in. Named after the routine they continue, and numbered in
    # address order, which is what they are.
    import bisect
    inner_p = HERE / "out" / "inner_entries.json"
    if inner_p.exists():
        inner = sorted(json.loads(inner_p.read_text()))
        ends = {a: e for a, e in
                ((f["at"], f["end"]) if isinstance(f, dict) else (f[0], f[1])
                 for f in facts["funcs"])}
        starts = sorted(ends)
        seen_host = {}
        for e in inner:
            k = bisect.bisect_right(starts, e) - 1
            if k < 0:
                continue
            host = starts[k]
            if not host < e < ends[host] or host not in unique:
                continue
            seen_host[host] = seen_host.get(host, 0) + 1
            want = f"{unique[host]}From{seen_host[host]}"
            if want not in set(unique.values()):
                unique[e] = want
        print(f"  entry points named after the routine they continue: "
              f"{sum(1 for a in unique if a in set(inner))}")
    print(f"  usable, unique names: {len(unique)}")
    (HERE / "out" / "idents.json").write_text(json.dumps(
        {"idents": {hex(a): n for a, n in unique.items()},
         "collisions": {n: [hex(x) for x in v] for n, v in collisions.items()},
         "unnamed": [hex(a) for a in unnamed]}))
    print("wrote out/idents.json")


if __name__ == "__main__":
    main()
