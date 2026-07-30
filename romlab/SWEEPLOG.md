# Sweep ledger

One line per sweep, per SWEEP.md. Dry is three consecutive sweeps finding
nothing; any discovery resets the count.

## 2026-07-29 — sweep 1 (static instruments + dynamic census, attract)

Instruments: staticentries (entry-aware), census_image, census.sh boots at
2,400 frames (die-proof variant: findings written even when the boot dies).

Found, fed back, and converged — the map went 778 → 885 routines:

- the board-ROM islands (0x140010 bank probe, 0x1400E4 table compare)
- ~40 overlay routines misfiled as data (self test, service cluster, sound
  queue) via the lifter-reference harvest
- the crash screen behind the halt stub; stop-successor entries generally
  (six stops ROM-wide)
- six dead-code islands judged by reading (reviewed_entries.json)
- extents clipped at noreturn calls and at undecodable words - seven
  routines were silently unliftable from data in their extents; the
  branching lifter now lifts 100%
- the deep-attract stratum the dynamic census walked one boot at a time:
  0x3C44/0x3CCC (cell-owner arms), 0x91B2, 0x1288E, 0xBBD2, and the event
  handler cluster 0x12280-0x12354 with mid-handler entries 0x122AE/0x1232C
- the entry-aware coverage rule: a transfer target must BE an entry, not
  merely inside an extent - 22 orphaned arm-joins surfaced at once when the
  harvest learned it

End state: census.sh runs 2,400 frames with zero missing addresses and no
death; staticentries dry across four consecutive regenerations.

Also opened and then closed: the bounded decompiled tick let decomp.test
finish for the first time, and seven pre-existing lift divergences became
visible (0x760A, 0xB032, 0x19786, 0x198C0, 0x1997A, 0x1997C, 0x19B06). Six
are fixed - zero-divide and trap take their vectors, a stop flushes before
halting, a conditional can leave a routine by falling, and a stubbed call
voids a trial instead of failing it. 0xB032 remains, named in baseline.json.

That work moved the map again (885 -> 899: the three jump tables whose
cases live inside the table's own data region), so the discovery round
above does not count as a dry sweep. The count starts below.

## 2026-07-29 — sweep at 899 routines: not dry

Static: staticentries clean, but census_image raised 14 misclassification
alarms - three pc-relative jump tables (0x554C, 0x17BE6, 0x1A5BA) whose case
targets live inside the table's own data region, so nothing gave them a
function. jumptables.py had never been re-run against the grown map; doing
so added 14 spans. Then one more round found the entry filter dropping the
wrong side of an overlapping pair: 0xFC46 begins a six-byte move.b, 0xFC4A
lands inside it, the game transfers to 0xFC46 and nothing reaches 0xFC4A -
and the extent stopping mid-instruction handed the lifter a truncation that
capstone read as a load from 0xAAAAAAAA. Reachability now settles the pair,
before extents are computed rather than after.

Map 885 -> 901. Found things, so the count resets.

## 2026-07-29 — sweep at 901 routines: not dry, and why attract is not enough

Static all dry. But the dynamic half had only ever run attract, and the
protocol asks for more. Encoding the rest - coin, join at a station, mash
button one, walk the trackball, two and three stations, the service switch -
found what attract never could: the game halted part-way through play
because 0x11EE6 had no function. Feeding it back let the run reach further
and reveal the next, four rounds deep (0x11EE6, 0x8A24, 0x7954, then the
event-handler entries 0x122B2/0x122BC/0x1235E) - which is the documented
shape of this work: each fix lets the game run further and shows the next.
sweeploop.sh now does that loop unattended.

Map 901 -> 907. Found things, so the count resets.

## 2026-07-29 — sweep 1 of 3 (907 routines)

Static: staticentries 0 uncovered of 812 lifted transfer targets;
jumptables 0 new spans; jtentries 0 new; census_image clean - every byte
verdicted, zero misclassification alarms, zero unjudged suspects, zero
overlap conflicts.
Dynamic (sweep.sh, all six patterns against the pure decompiled game): every
pattern ran its full budget with zero missing addresses and no early death -
attract 2,401 frames, one player 3,601, two players 3,601, three stations
3,001, service 1,801, idle 3,435. The play patterns had been dying at 1,135
frames before this round's finds.
Verification: decomp.test green - 3,606 comparisons, the only disagreement
the named 0xB032; boot, writes, compose and compose MODIFIED all green.
Found: nothing. **DRY 1.**

## 2026-07-29 — sweep 2 of 3 (907 routines)

Everything in sweep 1, plus the silicon instrument the protocol names:
exectrace.lua taps instruction fetches in 347 windows across a 14,000-frame
MAME session covering attract, build and battle, with coins, buttons and
both trackball axes driven. 10,558 distinct addresses executed; **every one
of them inside a routine in facts.json** - zero PCs outside the map.
Found: nothing. **DRY 2.**

## 2026-07-29 — sweep 3 of 3 (907 routines)

Every instrument again, the MAME session given half again as long to reach
anything the shorter one missed: the same 10,558 addresses, still all inside
the map. Port side: all six patterns to their full budgets, zero missing.
Static: staticentries 0 uncovered, census clean.
Found: nothing. **DRY 3.**

# Discovery went dry on 2026-07-29, at 907 routines.

Three consecutive full sweeps found nothing, by both instruments the goal
names: no PC outside funcs in MAME, zero missing entries in the port. What
would reopen it is a new input pattern - the protocol expects the pattern
list to grow, and the count resets when it does.
