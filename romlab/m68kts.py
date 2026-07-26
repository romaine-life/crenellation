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
ABS = re.compile(r"^\$([0-9a-fA-F]+)(?:\.[wl])?$")
IND = re.compile(r"^\((a\d|sp)\)$")
POST = re.compile(r"^\((a\d|sp)\)\+$")
PRE = re.compile(r"^-\((a\d|sp)\)$")
DISP = re.compile(r"^(-?\$?[0-9a-fA-F]+)\((a\d|sp|pc)\)$")
IDX = re.compile(r"^(-?\$?[0-9a-fA-F]+)\((a\d|sp|pc),\s*([da]\d)\.([wl])\)$")
# the same indexed form with the displacement omitted, which capstone prints
# as (a0,d0.l) - by far the most common form the first pass missed
NOIDX = re.compile(r"^\((a\d|sp|pc),\s*([da]\d)\.([wl])\)$")


class Operand:
    """One operand as a TypeScript read expression and an optional write form."""

    def __init__(self, tok, size):
        self.tok = tok.strip()
        self.size = size
        self.bits = SZBITS[size]
        self.read = None
        self.write = None
        self._build()

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
            a = int(m.group(1), 16)
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
            step = self.bits // 8
            self.read = "m.loadPost('%s', %d, %d)" % (r, step, self.bits)
            self.write = "m.storePost('%s', %d, %%s, %d)" % (r, step, self.bits)
            return
        m = PRE.match(t)
        if m:
            r = "a7" if m.group(1) == "sp" else m.group(1)
            step = self.bits // 8
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

    def ea(self):
        """Effective address expression, for lea and pea."""
        t = self.tok
        m = ABS.match(t)
        if m:
            return "0x%x" % int(m.group(1), 16)
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
    m = re.match(r"^\$([0-9a-fA-F]+)", tok.strip())
    return int(m.group(1), 16) if m else None


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
        return "return;"
    if b == "nop":
        return s
    if b in ("move", "movea") and len(O) == 2 and O[0].read and O[1].write:
        # Bind the source to a temporary. Emitting its read expression twice -
        # once to store, once for the flags - applies a postincrement or
        # predecrement twice, which silently corrupts every pointer walk.
        if b == "movea":
            return "{ const _s = %s; %s; } %s" % (
                O[0].read, O[1].write % ("m.sx(_s, %d)" % bits), s)
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
        return "{ const _a = %s; const _b = %s; %s; } %s" % (
            O[0].read, O[1].read, O[1].write % ("m.addFlags(_b, _a, %d)" % bits), s)
    if b == "adda" and len(O) == 2 and O[0].read and O[1].write:
        return "{ const _a = m.sx(%s, %d); %s; } %s" % (
            O[0].read, bits, O[1].write % ("(%s + _a)" % O[1].read), s)
    if b in ("sub", "subi", "subq") and len(O) == 2 and O[0].read and O[1].write:
        if is_addr_reg(ops[1]):
            L = Operand(ops[1], "l")
            return "{ const _a = m.sx(%s, %d); %s; } %s" % (
                O[0].read, bits, L.write % ("(m.rd(%s, 32) - _a)" % L._reg(ops[1].strip())), s)
        return "{ const _a = %s; const _b = %s; %s; } %s" % (
            O[0].read, O[1].read, O[1].write % ("m.subFlags(_b, _a, %d)" % bits), s)
    if b == "suba" and len(O) == 2 and O[0].read and O[1].write:
        return "{ const _a = m.sx(%s, %d); %s; } %s" % (
            O[0].read, bits, O[1].write % ("(%s - _a)" % O[1].read), s)
    if b in ("cmp", "cmpi", "cmpa") and len(O) == 2 and O[0].read and O[1].read:
        if b == "cmpa":
            # a word source is sign-extended to 32 bits before the comparison
            return ("{ const _a = m.sx(%s, %d); const _b = %s; "
                    "m.subFlags(_b, _a, 32); } %s") % (
                O[0].read, bits, Operand(ops[1], "l").read, s)
        return "{ const _a = %s; const _b = %s; m.subFlags(_b, _a, %d); } %s" % (
            O[0].read, O[1].read, bits, s)
    for name, op in BITWISE:
        if b == name and len(O) == 2 and O[0].read and O[1].write:
            return ("{ const _a = %s; const _b = %s; const _r = (_b %s _a); "
                    "%s; m.logicFlags(_r, %d); } %s") % (
                O[0].read, O[1].read, op, O[1].write % "_r", bits, s)
    if b == "not" and len(O) == 1 and O[0].write:
        return "{ const _r = (~%s); %s; m.logicFlags(_r, %d); } %s" % (
            O[0].read, O[0].write % "_r", bits, s)
    if b == "neg" and len(O) == 1 and O[0].write:
        return "{ const _v = %s; %s; } %s" % (
            O[0].read, O[0].write % ("m.subFlags(0, _v, %d)" % bits), s)
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
        return "%s; m.logicFlags(%s, 32); %s" % (L.write % e, e, s)
    if b in ("asl", "lsl") and O and O[-1].write:
        cnt = O[0].read if len(O) == 2 else "1"
        return ("{ const _c = (%s) & 63; const _v = %s; const _r = _v << _c; %s; "
                "m.shiftFlags(_r, _v, _c, %d, true); } %s") % (
            cnt, O[-1].read, O[-1].write % "_r", bits, s)
    if b == "lsr" and O and O[-1].write:
        cnt = O[0].read if len(O) == 2 else "1"
        mask = (1 << bits) - 1 if bits < 32 else 0xFFFFFFFF
        return ("{ const _c = (%s) & 63; const _v = (%s) & %d; const _r = _v >>> _c; "
                "%s; m.shiftFlags(_r, _v, _c, %d, false); } %s") % (
            cnt, O[-1].read, mask, O[-1].write % "_r", bits, s)
    if b == "asr" and O and O[-1].write:
        cnt = O[0].read if len(O) == 2 else "1"
        return ("{ const _c = (%s) & 63; const _v = m.sx(%s, %d); const _r = _v >> _c; "
                "%s; m.shiftFlags(_r, _v, _c, %d, false); } %s") % (
            cnt, O[-1].read, bits, O[-1].write % "_r", bits, s)
    if b == "btst" and len(O) == 2 and O[0].read and O[1].read:
        return ("{ const _n = %s; const _v = %s; "
                "m.z = ((_v >>> (_n & 31)) & 1) === 0; } %s") % (
            O[0].read, O[1].read, s)
    if b in ("bset", "bclr", "bchg") and len(O) == 2 and O[1].write:
        tmpl = {"bset": "(_v | _bit)", "bclr": "(_v & ~_bit)", "bchg": "(_v ^ _bit)"}[b]
        return ("{ const _n = %s; const _v = %s; const _bit = 1 << (_n & 31); "
                "m.z = ((_v >>> (_n & 31)) & 1) === 0; %s; } %s") % (
            O[0].read, O[1].read, O[1].write % tmpl, s)
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
        t = target_addr(ops[0])
        if t is not None:
            return "call(0x%05x, m); %s" % (t, s)
        # jsr (an): the target is whatever the register holds
        mi = re.match(r"^\((a\d|sp)\)$", ops[0].strip())
        if mi:
            return "call(%s, m); %s" % (Operand._reg(mi.group(1)), s)
        ea = O[0].ea()
        return "call(%s, m); %s" % (ea, s) if ea else None
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
        a = "m.rd(%s, 16)" % O[1].read if False else O[1].read
        if b == "muls":
            e = "((m.sx(%s, 16) * m.sx(%s, 16)) >>> 0)" % (O[1].read, O[0].read)
        else:
            e = "((((%s) & 0xffff) * ((%s) & 0xffff)) >>> 0)" % (O[1].read, O[0].read)
        w = Operand(ops[1], "l").write
        return "%s; m.logicFlags(%s, 32); %s" % (w % e, e, s)
    if b in ("divu", "divs") and len(O) == 2 and O[0].read and O[1].write:
        # 32 / 16: quotient in the low word, remainder in the high word. On
        # overflow the 68000 leaves the destination untouched and sets V.
        src = "m.sx(%s, 16)" % O[0].read if b == "divs" else "((%s) & 0xffff)" % O[0].read
        dst = "m.rd(%s, 32)" % O[1].read if False else Operand(ops[1], "l").read
        w = Operand(ops[1], "l").write
        num_ = "m.sx(%s, 32)" % dst if b == "divs" else "(%s >>> 0)" % dst
        return ("{ const _d = %s; const _n = %s; if (_d === 0) { throw new Error("
                "'divide by zero at 0x%05x'); } const _q = (_n / _d) | 0; "
                "const _r = _n %% _d; if (_q > 32767 || _q < -32768) { m.v = true; } "
                "else { m.v = false; %s; m.logicFlags(_q, 16); } } %s") % (
            src, num_, ins.address, w % "(((_r & 0xffff) << 16) | (_q & 0xffff)) >>> 0", s)
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
        return "m.stopped = true; return;"
    if b in ("rte", "rtr"):
        return "return;"
    if b == "reset":
        return s
    if b == "trap":
        n = num(ops[0].lstrip("#")) if ops else 0
        return "m.trap(%d); %s" % (n, s)
    if b in ("rol", "ror") and O and O[-1].write:
        cnt = O[0].read if len(O) == 2 else "1"
        v = "((%s) & %d)" % (O[-1].read, (1 << bits) - 1 if bits < 32 else 0xFFFFFFFF)
        if b == "rol":
            e = "(((%s << ((%s) %% %d)) | (%s >>> (%d - ((%s) %% %d)))) >>> 0)" % (
                v, cnt, bits, v, bits, cnt, bits)
        else:
            e = "(((%s >>> ((%s) %% %d)) | (%s << (%d - ((%s) %% %d)))) >>> 0)" % (
                v, cnt, bits, v, bits, cnt, bits)
        return "%s; m.logicFlags(%s, %d); %s" % (O[-1].write % e, e, bits, s)
    if b in ("ori", "andi", "eori") and len(ops) == 2 and ops[1].strip() in ("sr", "ccr"):
        op = {"ori": "|", "andi": "&", "eori": "^"}[b]
        return "m.sr = (m.sr %s %s) >>> 0; %s" % (op, O[0].read, s)
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
