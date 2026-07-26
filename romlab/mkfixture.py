"""Build test fixtures for the TypeScript routines from the ROM captures."""
import json, pathlib, re
HERE = pathlib.Path('.')
OUT = HERE.parent / 'frontend' / 'src' / 'rom'
fix = {}

# RNG: seed in, n in, return value and new seed out
rows = []
p = HERE / 'out' / 'verify6' / 'v.log'
if not p.exists():
    cands = list((HERE / 'out' / 'verify6').glob('*.log')) if (HERE/'out'/'verify6').exists() else []
    p = cands[0] if cands else None
if p and p.exists():
    for line in p.read_text().splitlines():
        m = re.match(r'^R (\w+) (\w+) (\w+) (\w+)$', line.strip())
        if m:
            rows.append([int(x, 16) for x in m.groups()])
fix['rng'] = rows

# combined ROM image: overlay below 0x20000, main image above
up = (HERE / 'prog_upper.bin').read_bytes()
main = (HERE / 'prog_main.bin').read_bytes()
rom = bytearray(main)
rom[0:len(up)] = up
(OUT / 'rom.bin').write_bytes(bytes(rom))
print('rom.bin bytes:', len(rom))
(OUT / 'fixtures.json').write_text(json.dumps(fix))
print('rng rows:', len(rows))
