import { describe, it, expect } from 'vitest';
import { propZBracket, seatTransformPercent } from './BoardStructure';

describe('seatTransformPercent — contact pixel onto the ground point', () => {
  it('the 1×1 doodad (96×180 @ 48,69) reproduces the shipped translate(-50%, -38.333%)', () => {
    const s = seatTransformPercent({ w: 96, h: 180, anchorX: 48, anchorY: 69 });
    expect(s.x).toBeCloseTo(-50, 4);
    expect(s.y).toBeCloseTo(-38.3333, 3); // NOT -61.667 — that complement re-floats every prop/doodad
  });

  it('a 2×2 prop (192×300 @ 96,255) seats centred + low (-50%, -85%)', () => {
    const s = seatTransformPercent({ w: 192, h: 300, anchorX: 96, anchorY: 255 });
    expect(s.x).toBeCloseTo(-50, 4);
    expect(s.y).toBeCloseTo(-85, 4);
  });
});

describe('propZBracket — depth keys off the front-most footprint cell', () => {
  it('a 2×2 at (3,3) brackets the front cell (4,4): back 20007, front 20009', () => {
    const z = propZBracket(3, 3, 2, 2);
    expect(z.base).toBe((4 + 4) + 20000); // 20008
    expect(z.back).toBe(20007);
    expect(z.front).toBe(20009);
  });

  it('a 1×1 at (3,3) matches the legacy doodad bracket (front cell == anchor)', () => {
    const z = propZBracket(3, 3, 1, 1);
    expect(z.base).toBe((3 + 3) + 20000); // 20006
    expect(z.back).toBe(20005);
    expect(z.front).toBe(20007);
  });

  it('the front half always sits one above the back half', () => {
    for (const [ax, ay, w, h] of [[0, 0, 2, 2], [5, 2, 2, 1], [1, 7, 1, 2]] as const) {
      const z = propZBracket(ax, ay, w, h);
      expect(z.front - z.back).toBe(2);
      expect(z.base - z.back).toBe(1);
    }
  });
});
