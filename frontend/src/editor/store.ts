// Level-editor store (Zustand). Edits a Level document through tools; undo/redo
// via state snapshots. The renderer is a pure projection of `level`; the editor
// only mutates `level` through paint(), which pushes the prior level onto the
// undo stack. Save/load round-trips the same JSON the game reads.

import { create } from 'zustand';
import type { PieceType, Side } from '../core/types';
import type { Level, TerrainType } from '../core/level';
import { createBlankLevel } from '../core/level';

export type EditorTool = 'terrain' | 'unit' | 'elevation' | 'erase';

const clone = (level: Level): Level => structuredClone(level);

function terrainAt(level: Level, x: number, y: number) {
  return level.layers.terrain.find((c) => c.x === x && c.y === y);
}

function applyTool(level: Level, tool: EditorTool, terrain: TerrainType, unit: { type: PieceType; side: Side }, x: number, y: number): void {
  if (tool === 'terrain') {
    const cell = terrainAt(level, x, y);
    if (cell) cell.terrain = terrain;
    else level.layers.terrain.push({ x, y, terrain, elevation: 0 });
  } else if (tool === 'elevation') {
    const cell = terrainAt(level, x, y);
    if (cell) cell.elevation = (cell.elevation + 1) % (level.board.heightLevels + 2);
  } else if (tool === 'unit') {
    level.layers.units = level.layers.units.filter((u) => !(u.x === x && u.y === y));
    level.layers.units.push({ x, y, type: unit.type, side: unit.side });
  } else if (tool === 'erase') {
    level.layers.units = level.layers.units.filter((u) => !(u.x === x && u.y === y));
  }
}

export interface EditorState {
  level: Level;
  tool: EditorTool;
  terrainBrush: TerrainType;
  unitBrush: { type: PieceType; side: Side };
  past: Level[];
  future: Level[];
  hover: { x: number; y: number } | null;
  setTool: (tool: EditorTool) => void;
  setTerrainBrush: (t: TerrainType) => void;
  setUnitBrush: (type: PieceType, side: Side) => void;
  setHover: (cell: { x: number; y: number } | null) => void;
  paint: (x: number, y: number) => void;
  undo: () => void;
  redo: () => void;
  setLevel: (level: Level) => void;
  newLevel: (cols?: number, rows?: number) => void;
}

export const useEditor = create<EditorState>((set) => ({
  level: createBlankLevel('draft', 'Untitled', 12, 8),
  tool: 'terrain',
  terrainBrush: 'grass',
  unitBrush: { type: 'knight', side: 'player' },
  past: [],
  future: [],
  hover: null,

  setTool: (tool) => set({ tool }),
  setTerrainBrush: (t) => set({ terrainBrush: t, tool: 'terrain' }),
  setUnitBrush: (type, side) => set({ unitBrush: { type, side }, tool: 'unit' }),
  setHover: (cell) => set({ hover: cell }),

  paint: (x, y) => set((s) => {
    if (x < 0 || y < 0 || x >= s.level.board.cols || y >= s.level.board.rows) return {};
    const next = clone(s.level);
    applyTool(next, s.tool, s.terrainBrush, s.unitBrush, x, y);
    return { level: next, past: [...s.past, s.level].slice(-100), future: [] };
  }),

  undo: () => set((s) => {
    if (!s.past.length) return {};
    const prev = s.past[s.past.length - 1];
    return { level: prev, past: s.past.slice(0, -1), future: [s.level, ...s.future] };
  }),

  redo: () => set((s) => {
    if (!s.future.length) return {};
    const next = s.future[0];
    return { level: next, past: [...s.past, s.level], future: s.future.slice(1) };
  }),

  setLevel: (level) => set({ level, past: [], future: [], hover: null }),

  newLevel: (cols = 12, rows = 8) => set({ level: createBlankLevel('draft', 'Untitled', cols, rows), past: [], future: [], hover: null }),
}));
