import type { PieceType, Side, UnitFacing } from './types';

export const PLAYABLE_PIECE_TYPES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const satisfies readonly PieceType[];
export type PlayablePieceType = typeof PLAYABLE_PIECE_TYPES[number];

export const isPlayablePieceType = (type: PieceType): type is PlayablePieceType =>
  (PLAYABLE_PIECE_TYPES as readonly PieceType[]).includes(type);

export const PIECE_LABEL: Record<PieceType, string> = {
  pawn: 'Pawn',
  knight: 'Knight',
  bishop: 'Bishop',
  rook: 'Rook',
  queen: 'Queen',
  king: 'King',
  rock: 'Rock',
  'random-rock': 'Rock',
};

export const PIECE_MARK: Record<PieceType, string> = {
  pawn: 'P',
  knight: 'N',
  bishop: 'B',
  rook: 'R',
  queen: 'Q',
  king: 'K',
  rock: 'O',
  'random-rock': '?',
};

// Team-color palettes. Each unit ships its 8 directions rendered in every palette;
// a board side is assigned a palette (default player navy-blue / enemy crimson). The
// roster sprites live at /assets/units/<type>/<palette>/<direction>.png.
export const UNIT_PALETTES = ['navy-blue', 'crimson', 'golden', 'emerald'] as const;
export type UnitPalette = typeof UNIT_PALETTES[number];
export const DEFAULT_PALETTE: UnitPalette = 'navy-blue';

export const UNIT_FACINGS: readonly UnitFacing[] = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

export const defaultFacingForSide = (side: Side): UnitFacing => {
  if (side === 'enemy') return 'south';
  return 'north';
};

export const facingFromDelta = (dx: number, dy: number): UnitFacing | null => {
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  if (sx === 0 && sy === 0) return null;
  if (sx === 0 && sy < 0) return 'north';
  if (sx > 0 && sy < 0) return 'north-east';
  if (sx > 0 && sy === 0) return 'east';
  if (sx > 0 && sy > 0) return 'south-east';
  if (sx === 0 && sy > 0) return 'south';
  if (sx < 0 && sy > 0) return 'south-west';
  if (sx < 0 && sy === 0) return 'west';
  return 'north-west';
};

export const pieceSpritePath = (type: PlayablePieceType, palette: UnitPalette = DEFAULT_PALETTE, direction: UnitFacing = 'south') =>
  `/assets/units/${type}/${palette}/${direction}.png`;

// Which palette a board side wears. Shared by the board and the HUD portrait.
export const PALETTE_FOR_SIDE: Record<Side, UnitPalette> = {
  player: 'navy-blue',
  enemy: 'crimson',
  neutral: 'navy-blue',
};

// Piece portraits: a dedicated eye-level perspective bust (separate contract from the
// true-iso board sprite), one per palette. See docs/portrait-contract.md.
export const portraitPath = (type: PlayablePieceType, palette: UnitPalette = DEFAULT_PALETTE) =>
  `/assets/units/${type}/portrait/${palette}.png`;
