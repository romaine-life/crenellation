"""Ports of the event queue at 0xEE90 (post) and 0xEEEE (remove).

The phase machine runs on this queue. A record is 12 bytes: a word priority at
+0, the handler's own bytes +4/+5 copied to +2/+3, the handler key at +4 and a
parameter at +8. The count is a word at 0x3E1CF4 and is -1 when empty, which
both routines detect with a signed test before touching the table at all.

Posting deduplicates on key AND parameter, so the same handler can be queued
twice with different parameters. Removing compacts the table down over the gap
and stamps the vacated last slot with 0x7FFF.
"""
import pathlib
import re

REC = 12
SLOTS = 8


def blank():
    return [dict(w=0, b2=0, b3=0, key=0, param=0) for _ in range(SLOTS)]


def render(count, tab):
    out = []
    for r in tab:
        out.append(f"{r['w']:04X}{r['b2']:02X}{r['b3']:02X}{r['key']:08X}{r['param']:08X}")
    return f"{count & 0xFFFF:04X}", "".join(out)


def post(count, tab, key, param, b4, b5):
    if count & 0x8000:
        idx = 0
    else:
        for i in range(count + 1):
            if tab[i]["key"] == key and tab[i]["param"] == param:
                return count, tab          # already queued: nothing changes
        idx = count + 1
    count = (count + 1) & 0xFFFF
    tab[idx] = dict(w=b4, b2=b4, b3=b5, key=key, param=param)
    return count, tab


def remove(count, tab, key, param):
    if count & 0x8000:
        return count, tab
    hit = None
    for i in range(count + 1):
        if tab[i]["key"] == key and tab[i]["param"] == param:
            hit = i
            break
    if hit is None:
        return count, tab
    for i in range(hit, count):
        tab[i] = dict(tab[i + 1])
    tab[count] = dict(w=0x7FFF, b2=tab[count]["b2"], b3=tab[count]["b3"], key=0,
                      param=tab[count]["param"])
    return (count - 1) & 0xFFFF, tab


CASES = [
    ("post_empty",  "post", 0xFFFF, [],                          1, 0x1111),
    ("post_append", "post", 0,      [(1, 0x1111)],               2, 0x2222),
    ("post_dup",    "post", 0,      [(1, 0x1111)],               1, 0x1111),
    ("post_samekey","post", 0,      [(1, 0x1111)],               1, 0x9999),
    ("post_third",  "post", 1,      [(1, 0x1111), (2, 0x2222)],  3, 0x3333),
    ("rm_first",    "rm",   2,      [(1, 0x1111), (2, 0x2222), (3, 0x3333)], 1, 0x1111),
    ("rm_mid",      "rm",   2,      [(1, 0x1111), (2, 0x2222), (3, 0x3333)], 2, 0x2222),
    ("rm_last",     "rm",   2,      [(1, 0x1111), (2, 0x2222), (3, 0x3333)], 3, 0x3333),
    ("rm_missing",  "rm",   2,      [(1, 0x1111), (2, 0x2222), (3, 0x3333)], 4, 0x4444),
    ("rm_wrongparam","rm",  2,      [(1, 0x1111), (2, 0x2222), (3, 0x3333)], 2, 0x7777),
    ("rm_empty",    "rm",   0xFFFF, [],                          1, 0x1111),
    ("rm_single",   "rm",   0,      [(1, 0x1111)],               1, 0x1111),
]

log = {}
for line in (pathlib.Path("out/verify13/v.log")).read_text().splitlines():
    m = re.match(r"^R (\S+) ([0-9A-F]{4}) ([0-9A-F]+)$", line)
    if m:
        log[m[1]] = (m[2], m[3])

ok = bad = 0
for name, op, count, pre, h, p in CASES:
    tab = blank()
    for i, (hi, pv) in enumerate(pre):
        tab[i] = dict(w=0x10 + hi, b2=0x10 + hi, b3=0x20 + hi,
                      key=0xC0DE0000 + hi, param=pv)
    key, b4, b5 = 0xC0DE0000 + h, 0x10 + h, 0x20 + h
    if op == "post":
        c2, t2 = post(count, tab, key, p, b4, b5)
    else:
        c2, t2 = remove(count, tab, key, p)
    mine = render(c2, t2)
    rom = log.get(name)
    if rom and mine[0] == rom[0] and mine[1] == rom[1]:
        ok += 1
    else:
        bad += 1
        print(f"  {name}: MISMATCH")
        print(f"     rom  count {rom[0]} {rom[1]}")
        print(f"     port count {mine[0]} {mine[1]}")

print(f"\n{ok} match, {bad} differ")
print("VERIFIED" if bad == 0 else "NOT VERIFIED")
