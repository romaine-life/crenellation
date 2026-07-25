---
name: north-star
description: Re-ground in the quality bar that was always in force — go find and honor the contracts and invariants this repo states for itself, then go deep and stop cutting corners
---

# /north-star — Re-ground in the standing standard

The bar was never lowered. When the user invokes `/north-star` (or
`$north-star`), they are not raising it or choosing "thorough" for this task —
the durable, high-craft solution was always the expected outcome. The signal
means the agent stopped seeing the standard that was already in force, and needs
to re-ground in it.

There is no quick-vs-thorough toggle. The contracts this repo has written down
for itself are binding invariants, not suggestions, and they were binding before
this was invoked.

This is a call to pay attention to those contracts and invariants, and a
statement of intent about how to work.

Use it in two situations:

1. **Starting substantial work** — re-ground in the standing bar before you
   begin, rather than discovering it halfway through.
2. **An agent has drifted** — it offered a quick-vs-thorough choice, started
   cutting corners, or reintroduced something a previous change deliberately
   removed. This re-asserts that the standard never changed and those decisions
   are settled.

## Do this now

1. **Find and read the contracts this repo states.** They live in `docs/` and
   in `CLAUDE.md` / `AGENTS.md`. Don't work from memory — open the ones that
   bear on the task. The repo states its invariants as explicit contracts, e.g.:
   - render & projection: `board-render-contract.md`,
     `blender-projection-contract.md`, `projection-angle-reference.md`,
     `unit-footprint-calibration.md`
   - asset pipeline: `asset-generation-contract.md`, `asset-terminology.md`,
     `tile-ruleset.md`, the portrait/background contracts
   - direction & intent: `game-concept.md`, `ui-art-direction.md`
   - verification: `local-dev-verification.md`
   - migrations & retiring systems: `migration-policy.md`

   This list is illustrative, not exhaustive — read whatever in-scope contract
   exists, and treat a contract as binding even if it isn't named here. If a
   contract relevant to the task is missing or contradicts the code, surface
   that as a finding before proceeding.

## Then hold this standard

- **Heavy is the floor, not a mode.** Do not present a minimal fix as the
  option, and do not ask the user to choose quick-vs-thorough. If the full
  solution is too large for one PR, write the full plan first and stage it so
  each step leaves the system coherent.
- **Honor the stated contracts.** Projection, footprint, facing, tile
  alignment, and asset-pipeline rules are invariants the repo paid for in past
  bugs. Match them exactly; do not re-litigate or quietly deviate.
- **Settled decisions stay settled, and retiring means deleting.** Do not
  reintroduce a route, flag, type, asset path, or UI path that a prior change
  removed. Per `docs/migration-policy.md`, migrating off an old system means
  deleting it end to end — no compatibility, no fallback, no "kept for
  reference." A method an ADR retires is an instruction to delete it, not to
  leave it runnable. Treat `legacy`, `archived`, `fallback`, `temporary`, and
  `retired` as deletion targets, not options.
- **Verify in the real running app.** A change is not done because it compiles.
  Run it, follow `local-dev-verification.md`, and hand the user a clickable link
  to the exact running route showing the result.
- **Definition of done is the contracts.** Before calling work complete, check
  it against the contracts you read. If something is unfinished, name it as
  unfinished scope — do not frame remaining work as optional.

Carry this standard for the rest of the session unless the user explicitly
downgrades it.
