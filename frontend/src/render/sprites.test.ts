import { describe, it, expect } from 'vitest';
import atlasJson from '../../public/assets/sprites/atlas.json';

// Expected coverage (kept in lockstep with scripts/generate-sprites.mjs by
// scripts/check-sprites.mjs, which regenerates and diffs the manifest in CI).
const TERRAINS = ['grass', 'water', 'stone', 'road', 'bridge', 'cliff', 'rock'];
const PIECE_TYPES = ['pawn', 'knight', 'bishop', 'rook', 'queen'];
const SIDES = ['player', 'enemy'];

interface Frame { x: number; y: number; w: number; h: number }
interface Layer { w: number; h: number; cellW: number; cellH: number; image: string; image2x: string; anchor?: { x: number; y: number }; frames: Record<string, Frame> }
const atlas = atlasJson as unknown as { tile: Layer; piece: Layer };

describe('sprite atlas manifest', () => {
  it('matches the iso tile geometry from render/iso.ts (64x32)', () => {
    expect(atlas.tile.cellW).toBe(64);
    expect(atlas.tile.cellH).toBe(32);
  });

  it('has exactly one tile frame per terrain type, within sheet bounds', () => {
    for (const t of TERRAINS) {
      const f = atlas.tile.frames[t];
      expect(f, `tile frame ${t}`).toBeTruthy();
      expect(f.x + f.w).toBeLessThanOrEqual(atlas.tile.w);
      expect(f.y + f.h).toBeLessThanOrEqual(atlas.tile.h);
    }
    expect(Object.keys(atlas.tile.frames).length).toBe(TERRAINS.length);
  });

  it('has a piece frame for every side/type plus the neutral rocks, within bounds', () => {
    for (const side of SIDES) {
      for (const type of PIECE_TYPES) {
        expect(atlas.piece.frames[`${side}.${type}`], `piece ${side}.${type}`).toBeTruthy();
      }
    }
    expect(atlas.piece.frames['neutral.rock']).toBeTruthy();
    expect(atlas.piece.frames['neutral.random-rock']).toBeTruthy();
    for (const key of Object.keys(atlas.piece.frames)) {
      const f = atlas.piece.frames[key];
      expect(f.x + f.w, key).toBeLessThanOrEqual(atlas.piece.w);
      expect(f.y + f.h, key).toBeLessThanOrEqual(atlas.piece.h);
    }
    expect(Object.keys(atlas.piece.frames).length).toBe(SIDES.length * PIECE_TYPES.length + 2);
  });

  it('declares a base-contact anchor for piece placement', () => {
    expect(atlas.piece.anchor?.x).toBeCloseTo(0.5);
    expect(atlas.piece.anchor?.y ?? 0).toBeGreaterThan(0.5); // contact near the bottom of the cell
    expect(atlas.piece.anchor?.y ?? 1).toBeLessThan(1);
  });

  it('references both @1x and @2x sheets', () => {
    expect(atlas.tile.image).toMatch(/tiles\.png$/);
    expect(atlas.tile.image2x).toMatch(/tiles@2x\.png$/);
    expect(atlas.piece.image).toMatch(/pieces\.png$/);
    expect(atlas.piece.image2x).toMatch(/pieces@2x\.png$/);
  });
});
