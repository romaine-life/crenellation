import type { CSSProperties } from 'react';
import { pieceSpritePath, type UnitPalette } from '../core/pieces';

export type Faction = UnitPalette;
export type PieceId = 'pawn' | 'rook' | 'knight' | 'bishop' | 'queen' | 'king';
export type Direction = 'south' | 'south-east' | 'east' | 'north-east' | 'north' | 'north-west' | 'west' | 'south-west';
export type FootprintShape = 'square' | 'circle';

export type UnitFootprint = {
  shape: FootprintShape;
  sourceCanvasPx: number;
  sourceFootprintPx: number;
};

export type UnitPlacementStyle = CSSProperties & {
  '--tile-anchor-x': string;
  '--tile-anchor-y': string;
  '--unit-anchor-x': string;
  '--unit-anchor-y': string;
  '--unit-size': string;
  '--unit-footprint-size': string;
  '--stack-shift-y': string;
};

export type UnitAsset = {
  id: string;
  family: PieceId;
  label: string;
  badge: string;
  preview: string;
  read: string;
  status: string;
  directions?: Direction[];
  factionMode: 'fixed' | 'palette';
  defaultScale: number;
  footprint: UnitFootprint;
  unitAnchorX?: string;
  unitAnchorY?: string;
  /** How this sprite was produced (e.g. "Blender", "Codex→Filter", "PixelLab"). */
  method?: string;
  /** Non-production candidates: shown in the Studio catalog for comparison, held OUT of the shipped roster/game. */
  speculative?: boolean;
  sprite: (faction: Faction, direction: Direction) => string;
};

export const CANONICAL_CIRCLE_FOOTPRINT_PX = 96;
const SQUARE_EQUAL_AREA_FACTOR = Math.sqrt(Math.PI) / 2;

export const canonicalFootprintSize = (shape: FootprintShape) =>
  shape === 'square' ? Math.round(CANONICAL_CIRCLE_FOOTPRINT_PX * SQUARE_EQUAL_AREA_FACTOR) : CANONICAL_CIRCLE_FOOTPRINT_PX;

export const renderSizeFromFootprint = (unit: UnitAsset, scale: number) =>
  Math.round((canonicalFootprintSize(unit.footprint.shape) * (scale / 100) * unit.footprint.sourceCanvasPx) / unit.footprint.sourceFootprintPx);

export const UNIT_INSPECTION_TILE_SCALE = 2;

export const renderSizeForTileScale = (unit: UnitAsset, scale: number, tileScale: number) =>
  Math.round(renderSizeFromFootprint(unit, scale) * (tileScale / UNIT_INSPECTION_TILE_SCALE));

export const footprintSizeFromScale = (unit: UnitAsset, scale: number) =>
  Math.round(canonicalFootprintSize(unit.footprint.shape) * (scale / 100));

const circleFootprint = (sourceCanvasPx: number, sourceFootprintPx = sourceCanvasPx): UnitFootprint => ({
  shape: 'circle',
  sourceCanvasPx,
  sourceFootprintPx,
});

const squareFootprint = (sourceCanvasPx: number, sourceFootprintPx = sourceCanvasPx): UnitFootprint => ({
  shape: 'square',
  sourceCanvasPx,
  sourceFootprintPx,
});

const ROOK_KEEP_CANVAS_PX = 512;
const ROOK_KEEP_CONTACT_FOOTPRINT_PX = 428;
const ROOK_KEEP_CONTACT_ANCHOR_X = '50%';
const ROOK_KEEP_CONTACT_ANCHOR_Y = '80.241%';
const KNIGHT_FUR_CANVAS_PX = 512;
const KNIGHT_FUR_CONTACT_FOOTPRINT_PX = 178;
const KNIGHT_FUR_CONTACT_ANCHOR_X = '50%';
const KNIGHT_FUR_CONTACT_ANCHOR_Y = '80.241%';
const BISHOP_MITRE_CANVAS_PX = 512;
const BISHOP_MITRE_CONTACT_FOOTPRINT_PX = 126;
const BISHOP_MITRE_CONTACT_ANCHOR_X = '50%';
const BISHOP_MITRE_CONTACT_ANCHOR_Y = '80.241%';
const QUEEN_TIARA_CANVAS_PX = 512;
const QUEEN_TIARA_CONTACT_FOOTPRINT_PX = 150;
const QUEEN_TIARA_CONTACT_ANCHOR_X = '50%';
const QUEEN_TIARA_CONTACT_ANCHOR_Y = '80.241%';
const KING_CROWN_CANVAS_PX = 512;
const KING_CROWN_CONTACT_FOOTPRINT_PX = 148;
const KING_CROWN_CONTACT_ANCHOR_X = '50%';
const KING_CROWN_CONTACT_ANCHOR_Y = '80.241%';

export const familyLabels: Record<PieceId, string> = {
  pawn: 'Pawn',
  rook: 'Rook',
  knight: 'Knight',
  bishop: 'Bishop',
  queen: 'Queen',
  king: 'King',
};

export const rookDirections: Direction[] = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

export const rookDirectionLabel: Record<Direction, string> = {
  south: 'S',
  'south-east': 'SE',
  east: 'E',
  'north-east': 'NE',
  north: 'N',
  'north-west': 'NW',
  west: 'W',
  'south-west': 'SW',
};

export const directionCompassCells: Array<Direction | 'center'> = [
  'west',
  'north-west',
  'north',
  'south-west',
  'center',
  'north-east',
  'south',
  'south-east',
  'east',
];

const paletteSprite = (piece: PieceId) => (faction: Faction, direction: Direction) => pieceSpritePath(piece, faction, direction);

export const MISSING_DIRECTION_SPRITE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>" +
      "<path d='M80 26 L144 80 L80 134 L16 80 Z' fill='none' stroke='#8fb8ff' stroke-width='3' stroke-dasharray='6 6' opacity='0.4'/>" +
      "<text x='80' y='96' font-size='42' text-anchor='middle' fill='#8fb8ff' opacity='0.5' font-family='sans-serif'>?</text>" +
      '</svg>',
  );

export const hasDirectionSprite = (unit: UnitAsset, dir: Direction) => (unit.directions ? unit.directions.includes(dir) : dir === 'south');

const productionUnits: UnitAsset[] = [
  {
    id: 'rook-blender-v4-calibrated',
    family: 'rook',
    label: 'Rook',
    badge: '8 directions · calibrated',
    preview: pieceSpritePath('rook'),
    read: 'Board-calibrated castle rook with exact eight-direction rotations',
    status: 'active production unit',
    directions: rookDirections,
    factionMode: 'palette',
    defaultScale: 100,
    footprint: squareFootprint(ROOK_KEEP_CANVAS_PX, ROOK_KEEP_CONTACT_FOOTPRINT_PX),
    unitAnchorX: ROOK_KEEP_CONTACT_ANCHOR_X,
    unitAnchorY: ROOK_KEEP_CONTACT_ANCHOR_Y,
    sprite: paletteSprite('rook'),
  },
  {
    id: 'knight-fur',
    family: 'knight',
    label: 'Knight',
    badge: '8 directions · calibrated',
    preview: pieceSpritePath('knight'),
    read: 'Carved warhorse with a procedural navy fur coat; true-isometric Blender render',
    status: 'active production unit',
    directions: rookDirections,
    factionMode: 'palette',
    defaultScale: 100,
    footprint: circleFootprint(KNIGHT_FUR_CANVAS_PX, KNIGHT_FUR_CONTACT_FOOTPRINT_PX),
    unitAnchorX: KNIGHT_FUR_CONTACT_ANCHOR_X,
    unitAnchorY: KNIGHT_FUR_CONTACT_ANCHOR_Y,
    sprite: paletteSprite('knight'),
  },
  {
    id: 'bishop-mitre',
    family: 'bishop',
    label: 'Bishop',
    badge: '8 directions · calibrated',
    preview: pieceSpritePath('bishop'),
    read: 'Mitre bishop rendered as a true-isometric eight-direction production unit',
    status: 'active production unit',
    directions: rookDirections,
    factionMode: 'palette',
    defaultScale: 100,
    footprint: circleFootprint(BISHOP_MITRE_CANVAS_PX, BISHOP_MITRE_CONTACT_FOOTPRINT_PX),
    unitAnchorX: BISHOP_MITRE_CONTACT_ANCHOR_X,
    unitAnchorY: BISHOP_MITRE_CONTACT_ANCHOR_Y,
    sprite: paletteSprite('bishop'),
  },
  {
    id: 'queen-tiara',
    family: 'queen',
    label: 'Queen',
    badge: '8 directions · calibrated',
    preview: pieceSpritePath('queen'),
    read: 'Coronet queen rendered as a true-isometric eight-direction production unit',
    status: 'active production unit',
    directions: rookDirections,
    factionMode: 'palette',
    defaultScale: 100,
    footprint: circleFootprint(QUEEN_TIARA_CANVAS_PX, QUEEN_TIARA_CONTACT_FOOTPRINT_PX),
    unitAnchorX: QUEEN_TIARA_CONTACT_ANCHOR_X,
    unitAnchorY: QUEEN_TIARA_CONTACT_ANCHOR_Y,
    sprite: paletteSprite('queen'),
  },
  {
    id: 'king-crown',
    family: 'king',
    label: 'King',
    badge: '8 directions · calibrated',
    preview: pieceSpritePath('king'),
    read: 'Crowned king rendered as a true-isometric eight-direction production unit',
    status: 'active production unit',
    directions: rookDirections,
    factionMode: 'palette',
    defaultScale: 100,
    footprint: circleFootprint(KING_CROWN_CANVAS_PX, KING_CROWN_CONTACT_FOOTPRINT_PX),
    unitAnchorX: KING_CROWN_CONTACT_ANCHOR_X,
    unitAnchorY: KING_CROWN_CONTACT_ANCHOR_Y,
    sprite: paletteSprite('king'),
  },
  {
    id: 'pawn-codexsheet',
    family: 'pawn',
    label: 'Pawn',
    badge: '8 directions · pixel art',
    preview: pieceSpritePath('pawn'),
    read: 'Helmeted pawn — Codex Sheet pixel-art production unit (true-isometric, 8 directions).',
    status: 'active production unit',
    directions: rookDirections,
    factionMode: 'palette',
    defaultScale: 100,
    footprint: circleFootprint(512, 150),
    unitAnchorX: '50%',
    unitAnchorY: '80.241%',
    sprite: paletteSprite('pawn'),
  },
];

// --- Speculative pixel-art comparison libraries (the unit "bake-off") --------
// The accepted PRODUCTION pixel-art set ("Codex Sheet") was promoted into the shipped
// roster above — it renders from the canonical /assets/units/<piece>/<palette> path with
// team colors. These remaining libraries stay in the Studio catalog ONLY for comparison
// (held out of the game), each tagged `speculative` so they can be culled. Navy palette
// only; sprites framed onto the same 512 canvas, seated via the per-piece footprints below.
export type PixelLibraryKey = 'codexfilter' | 'filter2' | 'filter3';
export const PIXEL_LIBRARIES: { key: PixelLibraryKey; label: string; dirs: Direction[] }[] = [
  { key: 'codexfilter', label: 'Codex→Filter', dirs: rookDirections },
  { key: 'filter2', label: 'Filter ×2', dirs: rookDirections },
  { key: 'filter3', label: 'Filter ×3', dirs: rookDirections },
];

const PIXEL_PIECE_FOOTPRINT: Record<PieceId, { footprint: UnitFootprint; anchorX: string; anchorY: string }> = {
  rook: { footprint: squareFootprint(ROOK_KEEP_CANVAS_PX, ROOK_KEEP_CONTACT_FOOTPRINT_PX), anchorX: ROOK_KEEP_CONTACT_ANCHOR_X, anchorY: ROOK_KEEP_CONTACT_ANCHOR_Y },
  knight: { footprint: circleFootprint(KNIGHT_FUR_CANVAS_PX, KNIGHT_FUR_CONTACT_FOOTPRINT_PX), anchorX: KNIGHT_FUR_CONTACT_ANCHOR_X, anchorY: KNIGHT_FUR_CONTACT_ANCHOR_Y },
  bishop: { footprint: circleFootprint(BISHOP_MITRE_CANVAS_PX, BISHOP_MITRE_CONTACT_FOOTPRINT_PX), anchorX: BISHOP_MITRE_CONTACT_ANCHOR_X, anchorY: BISHOP_MITRE_CONTACT_ANCHOR_Y },
  queen: { footprint: circleFootprint(QUEEN_TIARA_CANVAS_PX, QUEEN_TIARA_CONTACT_FOOTPRINT_PX), anchorX: QUEEN_TIARA_CONTACT_ANCHOR_X, anchorY: QUEEN_TIARA_CONTACT_ANCHOR_Y },
  king: { footprint: circleFootprint(KING_CROWN_CANVAS_PX, KING_CROWN_CONTACT_FOOTPRINT_PX), anchorX: KING_CROWN_CONTACT_ANCHOR_X, anchorY: KING_CROWN_CONTACT_ANCHOR_Y },
  pawn: { footprint: circleFootprint(512, 150), anchorX: '50%', anchorY: '80.241%' },
};

const PIXEL_PIECES: PieceId[] = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];

const pixelLibrarySprite = (key: PixelLibraryKey, piece: PieceId) =>
  (_faction: Faction, direction: Direction) => `/assets/units-pixel/${key}/${piece}/navy-blue/${direction}.png`;

const pixelLibraryUnits: UnitAsset[] = PIXEL_PIECES.flatMap((piece) =>
  PIXEL_LIBRARIES.map((lib): UnitAsset => {
    const fp = PIXEL_PIECE_FOOTPRINT[piece];
    return {
      id: `${piece}-${lib.key}`,
      family: piece,
      label: `${familyLabels[piece]} · ${lib.label}`,
      badge: lib.label,
      preview: `/assets/units-pixel/${lib.key}/${piece}/navy-blue/south.png`,
      read: `${familyLabels[piece]} — ${lib.label} pixel-art candidate (speculative; navy only).`,
      status: 'speculative candidate',
      directions: lib.dirs,
      factionMode: 'fixed',
      defaultScale: 100,
      footprint: fp.footprint,
      unitAnchorX: fp.anchorX,
      unitAnchorY: fp.anchorY,
      method: lib.label,
      speculative: true,
      sprite: pixelLibrarySprite(lib.key, piece),
    };
  }),
);

export const unitAssets: UnitAsset[] = [
  ...productionUnits.map((unit) => ({ ...unit, method: unit.method ?? 'Production' })),
  ...pixelLibraryUnits,
];

export const productionUnitAssets: UnitAsset[] = unitAssets.filter((unit) => unit.factionMode === 'palette' && !unit.speculative);

export const UNIT_METHOD_OPTIONS: { id: string; label: string; sub: string }[] = [
  { id: 'Production', label: 'Production', sub: 'shipped' },
  ...PIXEL_LIBRARIES.map((lib) => ({ id: lib.label, label: lib.label, sub: 'Speculative' })),
];

export const activeUnitFamilies = [...new Set(unitAssets.map((unit) => unit.family))];
