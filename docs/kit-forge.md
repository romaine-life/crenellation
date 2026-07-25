# Kit forge — generating UI-kit icons with codex

Two codex forges, both **method-verified against the rollout** (see below):
`frontend/scripts/kit-forge.mjs` produces the UI-kit **icon glyphs** (it owns the
`SPECS` list, one per icon), and `frontend/scripts/forge-atom.mjs` produces the
**9-slice atoms** for frames (chroma-key despill + low-fi, ADR-0013 / ADR-0014).

This doc exists because the forge once shipped a batch of broken icons, and the
reason is non-obvious and easy to repeat: kit-forge originally gated on `codex exec
--json` **stdout**, which never carries the generation event, so it rejected every
real generation (and the un-gated runs before it shipped code-drawn icons). That
gate was **fixed (#155) to read the rollout** (see below), and a CI check
(`scripts/check-imagegen-gate.mjs`) now fails the build if any forge regresses to a
stdout gate. Read this before building or "improving" any codex-image forge.

## The hard rule: verify the METHOD, never trust the bitmap

**You cannot trust that codex generated an image. Confirm it, every single
time, before you look at the pixels.**

Codex is asked to *generate* an icon. It often does not. Its own image-generation
skill says **not** to use the image model for "icons better produced directly in
SVG, HTML/CSS, or canvas" or for "deterministic code-native output." A request
for a tiny (64×64), hard-alpha, no-anti-aliasing, pixel-perfect icon is exactly
that profile — so codex instead writes a Python **PIL `ImageDraw`** script and
draws the icon procedurally (ignoring a prompt that literally says "do NOT write
a script"). For simple shapes (floppy, info-i) that looks fine; for anything with
curves or radial detail (gear, music note, wrench) it produces crude, lumpy,
asymmetric garbage. It even force-binarizes the alpha and self-checks it — i.e.
it codes **to** our gate.

A mechanical pixel gate (magenta despill / binary alpha / edge bleed) **cannot**
tell a hand-coded gear from a generated one — both can be perfectly clean
transparency. So the gate passes, provenance records "forged," and the lie ships.
That is what happened in commit `a6eddd8` ("Forge entire kit 30/30"): every icon
was drawn in code, not generated, and the detailed ones came out broken.

### How to verify (the definitive signal — read the ROLLOUT, not stdout)

A genuine generation emits an **`image_generation_call`** event (id `ig_…`) plus
an `image_generation_end`, and leaves the PNG under
`~/.codex/generated_images/<thread_id>/ig_*.png`. A programmatic drawing emits
only `shell_command` / code tool calls.

**The catch that has cost real time, more than once:** `codex exec --json`
**stdout is abridged** — it is a `thread/turn/item` stream (`thread.started`,
`item.completed` with `command_execution` / `mcp_tool_call`, `turn.completed`) and
**never contains `image_generation_call`.** Grepping stdout for it (what the old
kit-forge did) marks EVERY real generation "code-drawn." The event lives only in
the full **rollout session log**:
`~/.codex/sessions/<Y>/<M>/<D>/rollout-*-<thread_id>.jsonl` — correlate by the
`thread_id` that `thread.started` prints to stdout, then grep that rollout.

- **Method gate (first, definitive):** an `image_generation_call` in the
  **rollout**. None → codex coded it → reject, no matter how clean the pixels.
- **Pixel/transparency gate (second):** hygiene only — corners actually
  transparent after despill, no gross key fringe. **Anti-aliasing is allowed and
  expected**; never demand binary alpha. It does not judge whether the drawing is
  good — that is the method gate plus a human eyeball.

`forge-atom.mjs` implements this: `methodVerified()` reads the latest rollout for
`image_generation_call`, and it ships the PNG from
`~/.codex/generated_images/<thread_id>/` (the workspace copy is racy under
concurrency). Build every codex-image pipeline the same way — gate the method via
the **rollout** first.

## "Gate PASS" never means "ship"

The gates are necessary but not sufficient. They certify *clean transparency*,
not *a good drawing*. Always eyeball generated assets before onboarding them, and
never replace known-good art with a batch of "30/30 PASS" output you haven't
looked at. The eyeball is the required backstop; do not automate it away.

## The gate is transparency hygiene, NOT a quality judge

`verifyGlyph` only fails on real mechanical transparency defects: a gross
magenta keying fringe (dozens of saturated-magenta px outlining the subject) or
opaque pixels bleeding to the canvas edge. It used to *also* demand binary alpha
(no semi-transparent pixels) — that was a bug, removed. Anti-aliased edges are
what make icons look clean; demanding hard alpha rejected the good originals and
pushed codex to hand-draw jagged icons in code to satisfy it. Don't reintroduce
a binary-alpha fail. Whether the art is *good* is decided by the method gate
(was it really generated) plus a human eyeball — never by this pixel check.

## The transparency path (decided — ADR-0013)

Transparency for generated chrome is produced by generating on a flat `#00ff00`
chroma-key background (built-in / subscription codex, method-verified) and keying
to alpha locally with `$CODEX_HOME/skills/.system/imagegen/scripts/remove_chroma_key.py`.

The native paid-API path (gpt-image-1.5 `background=transparent`) is **rejected on
cost** — the subscription's flagship model (gpt-image-2) deliberately dropped
native transparency, and pinning the older model requires the paid API. Chroma-key
+ despill is the community-standard way to get transparency from a gpt-image-2-class
model; it is the method here, not a placeholder.

Key color: `#00ff00` for steel/blue/gold chrome (no pure green in the palette);
`#ff00ff` if an asset's art uses green. **Always verify alpha** (corners
transparent, no holes/fringe) — a key-color collision must fail loudly, not ship.
The despilled, anti-aliased edge is fine; a sloppy removal that leaves a key
fringe is (correctly) caught. Full rationale and sources: ADR-0013.
