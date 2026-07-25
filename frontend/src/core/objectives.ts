// Per-objective win conditions (issue #44 Track 4). Pure + deterministic: maps a
// level's ObjectiveType + a small context into a Winner, replacing the core's
// hard-coded last-side-standing rule for levels that want richer goals. The
// store evaluates this after each resolved turn.

import type { BoardSize, GameState, Piece, Vec, Winner } from './types';
import type { Level, ObjectiveType } from './level';
import { livingPieces } from './rules';

/** The "royal" piece whose loss ends a capture-king objective. */
const ROYAL: Piece['type'] = 'king';

// A `survive` level doesn't carry an explicit turn target in the schema yet, so a
// battle built from one outlasts this many player turns by default. Tunable per
// level once the schema grows a field.
export const DEFAULT_SURVIVE_TURNS = 8;

/** Short, player-facing summary of each objective (HUD / level select). */
export const OBJECTIVE_LABEL: Record<ObjectiveType, string> = {
  'capture-all': 'Defeat every enemy piece',
  'capture-king': 'Capture the enemy King',
  survive: 'Outlast the assault',
  reach: 'Reach the objective',
};

export interface ObjectiveContext {
  /** `survive`: number of player turns that must elapse to win. */
  surviveTurns?: number;
  /** `survive`: player turns elapsed so far. */
  turnsElapsed?: number;
  /** `reach`: destination cells a living player piece must stand on. */
  reachCells?: readonly Vec[];
}

/**
 * Resolve a level objective to a winner, or `null` while undecided. Pure.
 * A full player wipe is always a loss regardless of objective; otherwise each
 * objective defines the player's win.
 */
export function evaluateObjective(state: GameState, objective: ObjectiveType, ctx: ObjectiveContext = {}): Winner {
  const players = livingPieces(state.pieces, 'player');
  if (!players.length) return 'enemy';
  const enemies = livingPieces(state.pieces, 'enemy');

  switch (objective) {
    case 'capture-all':
      return enemies.length ? null : 'player';
    case 'capture-king':
      // Won once the enemy has no royal piece left standing.
      return enemies.some((p) => p.type === ROYAL) ? null : 'player';
    case 'survive':
      return (ctx.turnsElapsed ?? 0) >= (ctx.surviveTurns ?? 0) ? 'player' : null;
    case 'reach': {
      const cells = ctx.reachCells ?? [];
      return players.some((p) => cells.some((c) => c.x === p.x && c.y === p.y)) ? 'player' : null;
    }
    default:
      return enemies.length ? null : 'player';
  }
}

/** With no objective zone authored, `reach` defaults to the enemy's back rank. */
function defaultReachCells(board: BoardSize): Vec[] {
  const cells: Vec[] = [];
  for (let x = 0; x < board.cols; x += 1) cells.push({ x, y: 0 });
  return cells;
}

/**
 * The static objective context a level implies — the `survive` clock and the
 * `reach` destination cells. Pure; the live `turnsElapsed` is layered on by the
 * store. `reach` uses the authored objective zone when present, else falls back to
 * breaking through to the enemy's back rank.
 */
export function objectiveContextForLevel(level: Level): ObjectiveContext {
  if (level.objective === 'survive') return { surviveTurns: DEFAULT_SURVIVE_TURNS };
  if (level.objective === 'reach') {
    const authored = level.layers.zones
      .filter((zone) => zone.type === 'objective')
      .flatMap((zone) => zone.tiles.map(([x, y]) => ({ x, y })));
    return { reachCells: authored.length ? authored : defaultReachCells(level.board) };
  }
  return {};
}
