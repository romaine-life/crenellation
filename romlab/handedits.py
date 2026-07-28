"""Hand edits to the decompiled source, re-applied after it is regenerated.

The decompiled TypeScript is the source now: rules get changed by editing it.
The generator still exists, because the lifter still improves, and running it
overwrites the file - so every deliberate edit lives here as well, and is put
back afterwards.

An edit that no longer applies is an error, not something to skip. It means the
lifter now produces different text for that routine, and the change has to be
re-expressed against what it produces - or taught to the lifter instead.
"""
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
DEST = HERE.parent / "frontend" / "src" / "rom" / "decompiled.ts"

# (routine, what it says now, what it should say, why)
EDITS = [
    (
        "wallCellSet",
        "    d3 = ((d3 & 0xffff0000) | (((d3 & 65535) + 0x4) & 65535));",
        "    // Deliberate change to the wall-adjacency rule: a wall no longer\n"
        "    // counts the cell above it as connected, so vertical runs read as\n"
        "    // separate pieces.\n"
        "    d3 = ((d3 & 0xffff0000) | (((d3 & 65535) + 0x0) & 65535));",
        "walls do not connect upward",
    ),
]


def main():
    text = DEST.read_text(encoding="utf-8")
    applied = []
    for routine, old, new, why in EDITS:
        m = re.search(r"^export function " + re.escape(routine) + r"\b.*?^\}",
                      text, re.S | re.M)
        if not m:
            sys.exit(f"hand edit: no routine named {routine}")
        body = m.group(0)
        if new.strip().splitlines()[-1] in body:
            applied.append(f"{routine}: already applied ({why})")
            continue
        if body.count(old) != 1:
            sys.exit(f"hand edit: {routine} no longer contains the line to change "
                     f"({body.count(old)} matches) - re-express it against what "
                     f"the lifter produces now")
        text = text[:m.start()] + body.replace(old, new, 1) + text[m.end():]
        applied.append(f"{routine}: {why}")
    DEST.write_text(text, encoding="utf-8")
    for line in applied:
        print(f"  {line}")
    print(f"hand edits applied: {len(EDITS)}")


if __name__ == "__main__":
    main()
