// The landing sound effects, as catalog items. Read-only: you audition them (the
// Viewer plays them live), you don't edit them.
//
// Every effect here is AUTHORED recorded foley, sliced into one-shot take variants
// under public/assets/sfx/<key>/ and random-picked per landing (so repeats never
// fatigue). The card waveform is the real decoded take. A card is one SOUND set; the
// terrain→sound MAP (which terrains use it) lives in TERRAIN_SAMPLE + the assignment
// panel — e.g. road/bridge/dirt/pebble all reuse the stone footsteps. An earlier
// procedurally-synthesised set was removed (we play recordings, not synth).
//
// Adding an effect = drop sliced takes under public/assets/sfx/<key>/ + a manifest,
// then an entry here. cliff/rock are impassable (pieces never land), so no sound.

import type { TerrainType } from '../core/types';
import type { SampleKey } from '../sfx';

export interface SfxAsset {
  /** Stable id (== the terrain it sounds for, or 'arrival'); backs catalog selection. */
  name: string;
  /** The terrain this sounds for; omitted for the non-terrain arrival thump. */
  terrain?: TerrainType;
  /** The authored sample key under /assets/sfx/<key>/. */
  sampleKey: SampleKey;
  label: string;
  /** One-line description of what the sound evokes (the Details "Character"). */
  character: string;
  /** How it's made — the Details "Build" line. */
  build: string;
  /** How many take variants are random-picked per landing. */
  variantCount: number;
}

// Terrains a piece can land on (cliff/rock are impassable → never a landing, so not
// assignable). Drives the Studio terrain→sound assignment panel.
export const ASSIGNABLE_TERRAINS: TerrainType[] = ['grass', 'water', 'sand', 'stone', 'road', 'bridge', 'dirt', 'pebble'];

export const SFX_ASSETS: SfxAsset[] = [
  { name: 'grass', terrain: 'grass', sampleKey: 'grass', label: 'Grass', character: 'Recorded dry hay/grass rustle.', build: 'Authored recording · sliced one-shot takes', variantCount: 4 },
  { name: 'water', terrain: 'water', sampleKey: 'water', label: 'Water', character: 'Recorded splash / wet step.', build: 'Authored recording · sliced one-shot takes', variantCount: 10 },
  { name: 'sand', terrain: 'sand', sampleKey: 'sand', label: 'Sand', character: 'Recorded soft sandy shuffle.', build: 'Authored recording · sliced one-shot takes', variantCount: 11 },
  { name: 'stone', terrain: 'stone', sampleKey: 'stone', label: 'Stone', character: 'Recorded footsteps on stone.', build: 'Authored recording · sliced one-shot takes', variantCount: 12 },
  // The "unit lands on the board" thump, layered over the terrain at the deploy roll-call.
  { name: 'arrival', sampleKey: 'arrival', label: 'Arrival', character: 'Unit lands on the board — layered over terrain on deploy.', build: 'Authored recording (landing.mp3)', variantCount: 1 },
];
