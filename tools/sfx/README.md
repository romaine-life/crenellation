# Landing sound effects (authored foley)

Game landing/terrain SFX are **authored recordings**, not procedurally synthesized.
(An earlier code-synthesized set was removed — see the SFX ADR.)

## Pipeline

- `source/` — the raw multi-take recordings (source of truth, kept in git so the
  delivered takes are reproducible). Each file holds several takes back-to-back.
  - `hay.mp3` → **grass**, `water.mp3` → **water**, `sand.mp3` → **sand**,
    `landing.mp3` → **arrival** (the "unit lands on the board" thump).
- `slice-sfx.sh` — slices each source into individual one-shot take variants,
  normalizes (one makeup gain per whole file, preserving take-to-take dynamics),
  trims, caps over-long takes, drops near-silent fragments, and writes
  `frontend/public/assets/sfx/<key>/vN.mp3` + `manifest.json`.

Re-generate after editing a source recording:

```bash
bash tools/sfx/slice-sfx.sh   # requires ffmpeg
```

## Consumption

`frontend/src/sfx.ts` fetches each `manifest.json`, decodes the takes, and random-picks
one per landing (so repeats never fatigue). Per-set level trims live in `SAMPLE_GAINS`
in `sfx.ts`. Terrains without a set (stone/road/bridge/dirt/pebble) are silent until
recordings are added; drop sliced takes under `assets/sfx/<key>/` and map the terrain in
`TERRAIN_SAMPLE`. Audition everything in the Studio → **Sound Effects** catalog.
