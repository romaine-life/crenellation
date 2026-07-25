// The playfield.
//
// Measured from the arcade: the visible screen is 336x240 and walls sit on a
// 16px grid, so the play area is 21x15 cells. Terrain comes from the ROM maps
// (romlab/out/maps_final) downsampled to that grid.

import { MAPS, MAP_COLS, MAP_ROWS, type RampartMap } from './maps';

export const GRID_COLS = MAP_COLS;
export const GRID_ROWS = MAP_ROWS;
export const TILE_PX = 16;
export const BOARD_W = GRID_COLS * TILE_PX;
export const BOARD_H = GRID_ROWS * TILE_PX;

export type Terrain = 'land' | 'water';
export type Occupant = 'empty' | 'wall' | 'rubble' | 'castle' | 'cannon';
export type Owner = 0 | 1 | null;

export interface Cell {
  terrain: Terrain;
  occupant: Occupant;
  owner: Owner;
}

export interface Board {
  cols: number;
  rows: number;
  cells: Cell[];
  /** Cells sealed inside each player's walls, recomputed after every build. */
  territory: (Owner)[];
}

export function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS;
}

export function idx(col: number, row: number): number {
  return row * GRID_COLS + col;
}

export function cellAt(board: Board, col: number, row: number): Cell | null {
  if (!inBounds(col, row)) return null;
  return board.cells[idx(col, row)];
}

export function createBoard(map: RampartMap): Board {
  const cells: Cell[] = [];
  for (let r = 0; r < GRID_ROWS; r += 1) {
    const row = map.rows[r] ?? '';
    for (let c = 0; c < GRID_COLS; c += 1) {
      cells.push({
        terrain: row[c] === '~' ? 'water' : 'land',
        occupant: 'empty',
        owner: null,
      });
    }
  }
  return { cols: GRID_COLS, rows: GRID_ROWS, cells, territory: cells.map(() => null) };
}

export function mapById(id: string): RampartMap {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

export { MAPS };

/** Land cells with nothing on them, clear of the given radius around edges. */
export function findCastleSpot(board: Board, preferLeft: boolean): { col: number; row: number } | null {
  const midRow = Math.floor(GRID_ROWS / 2);
  const order: number[] = [];
  for (let d = 0; d < GRID_ROWS; d += 1) {
    if (midRow - d >= 0) order.push(midRow - d);
    if (midRow + d < GRID_ROWS) order.push(midRow + d);
  }
  const cols = preferLeft
    ? Array.from({ length: GRID_COLS }, (_, i) => i)
    : Array.from({ length: GRID_COLS }, (_, i) => GRID_COLS - 1 - i);
  for (const row of order) {
    for (const col of cols) {
      if (col < 2 || col > GRID_COLS - 3 || row < 2 || row > GRID_ROWS - 3) continue;
      let ok = true;
      for (let dr = -1; dr <= 1 && ok; dr += 1) {
        for (let dc = -1; dc <= 1 && ok; dc += 1) {
          const cell = cellAt(board, col + dc, row + dr);
          if (!cell || cell.terrain !== 'land' || cell.occupant !== 'empty') ok = false;
        }
      }
      if (ok) return { col, row };
    }
  }
  return null;
}
