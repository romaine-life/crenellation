import json, pathlib, capstone
from collections import Counter
import m68kts
UP = pathlib.Path('prog_upper.bin').read_bytes()
md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)
F = json.loads(open('out/facts.json').read())
tot = ok = 0
miss = Counter()
err = Counter()
for a, b in F['funcs']:
    addr = a
    while addr < b:
        ins = next(md.disasm(UP[addr:addr+16], addr, 1), None)
        if ins is None:
            addr += 2
            continue
        tot += 1
        try:
            r = m68kts.emit(ins, addr + ins.size)
        except Exception as e:
            r = None
            err[type(e).__name__ + ': ' + str(e)[:60]] += 1
        if r:
            ok += 1
        else:
            miss[ins.mnemonic.split('.')[0]] += 1
        addr += ins.size
print(f'instructions translated: {ok}/{tot} ({100*ok/tot:.1f}%)')
print('top unhandled mnemonics:', miss.most_common(14))
if err:
    print('errors:', err.most_common(6))
