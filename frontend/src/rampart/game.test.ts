import { describe, expect, it } from 'vitest';
import {
  SHOT_FLIGHT_MS,
  canPlace,
  cannonAllowance,
  createGame,
  fireAt,
  placeCannon,
  placePiece,
  update,
} from './game';
import { PHASE_DURATIONS_MS } from './phases';
import { GRID_COLS, GRID_ROWS, cellAt, idx } from './board';
import { computeTerritory, floodFromEdges, hasSealedCastle } from './enclosure';

/** Ring a castle with walls so it is sealed, the way a player would. */
function sealCastle(game: ReturnType<typeof createGame>) {
  let cc = -1;
  let cr = -1;
  for (let r = 0; r < GRID_ROWS; r += 1) {
    for (let c = 0; c < GRID_COLS; c += 1) {
      if (cellAt(game.board, c, r)?.occupant === 'castle') {
        cc = c;
        cr = r;
      }
    }
  }
  expect(cc).toBeGreaterThanOrEqual(0);
  for (let dr = -2; dr <= 2; dr += 1) {
    for (let dc = -2; dc <= 2; dc += 1) {
      if (Math.abs(dr) !== 2 && Math.abs(dc) !== 2) continue;
      const cell = cellAt(game.board, cc + dc, cr + dr);
      if (cell && (cell.occupant === 'empty' || cell.occupant === 'rubble')) {
        cell.occupant = 'wall';
        cell.owner = 0;
      }
    }
  }
  computeTerritory(game.board);
  return { cc, cr };
}

describe('enclosure', () => {
  it('treats the map edge as open and a ringed castle as sealed', () => {
    const game = createGame('map1');
    expect(hasSealedCastle(game.board, 0)).toBe(false);
    sealCastle(game);
    expect(hasSealedCastle(game.board, 0)).toBe(true);
  });

  it('reopens when the ring is broken', () => {
    const game = createGame('map1');
    const { cc, cr } = sealCastle(game);
    expect(hasSealedCastle(game.board, 0)).toBe(true);
    // Knock a hole in the ring; rubble does not block, so the flood gets in.
    const gap = cellAt(game.board, cc + 2, cr);
    if (gap) gap.occupant = 'rubble';
    computeTerritory(game.board);
    expect(hasSealedCastle(game.board, 0)).toBe(false);
  });

  it('never marks an edge cell as territory', () => {
    const game = createGame('map1');
    sealCastle(game);
    const open = floodFromEdges(game.board);
    for (let c = 0; c < GRID_COLS; c += 1) {
      expect(game.board.territory[idx(c, 0)]).toBeNull();
      expect(open[idx(c, 0)]).toBe(true);
    }
  });
});

describe('campaign round', () => {
  it('plays place -> battle -> build and survives a sealed castle', () => {
    const game = createGame('map1');
    sealCastle(game);

    // Cannons may only go inside sealed territory.
    expect(cannonAllowance(game)).toBeGreaterThan(0);
    let placed = false;
    for (let r = 0; r < GRID_ROWS && !placed; r += 1) {
      for (let c = 0; c < GRID_COLS && !placed; c += 1) {
        if (game.board.territory[idx(c, r)] === 0) placed = placeCannon(game, c, r);
      }
    }
    expect(placed).toBe(true);

    // Into battle: a shot lands after the measured flight time and does damage.
    update(game, PHASE_DURATIONS_MS.place);
    expect(game.phase.phase).toBe('battle');
    expect(game.ships.length).toBeGreaterThan(0);
    expect(fireAt(game, 5.5, 5.5)).toBe(true);
    // Ships shell the walls too, so count only the player's own shot.
    expect(game.shots.filter((s) => s.owner === 0).length).toBe(1);
    update(game, SHOT_FLIGHT_MS + 20);
    expect(game.shots.filter((s) => s.owner === 0).length).toBe(0);

    // Into build: a piece can be dropped on bare land.
    update(game, PHASE_DURATIONS_MS.battle);
    expect(game.phase.phase).toBe('build');
    let built = false;
    for (let r = 0; r < GRID_ROWS && !built; r += 1) {
      for (let c = 0; c < GRID_COLS && !built; c += 1) {
        if (canPlace(game, c, r)) built = placePiece(game, c, r);
      }
    }
    expect(built).toBe(true);

    // Ships breach the ring during battle, so repair it before the boundary -
    // failing to re-seal is what ends a run.
    sealCastle(game);
    expect(hasSealedCastle(game.board, 0)).toBe(true);

    // Round rolls over and the game continues while the castle holds.
    update(game, PHASE_DURATIONS_MS.build);
    expect(game.phase.round).toBe(2);
    expect(game.over).toBe(false);
    expect(game.score).toBeGreaterThan(0);
  });

  it('ends the game when the castle is not sealed at the round boundary', () => {
    const game = createGame('map1');
    update(game, PHASE_DURATIONS_MS.place + PHASE_DURATIONS_MS.battle + PHASE_DURATIONS_MS.build);
    expect(game.over).toBe(true);
  });
});
