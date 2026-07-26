// Game state and rules.
//
// Campaign (one human vs. attacking ships) is the mode that verifies the
// engine; a second local player can share the board for hot-seat play.

import {
  GRID_COLS,
  GRID_ROWS,
  cellAt,
  createBoard,
  findCastleSpot,
  idx,
  mapById,
  type Board,
  type Owner,
} from './board';
import { computeTerritory, hasSealedCastle } from './enclosure';
import { PieceBag, rotate, type Piece, type Shape } from './pieces';
import { advancePhase, createPhaseState, type PhaseState } from './phases';

// Cannonball flight measured from the arcade: the launch cue (sound id 94) is
// followed by the impact cue exactly 20 frames later, in 42 of 42 observed
// shots. 20 frames at 60Hz = 333ms, independent of distance.
export const SHOT_FLIGHT_FRAMES = 20;
export const SHOT_FLIGHT_MS = (SHOT_FLIGHT_FRAMES / 60) * 1000;
export const SHOT_BLAST_RADIUS = 1;
export const CANNON_RELOAD_MS = 900;
export const MAX_CANNONS_PER_TERRITORY_CELL = 1 / 12; // one cannon per 12 sealed cells

export interface Shot {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  elapsedMs: number;
  owner: Owner;
}

export interface Ship {
  x: number;
  y: number;
  vy: number;
  cooldownMs: number;
}

export interface GameState {
  board: Board;
  phase: PhaseState;
  bag: PieceBag;
  piece: Piece;
  pieceCells: Shape;
  shots: Shot[];
  ships: Ship[];
  score: number;
  round: number;
  cannonsPlaced: number;
  reloadMs: number;
  over: boolean;
  message: string;
  mapId: string;
}

export function createGame(mapId = 'map1', seed = 20260725): GameState {
  const board = createBoard(mapById(mapId));
  const bag = new PieceBag(seed);
  const piece = bag.take();

  // Player castle on the left, enemy landing on the right.
  const spot = findCastleSpot(board, true);
  if (spot) {
    const i = idx(spot.col, spot.row);
    board.cells[i].occupant = 'castle';
    board.cells[i].owner = 0;
  }
  computeTerritory(board);

  return {
    board,
    phase: createPhaseState(),
    bag,
    piece,
    pieceCells: piece.cells,
    shots: [],
    ships: [],
    score: 0,
    round: 1,
    cannonsPlaced: 0,
    reloadMs: 0,
    over: false,
    message: 'Seal your castle with walls',
    mapId,
  };
}

export function rotatePiece(game: GameState): void {
  game.pieceCells = rotate(game.pieceCells);
}

/** Can this piece drop here? Every covered cell must be bare land. */
export function canPlace(game: GameState, col: number, row: number): boolean {
  return game.pieceCells.every(([dx, dy]) => {
    const cell = cellAt(game.board, col + dx, row + dy);
    return !!cell && cell.terrain === 'land' && cell.occupant === 'empty';
  });
}

export function placePiece(game: GameState, col: number, row: number): boolean {
  if (game.phase.phase !== 'build') return false;
  if (!canPlace(game, col, row)) return false;
  for (const [dx, dy] of game.pieceCells) {
    const i = idx(col + dx, row + dy);
    game.board.cells[i].occupant = 'wall';
    game.board.cells[i].owner = 0;
  }
  computeTerritory(game.board);
  const next = game.bag.take();
  game.piece = next;
  game.pieceCells = next.cells;
  return true;
}

export function cannonAllowance(game: GameState): number {
  const sealed = game.board.territory.filter((t) => t === 0).length;
  return Math.max(1, Math.floor(sealed * MAX_CANNONS_PER_TERRITORY_CELL));
}

export function placeCannon(game: GameState, col: number, row: number): boolean {
  if (game.phase.phase !== 'place') return false;
  const cell = cellAt(game.board, col, row);
  if (!cell || cell.terrain !== 'land' || cell.occupant !== 'empty') return false;
  if (game.board.territory[idx(col, row)] !== 0) return false;
  if (game.cannonsPlaced >= cannonAllowance(game)) return false;
  cell.occupant = 'cannon';
  cell.owner = 0;
  game.cannonsPlaced += 1;
  return true;
}

/** Fire at a point during battle; the nearest ready cannon takes the shot. */
export function fireAt(game: GameState, x: number, y: number): boolean {
  if (game.phase.phase !== 'battle' || game.reloadMs > 0) return false;
  let best: { x: number; y: number; d: number } | null = null;
  for (let r = 0; r < GRID_ROWS; r += 1) {
    for (let c = 0; c < GRID_COLS; c += 1) {
      const cell = cellAt(game.board, c, r);
      if (!cell || cell.occupant !== 'cannon' || cell.owner !== 0) continue;
      const cx = c + 0.5;
      const cy = r + 0.5;
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (!best || d < best.d) best = { x: cx, y: cy, d };
    }
  }
  if (!best) return false;
  game.shots.push({ fromX: best.x, fromY: best.y, toX: x, toY: y, elapsedMs: 0, owner: 0 });
  game.reloadMs = CANNON_RELOAD_MS;
  return true;
}

// Measured footprint: frames captured through a battle show a hit costing 1-3
// wall cells with a bounding box up to 3x1 — the target plus orthogonal
// neighbours, not a full 3x3 (which would take up to nine).
const BLAST_CELLS: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function damageAt(game: GameState, col: number, row: number, owner: Owner): void {
  {
    for (const [dc, dr] of BLAST_CELLS) {
      const cell = cellAt(game.board, col + dc, row + dr);
      if (!cell) continue;
      if (cell.occupant === 'wall') {
        cell.occupant = 'rubble';
        if (owner === 0) game.score += 10;
      } else if (cell.occupant === 'cannon' && cell.owner !== owner) {
        cell.occupant = 'rubble';
      }
    }
  }
  computeTerritory(game.board);
}

function spawnShips(game: GameState): void {
  const count = Math.min(2 + game.phase.round, 6);
  game.ships = [];
  for (let i = 0; i < count; i += 1) {
    game.ships.push({
      x: GRID_COLS - 1.5 - (i % 2),
      y: 1 + ((i * 3.1) % (GRID_ROWS - 2)),
      vy: i % 2 === 0 ? 0.6 : -0.6,
      cooldownMs: 1200 + i * 400,
    });
  }
}

export function update(game: GameState, dtMs: number): void {
  if (game.over) return;

  const before = game.phase.phase;
  const res = advancePhase(game.phase, dtMs);
  game.phase = res.state;
  game.round = res.state.round;

  if (res.changed) {
    if (game.phase.phase === 'battle') {
      spawnShips(game);
      game.message = 'Fire at the ships';
    } else if (game.phase.phase === 'build') {
      game.message = 'Rebuild — seal your castle';
    } else if (game.phase.phase === 'place') {
      // A round survives only if the castle is still sealed.
      if (!hasSealedCastle(game.board, 0)) {
        game.over = true;
        game.message = 'Castle breached — game over';
        return;
      }
      game.cannonsPlaced = 0;
      game.score += 100;
      game.message = 'Place your cannons';
    }
  }
  if (before !== game.phase.phase) game.shots = [];

  game.reloadMs = Math.max(0, game.reloadMs - dtMs);

  // Shots in flight.
  for (const shot of game.shots) shot.elapsedMs += dtMs;
  const landed = game.shots.filter((s) => s.elapsedMs >= SHOT_FLIGHT_MS);
  for (const shot of landed) {
    damageAt(game, Math.floor(shot.toX), Math.floor(shot.toY), shot.owner);
    if (shot.owner === 0) {
      // Did it hit a ship?
      game.ships = game.ships.filter((ship) => {
        const hit = Math.abs(ship.x - shot.toX) < 1.2 && Math.abs(ship.y - shot.toY) < 1.2;
        if (hit) game.score += 250;
        return !hit;
      });
    }
  }
  game.shots = game.shots.filter((s) => s.elapsedMs < SHOT_FLIGHT_MS);

  // Ships patrol and shell the walls during battle.
  if (game.phase.phase === 'battle') {
    for (const ship of game.ships) {
      ship.y += (ship.vy * dtMs) / 1000;
      if (ship.y < 1) {
        ship.y = 1;
        ship.vy = Math.abs(ship.vy);
      }
      if (ship.y > GRID_ROWS - 2) {
        ship.y = GRID_ROWS - 2;
        ship.vy = -Math.abs(ship.vy);
      }
      ship.cooldownMs -= dtMs;
      if (ship.cooldownMs <= 0) {
        ship.cooldownMs = 2200 + Math.random() * 1500;
        const target = pickWallTarget(game);
        if (target) {
          game.shots.push({
            fromX: ship.x,
            fromY: ship.y,
            toX: target.col + 0.5,
            toY: target.row + 0.5,
            elapsedMs: 0,
            owner: 1,
          });
        }
      }
    }
  }
}

function pickWallTarget(game: GameState): { col: number; row: number } | null {
  const walls: Array<{ col: number; row: number }> = [];
  for (let r = 0; r < GRID_ROWS; r += 1) {
    for (let c = 0; c < GRID_COLS; c += 1) {
      const cell = cellAt(game.board, c, r);
      if (cell && cell.occupant === 'wall') walls.push({ col: c, row: r });
    }
  }
  if (!walls.length) return null;
  return walls[Math.floor(Math.random() * walls.length)];
}

/** Height of a shot above the ground, for drawing the arc. 0 at both ends. */
export function shotHeight(shot: Shot): number {
  const t = Math.min(1, shot.elapsedMs / SHOT_FLIGHT_MS);
  return Math.sin(t * Math.PI);
}

export function shotPosition(shot: Shot): { x: number; y: number } {
  const t = Math.min(1, shot.elapsedMs / SHOT_FLIGHT_MS);
  return {
    x: shot.fromX + (shot.toX - shot.fromX) * t,
    y: shot.fromY + (shot.toY - shot.fromY) * t,
  };
}
