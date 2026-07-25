// Dev-only scroll/thumbnail perf harness for the Campaign Editor. `/campaigns-next?stress=<n>`
// injects a throwaway campaign of N generated levels into the in-memory store so the long,
// windowed level list (baked thumbnails + content-visibility) can be measured under load.
//
// Gated entirely behind the URL flag: with no `?stress=` param `injectStressLevels` is a no-op
// and returns 0, so it can never affect normal use. The injected levels live only in the
// session store (the user would have to explicitly Save to persist them); reloading without the
// flag clears them.

import type { Campaign, CampaignLevelRef, Level, LevelUnit, ObjectiveType, TerrainCell, TerrainType } from '../core/level';
import type { PieceType, Side, UnitFacing } from '../core/types';
import { CAMPAIGN_FORMAT_VERSION, LEVEL_FORMAT_VERSION, BOARD_COLS, BOARD_ROWS } from '../core/level';
import { useCampaigns } from './store';

const DEFAULT_COUNT = 150;
const MAX_COUNT = 500; // a guard so a fat number can't lock the tab

// A tiny deterministic PRNG (mulberry32) so a given level index always generates the same board
// — repeat runs are comparable, and identical boards still share one baked thumbnail.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OBJECTIVES: ObjectiveType[] = ['capture-all', 'capture-king', 'survive', 'reach'];
const TERRAINS: TerrainType[] = ['grass', 'dirt', 'stone', 'pebble', 'sand', 'water'];
const PIECES: PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const FACINGS: UnitFacing[] = ['north', 'east', 'south', 'west'];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function generateStressLevel(index: number): Level {
  const random = rng(index * 2654435761 + 1);
  const cols = clamp(8 + Math.floor(random() * 6), BOARD_COLS.min, BOARD_COLS.max);
  const rows = clamp(8 + Math.floor(random() * 6), BOARD_ROWS.min, BOARD_ROWS.max);
  const base = TERRAINS[Math.floor(random() * TERRAINS.length)];
  const accent = TERRAINS[Math.floor(random() * TERRAINS.length)];

  const terrain: TerrainCell[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      // A simple varied pattern: an accent stripe + scattered road so different families and the
      // road feature path both get exercised across the list.
      let cell: TerrainType = base;
      if (x === Math.floor(cols / 2) || y === Math.floor(rows / 2)) cell = accent;
      if ((x + y) % 5 === 0) cell = 'road';
      terrain.push({ x, y, terrain: cell, elevation: 0 });
    }
  }

  const units: LevelUnit[] = [];
  const unitCount = 2 + Math.floor(random() * 5);
  const placed = new Set<string>();
  for (let i = 0; i < unitCount; i += 1) {
    const x = Math.floor(random() * cols);
    const y = Math.floor(random() * rows);
    const key = `${x},${y}`;
    if (placed.has(key)) continue;
    placed.add(key);
    const side: Side = random() < 0.5 ? 'player' : 'enemy';
    units.push({
      x,
      y,
      type: PIECES[Math.floor(random() * PIECES.length)],
      side,
      facing: FACINGS[Math.floor(random() * FACINGS.length)],
    });
  }

  return {
    formatVersion: LEVEL_FORMAT_VERSION,
    id: `stress-l-${index}`,
    name: `Stress Level ${index + 1}`,
    notes: '',
    board: { cols, rows, heightLevels: 1 },
    objective: OBJECTIVES[index % OBJECTIVES.length],
    difficulty: 'normal',
    economy: { startingFunds: 1200, incomePerTurn: 150 },
    theme: 'grassland',
    layers: { terrain, decals: [], zones: [], units },
  };
}

/** Parse `?stress=<n>` from the current URL. Returns the clamped count, or 0 when absent/invalid. */
export function readStressCount(search: string = typeof window !== 'undefined' ? window.location.search : ''): number {
  const params = new URLSearchParams(search);
  if (!params.has('stress')) return 0;
  const raw = params.get('stress');
  // Bare `?stress` (no value) → the default; an explicit number → clamped; garbage → 0.
  if (raw === null || raw === '') return DEFAULT_COUNT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return clamp(n, 1, MAX_COUNT);
}

/**
 * Inject a throwaway "Stress Test" campaign of N generated levels into the store (and select it),
 * driven by `?stress=<n>`. Returns the number injected, or 0 when the flag is absent — so the
 * caller can branch (e.g. skip the normal first-campaign selection) only under the harness.
 */
export function injectStressLevels(search?: string): number {
  const count = readStressCount(search);
  if (count <= 0) return 0;

  const store = useCampaigns.getState();
  const levels: Record<string, Level> = { ...store.levels };
  const refs: CampaignLevelRef[] = [];
  for (let i = 0; i < count; i += 1) {
    const level = generateStressLevel(i);
    levels[level.id] = level;
    refs.push({ levelId: level.id, ordinal: i, objective: level.objective });
  }
  const campaignId = 'stress-campaign';
  const campaign: Campaign = {
    formatVersion: CAMPAIGN_FORMAT_VERSION,
    id: campaignId,
    name: `Stress Test (${count} levels)`,
    difficulty: 'normal',
    chapters: 1,
    favorite: false,
    locked: false,
    levels: refs,
    origin: 'mine' as const,
    readOnly: false,
  };

  useCampaigns.setState((s) => ({
    campaigns: [campaign, ...s.campaigns.filter((c) => c.id !== campaignId)],
    levels,
    selectedCampaignId: campaignId,
    selectedLevelId: refs[0]?.levelId ?? null,
  }));
  return count;
}
