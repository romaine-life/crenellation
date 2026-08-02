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
#
# A changed rule is a switch, not a constant. Hard-coding one makes the
# equivalence proof unprovable rather than false: the two dispatchers then
# differ for a reason nobody is measuring, and "identical for a whole game"
# can never be asserted again. Written as a flag, the same source answers both
# questions - RULES.wallsConnectUp restores the ROM for the harness that
# compares against it, and is off everywhere else, including in the game.
#
# The addend goes into t10 as well as into the sum. `addq.w #4,d3` sets the
# condition codes from what it added; leaving the flag helpers reading a
# literal 4 would put the original rule back for anything downstream that
# branches on them.
EDITS = [
    (
        "wallCellSet",
        "    t10 = 0x4;\n"
        "    d3 = ((d3 & 0xffff0000) | (((d3 & 65535) + 0x4) & 65535));",
        "    // Deliberate change to the wall-adjacency rule: a wall no longer counts\n"
        "    // the cell above it as connected, so vertical runs read as separate\n"
        "    // pieces. RULES.wallsConnectUp puts the ROM's 0x4 back, which is what the\n"
        "    // equivalence harnesses run with - see RULES.\n"
        "    //\n"
        "    // The flags come off the addend that was actually added, not off the\n"
        "    // ROM's: `addq.w #4,d3` sets X, N, Z, V and C from the sum, and adding\n"
        "    // zero instead sets them from a different sum. Leaving t10 at 4 here\n"
        "    // would restore the original rule through the back door for any branch\n"
        "    // downstream that reads a condition code.\n"
        "    t10 = RULES.wallsConnectUp ? 0x4 : 0x0;\n"
        "    d3 = ((d3 & 0xffff0000) | (((d3 & 65535) + t10) & 65535));",
        "walls do not connect upward, unless RULES.wallsConnectUp",
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
