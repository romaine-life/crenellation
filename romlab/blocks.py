"""Lift routines that branch, turning the control-flow graph back into if/else.

The single-block pass carries register values forward as expressions, which
works only while there is one path. Once a routine branches, two paths reach
the same instruction with different values, so registers become ordinary local
variables and each block assigns to them. That is what makes a join work.

Branches need conditions, and a 68000 branch tests condition codes rather than
values. The flags almost always come from the instruction immediately before -
`tst`, `cmp`, `cmpi` and the arithmetic account for 93% of them - so the
comparison is reconstructed from that instruction and the branch's sense.

This pass handles routines whose graph has no loops. Loops need the back edge
turned into `while`, and come next.
"""

import json
import re
from collections import defaultdict
from pathlib import Path

from cfg import build, decode as cfg_decode, reducible, target_of
from decomp import ADDR, DATA, Bail, Expr, Lifter, SIZE_BITS, decode, num, split_ops

HERE = Path(__file__).parent

COND = {"bhi", "bls", "bcc", "bcs", "bne", "beq", "bvc", "bvs",
        "bpl", "bmi", "bge", "blt", "bgt", "ble"}

# how a branch reads the flags of `lhs - rhs`
SET_CC = {"st", "sf", "shi", "sls", "scc", "scs", "sne", "seq",
          "spl", "smi", "sge", "slt", "sgt", "sle"}

COMPARE = {
    "beq": "===", "bne": "!==",
    "blt": "<", "ble": "<=", "bgt": ">", "bge": ">=",
    "bcs": "<", "bls": "<=", "bhi": ">", "bcc": ">=",   # the unsigned pair
}
SIGNED = {"blt", "ble", "bgt", "bge"}


def sx(text, bits):
    """Sign-extend a value of `bits` width to a JavaScript number."""
    if bits == 32:
        return f"({text} | 0)"
    return f"((({text}) << {32 - bits}) >> {32 - bits})"


def uz(text, bits):
    return text if bits == 32 else f"(({text}) & {(1 << bits) - 1})"


class BlockLifter(Lifter):
    """Registers are local variables, so two paths can reach one join."""

    def __init__(self, lo, hi, names):
        super().__init__(lo, hi, names)
        self.flags = None
        self.saved = {}
        self.db_cond = None         # the loop test of the last dbcc

    def reg_value(self, r, bits):
        if r == "a7":
            return Expr("stackPointer()", "expr")
        if r not in self.used_regs and self.after_call:
            # First touched after a call, so it holds what the callee left -
            # a return value, most often. Introducing it as a parameter gives
            # it the value this routine's own caller passed, which is how a
            # routine came to read the wrong d0 immediately after the call that
            # produced it.
            self.stmts.append(f"{r} = getReg('{r}');")
        self.used_regs.add(r)
        if bits == 32:
            return Expr(r, "reg")
        return Expr(f"({r} & {(1 << bits) - 1})", "expr")

    def read(self, tok, bits):
        if tok.strip() == "sr":
            # The condition codes, which the lifted source does not keep - but
            # whatever set them last is known right here, so compute them and
            # give them to the machine, which composes the word.
            if self.flags is None:
                raise Bail("reads the condition codes with none set")
            kind, lhs, rhs, fbits = self.flags
            if kind not in ("cmp", "add"):
                raise Bail(f"reads the condition codes after {kind}")
            call = "setFlagsAdd" if kind == "add" else "setFlagsSub"
            self.stmts.append(f"{call}({lhs}, {rhs}, {fbits});")
            return Expr("getSr()", "expr")
        return super().read(tok, bits)

    def write(self, tok, value, bits):
        tok = tok.strip()
        if tok in DATA or tok in ADDR:
            if bits != 32 and tok in DATA:
                # A byte or word write keeps the register's upper bits, so the
                # destination is a source too. Going through reg_value is what
                # makes a register first touched *after* a call get the value
                # the callee left rather than the one this routine was passed -
                # `move.b $21(a2),d0` following a `jsr` keeps 24 bits of d0,
                # and taking them from the parameter is 24 bits of stale data.
                self.reg_value(tok, 32)
            self.used_regs.add(tok)
            if tok in ADDR and bits == 16:
                # Sign-extended to 32 bits: an address register has no partial
                # writes.
                value = Expr(f"((({value.text}) << 16) >> 16)")
            if bits == 32 or tok in ADDR:
                self.stmts.append(f"{tok} = {value.text};")
            else:
                keep = {8: "0xffffff00", 16: "0xffff0000"}[bits]
                mask = (1 << bits) - 1
                self.stmts.append(f"{tok} = (({tok} & {keep}) | ({value.text} & {mask}));")
            return
        super().write(tok, value, bits)

    def temp(self, value):
        """Named at function scope, not `const` inside the block.

        The structurer emits a block's statements and then the condition that
        leaves it, sometimes at a different nesting level, and node splitting
        copies a block into several places. A `const` declared in one of those
        is not in scope where it is read - which surfaced only as a
        ReferenceError out of the generated module.
        """
        if value.kind == "imm" or re.fullmatch(r"[A-Za-z_]\w*", value.text):
            return value
        name = f"t{len(self.temps)}"
        self.temps.append(name)
        self.stmts.append(f"{name} = {value.text};")
        return Expr(name, "expr")

    def mem_read(self, r, off, bits):
        """Pin the value where it was read.

        The single-block pass learned this the hard way: an expression holding
        `load8(a0)` that is used after `a0 = a0 + 1` reads the next byte. Here
        it matters for every `(an)+` operand, which is how this ROM walks
        strings - `tst.b (a0)+` followed by a branch tests the byte the pointer
        has already moved past.
        """
        v = super().mem_read(r, off, bits)
        return self.temp(v)

    def bump(self, r, by):
        if r == "a7":
            # The stack pointer is the machine's, not a local. Making it one
            # means the pop never happens and, worse, the writeback at the end
            # puts the local over the real stack pointer.
            if by <= 0:
                raise Bail("pre-decrement of the stack pointer")
            self.stmts.append(f"drop({by});")
            self.pushed -= by
            return
        self.used_regs.add(r)
        self.stmts.append(f"{r} = ({r} {'+' if by > 0 else '-'} {abs(by)});")

    def flush(self):
        """Put the locals back in the machine before control leaves.

        The callee reads its arguments out of registers and is free to change
        any of them. Locals that never reach the machine are invisible to it,
        and locals never reloaded afterwards still hold what this routine put
        there before the call - which is how a routine came to use a stale d0
        that the callee had long since overwritten.
        """
        for r in sorted(self.used_regs):
            self.stmts.append(f"setReg('{r}', {r});")

    def reload(self):
        for r in sorted(self.used_regs):
            self.stmts.append(f"{r} = getReg('{r}');")

    def step(self, ins):
        b = ins.mnemonic.split(".")[0]
        size = ins.mnemonic.rsplit(".", 1)[1] if "." in ins.mnemonic else "w"
        bits = SIZE_BITS.get(size, 16)
        ops = split_ops(ins.op_str or "")

        if b in COND or b == "bra" and False:
            return                                   # handled by the structurer
        if b in ("cmp", "cmpi", "cmpa"):
            rhs = self.read(ops[0], bits)
            lhs = self.read(ops[1], 32 if b == "cmpa" else bits)
            self.flags = ("cmp", lhs.text, rhs.text, 32 if b == "cmpa" else bits)
            return
        if b == "tst":
            v = self.read(ops[0], bits)
            self.flags = ("cmp", v.text, "0", bits)
            return
        if b == "btst":
            n = self.read(ops[0], 32)
            v = self.read(ops[1], bits)
            self.flags = ("bit", v.text, n.text, bits)
            return
        if b.startswith("db") and b != "divs":
            reg = ops[0].strip()
            if reg not in DATA:
                raise Bail(f"{b} on {reg}")
            # `dbcc` leaves the loop two ways: the condition came true, or the
            # counter ran out. Only `dbra`/`dbf` have no condition - treating
            # every one of them that way, as this did, drops the test entirely
            # and `dbeq` then scans the whole array instead of stopping.
            cc = b[2:]
            pre = None
            if cc not in ("ra", "f"):
                if cc == "t":
                    raise Bail("dbt never loops")
                name = f"dbc_{len(self.temps)}"
                self.temps.append(name)
                # Pinned before the decrement: the test reads flags set by the
                # instruction before, and the decrement is about to change the
                # register those flags may have come from.
                self.stmts.append(f"{name} = ({self.condition('b' + cc)});")
                pre = name
            self.used_regs.add(reg)
            # The decrement happens only when the condition is false. `dbeq`
            # that stops on the first match leaves the counter untouched, and
            # decrementing anyway puts every later index one slot low.
            dec = f"{reg} = (({reg} & 0xffff0000) | ((({reg} & 0xffff) - 1) & 0xffff));"
            self.stmts.append(dec if pre is None else f"if (!{pre}) {{ {dec} }}")
            # `dbcc` does not touch the flags. Its own branch has a condition of
            # its own, kept separately, and whatever set the flags before is
            # still what the next branch tests - `dbeq` followed by `bne` is
            # asking which way the loop ended, and answering it with the loop
            # counter instead of the byte is a different question entirely.
            self.db_cond = self.condition_of(
                ("dbcc" if pre is None else "dbcc-cc"),
                pre or f"({reg} & 0xffff)", f"({reg} & 0xffff)", 16)
            return
        if b == "movem":
            self.movem(ins, ops, bits)
            return
        if b == "link":
            # A stack frame: push the old frame pointer, point a6 at it, and
            # reserve locals below. The locals have to be real machine stack -
            # routines take their address and hand it to callees.
            self.frame = ops[0].strip()
            self.used_regs.add("a6")
            self.stmts.append("push(a6, 4);")
            self.stmts.append("a6 = stackPointer();")
            # The displacement is a signed word: `link a6,#$fffc` reserves
            # four bytes, not 65,532. Reading it unsigned moved the stack
            # pointer most of the way across memory in the wrong direction.
            disp = num(ops[1]) & 0xffff
            if disp & 0x8000:
                disp -= 0x10000
            self.stmts.append(f"drop({disp});")
            self.pushed += 4 - disp
            return
        if b == "unlk":
            self.used_regs.add("a6")
            self.stmts.append("setStackPointer(a6);")
            self.stmts.append("a6 = popLong();")
            self.pushed = 0
            return
        if b in ("jsr", "bsr"):
            super().step(ins)
            for r in sorted(self.used_regs):
                self.stmts.append(f"{r} = getReg('{r}');")
            self.after_call = True
            self.flags = None
            return
        # Set-on-condition: the same test a branch would take, written into a
        # byte as all-ones or all-zeroes instead of jumping. Only this pass can
        # do it, because only this pass knows what set the flags.
        if b in SET_CC:
            cond = self.condition("b" + b[1:]) if b not in ("st", "sf") else None
            text = {"st": "0xff", "sf": "0"}.get(b, f"(({cond}) ? 0xff : 0)")
            self.write(ops[0], Expr(text, "expr"), 8)
            return
        # An add whose operands can be read twice without side effects: keep
        # them, so a later `bcc` can be answered with the real carry rather
        # than a comparison that never sees it.
        addends = None
        if (b in ("add", "addq", "addi", "adda") and len(ops) == 2
                and ops[-1].strip() in DATA
                and (ops[0].strip() in DATA or ops[0].strip() in ADDR
                     or ops[0].strip().startswith("#"))):
            addends = (self.temp(self.reg_value(ops[-1].strip(), bits)).text,
                       self.temp(self.read(ops[0], bits)).text)
        before = len(self.stmts)
        super().step(ins)
        # Anything that writes a data register also sets the flags from what it
        # wrote, which is what a bare `bne` after an `addq` is testing.
        if b in ("move", "moveq", "add", "addq", "addi", "sub", "subq", "subi",
                 "and", "andi", "or", "ori", "eor", "eori", "clr", "asl", "asr",
                 "lsl", "lsr", "neg", "not", "ext") and ops:
            dst = ops[-1].strip()
            if addends is not None:
                self.flags = ("add", addends[0], addends[1], bits)
            elif dst in DATA:
                self.flags = ("cmp", self.reg_value(dst, bits).text, "0", bits)
            elif re.fullmatch(r"(-?\$?[0-9a-fA-F]+)?\((a\d)\)|\$[0-9a-fA-F]+\.(w|l)", dst):
                # A read-modify-write on memory sets the flags from what it
                # wrote. `subq.w #1,(a2)` followed by `bgt` is the ROM's
                # countdown, and without this the branch reads whatever set
                # the flags before it. Only operands that can be read a second
                # time without moving a pointer qualify.
                self.flags = ("cmp", self.temp(self.read(dst, bits)).text, "0", bits)
            elif b == "clr":
                self.flags = ("cmp", "0", "0", bits)
        del before

    def regs_of(self, tok):
        """Expand a movem register list like `d2-d4/a2` into names."""
        out = []
        for part in tok.split("/"):
            part = part.strip()
            m = re.fullmatch(r"([ad])(\d)-([ad])(\d)", part)
            if m and m.group(1) == m.group(3):
                for n in range(int(m.group(2)), int(m.group(4)) + 1):
                    out.append(f"{m.group(1)}{n}")
                continue
            if re.fullmatch(r"[ad]\d", part):
                out.append(part)
                continue
            raise Bail(f"movem list {tok!r}")
        return out

    def movem(self, ins, ops, bits):
        """Save or restore a set of registers.

        This is the routine keeping its promise to its caller, not part of what
        the routine computes. Saving pins the value in a constant and restoring
        puts it back, which is exactly the promise, and leaves the body free to
        use the register in between.
        """
        wide = bits // 8
        if ops[1].strip() == "-(a7)":
            regs = self.regs_of(ops[0])
            # The value is pinned in a constant *and* the machine's stack
            # actually moves. Recording the depth without moving the stack
            # leaves any callee looking at a stack this many bytes shallower
            # than the ROM's, which only shows up if the callee reads past its
            # own arguments - and some do.
            for r in reversed(regs):
                self.used_regs.add(r)
                self.stmts.append(f"push({r}, {wide});")
            for r in regs:
                name = f"save_{r}_{len(self.temps)}"
                self.temps.append(name)
                self.stmts.append(f"{name} = {r};")
                self.saved.setdefault(r, []).append(name)
            self.pushed += wide * len(regs)
            return
        if ops[0].strip() == "(a7)+":
            regs = self.regs_of(ops[1])
            for n, r in enumerate(regs):
                if not self.saved.get(r):
                    # Not this routine's push - it is unwinding a frame built
                    # elsewhere, or sharing another routine's epilogue. Read the
                    # value off the machine stack, where it actually is. A word
                    # restore sign-extends across the whole register.
                    self.used_regs.add(r)
                    at = f"stackPointer() + {n * wide}" if n else "stackPointer()"
                    self.stmts.append(
                        f"{r} = " + (f"load32({at});" if wide == 4
                                     else f"((load16({at}) << 16 >> 16) >>> 0);"))
                    continue
                self.stmts.append(f"{r} = {self.saved[r].pop()};")
            self.stmts.append(f"drop({wide * len(regs)});")
            self.pushed -= wide * len(regs)
            return
        # To or from ordinary memory rather than the stack. The registers go in
        # ascending address order, d0-d7 then a0-a7, whatever order the operand
        # lists them in.
        def slot(base_tok, k):
            return f"{base_tok} + {k * wide}"

        if re.fullmatch(r"[ad]\d(-[ad]\d)?(/[ad]\d(-[ad]\d)?)*", ops[0].strip()):
            regs = self.regs_of(ops[0])
            dest = ops[1].strip()
            base = self.mem_base(dest)
            for k, r in enumerate(regs):
                # a7 is the machine's stack pointer, never a local. A register
                # list that reaches a7 - `movem.l d1-d7/a2-a7,(a0)`, which is
                # this ROM's setjmp - would otherwise save the value this
                # routine was handed instead of where the stack actually is.
                if r == "a7":
                    self.stmts.append(f"store{bits}({slot(base, k)}, stackPointer());")
                    continue
                self.used_regs.add(r)
                self.stmts.append(f"store{bits}({slot(base, k)}, {r});")
            return
        regs = self.regs_of(ops[1])
        base = self.mem_base(ops[0].strip())
        for k, r in enumerate(regs):
            if r == "a7":
                self.stmts.append(f"setStackPointer(load{bits}({slot(base, k)}));")
                continue
            self.used_regs.add(r)
            self.stmts.append(f"{r} = load{bits}({slot(base, k)});")
        return

    def mem_base(self, tok):
        """The address an operand names, as an expression."""
        m = re.fullmatch(r"\$([0-9a-fA-F]+)\.(w|l)", tok)
        if m:
            return f"0x{int(m.group(1), 16):x}"
        m = re.fullmatch(r"(-?\$?[0-9a-fA-F]+)?\((a\d)\)", tok)
        if m:
            off = num(m.group(1)) if m.group(1) else 0
            base = self.reg_value(m.group(2), 32).text
            return base if off == 0 else f"({base} + {hex(off)})"
        raise Bail(f"movem through {tok!r}")

    def condition(self, mnemonic):
        """The branch's test, as an expression."""
        if self.flags is None:
            raise Bail(f"{mnemonic} with no flag-setter before it")
        return self.condition_of(*self.flags, mnemonic=mnemonic)

    def condition_of(self, kind, lhs, rhs, bits, mnemonic="b"):
        if kind == "bit":
            if mnemonic == "beq":
                return f"((({lhs}) >>> (({rhs}) & 7)) & 1) === 0"
            if mnemonic == "bne":
                return f"((({lhs}) >>> (({rhs}) & 7)) & 1) !== 0"
            raise Bail(f"{mnemonic} after btst")
        if kind == "dbcc":
            return f"{lhs} !== 0xffff"
        if kind == "dbcc-cc":
            # Loop again only if the condition is still false and the counter
            # has not wrapped past zero.
            return f"!{lhs} && {rhs} !== 0xffff"
        if kind == "add":
            # An add sets carry as well as N and Z, and modelling it as
            # "the result against zero" loses it. `add.w dN,dN` is this ROM's
            # shift-left, and the `bcc`/`bcs` after it is reading the bit that
            # fell off the top - answered as a comparison it is always false.
            mask = (1 << bits) - 1
            wide = f"((({lhs}) & {mask}) + (({rhs}) & {mask}))"
            res = f"({wide} & {mask})"
            if mnemonic in ("bcs", "bcc"):
                return f"{wide} {'>' if mnemonic == 'bcs' else '<='} {mask}"
            if mnemonic in ("beq", "bne"):
                return f"{res} {'===' if mnemonic == 'beq' else '!=='} 0"
            if mnemonic in ("bmi", "bpl"):
                return f"{sx(res, bits)} {'<' if mnemonic == 'bmi' else '>='} 0"
            if mnemonic == "bhi":
                return f"{wide} <= {mask} && {res} !== 0"
            if mnemonic == "bls":
                return f"({wide} > {mask} || {res} === 0)"
            if mnemonic in SIGNED:
                return f"{sx(res, bits)} {COMPARE[mnemonic]} 0"
            raise Bail(f"{mnemonic} after add")
        if mnemonic in ("bmi", "bpl"):
            # The sign of `lhs - rhs`, which after a `tst` is just the sign of
            # the value. Both operands are sign-extended first: comparing the
            # raw words makes every negative number look large and positive.
            op = "<" if mnemonic == "bmi" else ">="
            return f"({sx(lhs, bits)} - {sx(rhs, bits)}) {op} 0"
        if mnemonic not in COMPARE:
            raise Bail(f"branch {mnemonic}")
        op = COMPARE[mnemonic]
        conv = sx if mnemonic in SIGNED else uz
        return f"{conv(lhs, bits)} {op} {conv(rhs, bits)}"


def back_edges(edges, n):
    """Edges returning to a block already on the current path."""
    colour = [0] * n
    found = set()
    stack = [(0, iter(edges.get(0, [])))]
    colour[0] = 1
    while stack:
        v, it = stack[-1]
        moved = False
        for w in it:
            if colour[w] == 1:
                found.add((v, w))
            elif colour[w] == 0:
                colour[w] = 1
                stack.append((w, iter(edges.get(w, []))))
                moved = True
                break
        if not moved:
            colour[v] = 2
            stack.pop()
    return found


def loop_body(edges, latches, header):
    """Blocks that can reach the header again without leaving the loop."""
    body = {header}
    stack = list(latches)
    while stack:
        n = stack.pop()
        if n in body:
            continue
        body.add(n)
        for pred, outs in edges.items():
            if n in outs and pred not in body:
                stack.append(pred)
    return body


def loop_exit(edges, body):
    outs = {m for n in body for m in edges.get(n, []) if m not in body}
    if len(outs) > 1:
        raise Bail("loop with more than one way out")
    return next(iter(outs)) if outs else None



def sccs(edges, n):
    """Strongly connected components, by Tarjan's algorithm, iteratively."""
    index = {}
    low = {}
    on = set()
    stack = []
    out = []
    counter = [0]
    for root in range(n):
        if root in index:
            continue
        work = [(root, iter(edges.get(root, [])))]
        index[root] = low[root] = counter[0]
        counter[0] += 1
        stack.append(root)
        on.add(root)
        while work:
            v, it = work[-1]
            pushed = False
            for w in it:
                if w not in index:
                    index[w] = low[w] = counter[0]
                    counter[0] += 1
                    stack.append(w)
                    on.add(w)
                    work.append((w, iter(edges.get(w, []))))
                    pushed = True
                    break
                if w in on:
                    low[v] = min(low[v], index[w])
            if pushed:
                continue
            work.pop()
            if work:
                low[work[-1][0]] = min(low[work[-1][0]], low[v])
            if low[v] == index[v]:
                comp = []
                while True:
                    w = stack.pop()
                    on.discard(w)
                    comp.append(w)
                    if w == v:
                        break
                out.append(comp)
    return out


def split_nodes(edges, nblocks, limit):
    """Duplicate blocks until every loop has one way in.

    Assembly written by hand jumps into the middle of loops, which no
    combination of `while` and `if` can express - the block genuinely has two
    entries. Giving each entry its own copy of the region is the standard
    remedy: the copies are identical code, and the graph that results nests.
    """
    edges = {k: list(v) for k, v in edges.items()}
    total = nblocks
    clone_of = {}
    for _ in range(24):
        ok, _ = reducible(total, edges)
        if ok:
            return edges, total, clone_of
        target = None
        for comp in sccs(edges, total):
            if len(comp) < 2:
                continue
            inside = set(comp)
            entries = sorted({w for v, outs in edges.items() for w in outs
                              if w in inside and v not in inside})
            if 0 in inside:
                entries = sorted(set(entries) | {0})
            if len(entries) > 1:
                target = (inside, entries)
                break
        if target is None:
            return None, None, None
        inside, entries = target
        keep, extra = entries[0], entries[1:]
        for entry in extra:
            if total + len(inside) > limit:
                return None, None, None
            mapping = {}
            for node in sorted(inside):
                mapping[node] = total
                clone_of[total] = node
                total += 1
            for node in sorted(inside):
                edges[mapping[node]] = [mapping.get(m, m) for m in edges.get(node, [])]
            # every edge from outside that went to `entry` now goes to its copy
            for v, outs in list(edges.items()):
                if v in inside or v in mapping.values():
                    continue
                edges[v] = [mapping[entry] if m == entry else m for m in outs]
            del keep
    return None, None, None



def dispatch_form(starts, edges, lifted, conds):
    """Blocks in a loop that picks the next one, for graphs that will not nest.

    Not a program counter and not the recompiler's switch over addresses: the
    block bodies are recovered source, and only the sequencing is dynamic. It
    is the shape a decompiler reaches for when the control flow genuinely has
    no nested form.
    """
    # Each `case` is its own block scope, so a name declared in one is not in
    # scope in another - and a value saved by `movem` in the first block is read
    # back in the last. Every declaration is hoisted to the function.
    names = []
    hoisted = {}
    for n in range(len(starts)):
        rewritten = []
        for s in lifted.get(n, []):
            m = re.match(r"\s*(?:const|let)\s+(\w+)\s*=", s)
            if m:
                names.append(m.group(1))
                s = re.sub(r"^(\s*)(?:const|let)\s+",
                           lambda mm: mm.group(1), s, count=1)
            rewritten.append(s)
        hoisted[n] = rewritten

    out = [f"let {x} = 0;" for x in names]
    out += ["let _at = 0;", "dispatch: for (;;) {",
            "  if (++_guard > 4000000) throw new Error('dispatch did not end');",
            "  switch (_at) {"]
    for n in range(len(starts)):
        out.append(f"    case {n}: {{")
        out.extend("      " + s for s in hoisted.get(n, []))
        outs = edges.get(n, [])
        if not outs:
            out.append("      break dispatch;")
        elif len(outs) == 1:
            out.append(f"      _at = {outs[0]}; continue dispatch;")
        else:
            if n not in conds:
                raise Bail("two-way branch with no condition")
            cond, taken = conds[n]
            other = [x for x in outs if x != taken]
            if len(other) != 1:
                raise Bail("branch whose two edges cannot be told apart")
            out.append(f"      _at = ({cond}) ? {taken} : {other[0]}; continue dispatch;")
        out.append("    }")
    out.append("    default: break dispatch;")
    out.append("  }")
    out.append("}")
    return out


# The writeback every `rts` has to do before returning. Set by lift_once once
# the register set is known, which the two-pass lift guarantees is before the
# structurer runs.
EXIT = []


def structure(blocks, edges, lifted, conds, node, stop, depth=0, backs=frozenset(),
              open_loops=(), entering=None):
    """Emit one region as nested if/else and for(;;).

    `entering` is the loop header this call is the body of, if any. Reaching it
    again means go round; reaching it the first time means emit it. Without that
    distinction the header is treated as already open the moment the body starts
    and the body becomes a bare `continue` - a loop that cannot do anything and
    cannot stop, which is what fifty of the held-back routines were.
    """
    out = []
    seen = set()
    first = True
    while node is not None and node != stop:
        if node in open_loops and not (first and node == entering):
            out.append("continue;")
            return out
        first = False
        if any(w == node for _, w in backs):
            header = node
            latches = [v for v, w in backs if w == header]
            body = loop_body(edges, latches, header)
            after = loop_exit(edges, body)
            inner = structure(blocks, edges, lifted, conds, header, after, depth + 1,
                              frozenset((v, w) for v, w in backs if w != header),
                              open_loops + (header,), header)
            out.append("for (;;) {")
            out.append(f"  if (++_guard > 4000000) throw new Error('loop {header} did not end');")
            out.extend("  " + s for s in inner)
            out.append("  break;")
            out.append("}")
            node = after
            continue
        if node in seen or depth > 40:
            raise Bail("control flow this pass cannot shape")
        seen.add(node)
        out.extend(lifted[node])
        outs = edges.get(node, [])
        if not outs:
            # An `rts` block. Returning from the recursion is not the same as
            # returning from the function: nested inside an `if`, the emitted
            # block simply ends and control falls into whatever the structurer
            # wrote after it. Node splitting duplicates tails, so that is the
            # routine's own epilogue - run a second time, restoring saved
            # registers over the values it just computed.
            out.extend(EXIT)
            out.append("return;")
            return out
        if len(outs) == 1:
            node = outs[0]
            continue
        if node not in conds:
            raise Bail("two-way branch with no condition")
        cond_text, taken = conds[node]
        fall = [x for x in outs if x != taken]
        if not fall:
            # Both edges land on the same block: the test decides nothing.
            node = taken
            continue
        if len(fall) != 1:
            raise Bail("branch whose two edges cannot be told apart")
        fall = fall[0]
        join = meet(edges, taken, fall)
        cond = cond_text
        then = structure(blocks, edges, lifted, conds, taken, join, depth + 1,
                         backs, open_loops)
        other = structure(blocks, edges, lifted, conds, fall, join, depth + 1,
                          backs, open_loops)
        if other:
            out.append(f"if ({cond}) {{")
            out.extend("  " + s for s in then)
            out.append("} else {")
            out.extend("  " + s for s in other)
            out.append("}")
        else:
            out.append(f"if ({cond}) {{")
            out.extend("  " + s for s in then)
            out.append("}")
        node = join
    return out


def meet(edges, a, b):
    """The first node both paths reach - where an if/else joins again."""
    def reach(n, seen):
        if n in seen:
            return
        seen.add(n)
        for m in edges.get(n, []):
            reach(m, seen)
    ra, rb = set(), set()
    reach(a, ra)
    reach(b, rb)
    both = ra & rb
    if not both:
        return None
    # the one nothing else in the set reaches first: the earliest join
    order = sorted(both)
    for n in order:
        others = set()
        for m in both:
            if m != n:
                reach(m, others)
        if n not in others:
            return n
    return order[0]


def lift(lo, hi, names):
    """Lift twice: once to learn which registers the routine touches, then
    again knowing them.

    A register first read inside a branch has its `getReg` emitted inside that
    branch, while the epilogue writes every register back on every path. The
    path that skipped the load therefore writes the value this routine was
    entered with over whatever a call left in the machine. Knowing the whole
    set up front makes each one a parameter, seeded from the machine at entry
    and re-read after every call, so no path can carry a stale register.
    """
    first, _ = lift_once(lo, hi, names)
    seed = frozenset(first.used_regs) - {"a7"}
    return lift_once(lo, hi, names, seed)


def lift_once(lo, hi, names, seed=()):
    g = build(lo, hi)
    if not g:
        raise Bail("nothing to decode")
    starts, edges = g["blocks"], {int(k): v for k, v in g["edges"].items()}
    ok, back = reducible(len(starts), edges)
    clone_of = {}
    dispatch = False
    if not ok:
        split, grown, cloned = split_nodes(edges, len(starts), len(starts) * 4 + 8)
        if split is None:
            # Genuinely irreducible: a loop entered at two places, which no
            # arrangement of `if` and `for` expresses without duplicating the
            # whole region. Every decompiler falls back here - Hex-Rays and
            # Ghidra emit goto. JavaScript has no goto, so the blocks go in a
            # dispatch loop. Everything inside them is still recovered source:
            # real conditions, real locals, real calls. Only the order the
            # blocks run in is decided at runtime rather than by nesting.
            dispatch = True
        else:
            edges, clone_of = split, cloned
            del grown
    ends = starts[1:] + [hi]

    index = {a: k for k, a in enumerate(starts)}
    lifter = BlockLifter(lo, hi, names)
    lifter.used_regs.update(seed)
    lifted, conds = {}, {}
    # Flags reach a block from its predecessors in the graph, not from whatever
    # happens to sit before it in memory. Address order is right for the common
    # case and wrong wherever a block is reached by a branch - the flags then
    # belong to a block that never ran on that path. Only agreeing predecessors
    # count; disagreement means the branch there cannot be answered, which is
    # what the "no flag-setter" bail says.
    preds = defaultdict(set)
    for a, outs in edges.items():
        for b_ in outs:
            preds[b_].add(a)
    end_flags = {}
    for n, (s, e) in enumerate(zip(starts, ends)):
        lifter.stmts = []
        if n:
            known = {end_flags[p] for p in preds.get(n, ()) if p in end_flags}
            if len(known) == 1:
                lifter.flags = next(iter(known))
            # Predecessors that disagree leave whatever the block before this
            # one in memory left. That is not sound in general, but it is what
            # the graph cannot answer, and the oracle is the thing deciding
            # whether it was right - taking None here instead costs five
            # routines and gains one.
        ins = decode(s, e)
        for i in ins:
            b = i.mnemonic.split(".")[0]
            if b.startswith("db") and b != "divs":
                # Both a decrement and a branch. The decrement is emitted by
                # the lifter; the branch has to be recorded here or the block
                # ends with two successors and no test, which is what every
                # "two-way branch with no condition" bail was.
                lifter.step(i)
                tgt = target_of(i)
                if tgt is None or tgt not in index:
                    raise Bail("dbcc out of the routine")
                conds[n] = (lifter.db_cond, index[tgt])
                continue
            if b in COND:
                # Which successor is the taken one has to come from the branch
                # itself. The graph stores successors sorted by block index, so
                # for a forward branch the fall-through sorts first - reading
                # them positionally inverts every condition in the routine.
                tgt = target_of(i)
                if tgt is None:
                    raise Bail("conditional branch with no plain target")
                if tgt not in index:
                    # Conditionally leaves the routine: a tail jump under a
                    # test. The graph has only the fall-through edge, so this
                    # is emitted in the block itself and the structurer carries
                    # on with the path that stays.
                    cond = lifter.condition(b)
                    lifter.stmts.append(f"if ({cond}) {{")
                    saved = list(lifter.stmts)
                    lifter.stmts = []
                    lifter.flush()
                    inner = lifter.stmts
                    lifter.stmts = saved
                    lifter.stmts.extend("  " + s for s in inner)
                    lifter.stmts.append(f"  jumpRom(0x{tgt:05x});")
                    lifter.stmts.append("  return;")
                    lifter.stmts.append("}")
                    continue
                conds[n] = (lifter.condition(b), index[tgt])
                continue
            if b in ("bra", "bral", "jmp"):
                tgt = target_of(i)
                if tgt is not None and tgt in index:
                    continue                     # an edge the graph already has
                if tgt is None:
                    # Through a register or a table. The dispatcher takes an
                    # address either way, and the callee inherits this frame.
                    lifter.flush()
                    ops = split_ops(i.op_str or "")
                    lifter.stmts.append(f"jumpRom({lifter.effective_address(ops[0])});")
                    lifter.stmts.append("return;")
                    continue
                # Outside this routine: a tail jump, which hands the callee the
                # frame this routine was given. The graph has no edge for it, so
                # without this the block simply runs off its end and control
                # never goes anywhere.
                lifter.flush()
                lifter.stmts.append(f"jumpRom(0x{tgt:05x});")
                lifter.stmts.append("return;")
                continue
            lifter.step(i)
        lifted[n] = list(lifter.stmts)
        end_flags[n] = lifter.flags
    for copy, orig in clone_of.items():
        lifted[copy] = list(lifted[orig])
        if orig in conds:
            conds[copy] = conds[orig]
    # A routine whose last block runs off its end does not stop there - the
    # machine carries straight on into whatever follows. The single-block pass
    # has rejected that shape for a long time; this one did not, and produced
    # functions that returned where the machine kept executing.
    tail = decode(starts[-1], hi)
    last_ins = tail[-1] if tail else None
    last = last_ins.mnemonic.split(".")[0] if last_ins else ""
    runs_on = last_ins is not None and last not in ("rts", "rte", "rtr", "jmp", "bra", "bral")
    if runs_on and (last in COND or last.startswith("db")):
        # A conditional branch at the very end runs on only if its own target
        # also left the routine - both ways out are then tail jumps, the block
        # has no successors at all, and the `if` for the taken side has already
        # been emitted. When the target is inside, the fall-through is the
        # graph's edge and jumping here would make the branch unconditional.
        tgt = target_of(last_ins)
        runs_on = tgt is None or tgt not in index
    if runs_on:
        lifter.stmts = []
        lifter.flush()
        lifted[len(starts) - 1] = lifted.get(len(starts) - 1, []) + list(lifter.stmts) + [
            f"jumpRom(0x{hi:05x});", "return;"]

    global EXIT
    EXIT = [f"setReg('{x}', {x});" for x in sorted(lifter.used_regs) if x != "a7"]
    if dispatch:
        return lifter, dispatch_form(starts, edges, lifted, conds)
    try:
        backs = frozenset(back_edges(edges, len(starts) + len(clone_of)))
        return lifter, structure(starts, edges, lifted, conds, 0, None, 0, backs, ())
    except Bail:
        # Shapes the structurer cannot nest - a loop with several ways out, a
        # region it cannot bound - are not failures, they are what the dispatch
        # form exists for. Falling back keeps the block bodies as recovered
        # source and only makes the sequencing dynamic.
        return lifter, dispatch_form(starts, edges, lifted, conds)
    backs = frozenset(back_edges(edges, len(starts) + len(clone_of)))
    body = structure(starts, edges, lifted, conds, 0, None, 0, backs, ())
    return lifter, body


def main():
    rows = json.loads((HERE / "out" / "cfg.json").read_text())
    # Irreducible graphs are included now: split_nodes duplicates the
    # multi-entry regions until they nest.
    # Every routine, not just the branching ones. A single block can still end
    # in a conditional tail jump or use set-on-condition, and this pass is the
    # only one with flags - the first pass refuses those, and its refusals were
    # simply going nowhere.
    targets = rows
    ok, failed = [], {}
    for r in targets:
        try:
            lifter, body = lift(r["at"], r["end"], {})
            regs = sorted(lifter.used_regs)
            args = [f"{x}: number" for x in regs] + \
                   [f"{lifter.params[k]}: number" for k in sorted(lifter.params)]
            # Temps at function scope, not `const` in a block: the structurer
            # reads them from conditions emitted outside the block they were
            # named in, and node splitting copies blocks around.
            decl = "\n".join([f"  let {x} = {x}_;" for x in regs]
                             + [f"  let {x} = {'false' if x.startswith('dbc_') else '0'};"
                                for x in lifter.temps])
            sig = ", ".join(
                [f"{x}_: number" for x in regs]
                + [f"{lifter.params[k]}: number" for k in sorted(lifter.params)])
            tail = "\n".join(f"  setReg('{x}', {x});" for x in regs)
            # Declared unconditionally. A loop guard is referenced from inside
            # a nested region, and deciding whether to declare it by looking
            # for the name in the assembled body missed three routines - which
            # ran correctly and failed to type-check, the one combination the
            # oracle cannot catch.
            guard = "  let _guard = 0;\n  void _guard;\n"
            src = (f"export function fn_{r['at']:05x}({sig}): void {{\n"
                   + guard
                   + (decl + "\n" if decl else "")
                   + "\n".join("  " + s for s in body)
                   + ("\n" + tail if tail else "") + "\n}")
            ok.append((r["at"], src, regs, sorted(lifter.params)))
            del args
        except Bail as e:
            key = str(e).split("'")[0].strip()
            failed[key] = failed.get(key, 0) + 1
        except RecursionError:
            failed["deep recursion"] = failed.get("deep recursion", 0) + 1
        except Exception as e:                       # noqa: BLE001
            k = f"crash: {type(e).__name__}"
            failed[k] = failed.get(k, 0) + 1

    print(f"branching routines: {len(targets)}")
    print(f"  lifted: {len(ok)} ({len(ok) * 100 // max(1, len(targets))}%)")
    for k, n in sorted(failed.items(), key=lambda kv: -kv[1])[:60]:
        print(f"    {n:4}  {k}")
    (HERE / "out" / "blocks.json").write_text(json.dumps(
        [{"at": a, "src": s, "regs": g, "stack": st} for a, s, g, st in ok]))
    if ok:
        print("\nexample:\n")
        for _, src, _, _ in sorted(ok, key=lambda x: len(x[1]))[3:4]:
            print(src)


if __name__ == "__main__":
    main()
