import { TILE_TEMPLATE } from '../art/tileTemplate';

// The single source of truth for the board's isometric projection and centering.
// Every surface — the game board, previews, candidate review, AND the editor —
// derives tile positions and the board origin from these two functions, so no
// renderer re-implements the math and drifts (the old StudioEditableBoard had
// the headroom wrong at -27 instead of -69, which sank tiles relative to the grid).

/** Grid cell -> board-space pixel (the cell's contact-diamond centre) + paint order. */
export function boardLabCellPosition(cell: { x: number; y: number }): { left: number; top: number; zIndex: number } {
  return {
    left: (cell.x - cell.y) * TILE_TEMPLATE.stepX,
    top: (cell.x + cell.y) * TILE_TEMPLATE.stepY,
    zIndex: cell.x + cell.y,
  };
}

/** Board origin that centres the projected cells within the stage. */
export function boardLabMetrics(cells: readonly { x: number; y: number }[]): { originLeft: number; originTop: number } {
  const projectedPoints = (cells.length ? cells : [{ x: 0, y: 0 }]).map((cell) => boardLabCellPosition(cell));
  const minLeft = Math.min(...projectedPoints.map((point) => point.left - 48));
  const maxLeft = Math.max(...projectedPoints.map((point) => point.left + 48));
  // -69: tiles are anchored at their contact diamond (equator), and the 180px frame rises
  // 69px above it for 3D protrusion (standing grass, relief). Include that in the bounds.
  const minTop = Math.min(...projectedPoints.map((point) => point.top - 69));
  const maxTop = Math.max(...projectedPoints.map((point) => point.top + 140));
  const boardWidth = maxLeft - minLeft;
  const boardHeight = maxTop - minTop;
  return {
    originLeft: -minLeft - boardWidth / 2,
    originTop: -minTop - boardHeight / 2,
  };
}
