"""Name a stack argument after what the routine does with the pointer in it.

`argN` says a value arrived in the Nth stack slot, which the reader can already
see. For a good share of them the routine says more in one instruction: it
loads the slot into an address register and then only ever reads through it, or
only ever writes through it, or both.

    movea.l $8(a6), a0        ... move.b (a0)+, d0      src
    movea.l $8(a6), a0        ... move.b d0, (a0)+      dst
    movea.l $8(a6), a2        ... both                  record

FINDING THE SLOT IS THE WHOLE CARE IN THIS FILE. With a frame pointer the Nth
stack slot is at exactly (N+4)(a6) for the routine's whole body, so the
instruction that reads it is identified with no doubt at all. Without one the
arguments sit at N(a7) and a7 moves under every push, so `by_sp` walks the
straight line from the routine's first instruction carrying that displacement -
a `movem.l d2-d3,-(a7)` moves it by eight, a `pea` by four, an `addq.l #4,a7`
back by four - and gives up entirely the moment a7 moves in a way it cannot
account for. A wrong displacement does not fail here; it silently names the
wrong slot. A first attempt skipped all that and let N(a7), (N+4)(a7) and
(N+8)(a7) all match, which promptly gave `wallCellSetFrom1`'s slots at 8 and 12
the SAME instruction - one right name and one wrong one, and the wrong one is
the expensive half. Tracking a7 properly took the pointers found from 18 to 82.

The walk starts at the HOST's first instruction, not the entry's: an inner
entry lands after the prologue that loaded the arguments, and the offsets are
relative to the entry SP either way. That alone moved 82 slots out of "never
touched at that offset".

The direction is decided from every use of that address register, not the
first: a slot is `src` only if nothing is ever written through it and `dst`
only if nothing is ever read. Anything mixed is `record`, which says the least
of the three and is the one to fall back to.

    python3 stackroles.py            # report only
    python3 stackroles.py --write    # write them to params.curated.json
"""
import collections
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
UNNAMED = re.compile(r"^arg\d+$")


SP_REF = re.compile(r"\$([0-9a-f]+)\(a7\)")
PUSH = re.compile(r", -\(a7\)$")
ADDQ = re.compile(r"^#\$?([0-9a-f]+), a7$")
LEA_SP = re.compile(r"^\$?(-?)\$?([0-9a-f]+)\(a7\), a7$")


def by_sp(md, image, at, hi):
    """Slot offset -> the instructions that read it, for a routine with no
    `link`.

    Arguments sit at N(a7) on entry and a7 moves under every push, so the
    displacement that means "slot N" changes as the prologue runs. Walking the
    straight line from the entry and carrying that displacement makes it exact
    again - `movem.l d2-d3,-(a7)` moves it by eight, a `pea` by four, an
    `addq.l #4,a7` back by four.

    Only the straight line, and it stops at the first branch. Argument loads
    live in the prologue, so this reaches almost all of them, and stopping is
    the honest answer everywhere else: past a join a7's displacement depends on
    which way control came. Returns None if anything moves a7 in a way this
    cannot account for, because a wrong displacement here does not fail - it
    silently names the wrong slot.
    """
    out, delta, pc = {}, 0, at
    for i in md.disasm(image[at:hi], at):
        mn, ops = i.mnemonic, i.op_str
        base = mn.split(".")[0]
        if any(mn.startswith(p) for p in
               ("b", "jmp", "jsr", "rts", "rte", "rtr", "rtd", "db", "trap")) \
                and base not in ("bchg", "bclr", "bset", "btst"):
            break
        for m in SP_REF.finditer(ops):
            out.setdefault(int(m.group(1), 16) - delta, []).append(i)
        if base == "movem" and PUSH.search(ops):
            regs = ops.split(",")[0]
            n = 0
            for part in regs.split("/"):
                if "-" in part:
                    f, t = part.split("-")
                    n += (int(t[1]) - int(f[1])) + 1
                else:
                    n += 1
            delta += 4 * n
        elif base in ("move", "movea") and PUSH.search(ops):
            delta += {"b": 2, "w": 2}.get(
                mn.split(".")[1] if "." in mn else "l", 4)
        elif base == "pea":
            delta += 4
        elif base in ("addq", "adda", "add") and ops.strip().endswith(", a7"):
            m = ADDQ.match(ops.strip())
            if not m:
                return None
            delta -= int(m.group(1), 16)
        elif base in ("subq", "suba", "sub") and ops.strip().endswith(", a7"):
            m = ADDQ.match(ops.strip())
            if not m:
                return None
            delta += int(m.group(1), 16)
        elif base == "lea" and ops.strip().endswith(", a7"):
            m = re.match(r"^(-?)\$([0-9a-f]+)\(a7\), a7$", ops.strip())
            if not m:
                return None
            delta -= (-1 if m.group(1) else 1) * int(m.group(2), 16)
        elif ops.strip().endswith(", a7") or "-(a7)" in ops:
            return None                    # something else moved it: stop
    return out


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

    bins, found = collections.Counter(), {}
    for m in ENTRY.finditer(src):
        a, fn = int(m.group(1), 16), m.group(2)
        names = [p.strip().split(":")[0].strip()
                 for p in sig.get(fn, "").split(",") if p.strip()]
        slots = SOURCE.findall(m.group(3))
        if len(slots) != len(names):
            continue
        want = {int(o) for (_, o), n in zip(slots, names)
                if o and UNNAMED.match(n.rstrip("_"))}
        if not want:
            continue
        lo, hi = extent(a)
        line = list(md.disasm(image[lo:hi], lo))
        if not line:
            continue
        framed = line[0].mnemonic.startswith("link")
        where = None
        if not framed:
            # from the HOST's first instruction, not this entry's: an
            # inner entry lands after the prologue that loaded the
            # arguments, and offsets are relative to the entry SP.
            where = by_sp(md, image, lo, hi)
            if where is None:
                bins["no frame pointer, and a7 could not be tracked"] += \
                    len(want)
                continue
        for off in sorted(want):
            if framed:
                at = re.compile(r"\$%x\(a6\)" % (off + 4))
                uses = [i for i in line if at.search(i.op_str)]
            else:
                uses = where.get(off, [])
            if not uses:
                bins["never touched at that offset"] += 1
                continue
            first = uses[0]
            if first.mnemonic.split(".")[0] != "movea":
                bins[f"first use is {first.mnemonic.split('.')[0]}"] += 1
                continue
            reg = first.op_str.split(",")[-1].strip()
            # ...only until the register is pointed somewhere else. In
            # doesBoardCellBelongPlayer a0 holds this slot for four
            # instructions and then `lea $1000a,a0` makes it a table base;
            # counting the table's uses as this slot's would decide the
            # direction from the wrong pointer.
            live = []
            for i in line:
                if i.address <= first.address:
                    continue
                if re.match(r"^(movea|lea)", i.mnemonic) and \
                        i.op_str.strip().endswith(", " + reg):
                    break
                live.append(i)
            thru = [i for i in live
                    if re.search(r"[-(]?\(%s\)" % reg, i.op_str)
                    or re.search(r"\(%s," % reg, i.op_str)]
            wrote = [i for i in thru
                     if re.search(r"(\(%s\)\+?|-\(%s\)|\(%s,[^)]*\))$" %
                                  (reg, reg, reg), i.op_str.strip())]
            read = [i for i in thru if i not in wrote]
            role = ("dst" if wrote and not read else
                    "src" if read and not wrote else "record")
            bins[role] += 1
            found.setdefault(a, {})[f"stack{off}"] = (role, first, reg)

    total = sum(bins.values())
    print(f"{total} unnamed stack slots")
    for k, v in bins.most_common():
        print(f"{v:5}  {k}")

    if not write:
        print("\n(report only; pass --write to put them in "
              "params.curated.json)")
        return

    import familyparams as F
    reached = 0
    for a, slots in sorted(found.items()):
        names, seen = {}, collections.Counter()
        for slot, (role, first, reg) in sorted(slots.items()):
            seen[role] += 1
            n = seen[role]
            names[slot] = {
                "name": role + ("" if n == 1 else str(n)),
                "why": f"0x{first.address:05x} is `{first.mnemonic}"
                       f" {first.op_str}`, and this routine has a frame"
                       f" pointer, so that offset IS this slot for the whole"
                       f" body. Every use of {reg} afterwards"
                       + (" writes through it and none reads."
                          if role == "dst" else
                          " reads through it and none writes."
                          if role == "src" else
                          " both reads and writes through it.")
                       + " Found by stackroles.py.",
            }
        r, _ = F.apply(a, names, only=True)
        reached += r
    print(f"\nwrote names for {reached} entries")


if __name__ == "__main__":
    main()
