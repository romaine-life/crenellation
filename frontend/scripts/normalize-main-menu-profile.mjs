// Deterministic profile/status asset normalizer for the main menu.
//
// Source: frontend/public/assets/ui/main-menu-aspirational.png
// Outputs:
//   public/assets/ui/main-menu/panel-9slice.png
//   public/assets/ui/main-menu/panel-9slice.json
//   public/assets/ui/main-menu/profile-crest.png (+ @2x)
//   public/assets/ui/main-menu/profile-rook-blue.png (+ @2x)
//   public/assets/ui/main-menu/profile-rook-red.png (+ @2x)
//   public/assets/ui/main-menu/profile-cog.png (+ @2x)
//   public/assets/ui/main-menu/profile-contact-sheet.png
//
// The panel frame is cropped from the approved render and cleaned by removing
// baked live text/icons from the content area. Runtime copy and counts remain
// DOM text; the crest/rook/cog are standalone transparent PNG assets.

import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(__dirname, '../public/assets/ui');
const OUT_DIR = path.join(UI_DIR, 'main-menu');
const SOURCE = path.join(UI_DIR, 'main-menu-aspirational.png');

const PANEL = {
  x: 1176,
  y: 26,
  w: 390,
  h: 84,
  clear: { x: 14, y: 14, w: 360, h: 62 },
  sample: { x: 260, y: 60, w: 48, h: 10 },
  contentInset: { x: 18, y: 16, w: 354, h: 52 },
  patchMargins: { left: 16, right: 16, top: 16, bottom: 16 },
};

const ICONS = [
  { id: 'profile-crest', x: 1188, y: 38, w: 58, h: 59, out: 'profile-crest.png', tol: 28 },
  { id: 'profile-rook-blue', x: 1195, y: 142, w: 34, h: 38, out: 'profile-rook-blue.png', tol: 30 },
  { id: 'profile-rook-red', x: 1387, y: 142, w: 34, h: 38, out: 'profile-rook-red.png', tol: 30 },
  { id: 'profile-cog', x: 1516, y: 47, w: 37, h: 37, out: 'profile-cog.png', tol: 30 },
];

function readPNG(p) {
  const png = PNG.sync.read(fs.readFileSync(p));
  return { w: png.width, h: png.height, data: png.data };
}

function makeImg(w, h) {
  return { w, h, data: Buffer.alloc(w * h * 4, 0) };
}

function gp(img, x, y) {
  return (y * img.w + x) * 4;
}

function crop(img, x0, y0, w, h) {
  const out = makeImg(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x0 + x;
      const sy = y0 + y;
      if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
      const si = gp(img, sx, sy);
      const di = gp(out, x, y);
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  return out;
}

function sampleColor(img, rect) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      const i = gp(img, x, y);
      if (img.data[i + 3] < 200) continue;
      r += img.data[i];
      g += img.data[i + 1];
      b += img.data[i + 2];
      n++;
    }
  }
  return n ? { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) } : { r: 4, g: 14, b: 22 };
}

function fillRect(img, rect, color) {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      const i = gp(img, x, y);
      img.data[i] = color.r;
      img.data[i + 1] = color.g;
      img.data[i + 2] = color.b;
      img.data[i + 3] = 255;
    }
  }
}

function dist2(data, i, rgb) {
  const dr = data[i] - rgb.r;
  const dg = data[i + 1] - rgb.g;
  const db = data[i + 2] - rgb.b;
  return dr * dr + dg * dg + db * db;
}

function edgeColor(img) {
  const samples = [];
  for (let x = 0; x < img.w; x++) {
    samples.push(gp(img, x, 0), gp(img, x, img.h - 1));
  }
  for (let y = 0; y < img.h; y++) {
    samples.push(gp(img, 0, y), gp(img, img.w - 1, y));
  }
  let r = 0;
  let g = 0;
  let b = 0;
  for (const i of samples) {
    r += img.data[i];
    g += img.data[i + 1];
    b += img.data[i + 2];
  }
  return {
    r: Math.round(r / samples.length),
    g: Math.round(g / samples.length),
    b: Math.round(b / samples.length),
  };
}

function floodKey(img, tol) {
  const bg = edgeColor(img);
  const t2 = tol * tol;
  const seen = new Uint8Array(img.w * img.h);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
    const p = y * img.w + x;
    if (seen[p]) return;
    const i = p * 4;
    if (img.data[i + 3] > 0 && dist2(img.data, i, bg) <= t2) {
      seen[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < img.w; x++) {
    push(x, 0);
    push(x, img.h - 1);
  }
  for (let y = 0; y < img.h; y++) {
    push(0, y);
    push(img.w - 1, y);
  }
  while (stack.length) {
    const p = stack.pop();
    img.data[p * 4 + 3] = 0;
    const x = p % img.w;
    const y = (p - x) / img.w;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
}

function scaleNearest(img, factor) {
  const out = makeImg(img.w * factor, img.h * factor);
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const si = gp(img, Math.floor(x / factor), Math.floor(y / factor));
      const di = gp(out, x, y);
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

function copyInto(dst, src, ox, oy) {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const dx = ox + x;
      const dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= dst.w || dy >= dst.h) continue;
      const si = gp(src, x, y);
      const di = gp(dst, dx, dy);
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
}

function checkerboard(w, h, cell = 8) {
  const out = makeImg(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const light = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const c = light ? 38 : 22;
      const i = gp(out, x, y);
      out.data[i] = c;
      out.data[i + 1] = c + 5;
      out.data[i + 2] = c + 9;
      out.data[i + 3] = 255;
    }
  }
  return out;
}

function writePNG(img, p) {
  const png = new PNG({ width: img.w, height: img.h });
  img.data.copy(png.data);
  fs.writeFileSync(p, PNG.sync.write(png));
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const source = readPNG(SOURCE);
const panel = crop(source, PANEL.x, PANEL.y, PANEL.w, PANEL.h);
const fill = sampleColor(panel, PANEL.sample);
fillRect(panel, PANEL.clear, fill);
writePNG(panel, path.join(OUT_DIR, 'panel-9slice.png'));
fs.writeFileSync(
  path.join(OUT_DIR, 'panel-9slice.json'),
  `${JSON.stringify({
    image: '/assets/ui/main-menu/panel-9slice.png',
    width: panel.w,
    height: panel.h,
    source: {
      image: '/assets/ui/main-menu-aspirational.png',
      rect: { x: PANEL.x, y: PANEL.y, w: PANEL.w, h: PANEL.h },
    },
    contentInset: PANEL.contentInset,
    patchMargins: PANEL.patchMargins,
    text: 'live',
  }, null, 2)}\n`,
);

const iconImgs = [];
for (const icon of ICONS) {
  const img = crop(source, icon.x, icon.y, icon.w, icon.h);
  floodKey(img, icon.tol);
  writePNG(img, path.join(OUT_DIR, icon.out));
  writePNG(scaleNearest(img, 2), path.join(OUT_DIR, icon.out.replace('.png', '@2x.png')));
  iconImgs.push({ icon, img });
}

const contact = checkerboard(520, 180);
copyInto(contact, panel, 16, 16);
let x = 16;
for (const { img } of iconImgs) {
  copyInto(contact, img, x, 124);
  x += Math.max(56, img.w + 18);
}
writePNG(contact, path.join(OUT_DIR, 'profile-contact-sheet.png'));

console.log('Wrote main-menu profile assets:');
console.log(`  panel-9slice.png ${panel.w}x${panel.h}`);
for (const { icon, img } of iconImgs) console.log(`  ${icon.out} ${img.w}x${img.h}`);
