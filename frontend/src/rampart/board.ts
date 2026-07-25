// Playfield dimensions. Original Rampart plays on a coarse tile grid roughly
// this shape; the exact arcade numbers get pulled from the ROM alongside the
// phase timers. 48x30 tiles at 20px = a 960x600 canvas, integer-scaled by CSS.

export const GRID_COLS = 48;
export const GRID_ROWS = 30;
export const TILE_PX = 20;

export function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS;
}
