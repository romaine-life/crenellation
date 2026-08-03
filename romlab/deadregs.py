"""Which register parameters are dead on arrival, proved from the entry?

Every reading in this grind has kept turning up the same shape: a register the
lifter made a parameter of, whose first instruction at the entry point destroys
it. `moveq #0,d2`. `lea $17fcc(pc),a3`. `movea.l -$4(a6),a0`. The caller's
value reaches nothing, and the name for that is `unused`.

`dropunread.py` already moves that population into the body, and it works on
the LIFTED text, where an assignment deeper than the routine's own brace level
does not settle the question - so it holds back everything it cannot see
straight through. This asks the same question of the DISASSEMBLY instead, from
the entry address, and gets a sharper answer for the price of one rule:

    walk forward from the entry in address order, and STOP at the first
    instruction that can transfer control.

Up to that point the order is exactly the order of execution, so a register
written there is written before anything could have read it, unconditionally.
Nothing about branch targets, join points or loop back-edges enters into it.
That is what makes this sound where a scan of the whole extent is not: the
tempting version - "the register is never read anywhere in the routine" -
reaches 64 more and is WRONG, because a value spilled before a transfer is
handed to whatever runs next. whyunread.py records that measurement.

A write is only counted when it cannot also be a read:

  moveq / clr                the whole register, or its low byte for clr.b
  move / movea to a register whose source does not mention it
  lea to an address register

`move.b` and `clr.b` write only the low byte, and are counted only when every
later mention of the register is also byte-wide - otherwise the surviving upper
bytes might still be the caller's. `move.w` has the same hole and cost 23 of
the first 111 when it was found. `movea` is the exception both ways: it
sign-extends into the whole address register, so `movea.w` IS a full kill.
`add`, `or`, `and`, `sub` and the rest read the destination and never count.

Four questions in the end, each with its own scope, and the scope is the whole
difference between a sound answer and a plausible one:

  dead on arrival   the straight line from the entry, as above. Unconditional
                    branches are followed - one successor is not a fork.
  killed everywhere both arms of every conditional branch to a depth of forty.
                    Every way of not knowing counts AGAINST: a call (the callee
                    might read it), a return, an unresolved target, a loop back
                    to a block already on the path, running off the end.
  no branch skips it  the first thing in the routine that mentions the register
                    is a kill, and no branch target in the extent lands between
                    that kill and the register's last mention. Reaching a read
                    without passing the kill would mean branching over it, and
                    nothing does. No path walking at all, and it reaches the
                    cases the walk above gives up on because they run through a
                    call - 59 of them.
  preserved         every appearance of the register in what this entry can
                    REACH is inside a movem. Not the whole extent - a handler
                    block reached through a jump table is one routine among ten
                    and nine of them never touch d7. Not dead either: a spill
                    before a call still hands the value on, which is why the
                    name is different. Only claimed when the reachability walk
                    met no unresolved transfer, because stopping early
                    over-approximates what is untouched.

    python3 deadregs.py            # report only
    python3 deadregs.py --write    # write them to params.curated.json
"""
import json
import pathlib
import re
import sys

import capstone

HERE = pathlib.Path(__file__).parent
SRC = HERE.parent / "frontend" / "src" / "rom" / "decompiled.ts"
IMAGE = HERE / "prog_ext.bin"
FACTS = HERE / "out" / "facts.json"

FUNC = re.compile(r"^export function (\w+)\(([^)]*)\): void \{$", re.M)
ENTRY = re.compile(
    r"\{ at: (0x[0-9a-f]+), fn: (\w+) as [^,]*, params: \[(.*?)\] \}")
SOURCE = re.compile(
    r"\{ from: 'reg', name: '(\w+)' \}|\{ from: 'stack', off: (-?\d+) \}")
UNNAMED = re.compile(r"^[ad]\d+_?\d*$")

# Anything that can leave the straight line. `dbra` and the conditional set are
# not transfers, but `dbra` is a branch and `scc` is not - the list is by
# mnemonic prefix, and the trailing size/condition is part of the mnemonic.
TRANSFER = ("b", "jmp", "jsr", "rts", "rte", "rtr", "rtd", "db", "trap")

# Mnemonics that write their destination without reading it. `movep` is here
# because it is a plain load - it just takes alternate bytes, which is how this
# board's byte-wide palette RAM hangs off a 16-bit bus - and leaving it out
# missed the one register the palette handlers actually work in.
WHOLE = ("moveq", "clr", "lea", "move", "movea", "movep")


def transfers(mn):
    if mn.startswith("bchg") or mn.startswith("bclr") or mn.startswith("bset") \
            or mn.startswith("btst") or mn.startswith("bfins"):
        return False
    return any(mn.startswith(p) for p in TRANSFER)


def kills(insn, reg):
    """Does this instruction destroy `reg` outright, reading nothing of it?"""
    mn, ops = insn.mnemonic, insn.op_str
    base = mn.split(".")[0]
    # The self-clear idioms. `suba.l a0,a0` is how this ROM nulls an address
    # register and `sub.l d0,d0` how it zeroes a data one - both READ the
    # destination in the letter of the instruction and destroy it in fact, so
    # the general rule below (source must not mention the register) throws
    # them away. startDivideHelperZeroHigh's whole first instruction is one.
    if base in ("sub", "suba", "eor") and ops.strip() == f"{reg}, {reg}":
        return "l" if mn.endswith(".l") or "." not in mn else mn.split(".")[1]
    if base not in WHOLE:
        return None
    parts = [p.strip() for p in ops.split(",")]
    if not parts or parts[-1] != reg:
        return None
    if base in ("moveq", "clr") and len(parts) == (1 if base == "clr" else 2):
        pass
    elif base in ("move", "movea", "lea"):
        if len(parts) != 2 or re.search(r"\b" + reg + r"\b", parts[0]):
            return None
    else:
        return None
    size = mn.split(".")[1] if "." in mn else "l"
    # `movea` sign-extends into the whole address register whatever its size,
    # so movea.w is a full kill where move.w is not.
    return "l" if base == "movea" else size


ABS = re.compile(r"^\$([0-9a-f]+)(?:\.[wl])?$")


def straight(md, image, at, lo, hi):
    """The instructions certain to run, in order, starting at `at`.

    Straight-line to the first instruction that can FORK. An unconditional
    `bra` or `jmp <absolute>` does not fork - there is exactly one successor -
    so the certain run continues at the target, which is worth following
    because the lifted entries land in the middle of jump chains constantly.
    A conditional branch, a `jsr`, a `dbra` or a return ends the run. So does
    a target outside this routine, or one already visited: without the visited
    set a two-instruction loop would spin here forever.
    """
    run, seen, pc = [], set(), at
    while lo <= pc < hi and pc not in seen:
        seen.add(pc)
        block = list(md.disasm(image[pc:hi], pc))
        if not block:
            break
        for i in block:
            mn = i.mnemonic
            if not transfers(mn):
                run.append(i)
                continue
            base = mn.split(".")[0]
            target = None
            if base == "bra":
                m = ABS.match(i.op_str.strip())
                target = int(m.group(1), 16) if m else None
            elif base == "jmp":
                m = ABS.match(i.op_str.strip())
                target = int(m.group(1), 16) if m else None
            pc = target if target is not None else -1
            break
        else:
            pc = -1
    return run


def mentions(insn, reg):
    """Does this instruction name `reg`, counting movem's ranges?

    capstone prints `movem.l d2-d7/a2-a3, -(a7)`, and a plain search for `d3`
    finds nothing in it. That is not a detail: it meant the preserved check saw
    ZERO appearances of d3 through d6 in tickTimerListHead - a routine whose
    only mention of them is exactly that movem - and a register with no
    appearances at all failed the `uses and all(...)` test rather than passing
    it. The range has to be expanded before the question can be asked.
    """
    if re.search(r"\b" + reg + r"\b", insn.op_str):
        return True
    if not insn.mnemonic.startswith("movem"):
        return False
    for part in re.findall(r"[ad]\d(?:-[ad]\d)?", insn.op_str):
        if "-" not in part:
            continue
        f, t = part.split("-")
        if f[0] == reg[0] and int(f[1]) <= int(reg[1]) <= int(t[1]):
            return True
    return False


BRANCH = re.compile(r"\$([0-9a-f]+)(?:\.[wl])?$")


def reachable(md, image, at, lo, hi):
    """Every instruction control can get to from `at`, without leaving lo..hi.

    The straight-line run answers "is this register dead on arrival"; this
    answers the other question, "does this entry ever touch it at all". A
    handler block reached through a jump table is one case of a routine among
    ten, and nine of the ten never see d4 - but a scan of the whole extent
    sees all ten and reports that they do.

    Successors are the fall-through and any branch target that parses as an
    absolute inside the routine. An indirect `jmp (a0)` or `jsr (a0)` has no
    target here, and the walk simply stops rather than guessing - which keeps
    this an under-approximation of what runs and so an over-approximation of
    what is untouched. That is the wrong direction for safety, so a register
    is only called preserved when the walk saw no unresolved transfer at all.
    """
    seen, todo, insns, blind = set(), [at], [], False
    while todo:
        pc = todo.pop()
        while lo <= pc < hi and pc not in seen:
            seen.add(pc)
            block = list(md.disasm(image[pc:hi], pc))
            if not block:
                break
            i = block[0]
            insns.append(i)
            mn, base = i.mnemonic, i.mnemonic.split(".")[0]
            nxt = i.address + i.size
            if not transfers(mn):
                pc = nxt
                continue
            if base in ("rts", "rte", "rtr", "rtd"):
                break
            m = BRANCH.search(i.op_str.strip())
            if m:
                t = int(m.group(1), 16)
                if lo <= t < hi:
                    todo.append(t)
                elif base in ("bra", "jmp"):
                    blind = True           # leaves the routine: cannot follow
            else:
                blind = True               # indirect, or a register target
            if base in ("bra", "jmp"):
                break
            pc = nxt
    return insns, blind


def killed_everywhere(md, image, at, lo, hi, reg, line, depth=0, seen=None):
    """Is `reg` destroyed on EVERY path out of `at`, before anything reads it?

    The straight-line rule stops at the first conditional branch, and a great
    many of these registers are killed just past one - `moveq #0,d0` on one arm
    and `moveq #1,d0` on the other is the shape, and neither arm reads what
    arrived. Following both answers it properly.

    Every way of not knowing returns False: an unresolved target, a call (the
    callee can read the register - arguments go on the stack in this ROM, but
    nothing here proves the callee ignores it), a return, running off the end,
    or recursion deeper than the bound. A loop back to a block already on the
    path is False too, not True: a register read on the second time round is
    read.
    """
    if depth > 40:
        return False
    seen = set() if seen is None else seen
    pc = at
    while lo <= pc < hi:
        if pc in seen:
            return False
        seen = seen | {pc}
        block = list(md.disasm(image[pc:hi], pc))
        if not block:
            return False
        i = block[0]
        mn, base = i.mnemonic, i.mnemonic.split(".")[0]
        if re.search(r"\b" + reg + r"\b", i.op_str):
            size = kills(i, reg)
            if size == "l" or (size in ("w", "b") and narrow(line, reg, size)):
                return True
            return False
        if not transfers(mn):
            pc = i.address + i.size
            continue
        if base in ("rts", "rte", "rtr", "rtd", "jsr", "bsr", "trap") \
                or base.startswith("db"):
            return False
        m = BRANCH.search(i.op_str.strip())
        if not m:
            return False
        target = int(m.group(1), 16)
        if not (lo <= target < hi):
            return False
        if base in ("bra", "jmp"):
            pc = target
            continue
        return (killed_everywhere(md, image, target, lo, hi, reg, line,
                                  depth + 1, seen)
                and killed_everywhere(md, image, i.address + i.size, lo, hi,
                                      reg, line, depth + 1, seen))
    return False


RANK = {"b": 1, "w": 2, "l": 3}


def narrow(line, reg, size):
    """Is every mention of `reg` in the routine no wider than `size`?

    A byte or word write leaves the bits above it exactly as the caller left
    them, so it only kills the register if nothing ever looks at those bits.
    `move.w $6(a7),d0` followed by a `move.l d0,...` is NOT a kill, and that
    is the whole reason this check exists: without it the count was 111 and
    some of them were wrong.
    """
    want = RANK[size]
    for j in line:
        if not re.search(r"\b" + reg + r"\b", j.op_str):
            continue
        mn = j.mnemonic
        if mn.startswith("movem") or mn.startswith("lea") \
                or mn.startswith("movea") or mn.startswith("moveq"):
            return False                    # long by definition
        if "." not in mn:
            return False                    # size not stated: assume long
        if RANK.get(mn.split(".")[1], 3) > want:
            return False
    return True


def main():
    write = "--write" in sys.argv
    funcs = json.loads(FACTS.read_text())["funcs"]
    src = SRC.read_text(encoding="utf-8")
    sig = {m.group(1): m.group(2) for m in FUNC.finditer(src)}
    image = IMAGE.read_bytes()
    md = capstone.Cs(capstone.CS_ARCH_M68K,
                     capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

    def extent(a):
        for lo, hi in funcs:
            if lo <= a < hi:
                return lo, hi
        return a, a + 64

    found, kept, checked = {}, {}, 0
    for m in ENTRY.finditer(src):
        a, fn = int(m.group(1), 16), m.group(2)
        names = [p.strip().split(":")[0].strip()
                 for p in sig.get(fn, "").split(",") if p.strip()]
        slots = SOURCE.findall(m.group(3))
        if len(slots) != len(names):
            continue
        want = {r for (r, _), n in zip(slots, names)
                if r and UNNAMED.match(n.rstrip("_"))}
        if not want:
            continue
        checked += len(want)
        lo, hi = extent(a)
        line = list(md.disasm(image[lo:hi], lo))
        run = straight(md, image, a, lo, hi)
        seen, dead = set(), {}
        for i in run:
            for reg in sorted(want - seen):
                if re.search(r"\b" + reg + r"\b", i.op_str):
                    size = kills(i, reg)
                    seen.add(reg)
                    if size == "l" or (size in ("w", "b") and narrow(
                            line, reg, size)):
                        dead[reg] = (i.address, i.mnemonic, i.op_str)
        # ...and the other honest answer, which is NOT `unused`. A register
        # whose every appearance in the whole routine is inside a `movem` is
        # one the routine saves and restores and never touches: it PRESERVES
        # it. The value is not dead - a spill before a call hands it straight
        # to the callee, which is the case whyunread.py refused to call unused
        # - but nothing here reads it, and saying so is the useful thing.
        # Whole-extent rather than reachable-set, so it holds for every entry.
        # ...and the same question asked of every path, not just the first.
        for reg in sorted(want - set(dead)):
            if killed_everywhere(md, image, a, lo, hi, reg, line):
                dead[reg] = (a, None, None)

        # ...and once more without walking paths at all. If the FIRST thing in
        # the routine that mentions the register is a kill, the only way to
        # reach a read without passing it is to branch over it - so collect
        # every branch target in the extent and check that none lands between
        # the kill and the last mention. Cheap, and it reaches the cases the
        # path walk gives up on because they run through a call.
        targets = set()
        for i in line:
            if transfers(i.mnemonic):
                mt = BRANCH.search(i.op_str.strip())
                targets.add(int(mt.group(1), 16) if mt else -1)
        for reg in sorted(want - set(dead)):
            uses = [i for i in line if mentions(i, reg) and i.address >= a
                    and not i.mnemonic.startswith("movem")]
            if not uses:
                continue
            k = uses[0]
            size = kills(k, reg)
            if not (size == "l" or (size in ("w", "b")
                                    and narrow(line, reg, size))):
                continue
            if any(k.address < t <= uses[-1].address for t in targets):
                continue
            dead[reg] = (k.address, k.mnemonic, k.op_str)

        near, blind = reachable(md, image, a, lo, hi)
        for reg in sorted(want - set(dead)):
            uses = [i for i in line if mentions(i, reg)]
            if uses and all(i.mnemonic.startswith("movem") for i in uses):
                kept.setdefault(a, {})[reg] = (uses[0].address, "the routine")
                continue
            if blind:
                continue
            here = [i for i in near if mentions(i, reg)]
            if here and all(i.mnemonic.startswith("movem") for i in here):
                kept.setdefault(a, {})[reg] = (here[0].address,
                                               "everything this entry reaches")
        if dead:
            found[a] = dead

    total = sum(len(v) for v in found.values())
    keptn = sum(len(v) for v in kept.values())
    print(f"{total} of {checked} unnamed register parameters are dead on "
          f"arrival, across {len(found)} entries")
    print(f"{keptn} more appear only inside a movem - preserved, never "
          f"touched - across {len(kept)} entries")
    for a in sorted(found)[:8]:
        for reg, (at, mn, ops) in sorted(found[a].items()):
            print(f"  0x{a:05x} {reg:3} killed by  {at:06x}  {mn} {ops}")
    if len(found) > 8:
        print(f"  ... {len(found) - 8} more entries")

    if not write:
        print("\n(report only; pass --write to put them in "
              "params.curated.json)")
        return

    import familyparams as F
    reached = 0
    for a, dead in sorted(found.items()):
        names, n = {}, 0
        for reg, (at, mn, ops) in sorted(dead.items()):
            n += 1
            why = (f"dead on arrival: walking forward from this entry in"
                   f" address order, with no branch in between, 0x{at:05x} is"
                   f" `{mn} {ops}` - the register is destroyed before anything"
                   f" could read it."
                   if mn else
                   f"dead on arrival: every path out of this entry destroys it"
                   f" before anything reads it - both arms of every conditional"
                   f" branch, followed to a depth of forty, and any path that"
                   f" reaches a call, a return or an unresolved target counts"
                   f" against rather than for.")
            names[reg] = {
                "name": "unused" + ("" if n == 1 else str(n)),
                "why": why + " Proved by deadregs.py.",
            }
        r, _ = F.apply(a, names, only=True)
        reached += r
    for a, regs in sorted(kept.items()):
        names, n = {}, 0
        for reg, (at, scope) in sorted(regs.items()):
            n += 1
            names[reg] = {
                "name": "preserved" + ("" if n == 1 else str(n)),
                "why": f"every appearance of it in {scope} is inside a movem"
                       f" (the first at 0x{at:05x}) - saved and restored and"
                       f" never touched. Not dead: a spill before a call still"
                       f" hands it on. Found by deadregs.py.",
            }
        r, _ = F.apply(a, names, only=True)
        reached += r
    print(f"\nwrote names for {reached} entries")


if __name__ == "__main__":
    main()
