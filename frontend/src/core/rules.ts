// The rules engine: pure functions over game state. Ported faithfully from the
// legacy app.js implementation (pawn/knight/bishop/queen movement, rocks as
// obstacles, side-based pawns, threat = enemy attacked squares, capture/promote/
// last-side-standing) — but deterministic and immutable.

import type { BoardSize, EnemyIntent, GameEvent, GameState, LastMove, Move, Piece, PieceType, Side, Vec, Winner } from './types';
import type { Rng } from './rng';
import { canTraverse, elevationAt, type TerrainIndex } from './terrain';
import { facingFromDelta } from './pieces';

const KNIGHT: ReadonlyArray<readonly [number, number]> = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1],
];
const DIAG: ReadonlyArray<readonly [number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTHO: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ALL8: ReadonlyArray<readonly [number, number]> = [...ORTHO, ...DIAG];

const isObstacle = (p: Piece): boolean => p.type === 'rock' || p.type === 'random-rock';

/** Current hit points, defaulting to 1 so unset pieces keep single-hit capture. */
export function pieceHp(piece: Piece): number {
  return piece.hp ?? 1;
}

/** Hit-point capacity (for HUD/board bars); defaults to current hp. */
export function pieceMaxHp(piece: Piece): number {
  return piece.maxHp ?? piece.hp ?? 1;
}

/** Action points available this turn; defaults to 1 (classic single action). */
export function pieceAp(piece: Piece): number {
  return piece.ap ?? 1;
}

/** Action-point capacity, refreshed at the owner's turn start; defaults to ap. */
export function pieceMaxAp(piece: Piece): number {
  return piece.maxAp ?? piece.ap ?? 1;
}

/** True while `side` has any living piece with action points left to spend. */
export function sideHasAp(state: GameState, side: Side): boolean {
  return livingPieces(state.pieces, side).some((p) => pieceAp(p) > 0);
}

/** Relative worth, used to rank enemy targets when forecasting intents. */
const PIECE_VALUE: Record<PieceType, number> = {
  pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100, rock: 0, 'random-rock': 0,
};

const manhattan = (a: Vec, b: Vec): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function inBounds(x: number, y: number, size: BoardSize): boolean {
  return x >= 0 && x < size.cols && y >= 0 && y < size.rows;
}

export function pieceAt(pieces: readonly Piece[], x: number, y: number): Piece | null {
  return pieces.find((p) => p.alive && p.x === x && p.y === y) ?? null;
}

export function livingPieces(pieces: readonly Piece[], side: Side): Piece[] {
  return pieces.filter((p) => p.side === side && p.alive);
}

/** A target is capturable iff it's a non-obstacle, non-neutral opposing piece. */
export function isEnemy(piece: Piece, target: Piece | null): boolean {
  if (!target) return false;
  if (target.type === 'rock' || target.side === 'neutral') return false;
  return target.side !== piece.side;
}

/**
 * Optional movement environment. When `terrain` is supplied, impassable tiles
 * (cliff/rock) and un-climbable elevation rises block movement — a terrain
 * wall stops a ray and removes a step. Omitting it reproduces pure chess
 * movement, so every existing caller is unaffected.
 */
export interface MoveEnv {
  terrain?: TerrainIndex;
  lastMove?: LastMove;
}

/** Whether terrain in `env` forbids moving into (x, y) from `originElev`. */
function blockedByTerrain(env: MoveEnv | undefined, originElev: number, x: number, y: number): boolean {
  return !!env?.terrain && !canTraverse(env.terrain, originElev, x, y);
}

function rayMoves(piece: Piece, pieces: readonly Piece[], size: BoardSize, dirs: ReadonlyArray<readonly [number, number]>, env: MoveEnv | undefined, originElev: number): Move[] {
  const moves: Move[] = [];
  for (const [dx, dy] of dirs) {
    for (let step = 1; ; step += 1) {
      const x = piece.x + dx * step;
      const y = piece.y + dy * step;
      if (!inBounds(x, y, size)) break;
      if (blockedByTerrain(env, originElev, x, y)) break; // terrain wall ends the ray
      const occ = pieceAt(pieces, x, y);
      if (occ) {
        if (isEnemy(piece, occ)) moves.push({ x, y, capture: occ.id });
        break;
      }
      moves.push({ x, y });
    }
  }
  return moves;
}

function stepMoves(piece: Piece, pieces: readonly Piece[], size: BoardSize, deltas: ReadonlyArray<readonly [number, number]>, env: MoveEnv | undefined, originElev: number): Move[] {
  const moves: Move[] = [];
  for (const [dx, dy] of deltas) {
    const x = piece.x + dx;
    const y = piece.y + dy;
    if (!inBounds(x, y, size)) continue;
    if (blockedByTerrain(env, originElev, x, y)) continue;
    const occ = pieceAt(pieces, x, y);
    if (!occ) {
      moves.push({ x, y });
    } else if (isEnemy(piece, occ)) {
      moves.push({ x, y, capture: occ.id });
    }
  }
  return moves;
}

function pawnMoves(piece: Piece, pieces: readonly Piece[], size: BoardSize, env: MoveEnv | undefined, originElev: number): Move[] {
  const dir = piece.side === 'player' ? -1 : 1;
  const moves: Move[] = [];
  const oneY = piece.y + dir;
  if (inBounds(piece.x, oneY, size) && !pieceAt(pieces, piece.x, oneY) && !blockedByTerrain(env, originElev, piece.x, oneY)) {
    moves.push({ x: piece.x, y: oneY });
    const twoY = piece.y + dir * 2;
    if (piece.y === piece.startY && inBounds(piece.x, twoY, size) && !pieceAt(pieces, piece.x, twoY) && !blockedByTerrain(env, originElev, piece.x, twoY)) {
      moves.push({ x: piece.x, y: twoY });
    }
  }
  for (const dx of [-1, 1]) {
    const x = piece.x + dx;
    const y = piece.y + dir;
    if (!inBounds(x, y, size)) continue;
    if (blockedByTerrain(env, originElev, x, y)) continue;
    const occ = pieceAt(pieces, x, y);
    if (isEnemy(piece, occ)) moves.push({ x, y, capture: occ!.id });
  }

  const last = env?.lastMove;
  if (
    last?.pieceType === 'pawn' &&
    last.side !== piece.side &&
    Math.abs(last.from.y - last.to.y) === 2 &&
    last.to.y === piece.y &&
    Math.abs(last.to.x - piece.x) === 1
  ) {
    const x = last.to.x;
    const y = piece.y + dir;
    if (inBounds(x, y, size) && !pieceAt(pieces, x, y) && !blockedByTerrain(env, originElev, x, y)) {
      moves.push({ x, y, capture: last.pieceId, enPassant: true });
    }
  }
  return moves;
}

/**
 * All legal destinations for a piece (excludes obstacles, which never move).
 * Pass `env.terrain` to apply terrain movement effects (cliff/rock barriers and
 * elevation limits); omit it for pure chess movement. Water is passable.
 */
export function legalMoves(piece: Piece, pieces: readonly Piece[], size: BoardSize, env?: MoveEnv): Move[] {
  if (!piece || !piece.alive || isObstacle(piece)) return [];
  const originElev = env?.terrain ? elevationAt(env.terrain, piece.x, piece.y) : 0;
  switch (piece.type) {
    case 'pawn': return pawnMoves(piece, pieces, size, env, originElev);
    case 'knight': return stepMoves(piece, pieces, size, KNIGHT, env, originElev);
    case 'bishop': return rayMoves(piece, pieces, size, DIAG, env, originElev);
    case 'rook': return rayMoves(piece, pieces, size, ORTHO, env, originElev);
    case 'queen': return rayMoves(piece, pieces, size, ALL8, env, originElev);
    case 'king': return stepMoves(piece, pieces, size, ALL8, env, originElev);
    default: return [];
  }
}

/** Squares a piece threatens (basis for the enemy threat telegraph overlay). */
export function attackedSquares(piece: Piece, pieces: readonly Piece[], size: BoardSize): Vec[] {
  if (!piece || !piece.alive || isObstacle(piece)) return [];
  if (piece.type === 'pawn') {
    const dir = piece.side === 'player' ? -1 : 1;
    const out: Vec[] = [];
    for (const dx of [-1, 1]) {
      const x = piece.x + dx;
      const y = piece.y + dir;
      if (inBounds(x, y, size)) out.push({ x, y });
    }
    return out;
  }
  if (piece.type === 'knight') {
    return KNIGHT.map(([dx, dy]) => ({ x: piece.x + dx, y: piece.y + dy })).filter((p) => inBounds(p.x, p.y, size));
  }
  if (piece.type === 'king') {
    return ALL8.map(([dx, dy]) => ({ x: piece.x + dx, y: piece.y + dy })).filter((p) => inBounds(p.x, p.y, size));
  }
  const dirs = piece.type === 'bishop' ? DIAG : piece.type === 'rook' ? ORTHO : ALL8;
  const out: Vec[] = [];
  for (const [dx, dy] of dirs) {
    for (let step = 1; ; step += 1) {
      const x = piece.x + dx * step;
      const y = piece.y + dy * step;
      if (!inBounds(x, y, size)) break;
      out.push({ x, y });
      if (pieceAt(pieces, x, y)) break;
    }
  }
  return out;
}

/** True when any living `bySide` piece attacks the square `sq` on this board. */
function squareAttackedBy(sq: Vec, bySide: Side, pieces: readonly Piece[], size: BoardSize): boolean {
  for (const p of pieces) {
    if (!p.alive || p.side !== bySide || isObstacle(p)) continue;
    for (const a of attackedSquares(p, pieces, size)) {
      if (a.x === sq.x && a.y === sq.y) return true;
    }
  }
  return false;
}

/** Ids of the opponents of `p` that currently sit on a square `p` attacks. */
function opponentsUnderAttackBy(p: Piece, pieces: readonly Piece[], size: BoardSize): Set<string> {
  const ids = new Set<string>();
  for (const sq of attackedSquares(p, pieces, size)) {
    const t = pieceAt(pieces, sq.x, sq.y);
    if (t && t.alive && t.side !== p.side && !isObstacle(t)) ids.add(t.id);
  }
  return ids;
}

/** Union of every living enemy's attacked squares. */
export function enemyThreats(pieces: readonly Piece[], size: BoardSize): Vec[] {
  const map = new Map<string, Vec>();
  for (const p of livingPieces(pieces, 'enemy')) {
    for (const sq of attackedSquares(p, pieces, size)) map.set(`${sq.x},${sq.y}`, sq);
  }
  return [...map.values()];
}

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

export interface ApplyOptions {
  /**
   * Enable the action-point turn model: each action spends 1 AP from the acting
   * piece and the turn only hands off once the acting side has no AP left, at
   * which point the incoming side's AP refreshes to `maxAp`. Off by default, so
   * the classic alternating one-move-per-turn flow is unchanged.
   */
  ap?: boolean;
}

/**
 * Apply a move to the state, returning a NEW state plus the events it produced.
 * Handles capture, pawn promotion, victory (last side standing), and turn
 * hand-off. Pure: the input state is never mutated.
 */
export function applyMove(state: GameState, pieceId: string, move: Move, opts: ApplyOptions = {}): ApplyResult {
  const events: GameEvent[] = [];
  const pieces = state.pieces.map((p) => ({ ...p }));
  const piece = pieces.find((p) => p.id === pieceId && p.alive);
  if (!piece) return { state, events };

  const from: Vec = { x: piece.x, y: piece.y };
  const movedPieceType = piece.type;

  // Service-record bookkeeping: only player/enemy units accrue stats, and only
  // from this (committed) move. Snapshot the threat picture BEFORE the move while
  // the piece still sits on `from`.
  const tracksStats = piece.side === 'player' || piece.side === 'enemy';
  const opponentSide: Side | null = piece.side === 'player' ? 'enemy' : piece.side === 'enemy' ? 'player' : null;
  const escapedThreat = tracksStats && opponentSide
    ? squareAttackedBy(from, opponentSide, state.pieces, state.size)
    : false;
  const threatenedBefore = tracksStats
    ? opponentsUnderAttackBy(piece, state.pieces, state.size)
    : new Set<string>();

  const nextFacing = facingFromDelta(move.x - from.x, move.y - from.y);
  if (nextFacing) piece.facing = nextFacing;
  const capturedId = move.capture ?? pieceAt(pieces, move.x, move.y)?.id;
  // Attacker displaces onto the target square only when the target dies. With
  // hp > 1 the target survives the hit and the attacker stays put (an
  // attack-in-place). For the default hp of 1 this collapses to classic capture.
  let displaced = true;
  if (capturedId) {
    const target = pieces.find((p) => p.id === capturedId);
    if (target && target.side !== piece.side && !isObstacle(target)) {
      const damage = 1;
      const remaining = pieceHp(target) - damage;
      if (remaining > 0) {
        target.hp = remaining;
        displaced = false;
        events.push({ kind: 'damaged', pieceId: target.id, by: piece.id, amount: damage, hp: remaining });
      } else {
        target.alive = false;
        target.hp = 0;
        if (tracksStats) piece.enemiesKilled = (piece.enemiesKilled ?? 0) + 1;
        events.push({ kind: 'captured', pieceId: target.id, by: piece.id });
      }
    }
  }

  if (displaced) {
    piece.x = move.x;
    piece.y = move.y;
    events.push({ kind: 'moved', pieceId: piece.id, from, to: { x: move.x, y: move.y } });

    if (piece.type === 'pawn') {
      const farRank = piece.side === 'player' ? 0 : state.size.rows - 1;
      if (piece.y === farRank) {
        piece.type = 'queen';
        events.push({ kind: 'promoted', pieceId: piece.id, to: 'queen' });
      }
    }
  }

  // Tally the service record now that the piece sits at its final square.
  if (tracksStats) {
    piece.timesUsed = (piece.timesUsed ?? 0) + 1;
    if (displaced) {
      const dx = Math.abs(piece.x - from.x);
      const dy = Math.abs(piece.y - from.y);
      const diagonal = Math.min(dx, dy);
      const straight = Math.abs(dx - dy);
      piece.squaresTraveled = (piece.squaresTraveled ?? 0) + diagonal * 1.5 + straight;
      if (escapedThreat) piece.escapes = (piece.escapes ?? 0) + 1;
    }
    // Opponents this piece newly placed under attack (in its post-move position).
    const threatenedAfter = opponentsUnderAttackBy(piece, pieces, state.size);
    let newlyThreatened = 0;
    for (const id of threatenedAfter) if (!threatenedBefore.has(id)) newlyThreatened += 1;
    if (newlyThreatened > 0) piece.threatsMade = (piece.threatsMade ?? 0) + newlyThreatened;
  }

  // Spend an action point in AP mode (an attack-in-place still costs an action).
  if (opts.ap) piece.ap = Math.max(0, pieceAp(piece) - 1);

  let winner: Winner = state.winner;
  let turn = state.turn;
  const players = livingPieces(pieces, 'player').length;
  const enemies = livingPieces(pieces, 'enemy').length;
  if (!players || !enemies) {
    winner = players ? 'player' : 'enemy';
    turn = 'done';
    events.push({ kind: 'victory', winner });
  } else if (piece.side === 'player' || piece.side === 'enemy') {
    const other: Side = piece.side === 'player' ? 'enemy' : 'player';
    // AP mode: the acting side keeps the turn while it still has AP to spend;
    // otherwise hand off and refresh the incoming side to full AP.
    if (opts.ap && livingPieces(pieces, piece.side).some((p) => pieceAp(p) > 0)) {
      turn = piece.side;
    } else {
      turn = other;
      if (opts.ap) {
        for (const p of pieces) if (p.side === other && p.alive) p.ap = pieceMaxAp(p);
      }
    }
  }

  const lastMove: LastMove | undefined = displaced
    ? { pieceId: piece.id, pieceType: movedPieceType, side: piece.side, from, to: { x: piece.x, y: piece.y } }
    : state.lastMove;

  return { state: { ...state, pieces, winner, turn, lastMove }, events };
}

/**
 * Deterministic enemy AI: prefer a capturing move, otherwise any legal move;
 * choices drawn from the injected seeded RNG. Returns null if the enemy is
 * stuck. (Matches the legacy capture-greedy behaviour.)
 */
export function enemyMove(state: GameState, rng: Rng, env?: MoveEnv): { pieceId: string; move: Move } | null {
  const candidates = livingPieces(state.pieces, 'enemy')
    .map((p) => ({ piece: p, moves: legalMoves(p, state.pieces, state.size, env) }))
    .filter((e) => e.moves.length > 0);
  if (!candidates.length) return null;

  const captureEntries = candidates
    .map((e) => ({ piece: e.piece, moves: e.moves.filter((m) => m.capture) }))
    .filter((e) => e.moves.length > 0);

  const pool = captureEntries.length ? captureEntries : candidates;
  const entry = rng.pick(pool);
  const move = rng.pick(entry.moves);
  return { pieceId: entry.piece.id, move };
}

/**
 * Pick an enemy's next move deterministically (no RNG): take the highest-value
 * capture, else the move that closes distance to the nearest living player.
 * Stable tie-breaks (target value, then board position) so a telegraph computed
 * now matches deterministic execution later.
 */
export function chooseEnemyMove(piece: Piece, moves: readonly Move[], state: GameState): Move | null {
  if (!moves.length) return null;
  const valueOf = (m: Move): number => {
    if (!m.capture) return -1;
    const t = state.pieces.find((p) => p.id === m.capture);
    return t ? PIECE_VALUE[t.type] : -1;
  };
  const captures = moves.filter((m) => m.capture);
  if (captures.length) {
    return [...captures].sort((a, b) => valueOf(b) - valueOf(a) || a.y - b.y || a.x - b.x)[0];
  }
  const players = livingPieces(state.pieces, 'player').map((p) => ({ x: p.x, y: p.y }));
  const distOf = (m: Move): number => (players.length
    ? Math.min(...players.map((p) => manhattan({ x: m.x, y: m.y }, p)))
    : 0);
  return [...moves].sort((a, b) => distOf(a) - distOf(b) || a.y - b.y || a.x - b.x)[0];
}

/**
 * Telegraph every living enemy's intended next action — the signature
 * "forecast the queued attack a turn ahead" overlay. Deterministic, so the
 * preview the player sees is exactly what a deterministic enemy turn executes.
 */
export function forecastEnemyIntents(state: GameState, env?: MoveEnv): EnemyIntent[] {
  const intents: EnemyIntent[] = [];
  for (const piece of livingPieces(state.pieces, 'enemy')) {
    const move = chooseEnemyMove(piece, legalMoves(piece, state.pieces, state.size, env), state);
    if (!move) continue;
    const from: Vec = { x: piece.x, y: piece.y };
    const targetId = move.capture ?? pieceAt(state.pieces, move.x, move.y)?.id;
    const target = targetId ? state.pieces.find((p) => p.id === targetId && p.side !== piece.side) : null;
    intents.push(target
      ? { pieceId: piece.id, from, to: { x: move.x, y: move.y }, kind: 'attack', targetId: target.id, damage: 1 }
      : { pieceId: piece.id, from, to: { x: move.x, y: move.y }, kind: 'move' });
  }
  return intents;
}

/** State with `intents` recomputed — the enemy's telegraphed upcoming turn. */
export function withForecast(state: GameState, env?: MoveEnv): GameState {
  return { ...state, intents: forecastEnemyIntents(state, env) };
}

/** Refresh a side's living pieces to full AP (start-of-turn). Pure. */
export function refreshAp(state: GameState, side: Side): GameState {
  const pieces = state.pieces.map((p) => (p.side === side && p.alive ? { ...p, ap: pieceMaxAp(p) } : p));
  return { ...state, pieces };
}

/**
 * Force the turn to the other side and refresh that side's AP. For AP levels
 * where the active side ends early or has no legal action left (the AP apply
 * path keeps the turn until AP is exhausted, so the store calls this to break
 * out when the side is stuck). Pure; no-op once the game is over.
 */
export function endTurn(state: GameState): GameState {
  if (state.turn !== 'player' && state.turn !== 'enemy') return state;
  const other: Side = state.turn === 'player' ? 'enemy' : 'player';
  return refreshAp({ ...state, turn: other }, other);
}
