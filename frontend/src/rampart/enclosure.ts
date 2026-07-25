// Enclosure — the heart of Rampart.
//
// A castle is sealed when no path exists from outside the map to it. So flood
// fill inward from every edge cell, passing through anything that is NOT a
// wall; whatever the flood cannot reach is enclosed. Water does not block:
// you can wall across a river, and the sea is open unless walled.

import { GRID_COLS, GRID_ROWS, idx, type Board, type Owner } from './board';

/** Cells reachable from outside the map without crossing a wall. */
export function floodFromEdges(board: Board): boolean[] {
  const open = new Array<boolean>(GRID_COLS * GRID_ROWS).fill(false);
  const stack: number[] = [];

  const push = (c: number, r: number) => {
    if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) return;
    const i = idx(c, r);
    if (open[i]) return;
    const cell = board.cells[i];
    // Walls and castles block; rubble does not (a broken wall leaks).
    if (cell.occupant === 'wall' || cell.occupant === 'castle') return;
    open[i] = true;
    stack.push(i);
  };

  for (let c = 0; c < GRID_COLS; c += 1) {
    push(c, 0);
    push(c, GRID_ROWS - 1);
  }
  for (let r = 0; r < GRID_ROWS; r += 1) {
    push(0, r);
    push(GRID_COLS - 1, r);
  }

  while (stack.length) {
    const i = stack.pop() as number;
    const c = i % GRID_COLS;
    const r = Math.floor(i / GRID_COLS);
    push(c + 1, r);
    push(c - 1, r);
    push(c, r + 1);
    push(c, r - 1);
  }
  return open;
}

/**
 * Recompute territory. A region is a player's territory when it is unreachable
 * from outside AND contains at least one of that player's castles.
 */
export function computeTerritory(board: Board): { territory: Owner[]; sealed: Map<Owner, number> } {
  const open = floodFromEdges(board);
  const territory = new Array<Owner>(GRID_COLS * GRID_ROWS).fill(null);
  const sealed = new Map<Owner, number>();

  const seen = new Array<boolean>(GRID_COLS * GRID_ROWS).fill(false);
  for (let start = 0; start < board.cells.length; start += 1) {
    if (open[start] || seen[start]) continue;
    const cell = board.cells[start];
    if (cell.occupant === 'wall') continue;

    // Collect this sealed region and find whose castle (if any) is inside.
    const region: number[] = [];
    const stack = [start];
    seen[start] = true;
    let owner: Owner = null;
    while (stack.length) {
      const i = stack.pop() as number;
      region.push(i);
      const cc = board.cells[i];
      if (cc.occupant === 'castle' && cc.owner !== null) owner = cc.owner;
      const c = i % GRID_COLS;
      const r = Math.floor(i / GRID_COLS);
      const nbrs = [
        [c + 1, r],
        [c - 1, r],
        [c, r + 1],
        [c, r - 1],
      ];
      for (const [nc, nr] of nbrs) {
        if (nc < 0 || nc >= GRID_COLS || nr < 0 || nr >= GRID_ROWS) continue;
        const j = idx(nc, nr);
        if (seen[j] || open[j]) continue;
        if (board.cells[j].occupant === 'wall') continue;
        seen[j] = true;
        stack.push(j);
      }
    }

    if (owner !== null) {
      for (const i of region) territory[i] = owner;
      sealed.set(owner, (sealed.get(owner) ?? 0) + region.length);
    }
  }

  board.territory = territory;
  return { territory, sealed };
}

/** Does this player hold at least one sealed castle? Losing this ends their game. */
export function hasSealedCastle(board: Board, player: Owner): boolean {
  for (let i = 0; i < board.cells.length; i += 1) {
    const cell = board.cells[i];
    if (cell.occupant === 'castle' && cell.owner === player && board.territory[i] === player) {
      return true;
    }
  }
  return false;
}
