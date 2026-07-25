import type { PlayablePieceType } from '../core/pieces';

export interface BackgroundSet {
  id: string;
  label: string;
  world: string;
  portraits: Record<PlayablePieceType, string>;
}

const setPath = (setId: string, file: string) => `/assets/backgrounds/${setId}/${file}`;
const portraitPaths = (setId: string): Record<PlayablePieceType, string> => ({
  pawn: setPath(setId, 'portraits/pawn.png'),
  knight: setPath(setId, 'portraits/knight.png'),
  bishop: setPath(setId, 'portraits/bishop.png'),
  rook: setPath(setId, 'portraits/rook.png'),
  queen: setPath(setId, 'portraits/queen.png'),
  king: setPath(setId, 'portraits/king.png'),
});

export const backgroundSets: readonly BackgroundSet[] = [
  {
    id: 'summer-that-failed-set-01',
    label: 'The Summer That Failed',
    world: setPath('summer-that-failed-set-01', 'world.png'),
    portraits: portraitPaths('summer-that-failed-set-01'),
  },
  {
    id: 'farm-behind-line-set-01',
    label: 'The Farm Behind The Line',
    world: setPath('farm-behind-line-set-01', 'world.png'),
    portraits: portraitPaths('farm-behind-line-set-01'),
  },
];

export const DEFAULT_BACKGROUND_SET = backgroundSets[0];
