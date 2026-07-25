// Skirmish VIEW state (Zustand) — board-view preferences only, kept OUT of the
// game store (which is the single source of truth for game state, per store.ts).
// Both the board renderer and the HUD subscribe to this: the board reads it to
// render overlays / drive zoom+pan; the HUD's "View" tab is where the controls
// live, so the playfield itself stays free of floating buttons (ADR-0006 lean +
// the tactics-UI convention: tactical info renders on the board, controls dock).

import { create } from 'zustand';

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.45;
const DEFAULT_ZOOM = 0.9;
const DEFAULT_PAN = { x: 0, y: -12 };

type OverlayKey = 'showMoves' | 'showEnemyAttacks' | 'showBlocked';

export interface SkirmishViewState {
  /** Highlight the focused piece's legal moves. Default on. */
  showMoves: boolean;
  /** Highlight enemy threat squares (danger zone). Default on. */
  showEnemyAttacks: boolean;
  /** Highlight squares the focused piece is blocked from. Opt-in (default off). */
  showBlocked: boolean;
  zoom: number;
  pan: { x: number; y: number };
  toggle: (key: OverlayKey) => void;
  setZoom: (zoom: number) => void;
  setPan: (pan: { x: number; y: number }) => void;
  resetView: () => void;
}

export const useSkirmishView = create<SkirmishViewState>((set) => ({
  showMoves: true,
  showEnemyAttacks: true,
  showBlocked: false,
  zoom: DEFAULT_ZOOM,
  pan: DEFAULT_PAN,
  toggle: (key) => set((s) => ({ [key]: !s[key] })),
  setZoom: (zoom) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(zoom.toFixed(2)))) }),
  setPan: (pan) => set({ pan }),
  resetView: () => set({ zoom: DEFAULT_ZOOM, pan: DEFAULT_PAN }),
}));
