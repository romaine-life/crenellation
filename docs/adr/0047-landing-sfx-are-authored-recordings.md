---
status: "accepted"
date: 2026-06-29
deciders: Nelson, Claude
---

# ADR-0047: Landing SFX are authored recordings, not code-synthesized

Supersedes the synthesis approach of the first terrain-SFX cut (PR #267). Sits beside
[ADR-0029](0029-catalog-category-requirements.md) (the Studio SFX catalog stays a valid
category) and carries the same spirit as the art rules
([ADR-0011](0011-chrome-art-generated-not-extracted.md)): we don't fabricate assets in
code, we source/author them.

## Context and Problem Statement

The first landing-SFX cut synthesized every terrain footstep procedurally in `sfx.ts`:
a `RECIPES` table where each terrain built a short one-shot from Web Audio oscillators +
filtered noise (`noiseSource`), and `sfxWaveform.ts` offline-rendered those recipes for
the catalog cards. It worked mechanically, but the synthesized foley was agent-authored
and sounded **wrong** — the owner's words: "they were agent-created and are weird." The
owner then supplied real **recordings** (hay/water/sand/landing) to use instead.

This mirrors a settled principle on the art side: visual richness is generated or
sourced, never hand-built in code. Audio deserves the same stance — a code-tuned
oscillator graph is the audio equivalent of code-drawing a prop, and it reads as such.

## Decision Drivers

- The owner judges sound by ear and rejected the synthesized set outright; "weird but
  present" is worse than honest silence.
- One source of truth for "how SFX are made," so a future agent doesn't helpfully
  re-introduce procedural foley as a "fallback."
- Repeated landings must not fatigue — the reason the synthesis was tuned subtle, and a
  constraint the recording pipeline must also satisfy.

## Considered Options

- **Keep the procedural recipes, add recordings on top.** Rejected: two systems for one
  sound, and the recipes are the thing the owner disliked — keeping them invites their
  reuse and muddies the mix.
- **Keep recipes as a fallback for un-recorded terrains.** Rejected: the fallback IS the
  weird sound; silence is preferable until a real recording exists.
- **Authored recordings only; remove the synthesis** (chosen).

## Decision Outcome

**Landing/terrain SFX are authored recordings.** Raw recordings live in `tools/sfx/source/`
(source of truth, in git); `tools/sfx/slice-sfx.sh` slices each multi-take recording into
individual one-shot take variants under `frontend/public/assets/sfx/<key>/` (`vN.mp3` +
`manifest.json`), normalized once per file to preserve take-to-take dynamics. `sfx.ts`
fetches each manifest, decodes the takes on the first gesture, and **random-picks a take
per landing** so repeats never fatigue. Per-set level trims live in `SAMPLE_GAINS`.

The procedural synthesis is **deleted**: `RECIPES`, the per-terrain recipe functions,
`noiseSource`/`NoiseColor`, `SfxRecipe`, and the recipe-render path in `sfxWaveform.ts`
(~445 lines). `playTerrain` now plays a terrain's sample set or nothing — there is no
synthesized voice.

Recorded sound sets: **grass** (hay), **water**, **sand**, **stone** (footsteps), and the
non-terrain **arrival** thump (`landing.mp3`, layered over the per-terrain spawn sound at
the deploy roll-call, ADR-0045). The terrain→sound MAP is decoupled from the sets
(`TERRAIN_SAMPLE`): every landable terrain is voiced — the bare hard-ground terrains
**road/bridge/dirt/pebble reuse the stone footsteps** — and only the impassable
`cliff`/`rock` are silent (pieces never land there). The owner edits the map in the Studio
assignment panel and hands it back to bake in. New distinct sound = drop sliced takes under
`assets/sfx/<key>/`, register the source in `slice-sfx.sh`, add a `SFX_ASSETS` entry, and
map terrains to it. Long source packs are capped at `MAX_VARIANTS` takes by the slicer
(stone kept 12 of 29).

### Consequences

- **Good:** the sounds are the owner's real foley, judged by ear; no agent-synthesized
  audio ships; one clearly-documented pipeline; ~445 lines of synthesis removed.
- **Good:** the Studio "Sound Effects" catalog (ADR-0029) now auditions the real takes
  and draws the real decoded waveform — what you hear is what plays.
- **Cost / intended:** five terrains are silent on landing for now. This is deliberate
  (silence over weird synth) and reversible — the pipeline is in place to voice them.
- **Cost:** SFX now fetch + decode small assets (≈260 KB total) instead of costing zero
  network; decoded once per session on the first gesture, well before the first landing.

## More Information

- **Components:** `frontend/src/sfx.ts` (sample sets, `playTerrain`, `playArrival`),
  `frontend/src/sfxWaveform.ts` (decoded-take waveform), `frontend/src/ui/sfxCatalog.ts` +
  `SfxLibraryStudio.tsx` (catalog grid + the assignment editor), `frontend/src/game/store.ts`
  (fires landings + the arrival roll-call). **Assets:** `frontend/public/assets/sfx/<key>/`.
  **Pipeline:** `tools/sfx/` (`source/`, `slice-sfx.sh`, `README.md`).
- **Studio placement:** the owner edits the terrain→sound map + arrival thump in an
  assignment editor that lives as the **Viewer `sfx` kind** (`SfxViewer`), NOT in the
  catalog main or the 260px controls rail. Per docs/studio-control-architecture.md the
  catalog main is content-only (the card grid) and a heavy matrix would dominate the rail,
  so the editor uses the blessed editing-kind shape (Portrait/9-Slice): editor = the
  `al-lab-main` stage, controls in the rail. It is the first *global-config* Viewer kind
  (no per-item selection) — deliberate; do not relocate it back into the catalog. Reached
  via the catalog's "Assign sounds…" affordance (`openViewer('sfx')`). The editor writes a
  localStorage DRAFT and a "Copy for Claude" blob the owner pastes back to bake in.
- **Settings:** volume + mute via Settings → Audio (Master Audio + Effects Volume),
  unchanged.
