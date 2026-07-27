"""68000 -> TypeScript translator.

Emits a runnable TypeScript function per ROM routine, operating on the Machine
model in frontend/src/rom/machine.ts. Control flow is a switch on the program
counter, so branches, loops and mid-routine entry all work without having to
restructure anything.

Any instruction form without a rule emits a throw naming its address, so an
unsupported opcode fails loudly at run time rather than quietly computing the
wrong number.
"""
import re

SZBITS = {"b": 8, "w": 16, "l": 32}


def split_ops(s):
    """Split an operand list on commas that are not inside parentheses."""
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def num(t):
    t = t.strip()
    neg = t.startswith("-")
    if neg:
        t = t[1:]
    v = int(t.lstrip("$"), 16) if t.startswith("$") else int(t)
    return -v if neg else v


REG = re.compile(r"^([da]\d)$")
IMM = re.compile(r"^#(.+)$")
ABS = re.compile(r"^\$([0-9a-fA-F]+)(\.[wl])?$")
IND = re.compile(r"^\((a\d|sp)\)$")
POST = re.compile(r"^\((a\d|sp)\)\+$")
PRE = re.compile(r"^-\((a\d|sp)\)$")
DISP = re.compile(r"^(-?\$?[0-9a-fA-F]+)\((a\d|sp|pc)\)$")
IDX = re.compile(r"^(-?\$?[0-9a-fA-F]+)\((a\d|sp|pc),\s*([da]\d)\.([wl])\)$")
# the same indexed form with the displacement omitted, which capstone prints
# as (a0,d0.l) - by far the most common form the first pass missed
NOIDX = re.compile(r"^\((a\d|sp|pc),\s*([da]\d)\.([wl])\)$")


def abs_addr(m):
    """Absolute address, taking the .w form as signed.

    `$fff4.w` is 0xFFFFFFF4, not 0x0000FFF4: absolute short sign-extends its
    16-bit address, which is how the low end of the address space and the top
    of it are both reachable in one word. Dropping the suffix silently turns
    every high short address into a completely different location.
    """
    a = int(m.group(1), 16)
    if m.group(2) == ".w" and a & 0x8000:
        a = (a - 0x10000) & 0xFFFFFFFF
    return a


class Operand:
    """One operand as a TypeScript read expression and an optional write form."""

    def __init__(self, tok, size):
        self.tok = tok.strip()
        self.size = size
        self.bits = SZBITS[size]
        self.read = None
        self.write = None
        self._build()

    def _step(self, r):
        """How far a pre-decrement or post-increment moves the register.

        A byte access through the stack pointer moves it by two, not one: the
        68000 keeps the stack word-aligned, so a7 never lands on an odd
        address. Every other address register steps by the operand size.
        """
        if r == "a7" and self.bits == 8:
            return 2
        return self.bits // 8

    @staticmethod
    def _reg(r):
        # capstone prints pc-relative operands with the displacement already
        # resolved to an absolute address, so the base contributes nothing
        if r == "pc":
            return "0"
        return "m.a7" if r in ("sp", "a7") else "m." + r

    def _build(self):
        t = self.tok
        if REG.match(t) or t in ("sp", "a7"):
            r = self._reg(t)
            self.read = "m.rd(%s, %d)" % (r, self.bits)
            self.write = "%s = m.wr(%s, %%s, %d)" % (r, r, self.bits)
            return
        m = IMM.match(t)
        if m:
            self.read = str(num(m.group(1)) & 0xFFFFFFFF)
            return
        m = ABS.match(t)
        if m:
            a = abs_addr(m)
            self.read = "m.load(0x%x, %d)" % (a, self.bits)
            self.write = "m.store(0x%x, %%s, %d)" % (a, self.bits)
            return
        m = IND.match(t)
        if m:
            r = self._reg(m.group(1))
            self.read = "m.load(%s, %d)" % (r, self.bits)
            self.write = "m.store(%s, %%s, %d)" % (r, self.bits)
            return
        m = POST.match(t)
        if m:
            r = "a7" if m.group(1) == "sp" else m.group(1)
            step = self._step(r)
            self.read = "m.loadPost('%s', %d, %d)" % (r, step, self.bits)
            self.write = "m.storePost('%s', %d, %%s, %d)" % (r, step, self.bits)
            return
        m = PRE.match(t)
        if m:
            r = "a7" if m.group(1) == "sp" else m.group(1)
            step = self._step(r)
            self.read = "m.loadPre('%s', %d, %d)" % (r, step, self.bits)
            self.write = "m.storePre('%s', %d, %%s, %d)" % (r, step, self.bits)
            return
        m = IDX.match(t)
        if m:
            d = num(m.group(1))
            r = self._reg(m.group(2))
            ix = "m.sx(m.%s, %d)" % (m.group(3), 16 if m.group(4) == "w" else 32)
            self.read = "m.load(%s + %d + %s, %d)" % (r, d, ix, self.bits)
            self.write = "m.store(%s + %d + %s, %%s, %d)" % (r, d, ix, self.bits)
            return
        m = NOIDX.match(t)
        if m:
            r = self._reg(m.group(1))
            ix = "m.sx(m.%s, %d)" % (m.group(2), 16 if m.group(3) == "w" else 32)
            self.read = "m.load(%s + %s, %d)" % (r, ix, self.bits)
            self.write = "m.store(%s + %s, %%s, %d)" % (r, ix, self.bits)
            return
        m = DISP.match(t)
        if m:
            d = num(m.group(1))
            r = self._reg(m.group(2))
            self.read = "m.load(%s + %d, %d)" % (r, d, self.bits)
            self.write = "m.store(%s + %d, %%s, %d)" % (r, d, self.bits)
            return

    def rmw(self):
        """Read and write one operand, applying its side effect exactly once.

        An operand that is both source and destination - `neg.b -(a0)`,
        `eor.b d0, (a0)+`, `bset d1, (a2)+` - has a single effective address.
        Emitting the read expression and the write expression separately makes
        the pre-decrement or post-increment happen twice, which walks the
        pointer off by a whole operand and corrupts every structure it steps
        through. Returns (setup, read, write) with the address bound first.
        """
        t = self.tok
        if REG.match(t) or t in ("sp", "a7") or IMM.match(t):
            return "", self.read, self.write
        m = POST.match(t)
        if m:
            r = "a7" if m.group(1) == "sp" else m.group(1)
            setup = "const _ea = m.%s >>> 0; m.%s = (m.%s + %d) >>> 0;" % (
                r, r, r, self._step(r))
        else:
            m = PRE.match(t)
            if m:
                r = "a7" if m.group(1) == "sp" else m.group(1)
                setup = "m.%s = (m.%s - %d) >>> 0; const _ea = m.%s;" % (
                    r, r, self._step(r), r)
            else:
                ea = self.ea()
                if ea is None:
                    return None
                setup = "const _ea = (%s) >>> 0;" % ea
        return (setup, "m.load(_ea, %d)" % self.bits,
                "m.store(_ea, %%s, %d)" % self.bits)

    def ea(self):
        """Effective address expression, for lea and pea."""
        t = self.tok
        m = ABS.match(t)
        if m:
            return "0x%x" % abs_addr(m)
        m = IND.match(t)
        if m:
            return self._reg(m.group(1))
        m = IDX.match(t)
        if m:
            return "(%s + %d + m.sx(m.%s, %d))" % (
                self._reg(m.group(2)), num(m.group(1)), m.group(3),
                16 if m.group(4) == "w" else 32)
        m = NOIDX.match(t)
        if m:
            return "(%s + m.sx(m.%s, %d))" % (
                self._reg(m.group(1)), m.group(2),
                16 if m.group(3) == "w" else 32)
        m = DISP.match(t)
        if m:
            return "(%s + %d)" % (self._reg(m.group(2)), num(m.group(1)))
        return None


BRANCH_CC = {
    "bra": "t", "beq": "eq", "bne": "ne", "bcs": "cs", "bcc": "cc",
    "bmi": "mi", "bpl": "pl", "bvs": "vs", "bvc": "vc", "blt": "lt",
    "bge": "ge", "ble": "le", "bgt": "gt", "bls": "ls", "bhi": "hi",
}
DB_CC = {
    "dbra": "f", "dbf": "f", "dbeq": "eq", "dbne": "ne", "dbcs": "cs",
    "dbcc": "cc", "dbmi": "mi", "dbpl": "pl", "dblt": "lt", "dbge": "ge",
    "dble": "le", "dbgt": "gt", "dbls": "ls", "dbhi": "hi", "dbt": "t",
}
SET_CC = {
    "seq": "eq", "sne": "ne", "scs": "cs", "scc": "cc", "smi": "mi",
    "spl": "pl", "svs": "vs", "svc": "vc", "slt": "lt", "sge": "ge",
    "sle": "le", "sgt": "gt", "sls": "ls", "shi": "hi", "st": "t", "sf": "f",
}
BITWISE = (("and", "&"), ("andi", "&"), ("or", "|"), ("ori", "|"),
           ("eor", "^"), ("eori", "^"))
ADDR_SIZED = ("lea", "pea", "movea", "adda", "suba", "cmpa", "jsr", "bsr",
              "link", "unlk")


def is_addr_reg(tok):
    """Is this operand an address register? Their arithmetic ignores size and
    leaves the condition codes alone, unlike a data register."""
    t = tok.strip()
    return bool(re.fullmatch(r"a\d", t)) or t in ("sp", "a7")


def target_addr(tok):
    """A branch or jump target, but only when the whole operand is one.

    This has to match the entire token. An unanchored match also accepts the
    leading `$d00e` of `$d00e(pc, d0.w)` and reports it as a fixed target,
    which silently drops the index: every table-driven dispatch in the program
    then jumps to the base of its own jump table instead of to the case the
    table selected.
    """
    m = ABS.match(tok.strip())
    return abs_addr(m) if m else None


# ---------------------------------------------------------------------------
# Cycle costs.
#
# The board interrupts on wall clock - 60 Hz against a 7.16 MHz clock - and the
# port was interrupting on an instruction count, so where an interrupt landed
# drifted from where the chip put it. Counting cycles instead needs only to be
# close: what matters is that a frame's worth of work costs about what it costs
# on the chip, not that any one instruction is exact.
#
# Base costs are the common cases from the 68000 timings, plus the cost of
# working out each memory operand's address.

_EA_COST = {
    "reg": 0, "imm": 0,
    "ind": 4,          # (an)
    "post": 4,         # (an)+
    "pre": 6,          # -(an)
    "disp": 8,         # d(an)
    "idx": 10,         # d(an,ix)
    "abs": 12,         # $xxxxxxxx.l - the short form is 8, close enough
}

_BASE = {
    "nop": 4, "moveq": 4, "move": 4, "movea": 4, "lea": 4, "pea": 12,
    "add": 4, "adda": 8, "addi": 8, "addq": 4, "sub": 4, "suba": 8,
    "subi": 8, "subq": 4, "cmp": 4, "cmpa": 6, "cmpi": 8, "cmpm": 12,
    "and": 4, "andi": 8, "or": 4, "ori": 8, "eor": 4, "eori": 8,
    "not": 4, "neg": 4, "negx": 4, "clr": 4, "tst": 4, "ext": 4,
    "swap": 4, "exg": 6, "link": 16, "unlk": 12,
    "asl": 6, "asr": 6, "lsl": 6, "lsr": 6, "rol": 6, "ror": 6,
    "roxl": 6, "roxr": 6,
    "btst": 4, "bset": 8, "bclr": 10, "bchg": 8,
    "mulu": 70, "muls": 70, "divu": 140, "divs": 158,
    "jmp": 8, "jsr": 16, "bsr": 18, "rts": 16, "rte": 20, "rtr": 20,
    "trap": 34, "stop": 4, "reset": 132, "movem": 12, "movep": 16,
    "abcd": 6, "sbcd": 6, "nbcd": 6, "addx": 4, "subx": 4, "tas": 14,
}


def _ea_kind(tok):
    tok = tok.strip()
    if REG.match(tok) or tok in ("sp", "a7"):
        return "reg"
    if IMM.match(tok):
        return "imm"
    if POST.match(tok):
        return "post"
    if PRE.match(tok):
        return "pre"
    if IND.match(tok):
        return "ind"
    if IDX.match(tok) or NOIDX.match(tok):
        return "idx"
    if DISP.match(tok):
        return "disp"
    if ABS.match(tok):
        return "abs"
    return "reg"


def cycles(ins):
    """Roughly what this instruction costs the chip."""
    b = ins.mnemonic.split(".")[0]
    size = ins.mnemonic.rsplit(".", 1)[1] if "." in ins.mnemonic else "w"
    n = _BASE.get(b, 8)
    if b in BRANCH_CC or b in DB_CC:
        # a taken branch costs more than one that falls through; assume taken,
        # which is what a loop does
        return 10
    for tok in split_ops(ins.op_str or ""):
        n += _EA_COST.get(_ea_kind(tok), 0)
    if size == "l" and b not in ("mulu", "muls", "divu", "divs", "jsr", "bsr",
                                 "rts", "rte", "trap", "reset"):
        n += 2
    if b == "movem":
        # four cycles a register for words, eight for longs
        regs = (ins.op_str or "").count("/") + (ins.op_str or "").count("-") + 1
        n += regs * (8 if size == "l" else 4)
    return n


def emit(ins, nxt):
    """TypeScript for one instruction; None if the form has no rule."""
    mn = ins.mnemonic
    b = mn.split(".")[0]
    size = mn.rsplit(".", 1)[1] if "." in mn else None
    if size not in ("b", "w", "l"):
        size = "l" if b in ADDR_SIZED else "w"
    ops = split_ops(ins.op_str or "")
    O = [Operand(o, size) for o in ops]
    bits = SZBITS[size]
    s = "pc = 0x%05x;" % nxt

    if b == "rts":
        # Pop the return address the matching jsr pushed. Control returns
        # through the JavaScript call rather than through this value, but the
        # stack pointer has to come back or every caller's frame is off by
        # four for the rest of the routine.
        return "m.a7 = (m.a7 + 4) >>> 0; return;"
    if b == "nop":
        return s
    if b == "move" and len(ops) == 2 and ops[1].strip() == "sr":
        return "m.setSR(%s); %s" % (O[0].read, s)
    if b == "move" and len(ops) == 2 and ops[0].strip() == "sr":
        W = Operand(ops[1], "w")
        return "%s; %s" % (W.write % "m.getSR()", s) if W.write else None
    if b == "move" and len(ops) == 2 and ops[1].strip() == "ccr":
        return "m.setSR((m.getSR() & 0xff00) | (%s & 0xff)); %s" % (O[0].read, s)
    if b in ("move", "movea") and len(O) == 2 and O[0].read and O[1].write:
        # Bind the source to a temporary. Emitting its read expression twice -
        # once to store, once for the flags - applies a postincrement or
        # predecrement twice, which silently corrupts every pointer walk.
        if b == "movea":
            # the destination is an address register, so the write is always
            # 32-bit no matter the mnemonic's size - movea.w #$40,a1 sets the
            # whole register, it does not merge into its low half
            L = Operand(ops[1], "l")
            return "{ const _s = %s; %s; } %s" % (
                O[0].read, L.write % ("m.sx(_s, %d)" % bits), s)
        return "{ const _s = %s; %s; m.logicFlags(_s, %d); } %s" % (
            O[0].read, O[1].write % "_s", bits, s)
    if b == "moveq" and len(ops) == 2:
        # moveq is always 32-bit and sign-extends its 8-bit immediate, so
        # #$ff means -1 and not 255. Taking the size from the mnemonic makes it
        # a word and drops the extension - and moveq is the second most common
        # instruction in this ROM.
        v = num(ops[0].lstrip("#")) & 0xFF
        if v & 0x80:
            v -= 0x100
        L = Operand(ops[1], "l")
        if not L.write:
            return None
        return "%s; m.logicFlags(%d, 32); %s" % (L.write % ("(%d >>> 0)" % (v & 0xFFFFFFFF)), v, s)
    if b == "lea" and len(O) == 2 and O[1].write:
        ea = O[0].ea()
        return "%s; %s" % (O[1].write % ea, s) if ea else None
    if b == "pea" and len(O) == 1:
        ea = O[0].ea()
        return "m.storePre('a7', 4, %s, 32); %s" % (ea, s) if ea else None
    if b == "clr" and len(O) == 1 and O[0].write:
        return "%s; m.logicFlags(0, %d); %s" % (O[0].write % "0", bits, s)
    if b == "tst" and len(O) == 1 and O[0].read:
        return "m.logicFlags(%s, %d); %s" % (O[0].read, bits, s)
    if b in ("add", "addi", "addq") and len(O) == 2 and O[0].read and O[1].write:
        if is_addr_reg(ops[1]):
            # an address-register destination is always 32-bit and sets no
            # flags at all - and `addq.l #8,a7` for stack cleanup is everywhere,
            # so getting this wrong corrupts the next conditional branch
            L = Operand(ops[1], "l")
            return "{ const _a = m.sx(%s, %d); %s; } %s" % (
                O[0].read, bits, L.write % ("(m.rd(%s, 32) + _a)" % L._reg(ops[1].strip())), s)
        rw = O[1].rmw()
        if rw is None:
            return None
        setup, rd, wr = rw
        return "{ const _a = %s; %s const _b = %s; %s; } %s" % (
            O[0].read, setup, rd, wr % ("m.addFlags(_b, _a, %d)" % bits), s)
    if b == "adda" and len(O) == 2 and O[0].read and O[1].write:
        L = Operand(ops[1], "l")
        return "{ const _a = m.sx(%s, %d); %s; } %s" % (
            O[0].read, bits, L.write % ("(%s + _a)" % L.read), s)
    if b in ("sub", "subi", "subq") and len(O) == 2 and O[0].read and O[1].write:
        if is_addr_reg(ops[1]):
            L = Operand(ops[1], "l")
            return "{ const _a = m.sx(%s, %d); %s; } %s" % (
                O[0].read, bits, L.write % ("(m.rd(%s, 32) - _a)" % L._reg(ops[1].strip())), s)
        rw = O[1].rmw()
        if rw is None:
            return None
        setup, rd, wr = rw
        return "{ const _a = %s; %s const _b = %s; %s; } %s" % (
            O[0].read, setup, rd, wr % ("m.subFlags(_b, _a, %d)" % bits), s)
    if b == "suba" and len(O) == 2 and O[0].read and O[1].write:
        L = Operand(ops[1], "l")
        return "{ const _a = m.sx(%s, %d); %s; } %s" % (
            O[0].read, bits, L.write % ("(%s - _a)" % L.read), s)
    if b in ("cmp", "cmpi", "cmpa") and len(O) == 2 and O[0].read and O[1].read:
        if b == "cmpa":
            # a word source is sign-extended to 32 bits before the comparison
            return ("{ const _a = m.sx(%s, %d); const _b = %s; "
                    "m.subFlags(_b, _a, 32, false); } %s") % (
                O[0].read, bits, Operand(ops[1], "l").read, s)
        return "{ const _a = %s; const _b = %s; m.subFlags(_b, _a, %d, false); } %s" % (
            O[0].read, O[1].read, bits, s)
    for name, op in BITWISE:
        if b == name and len(O) == 2 and O[0].read and O[1].write:
            rw = O[1].rmw()
            if rw is None:
                return None
            setup, rd, wr = rw
            return ("{ const _a = %s; %s const _b = %s; const _r = (_b %s _a); "
                    "%s; m.logicFlags(_r, %d); } %s") % (
                O[0].read, setup, rd, op, wr % "_r", bits, s)
    if b == "not" and len(O) == 1 and O[0].write:
        rw = O[0].rmw()
        if rw is None:
            return None
        setup, rd, wr = rw
        return "{ %s const _r = (~%s); %s; m.logicFlags(_r, %d); } %s" % (
            setup, rd, wr % "_r", bits, s)
    if b == "neg" and len(O) == 1 and O[0].write:
        rw = O[0].rmw()
        if rw is None:
            return None
        setup, rd, wr = rw
        return "{ %s const _v = %s; %s; } %s" % (
            setup, rd, wr % ("m.subFlags(0, _v, %d)" % bits), s)
    if b == "ext" and len(O) == 1 and O[0].write:
        src = 8 if size == "w" else 16
        return "{ const _r = m.sx(%s, %d); %s; m.logicFlags(_r, %d); } %s" % (
            O[0].read, src, O[0].write % "_r", bits, s)
    if b == "swap" and len(ops) == 1:
        # swap is always a full 32-bit operation; taking the size from the
        # mnemonic would default it to a word and lose the upper half
        L = Operand(ops[0], "l")
        if not L.write:
            return None
        e = "((((%s) >>> 16) | ((%s) << 16)) >>> 0)" % (L.read, L.read)
        return "{ const _r = %s; %s; m.logicFlags(_r, 32); } %s" % (e, L.write % "_r", s)
    # A shift count comes from a register modulo 64, so it can exceed the
    # operand width. JavaScript's shift operators take the count modulo 32,
    # which turns "shift everything out" into "shift by a few" - the result has
    # to be forced to zero (or to the sign, for an arithmetic right shift).
    if b in ("asl", "lsl", "lsr", "asr") and O and O[-1].write:
        cnt = O[0].read if len(O) == 2 else "1"
        rw = O[-1].rmw()
        if rw is None:
            return None
        setup, rd, wr = rw
        if b in ("asl", "lsl"):
            val, expr, left = rd, "(_c >= %d ? 0 : (_v << _c))" % bits, "true"
            arith = "true" if b == "asl" else "false"
        elif b == "lsr":
            mask = (1 << bits) - 1 if bits < 32 else 0xFFFFFFFF
            val = "(%s) & %d" % (rd, mask)
            expr, left, arith = "(_c >= %d ? 0 : (_v >>> _c))" % bits, "false", "false"
        else:
            val = "m.sx(%s, %d)" % (rd, bits)
            expr = "(_c >= %d ? (_v >> %d) : (_v >> _c))" % (bits, bits - 1)
            left, arith = "false", "true"
        return ("{ const _c = (%s) & 63; %s const _v = %s; const _r = %s; %s; "
                "m.shiftFlags(_r, _v, _c, %d, %s, %s); } %s") % (
            cnt, setup, val, expr, wr % "_r", bits, left, arith, s)
    # A bit instruction takes its width from the destination, not the
    # mnemonic: a data register is a 32-bit operand and the bit number is taken
    # modulo 32, while any memory destination is a single byte and the number
    # is taken modulo 8. capstone prints both as ".b", so trusting the mnemonic
    # silently addresses the wrong bit on every register form.
    if b in ("btst", "bset", "bclr", "bchg") and len(O) == 2:
        dreg = REG.match(ops[1].strip()) and ops[1].strip()[0] == "d"
        D = Operand(ops[1], "l" if dreg else "b")
        mask = 31 if dreg else 7
        if b == "btst":
            if not D.read:
                return None
            return ("{ const _n = (%s) & %d; const _v = %s; "
                    "m.z = ((_v >>> _n) & 1) === 0; } %s") % (
                O[0].read, mask, D.read, s)
        if not D.write:
            return None
        rw = D.rmw()
        if rw is None:
            return None
        setup, rd, wr = rw
        tmpl = {"bset": "(_v | _bit)", "bclr": "(_v & ~_bit)", "bchg": "(_v ^ _bit)"}[b]
        return ("{ const _n = (%s) & %d; %s const _v = %s; const _bit = (1 << _n) >>> 0; "
                "m.z = ((_v >>> _n) & 1) === 0; %s; } %s") % (
            O[0].read, mask, setup, rd, wr % tmpl, s)
    if b == "movep" and len(ops) == 2:
        # movep moves a register through every other byte of memory, for
        # peripherals wired to one half of the data bus. It is the only
        # instruction whose bytes are not contiguous, so nothing else in the
        # translator produces the right addresses for it.
        n = bits // 8
        src, dst = ops[0].strip(), ops[1].strip()
        if REG.match(src) and src[0] == "d":
            A = Operand(dst, "b")
            ea = A.ea()
            if ea is None:
                return None
            parts = " ".join(
                "m.setByte(_ea + %d, _v >>> %d);" % (i * 2, (n - 1 - i) * 8)
                for i in range(n))
            return "{ const _ea = (%s) >>> 0; const _v = m.%s >>> 0; %s } %s" % (
                ea, src, parts, s)
        A = Operand(src, "b")
        ea = A.ea()
        if ea is None or not REG.match(dst) or dst[0] != "d":
            return None
        parts = " + ".join("(m.byte(_ea + %d) << %d)" % (i * 2, (n - 1 - i) * 8)
                           for i in range(n))
        keep = "" if n == 4 else "(m.%s & 0xffff0000) | " % dst
        return "{ const _ea = (%s) >>> 0; m.%s = (%s(%s)) >>> 0; } %s" % (
            ea, dst, keep, parts, s)
    if b in BRANCH_CC and len(ops) == 1:
        t = target_addr(ops[0])
        if t is None:
            return None
        if b == "bra":
            return "pc = 0x%05x; break;" % t
        return "if (m.cond('%s')) { pc = 0x%05x; } else { %s }" % (
            BRANCH_CC[b], t, s)
    if b in DB_CC and len(ops) == 2 and O[0].write:
        t = target_addr(ops[1])
        if t is None:
            return None
        cc = DB_CC[b]
        pre = "" if cc == "f" else "if (m.cond('%s')) { %s break; } " % (cc, s)
        return pre + ("{ const _c = (m.sx(%s, 16) - 1) & 0xffff; %s; "
                      "pc = (m.sx(_c, 16) !== -1) ? 0x%05x : 0x%05x; }") % (
            O[0].read, O[0].write % "_c", t, nxt)
    if b in SET_CC and len(O) == 1 and O[0].write:
        e = "(m.cond('%s') ? 0xff : 0)" % SET_CC[b]
        return "%s; %s" % (O[0].write % e, s)
    if b in ("jsr", "bsr") and len(ops) == 1:
        # Push the return address before calling, as the chip does. Without it
        # the callee's stack is four bytes shallower than it expects, so every
        # routine that reads an argument at 4(a7) or 8(a7) reads the wrong
        # slot - which is why leaf routines matched far more often than the
        # routines that call them.
        push = "m.storePre('a7', 4, 0x%05x, 32); " % nxt
        t = target_addr(ops[0])
        if t is not None:
            return "%scall(0x%05x, m); %s" % (push, t, s)
        # jsr (an): the target is whatever the register holds
        mi = re.match(r"^\((a\d|sp)\)$", ops[0].strip())
        if mi:
            return "{ const _t = %s; %scall(_t, m); } %s" % (
                Operand._reg(mi.group(1)), push, s)
        ea = O[0].ea()
        return "{ const _t = (%s) >>> 0; %scall(_t, m); } %s" % (ea, push, s) if ea else None
    if b == "jmp" and len(ops) == 1:
        t = target_addr(ops[0])
        if t is not None:
            return "pc = 0x%05x; break;" % t
        # jmp (an) is a tail call into another routine
        mi = re.match(r"^\((a\d|sp)\)$", ops[0].strip())
        if mi:
            return "call(%s, m); return;" % Operand._reg(mi.group(1))
        # a computed jmp is almost always a jump table into this same routine -
        # the switch has a case for every address, so just move the pc
        ea = O[0].ea()
        return "pc = (%s) >>> 0; break;" % ea if ea else None
    if b in ("mulu", "muls") and len(O) == 2 and O[0].read and O[1].write:
        if b == "muls":
            e = "((m.sx(%s, 16) * m.sx(%s, 16)) >>> 0)" % (O[1].read, O[0].read)
        else:
            e = "((((%s) & 0xffff) * ((%s) & 0xffff)) >>> 0)" % (O[1].read, O[0].read)
        w = Operand(ops[1], "l").write
        return "{ const _r = %s; %s; m.logicFlags(_r, 32); } %s" % (e, w % "_r", s)
    if b in ("divu", "divs") and len(O) == 2 and O[0].read and O[1].write:
        # 32 / 16: quotient in the low word, remainder in the high word. On
        # overflow the 68000 leaves the destination untouched and sets V.
        signed = b == "divs"
        src = "m.sx(%s, 16)" % O[0].read if signed else "((%s) & 0xffff)" % O[0].read
        dst = Operand(ops[1], "l").read
        w = Operand(ops[1], "l").write
        num_ = "m.sx(%s, 32)" % dst if signed else "(%s >>> 0)" % dst
        # The quotient has to fit in 16 bits, and what "fit" means differs:
        # divu overflows above 65535, divs outside -32768..32767. Using the
        # signed bound for divu rejects every quotient over 32767 and leaves
        # the destination untouched, which is the opposite of the right answer.
        over = "_q > 32767 || _q < -32768" if signed else "_q > 0xffff"
        trunc = "Math.trunc(_n / _d)" if signed else "Math.floor(_n / _d)"
        # Dividing by zero is an exception, not an error: the chip stacks the
        # return address and the status register and vectors through 0x14. The
        # sound code divides by a value off the stack, so any argument shape
        # that can put a zero there took a path the port never followed.
        return ("{ const _d = %s; const _n = %s; if (_d === 0) { "
                "m.storePre('a7', 4, 0x%05x, 32); "
                "m.storePre('a7', 2, m.getSR(), 16); "
                "pc = m.load(0x14, 32); break; } const _q = %s; "
                "const _r = _n %% _d; if (%s) { m.v = true; m.n = true; "
                "m.z = false; m.c = false; } "
                "else { m.v = false; %s; m.logicFlags(_q, 16); } } %s") % (
            src, num_, nxt, trunc, over,
            w % "(((_r & 0xffff) << 16) | (_q & 0xffff)) >>> 0", s)
    if b == "exg" and len(ops) == 2:
        r0, r1 = ops[0].strip(), ops[1].strip()
        return "{ const _t = m.%s; m.%s = m.%s; m.%s = _t; } %s" % (r0, r0, r1, r1, s)
    if b == "addx" and len(O) == 2 and O[0].read and O[1].write:
        e = "m.addFlags(%s, (%s) + (m.x ? 1 : 0), %d)" % (O[1].read, O[0].read, bits)
        return "%s; %s" % (O[1].write % e, s)
    if b == "subx" and len(O) == 2 and O[0].read and O[1].write:
        e = "m.subFlags(%s, (%s) + (m.x ? 1 : 0), %d)" % (O[1].read, O[0].read, bits)
        return "%s; %s" % (O[1].write % e, s)
    if b == "stop":
        # A halted 68000 has already prefetched the next instruction, and that
        # is the address its program counter reports. Halting on the stop's own
        # address instead means the harness never sees the point the chip
        # stopped at, and the four routines that open with `stop` could not be
        # compared at all.
        # `stop` also loads its operand into the status register - that is
        # what raises the mask that decides which interrupt is allowed to
        # wake it. Emitting the halt without the load left the mask at
        # whatever the caller had, so the chip and the port disagreed about
        # which interrupts get through while halted.
        imm = 0
        mm = re.search(r"#\$?([0-9a-fA-F]+)", ins.op_str or "")
        if mm:
            imm = int(mm.group(1), 16 if "$" in (ins.op_str or "") else 10)
        return ("m.setSR(0x%x); m.halt(0x%05x); pc = 0x%05x; break;"
                % (imm, nxt, nxt))
    if b in ("rte", "rtr"):
        # Not a bare return. `rte` pops the status register and the program
        # counter the exception stacked, and the status register is what
        # carries the interrupt mask - leaving it raised means the first
        # interrupt taken is also the last one, because every later one is
        # blocked by a mask the handler never gave back. `rtr` pops the
        # condition codes only, and leaves the mask alone.
        if b == "rte":
            return ("{ const _sr = m.loadPost('a7', 2, 16); "
                    "m.a7 = (m.a7 + 4) >>> 0; m.setSR(_sr); } return;")
        return ("{ const _cc = m.loadPost('a7', 2, 16); "
                "m.a7 = (m.a7 + 4) >>> 0; m.setSR((m.getSR() & 0xff00) | (_cc & 0xff)); }"
                " return;")
    if b == "reset":
        return s
    if b == "trap":
        # A trap is not a no-op. The 68000 stacks the return address and the
        # status register and vectors through the table, and the game uses that
        # - TRAP #0 vectors to 0x18658, which is the instruction after the jsr
        # that reached it, so the handler is the continuation. Recording the
        # trap and carrying straight on took a completely different path.
        n = num(ops[0].lstrip("#")) if ops else 0
        return ("{ m.trap(%d); m.storePre('a7', 4, 0x%05x, 32); "
                "m.storePre('a7', 2, m.getSR(), 16); "
                "pc = m.load(0x%x, 32); } break;") % (n, nxt, (32 + n) * 4)
    if b in ("roxl", "roxr") and O and O[-1].write:
        cnt = O[0].read if len(O) == 2 else "1"
        rw = O[-1].rmw()
        if rw is None:
            return None
        setup, rd, wr = rw
        return ("{ const _c = (%s) & 63; %s const _v = %s; "
                "const _r = m.roxFlags(_v, _c, %d, %s); %s; } %s") % (
            cnt, setup, rd, bits, "true" if b == "roxl" else "false",
            wr % "_r", s)
    if b in ("rol", "ror") and O and O[-1].write:
        cnt = O[0].read if len(O) == 2 else "1"
        v = "((%s) & %d)" % (O[-1].read, (1 << bits) - 1 if bits < 32 else 0xFFFFFFFF)
        if b == "rol":
            e = "(((%s << ((%s) %% %d)) | (%s >>> (%d - ((%s) %% %d)))) >>> 0)" % (
                v, cnt, bits, v, bits, cnt, bits)
        else:
            e = "(((%s >>> ((%s) %% %d)) | (%s << (%d - ((%s) %% %d)))) >>> 0)" % (
                v, cnt, bits, v, bits, cnt, bits)
        # The result expression was emitted twice - once to store and once for
        # the flags - so the flags were computed from the already-rotated
        # register. C comes from the bit that wrapped around, and a zero count
        # clears it; X is not touched by a rotate at all.
        cbit = "(_r & 1) === 1" if b == "rol" else "((_r >>> %d) & 1) === 1" % (bits - 1)
        return ("{ const _am = ((%s) & 63) %% %d; const _r = %s; %s; "
                "m.logicFlags(_r, %d); if (_am !== 0) m.c = %s; } %s") % (
            cnt, bits, e, O[-1].write % "_r", bits, cbit, s)
    if b in ("ori", "andi", "eori") and len(ops) == 2 and ops[1].strip() in ("sr", "ccr"):
        op = {"ori": "|", "andi": "&", "eori": "^"}[b]
        return "m.setSR((m.getSR() %s (%s)) >>> 0); %s" % (op, O[0].read, s)
    if b == "dc":
        # data that the linear decoder read as an instruction; the emitted
        # routine should never reach it
        return "throw new Error('reached data at 0x%05x');" % ins.address
    if b in ("move", "movea") and len(ops) == 2 and ops[1].strip() in ("sr", "ccr"):
        # writes to the status register set the interrupt mask; the ported code
        # has no interrupts, so record it and carry on
        return "m.sr = %s; %s" % (O[0].read if O[0].read else "0", s)
    if b == "move" and len(ops) == 2 and ops[0].strip() in ("sr", "ccr") and O[1].write:
        return "%s; %s" % (O[1].write % "m.sr", s)
    if b == "movep":
        # peripheral transfer: alternating bytes. Only used by the sound driver.
        return "m.movep(%s); %s" % ("0", s)
    if b == "link" and len(ops) == 2:
        # the displacement is a SIGNED 16-bit value: #$fffc means -4, and
        # reading it unsigned grows the stack by 65532 instead of shrinking
        # it by 4, which corrupts every frame the routine builds
        d = num(ops[1].lstrip("#")) & 0xFFFF
        if d & 0x8000:
            d -= 0x10000
        r = ops[0].strip()
        return ("m.storePre('a7', 4, m.%s, 32); m.%s = m.a7; "
                "m.a7 = (m.a7 + (%d)) >>> 0; %s") % (r, r, d, s)
    if b == "unlk" and len(ops) == 1:
        r = ops[0].strip()
        return "m.a7 = m.%s; m.%s = m.loadPost('a7', 4, 32); %s" % (r, r, s)
    if b == "movem":
        idx = None
        for i, o in enumerate(ops):
            if re.fullmatch(r"[da]\d(-[da]\d)?(/[da]\d(-[da]\d)?)*", o.strip()):
                idx = i
        if idx is None:
            return None
        names = []
        for part in ops[idx].strip().split("/"):
            if "-" in part:
                lo, hi = part.split("-")
                for k in range(int(lo[1]), int(hi[1]) + 1):
                    names.append("%s%d" % (lo[0], k))
            else:
                names.append(part)
        other = ops[1 - idx].strip()
        step = bits // 8
        m = re.match(r"^-\((a\d|sp)\)$", other)
        if idx == 0 and m:
            r = "a7" if m.group(1) == "sp" else m.group(1)
            body = " ".join("m.storePre('%s', %d, m.%s, %d);" % (r, step, n, bits)
                            for n in reversed(names))
            return "%s %s" % (body, s)
        m = re.match(r"^\((a\d|sp)\)\+$", other)
        if idx == 1 and m:
            r = "a7" if m.group(1) == "sp" else m.group(1)
            body = " ".join("m.%s = m.loadPost('%s', %d, %d);" % (n, r, step, bits)
                            for n in names)
            return "%s %s" % (body, s)
        ea = Operand(other, size).ea()
        if ea is None:
            return None
        if idx == 0:
            body = " ".join("m.store(%s + %d, m.%s, %d);" % (ea, k * step, n, bits)
                            for k, n in enumerate(names))
        else:
            body = " ".join("m.%s = m.load(%s + %d, %d);" % (n, ea, k * step, bits)
                            for k, n in enumerate(names))
        return "%s %s" % (body, s)
    return None
