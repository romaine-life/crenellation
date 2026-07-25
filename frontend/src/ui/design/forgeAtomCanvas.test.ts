// @ts-nocheck — node built-ins + pngjs are untyped in the app tsconfig, and the
// forge is an untyped .mjs; vitest runs this via esbuild (no typecheck). The pad
// logic it exercises is plain JS.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
// The ADR-0026 glyph-canvas contract: forge-atom pads a trimmed glyph into a
// uniform centered canvas and the size is asserted. This tests the pure pad step
// (no codex) so CI guarantees the contract holds.
import { padToCanvas } from '../../../scripts/forge-atom.mjs';

function solidPng(w: number, h: number): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i += 1) {
    png.data[i * 4] = 200; png.data[i * 4 + 1] = 40; png.data[i * 4 + 2] = 40; png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}
function opaqueBox(png: PNG) {
  let minX = png.width, minY = png.height, maxX = -1, maxY = -1;
  for (let y = 0; y < png.height; y += 1) for (let x = 0; x < png.width; x += 1) {
    if (png.data[(y * png.width + x) * 4 + 3] > 20) {
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return {
    w: maxX - minX + 1, h: maxY - minY + 1,
    left: minX, top: minY, right: png.width - 1 - maxX, bottom: png.height - 1 - maxY,
  };
}
function padded(srcW: number, srcH: number, cw = 64, ch = 64, margin = 2): PNG {
  const dir = mkdtempSync(join(tmpdir(), 'padcanvas-'));
  const f = join(dir, 'g.png');
  writeFileSync(f, solidPng(srcW, srcH));
  padToCanvas(f, cw, ch, margin);
  return PNG.sync.read(readFileSync(f));
}

describe('padToCanvas (ADR-0026 glyph canvas)', () => {
  it('lands on the exact canvas size regardless of glyph shape', () => {
    for (const [w, h] of [[20, 30], [49, 49], [8, 8], [40, 12]] as const) {
      const out = padded(w, h);
      expect(out.width).toBe(64);
      expect(out.height).toBe(64);
    }
  });

  it('centers the glyph with equal margins (±1px)', () => {
    const out = padded(20, 30);
    const b = opaqueBox(out);
    expect(Math.abs(b.left - b.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.top - b.bottom)).toBeLessThanOrEqual(1);
  });

  it('never upscales a glyph already within the safe area', () => {
    const out = padded(20, 30);
    const b = opaqueBox(out);
    expect(b.w).toBe(20);
    expect(b.h).toBe(30);
  });

  it('scales an over-large glyph DOWN to fit the margin', () => {
    const out = padded(100, 80, 64, 64, 2); // inner = 60 -> s = 0.6 -> 60x48
    const b = opaqueBox(out);
    expect(b.w).toBeLessThanOrEqual(60);
    expect(b.h).toBeLessThanOrEqual(60);
    expect(b.w).toBeGreaterThanOrEqual(58); // ~60 wide on the dominant axis
  });
});
