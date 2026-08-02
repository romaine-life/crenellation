"""Lower the naming ratchets to what `names.txt` actually says.

Every one of these numbers has been hand-edited into `baseline.json` after a
batch of reading, and hand-editing them means arithmetic: 430 minus the three
routines just written down is 427. That is wrong whenever one of the three was
already stated by something else, and it was - the ratchet went red with
`expected 429 to be less than or equal to 427`, which is the floor catching a
guess rather than a regression.

`names.test.ts` writes the measured numbers to `names.txt` every run. This
reads them back and writes them into `baseline.json`, so the floor is always a
measurement and never a subtraction. It REFUSES to raise one: a number going
up is either a regression or a deliberate decision, and both of those want a
human sentence in the file next to them.

    python3 syncbaseline.py [--dry]
"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
ROM = HERE.parent / "frontend" / "src" / "rom"
REPORT = ROM / "names.txt"
BASE = ROM / "baseline.json"

# What to read out of names.txt, and which floor it belongs to.
WANTED = [
    ("addressNamed", r"still an address (\d+)"),
    ("suffixOnlyNames", r"named only by a suffix on another routine's name: (\d+)"),
    ("unstatedPurpose", r"the name was derived by rule: (\d+)"),
    ("opaquePurpose", r"of which (\d+) are opaque"),
    ("unnamedParams", r"(\d+) parameters$"),
]


def main():
    dry = "--dry" in sys.argv
    report = REPORT.read_text(encoding="utf-8")
    text = BASE.read_text(encoding="utf-8")
    base = json.loads(text)

    moved, refused = [], []
    for key, pattern in WANTED:
        m = re.search(pattern, report, re.M)
        if not m:
            raise SystemExit(f"names.txt has no {key}: pattern {pattern!r}"
                             " did not match. Re-run names.test first.")
        now, was = int(m.group(1)), base.get(key)
        if was is None:
            raise SystemExit(f"baseline.json has no {key}")
        if now == was:
            continue
        if now > was:
            refused.append(f"{key}: {was} -> {now}")
            continue
        text = text.replace(f'"{key}": {was},', f'"{key}": {now},', 1)
        moved.append(f"{key}: {was} -> {now}")

    if not dry:
        BASE.write_text(text, encoding="utf-8")
    json.loads(text)
    for line in moved:
        print("  lowered  " + line)
    for line in refused:
        print("  REFUSED  " + line
              + "  (a rise is a regression or a decision; write the reason in"
                " baseline.json by hand)")
    if not moved and not refused:
        print("  nothing to move")
    if refused:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
