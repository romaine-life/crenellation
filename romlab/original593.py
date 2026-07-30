"""How many of the original 593 routines are verified.

The goal was set against the map as it stood then: 593 functions, before the
trampolines, the jump-table cases and the pointer-table handlers were found to
be code. Those additions moved the denominator, so the headline figure is not
directly comparable to what was asked for. This computes the original list the
same way describe.py did before any of them existed - code runs and entries
straight out of the classifier, with nothing injected - and reports how many of
those specific routines are verified now.

Where an original function has since been split, it counts as verified only if
every piece it was split into is.
"""
import json
import pathlib

HERE = pathlib.Path(__file__).parent
M = json.loads((HERE / "out" / "codemap2.json").read_text())
VERIFIED = HERE.parent / "frontend" / "src" / "rom" / "verified.json"


def main():
    entries = sorted(set(M["entries"]))
    funcs = []
    for a, b in M["code"]:
        inside = sorted(set([a] + [e for e in entries if a < e < b]))
        for i, e in enumerate(inside):
            funcs.append((e, inside[i + 1] if i + 1 < len(inside) else b))
    widest = {}
    for a, b in funcs:
        if b > widest.get(a, -1):
            widest[a] = b
    funcs = sorted(widest.items())

    v = json.loads(VERIFIED.read_text())
    ok = set(v["verified"])
    now = sorted(set(ok) | set(v["failing"]) | set(v["conflicted"])
                 | set(v["stepStateOnlyMismatch"]) | set(v["neverJudged"])
                 | set(v.get("siliconVoided", []))
                 | set(v.get("oracleOnlyUncaptured", []))
                 | set(v.get("incomparable", [])))
    # the current map's own extents, so an original entry that is no longer a
    # start can be attributed to whichever function absorbed it rather than
    # counted as unknown
    cur = sorted((a, b) for a, b in
                 json.loads((HERE / "out" / "facts.json").read_text())["funcs"])

    def pieces_of(a, b):
        inside = [x for x in now if a <= x < b]
        if inside:
            return inside
        for x, y in cur:
            if x <= a < y:
                return [x]
        return [a]

    full = 0
    partial = 0
    none = 0
    for a, b in funcs:
        pieces = pieces_of(a, b)
        good = [x for x in pieces if x in ok]
        if len(good) == len(pieces):
            full += 1
        elif good:
            partial += 1
        else:
            none += 1

    # Every class the ledger knows, so an unverified original says why rather
    # than "unknown". The three that remain are all "no silicon verdict" for
    # reasons already on record, not routines nobody has looked at.
    blocked = {"mid-run only": set(v.get("midRunOnly", [])),
               "failing": set(v["failing"]),
               "input-dependent": set(v["conflicted"]),
               "stopping-point": set(v["stepStateOnlyMismatch"]),
               "oracle-proved, no capture yet": set(v.get("oracleOnlyUncaptured", [])),
               "incomparable - protection state machine": set(v.get("incomparable", [])),
               "silicon trials voided - the harness stubbed a call":
                   set(v.get("siliconVoided", [])),
               "never judged": set(v["neverJudged"])}
    rows = []
    for a, b in funcs:
        pieces = pieces_of(a, b)
        bad = [x for x in pieces if x not in ok]
        if not bad:
            continue
        why = set()
        for x in bad:
            for k, s in blocked.items():
                if x in s:
                    why.add(k)
        rows.append((a, bad, sorted(why) or ["unknown"]))
    json.dump([{"entry": a, "pieces": bad, "why": why} for a, bad, why in rows],
              open(HERE / "out" / "original-unverified.json", "w"))
    import collections
    c = collections.Counter(tuple(w) for _, _, w in rows)
    print("what blocks the ones that are not verified:")
    for k, n in c.most_common():
        print("   %3d  %s" % (n, ", ".join(k)))
    print()
    print("original routines: %d" % len(funcs))
    print("  fully verified (every piece they were split into): %d" % full)
    print("  partly verified: %d" % partial)
    print("  not verified: %d" % none)


if __name__ == "__main__":
    main()
