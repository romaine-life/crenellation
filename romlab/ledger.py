"""Rebuild verified.json from the step-state run over the recaptured set.

The old ledger stopped at 754 entries and mixed eras: its baselines came from
whichever original capture run wrote them last, while its cases came from all
of them. The recapture froze one machine for every run, so the verdicts are
finally about the routines and not about the harness.

Classes, and what they mean:
- verified: every step-state case for the entry matched silicon by position
- stepStateOnlyMismatch: at least one case disagreed - localise.test.ts takes
  these and narrows each to a span of instructions
- neverJudged: the chip crashed early under every shape (all X lines), so
  position comparison had nothing to compare; these are covered by the
  random-state oracle (decomp.test.ts) only, and stay visibly in this class
  rather than being averaged into "verified"
"""
import json
import pathlib

HERE = pathlib.Path(__file__).parent
FRONT = HERE.parent / "frontend" / "src" / "rom"


def main():
    result = json.loads((FRONT / "stepstate-result.json").read_text())
    entries = [int(line, 16) for line in
               (FRONT / "entries.txt").read_text().splitlines() if line.strip()]

    # reviewed_entries.json carries verdicts from reading; an entry judged
    # incomparable there leaves the outstanding list with its reason on
    # record - 0x140010 is the case: a protection bank probe whose captured
    # result measures the state machine, not the translation
    rev_path = HERE / "reviewed_entries.json"
    reviewed = json.loads(rev_path.read_text()) if rev_path.exists() else {}
    incomparable = sorted(int(k, 16) for k, v in reviewed.items()
                          if isinstance(v, dict)
                          and v.get("verdict") == "incomparable")

    snapshot = set()
    for line in (FRONT / "stepstate.log").read_text().splitlines():
        parts = line.split()
        if parts and parts[0] == "S":
            snapshot.add(int(parts[1], 16))

    passed = set(result.get("pass", []))
    failed = set(result.get("fail", [])) - set(incomparable)
    never = [e for e in entries if e not in snapshot]

    # Routines the map has gained since the capture session. They are proved
    # against the oracle on random machine states like every other routine,
    # but no silicon snapshot exists for them yet, and that is a different and
    # weaker claim - so it gets its own class rather than being folded into
    # "verified". A capture top-up moves them across; averaging them in would
    # only hide which is which.
    facts = json.loads((HERE / "out" / "facts.json").read_text())
    mapped = sorted(a for a, _ in facts["funcs"])
    uncaptured = [a for a in mapped if a not in set(entries)]

    out = {
        "total": len(mapped),
        "captured": len(entries),
        "verified": sorted(passed - failed),
        "outstanding": sorted(failed),
        "failing": [],
        "conflicted": [],
        "stepStateOnlyMismatch": sorted(failed),
        "incomparable": incomparable,
        "oracleOnlyUncaptured": uncaptured,
        "neverJudged": sorted(never),
        "midRunOnly": [],
    }
    (FRONT / "verified.json").write_text(json.dumps(out))
    print(f"mapped {out['total']}  captured {len(entries)}  "
          f"verified {len(out['verified'])}  "
          f"outstanding {len(out['outstanding'])}  "
          f"incomparable {len(incomparable)}  "
          f"oracle-only {len(uncaptured)}  neverJudged {len(never)}")


if __name__ == "__main__":
    main()
