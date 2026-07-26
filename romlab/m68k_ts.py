"""Translate 68000 routines into TypeScript.

Hand-porting 565 routines is not feasible; this emits them mechanically. The
output is real executable TypeScript operating on a machine model (registers,
flags, a memory array), so a translated routine can be run and compared against
the ROM the same way the hand-written ports were.

Coverage is deliberately explicit: any instruction without a rule emits a
throw, so an unsupported opcode fails loudly at run time instead of silently
producing wrong numbers.
"""
import json
import pathlib
import re

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

SZ = {"b": 8, "w": 16, "l": 32}


def sizeof(mn):
    if "." in mn:
        return mn.rsplit(".", 1)[1]
    return "w"


def base(mn):
    return mn.split(".")[0]


def operand(tok, size):
    """Translate one operand into a TypeScript lvalue/rvalue pair."""
    tok = tok.strip()
    m = re.fullmatch(r"[da](\d)", tok)
    if m:
        return f"m.{tok}", None
    if tok == "sp" or tok == "a7":
        return "m.a7", None
    if re.fullmatch(r"#\$?-?[0-9a-fA-F]+", tok):
        v = tok[1:]
        n = int(v.lstrip("$"), 16) if v.startswith("$") else int(v)
        return str(n), None
    m = re.fullmatch(r"\$([0-9a-fA-F]+)(?:\.[wl])?", tok)
    if m:
        return f"m.read{size.upper()}(0x{m.group(1)})", f"m.write{size.upper()}(0x{m.group(1)}, %s)"
    m = re.fullmatch(r"\((a\d)\)", tok)
    if m:
        return f"m.read{size.upper()}(m.{m.group(1)})", f"m.write{size.upper()}(m.{m.group(1)}, %s)"
    m = re.fullmatch(r"\((a\d)\)\+", tok)
    if m:
        r = m.group(1)
        step = SZ[size] // 8
        return (f"m.postinc(m.{r}, {step}, {SZ[size]})",
                f"m.writePostinc('{r}', {step}, {SZ[size]}, %s)")
    m = re.fullmatch(r"-\((a\d)\)", tok)
    if m:
        r = m.group(1)
        step = SZ[size] // 8
        return (f"m.predec('{r}', {step}, {SZ[size]})",
                f"m.writePredec('{r}', {step}, {SZ[size]}, %s)")
    m = re.fullmatch(r"\$?(-?[0-9a-fA-F]+)\((a\d)\)", tok)
    if m:
        off = int(m.group(1), 16)
        return (f"m.read{size.upper()}(m.{m.group(2)} + {off})",
                f"m.write{size.upper()}(m.{m.group(2)} + {off}, %s)")
    return None, None


def translate(entry, end, name):
    lines = [f"// {name}  ({entry:#07x}..{end:#07x})",
             f"export function fn_{entry:05x}(m: Machine): void {{",
             "  let pc = 0x%05x;" % entry,
             "  for (;;) { switch (pc) {"]
    addr = entry
    unsupported = 0
    total = 0
    while addr < end:
        ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
        if ins is None:
            addr += 2
            continue
        total += 1
        nxt = addr + ins.size
        b, s = base(ins.mnemonic), sizeof(ins.mnemonic)
        ops = [o for o in ins.op_str.split(",")] if ins.op_str else []
        body = None
        if b == "move" and len(ops) == 2:
            src, _ = operand(ops[0], s)
            _, dst = operand(ops[1], s)
            if src and dst:
                body = dst % src + ";"
        elif b == "rts":
            body = "return;"
        elif b == "nop":
            body = ";"
        if body is None:
            unsupported += 1
            body = (f"throw new Error('unsupported {ins.mnemonic} {ins.op_str} "
                    f"at {addr:#07x}');")
        lines.append(f"    case 0x{addr:05x}: {body} pc = 0x{nxt:05x}; break;")
        addr = nxt
    lines.append("    default: throw new Error('pc out of range: ' + pc.toString(16));")
    lines.append("  } }")
    lines.append("}")
    return "\n".join(lines), total, unsupported


if __name__ == "__main__":
    F = json.loads((HERE / "out" / "facts.json").read_text())
    N = json.loads((HERE / "out" / "names.json").read_text())
    names = {int(k, 16): v for k, v in N["names"].items()}
    funcs = sorted((a, b) for a, b in F["funcs"])
    tot = uns = 0
    for a, b in funcs[:40]:
        _, t, u = translate(a, b, names.get(a, "?"))
        tot += t
        uns += u
    print(f"sampled {len(funcs[:40])} functions: {tot} instructions, "
          f"{uns} unsupported ({100*uns/max(1,tot):.0f}%)")
    print("instruction coverage must be near 100% before this is worth running")
