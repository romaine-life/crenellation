"""Control-flow graphs for every routine, and how hard each is to structure.

Decompiling means turning a program counter and a switch back into `if`, `while`
and `for`. Whether that is possible routine-by-routine, and how much of the
corpus falls out easily, is a property of the control-flow graph - so measure it
before writing an emitter that assumes an answer.

A CFG is *reducible* when every loop has a single entry point. Reducible graphs
structure into ordinary nested control flow with no duplication and no goto.
Irreducible ones - loops entered at two different places, which hand-written
assembly produces and compilers mostly do not - need node splitting or a
dispatch loop, and are the ones that will cost real effort.
"""

import json
from collections import defaultdict
from pathlib import Path

import capstone

HERE = Path(__file__).parent
UP = (HERE / "prog_ext.bin").read_bytes()

# Addresses the game enters at that are not routine starts - tail jumps, jump
# tables, `lea $X(pc),a6` continuations. Each gets its own function because a
# decompiled function has one way in; each is also a block head *inside* the
# routine that contains it, which is what `build` uses this for.
_inner = HERE / "out" / "inner_entries.json"
INNER = set(json.loads(_inner.read_text())) if _inner.exists() else set()
# Routine starts belong here too. The classifier's extents are not disjoint -
# one routine can run into the start of another, and the recompiler, which
# begins wherever it is told, polls at that start while the containing
# function has merged straight through it. 0x1378e is exactly that case and
# the inner-entry set does not contain it, because it is not inner.
INNER |= {a for a, _ in json.loads(
    (HERE / "out" / "facts.json").read_text())["funcs"]}
INNER = frozenset(INNER)
FACTS = json.loads((HERE / "out" / "facts.json").read_text())

md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)
md.detail = False

# Instructions that end a basic block, and whether flow can continue past them.
TERMINAL = {"rts", "rte", "rtr", "jmp", "bra", "bral", "stop", "trap", "reset"}
CONDITIONAL = {
    "bhi", "bls", "bcc", "bcs", "bne", "beq", "bvc", "bvs",
    "bpl", "bmi", "bge", "blt", "bgt", "ble",
}
DBCC = {"dbra", "dbf", "dbt", "dbhi", "dbls", "dbcc", "dbcs", "dbne", "dbeq",
        "dbvc", "dbvs", "dbpl", "dbmi", "dbge", "dblt", "dbgt", "dble"}


def base(mnemonic):
    return mnemonic.split(".")[0]


def target_of(ins):
    """The branch target, if the operand is a plain address."""
    op = (ins.op_str or "").strip()
    if op.startswith("$"):
        try:
            return int(op[1:].split(".")[0], 16)
        except ValueError:
            return None
    # dbra has the counter first: `dbra d4, $11f4c`
    if "," in op:
        last = op.rsplit(",", 1)[1].strip()
        if last.startswith("$"):
            try:
                return int(last[1:].split(".")[0], 16)
            except ValueError:
                return None
    return None


def decode(lo, hi):
    """Every instruction in [lo, hi), in address order."""
    out = []
    at = lo
    while at < hi:
        ins = next(md.disasm(UP[at:min(at + 16, hi)], at, 1), None)
        if ins is None:
            at += 2
            continue
        out.append(ins)
        at += ins.size
    return out


def build(lo, hi):
    """Basic blocks and edges for one routine."""
    ins = decode(lo, hi)
    if not ins:
        return None
    by_addr = {i.address: i for i in ins}

    # leaders: the entry, every branch target, and everything after a branch
    leaders = {lo}
    # ...and every address something else enters at. An inner entry is a block
    # head in the function generated for it, and without this it is *interior*
    # to a merged block in the routine that contains it - so the host runs
    # straight through where the recompiler, which polls per instruction at
    # every block head in any function, stops to poll. That mismatch is the
    # whole of the twenty-seven poll points the two dispatchers differed by:
    # 276 inner entries sit in POLL_AT and about that many execute in attract.
    # An entry is a block head; saying so here makes the two agree by
    # construction instead of by discount.
    leaders |= {e for e in INNER if lo < e < hi}
    for i in ins:
        b = base(i.mnemonic)
        t = target_of(i)
        if b in CONDITIONAL or b in DBCC or b in ("bra", "bral", "bsr", "jmp", "jsr"):
            if t is not None and lo <= t < hi:
                leaders.add(t)
        # bsr and jsr end a block too, and leaving them out was the last
        # divergence between the two dispatchers. They appear above, so a call's
        # target is a leader - but without them here the instruction *after* a
        # call is interior, and the block runs straight through the transfer.
        # decomp.py charges a block's whole cost at its head while gen_ts.py
        # charges per instruction, so across the call one side has paid for
        # instructions that have not run: measured at 0x1362e, tick(116) against
        # 30 actually executed, an 86-cycle gap held for the duration of the
        # call and settled on return. Eight blocks in a 2.4-million-poll run,
        # every one of them a block containing a call. That offset moved the
        # sound driver's busy-wait at 0x14510 across a frame boundary, so it
        # left one iteration apart, and the station banner came out green.
        # This is the same fault the comment above describes for inner entries -
        # a block head in one dispatcher and interior in the other - and it
        # wants the same answer: say the boundary is there.
        # Writing the status register ends a block for the same reason. The
        # mask lives there, so lowering it makes a pending interrupt takeable
        # at once: the chip takes it at the next instruction, and lifted code
        # that has already charged the rest of the block reaches that moment
        # somewhere else. Measured after the bsr/jsr fix above, the two blocks
        # still parting were 0x620, which is `move #$2000,sr`, and 0x133e6,
        # which is an rte restoring sr from the stack - both mask changes and
        # nothing else in common. rte is already TERMINAL; a move to sr is not,
        # and that is the gap.
        writes_sr = (b in ("move", "andi", "ori", "eori")
                     and (i.op_str or "").rstrip().endswith("sr"))
        if (b in TERMINAL or b in CONDITIONAL or b in DBCC
                or b in ("bsr", "jsr") or writes_sr):
            nxt = i.address + i.size
            if lo <= nxt < hi:
                leaders.add(nxt)

    starts = sorted(leaders)
    index = {a: n for n, a in enumerate(starts)}
    ends = starts[1:] + [hi]

    edges = defaultdict(set)
    for n, (s, e) in enumerate(zip(starts, ends)):
        # the last real instruction in this block
        last = None
        for a in range(s, e):
            if a in by_addr:
                last = by_addr[a]
        if last is None:
            if n + 1 < len(starts):
                edges[n].add(n + 1)
            continue
        b = base(last.mnemonic)
        t = target_of(last)
        if b in ("rts", "rte", "rtr", "stop"):
            pass                                   # leaves the routine
        elif b in ("bra", "bral", "jmp"):
            if t is not None and t in index:
                edges[n].add(index[t])
        elif b in CONDITIONAL or b in DBCC:
            if t is not None and t in index:
                edges[n].add(index[t])
            if last.address + last.size in index:
                edges[n].add(index[last.address + last.size])
        else:
            if last.address + last.size in index:
                edges[n].add(index[last.address + last.size])
    return {"blocks": starts, "edges": {k: sorted(v) for k, v in edges.items()}, "count": len(ins)}


def reducible(nblocks, edges):
    """Whether every loop has one entry - the test for ordinary nesting.

    Depth-first search classifies each edge. A back edge goes to a node still on
    the search stack; that node dominates its loop and the loop is well behaved.
    An edge into the middle of an already-finished region is a cross edge, and a
    loop reached through one has two ways in.
    """
    colour = [0] * nblocks                          # 0 unseen, 1 on stack, 2 done
    order = []
    back = 0
    stack = [(0, iter(edges.get(0, [])))]
    colour[0] = 1
    while stack:
        node, it = stack[-1]
        advanced = False
        for nxt in it:
            if colour[nxt] == 0:
                colour[nxt] = 1
                stack.append((nxt, iter(edges.get(nxt, []))))
                advanced = True
                break
            if colour[nxt] == 1:
                back += 1
        if not advanced:
            colour[node] = 2
            order.append(node)
            stack.pop()

    # A graph is reducible exactly when T1 and T2 collapse it to a single
    # node: T1 removes a self-edge, T2 merges a node that has exactly one
    # predecessor into that predecessor.
    #
    # BOTH maps have to be maintained, and only `preds` was. Merging x into
    # `only` makes `only` inherit x's successors, and without writing that
    # down the successors keep naming x - which is dead - so their live
    # predecessor set empties and they can never be merged themselves. The
    # collapse then stalls with several nodes alive and the graph reads as
    # irreducible. Measured 2026-08-02: 159 routines reported irreducible and
    # only 3 of them had a component with two entries, which is what
    # irreducible means. 0x022BA is the smallest: 0 -> 1, 1 -> 2, 2 -> {1, 3},
    # an ordinary loop with a tail, stalling with {0, 3} alive.
    preds = defaultdict(set)
    succs = defaultdict(set)
    for a, outs in edges.items():
        for b in outs:
            if b != a:
                preds[b].add(a)
                succs[a].add(b)
    alive = {n for n in range(nblocks) if colour[n] != 0}
    for n in list(succs):
        succs[n] &= alive
    changed = True
    while changed and len(alive) > 1:
        changed = False
        for n in sorted(alive):
            if n == 0:
                continue
            p = (preds[n] & alive) - {n}
            if len(p) != 1:
                continue
            only = next(iter(p))
            for t in succs[n] & alive:
                if t == n:
                    continue
                preds[t].discard(n)
                # A merge that makes `only` its own successor is a self-edge,
                # which T1 removes rather than counting as a way in.
                if only != t:
                    preds[t].add(only)
                    succs[only].add(t)
            succs[only].discard(n)
            alive.discard(n)
            changed = True
            break
    return len(alive) == 1, back


def main():
    funcs = FACTS["funcs"]
    rows = []
    for f in funcs:
        lo, hi = (f["at"], f["end"]) if isinstance(f, dict) else (f[0], f[1])
        g = build(lo, hi)
        if not g:
            continue
        n = len(g["blocks"])
        ok, back = reducible(n, {int(k): v for k, v in g["edges"].items()})
        rows.append({"at": lo, "end": hi, "blocks": n, "insns": g["count"],
                     "loops": back, "reducible": ok})

    total = len(rows)
    red = sum(1 for r in rows if r["reducible"])
    straight = sum(1 for r in rows if r["blocks"] == 1)
    loops = sum(1 for r in rows if r["loops"] > 0)
    print(f"routines analysed: {total}")
    print(f"  structurable with ordinary control flow: {red} ({red / total * 100:.1f}%)")
    print(f"  irreducible (a loop with two entries):   {total - red}")
    print(f"  straight-line, no branches at all:       {straight}")
    print(f"  containing at least one loop:            {loops}")
    sizes = sorted(r["insns"] for r in rows)
    print(f"  instructions: median {sizes[len(sizes) // 2]}, "
          f"largest {sizes[-1]}, total {sum(sizes)}")
    bl = sorted(r["blocks"] for r in rows)
    print(f"  basic blocks: median {bl[len(bl) // 2]}, largest {bl[-1]}")
    (HERE / "out" / "cfg.json").write_text(json.dumps(rows))
    print("wrote out/cfg.json")


if __name__ == "__main__":
    main()
