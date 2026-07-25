---
status: "accepted"
date: 2026-06-26
deciders: Nelson, Claude
---

# ADR-0011: Chrome art is generated or atom-assembled — not extracted, not redrawn

Refines [ADR-0002](0002-nine-slice-border-image-for-pixel-art-chrome.md) (the
9-slice mechanism) by fixing how the *source* image is produced. Supersedes the
extraction instructions in the kit briefs and `ui-kit-standard.md` §5.

## Context and Problem Statement

The kit briefs (`docs/art/kit-briefs/row.md`, `panel.md`, `icons.md`, `toggle.md`)
and `ui-kit-standard.md` §5 all instruct: **extract** the art from the concept
crops, "do NOT redraw / regenerate." That guidance is stale and contradicts the
hard-won current method — and it nearly walked this work back into extraction.

The history matters so the fix is accurate:

- Extraction was an early **stopgap**. §5 records *why* it won then: codex's
  *code-drawn* redraws were "visibly worse than the extracted ones." True — when
  codex was hand-drawing chrome in PIL.
- Then the forge added **method-verified img2img generation** (`kit-forge.md`):
  confirm an `image_generation_call` event before trusting pixels, so codex
  actually *generates* instead of code-drawing.
- Method-verified generation beats **both** extraction (which produced dirty,
  asymmetric whole-crops — the tabs and `row.png`, retired in
  [ADR-0009](0009-mode-button-from-atoms.md)) **and** code-drawing.

The briefs and §5 froze at the stopgap and were never updated.

## Decision Drivers

- One clear, current method; stop stale docs misleading people (and agents).
- Honor the painstaking learning that extraction is the wrong end state.

## Decision Outcome

UI chrome art is produced by **codex image generation (img2img, method-verified
via an `image_generation_call` event)**, or **assembled from codex-generated
atoms** (`corner`/`edge`/`fill` → `assemble-frame.mjs`, symmetric by
construction). **Extraction of concept crops and procedural/CSS/code redraw are
retired — with NO exceptions, including for fine details** (see "When generation
seems to miss a fine detail" below).

This is **settled and rigorously resolved.** Do not reopen the extraction
question, do not quote the superseded briefs as current, and do not treat a
generation that misses a detail as evidence that extraction is needed. If you
believe this is wrong, the bar is very high: bring it as an explicit new ADR
proposal — do not drift back into extraction in passing.

- The concept art is the **style/palette reference** (the img2img input) and the
  review target — never a crop source for runtime chrome.
- **Verify the method first, every time** (`kit-forge.md`): an
  `image_generation_call` in the rollout, no code-drawing, before looking at
  pixels. The forge's stdout method check is known-unreliable (this codex version
  emits the event in the rollout log, not stdout) — check the rollout.

### Consequences

- Good: one current method; the extraction-era docs get corrected to match.
- Note: some currently-*deployed* chrome may still be extraction-era assets not
  yet regenerated (e.g. the old `row.png`, possibly `panel.png`). Migrating those
  to generated/atom-assembled is separate follow-up, not blocked by this record.

## When generation seems to miss a fine detail

If a generated asset looks like it dropped a fine detail (e.g. the settings row's
small notched corner accent), the fix is to **feed codex a close-up crop of that
exact detail as the img2img reference and re-generate** — NOT to fall back to
extraction.

Proven on the row corner: from the full-screen reference codex produced a generic
rounded box (no notch); given a tight close-up of the corner, it reproduced the
notch. "Generation can't do fine detail" is **false** — it just needs the detail
shown to it. This is the resolution; it is not grounds to reopen extraction.

## More Information

- Method gate + history: [`../kit-forge.md`](../kit-forge.md).
- Atom assembly: `frontend/scripts/assemble-frame.mjs`; example: [ADR-0009](0009-mode-button-from-atoms.md).
- Superseded guidance: kit-briefs `row/panel/icons/toggle.md`, `ui-kit-standard.md` §5.
