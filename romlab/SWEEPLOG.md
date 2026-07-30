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

Also opened, not yet closed: the bounded decompiled tick let decomp.test
finish for the first time, and seven pre-existing lift divergences became
visible (0x760A, 0xB032, 0x19786, 0x198C0, 0x1997A, 0x1997C, 0x19B06) -
recorded in out/unproven.json, to be fixed rather than held back. Sweep 2
must re-run after those fixes; the count stands at zero dry sweeps.
