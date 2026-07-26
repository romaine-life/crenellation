import json, pathlib, capstone
from collections import Counter
import m68kts
UP = pathlib.Path('prog_upper.bin').read_bytes()
md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)
F = json.loads(open('out/facts.json').read())
forms = Counter()
for a, b in F['funcs']:
    addr = a
    while addr < b:
        ins = next(md.disasm(UP[addr:addr+16], addr, 1), None)
        if ins is None:
            addr += 2
            continue
        try:
            r = m68kts.emit(ins, addr + ins.size)
        except Exception:
            r = None
        if not r:
            forms['%-10s %s' % (ins.mnemonic, ins.op_str)] += 1
        addr += ins.size
for k, v in forms.most_common(40):
    print('%5d  %s' % (v, k))
print('distinct unhandled forms:', len(forms))
