// Turn a unit concept illustration (solid dark background) into a transparent,
// cropped, downscaled cutout sprite usable on the board.
//
// Background removal is a flood fill from the image borders (not a global colour
// key), so dark pixels INSIDE the piece are preserved — only background-coloured
// pixels reachable from the edge are cleared.
//
// Usage: node scripts/cutout-unit-concept.mjs <srcRelPath> <outRelPath> [tolerance] [targetMax]

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const [, , srcArg, outArg, tolArg, maxArg] = process.argv;
const srcPath = path.join(repoRoot, srcArg ?? 'frontend/public/assets/units/concepts/pawn-shield-south-concept.png');
const outPath = path.join(repoRoot, outArg ?? 'frontend/public/assets/units/cutouts/pawn-shield-south.png');
const TOL = Number(tolArg ?? 56);
const TARGET_MAX = Number(maxArg ?? 256);

const src = PNG.sync.read(fs.readFileSync(srcPath));
const W = src.width;
const H = src.height;
const at = (x, y) => (y * W + x) * 4;

const cornerColor = (x, y) => { const i = at(x, y); return [src.data[i], src.data[i + 1], src.data[i + 2]]; };
const corners = [cornerColor(0, 0), cornerColor(W - 1, 0), cornerColor(0, H - 1), cornerColor(W - 1, H - 1)];
const bg = [0, 1, 2].map((c) => Math.round(corners.reduce((s, k) => s + k[c], 0) / corners.length));
const tol2 = TOL * TOL;
const isBg = (i) => {
  const dr = src.data[i] - bg[0];
  const dg = src.data[i + 1] - bg[1];
  const db = src.data[i + 2] - bg[2];
  return dr * dr + dg * dg + db * db <= tol2;
};

// Flood fill from every border pixel; clear connected background.
const cleared = new Uint8Array(W * H);
const visited = new Uint8Array(W * H);
const stack = [];
const push = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const p = y * W + x; if (visited[p]) return; visited[p] = 1; stack.push(p); };
for (let x = 0; x < W; x += 1) { push(x, 0); push(x, H - 1); }
for (let y = 0; y < H; y += 1) { push(0, y); push(W - 1, y); }
while (stack.length) {
  const p = stack.pop();
  if (!isBg(p * 4)) continue;
  cleared[p] = 1;
  const x = p % W;
  const y = (p / W) | 0;
  push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
}

// Apply transparency and compute content bbox.
let minX = W; let minY = H; let maxX = -1; let maxY = -1;
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const p = y * W + x;
    if (cleared[p]) { src.data[p * 4 + 3] = 0; continue; }
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
}
const cw = maxX - minX + 1;
const ch = maxY - minY + 1;

// Downscale (alpha-weighted box average) to TARGET_MAX longest side.
const scale = Math.min(1, TARGET_MAX / Math.max(cw, ch));
const ow = Math.max(1, Math.round(cw * scale));
const oh = Math.max(1, Math.round(ch * scale));
const out = new PNG({ width: ow, height: oh });
for (let oy = 0; oy < oh; oy += 1) {
  for (let ox = 0; ox < ow; ox += 1) {
    const sx0 = minX + Math.floor(ox / scale);
    const sx1 = minX + Math.max(Math.floor(ox / scale) + 1, Math.floor((ox + 1) / scale));
    const sy0 = minY + Math.floor(oy / scale);
    const sy1 = minY + Math.max(Math.floor(oy / scale) + 1, Math.floor((oy + 1) / scale));
    let r = 0; let g = 0; let b = 0; let aSum = 0; let n = 0;
    for (let sy = sy0; sy < Math.min(sy1, H); sy += 1) {
      for (let sx = sx0; sx < Math.min(sx1, W); sx += 1) {
        const s = at(sx, sy);
        const a = src.data[s + 3];
        const w = a / 255;
        r += src.data[s] * w; g += src.data[s + 1] * w; b += src.data[s + 2] * w; aSum += a; n += 1;
      }
    }
    const wsum = aSum / 255;
    const d = (oy * ow + ox) * 4;
    out.data[d] = wsum > 0 ? Math.round(r / wsum) : 0;
    out.data[d + 1] = wsum > 0 ? Math.round(g / wsum) : 0;
    out.data[d + 2] = wsum > 0 ? Math.round(b / wsum) : 0;
    out.data[d + 3] = Math.round(aSum / n);
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, PNG.sync.write(out));
console.log(`bg=${bg} tol=${TOL} crop=${cw}x${ch} -> ${ow}x${oh}  ${path.relative(repoRoot, outPath)}`);
