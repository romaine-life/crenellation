// Phase-1 asset normalizer for the main-menu button family, aligned to the
// asset catalog (frontend/src/asset-catalog.json).
//
// Hybrid pipeline (method "c"): generated concept art -> mechanical cleanup ->
// reusable, swappable game assets in the DECOMPOSED catalog model.
//
//   button-9slice.png  : a 2-state 9-slice sheet (normal on top, pressed below)
//                       built from the five-mode sheet, background flood-keyed
//                       transparent and the icon badge punched out so the frame
//                       family is icon-less.
//   icon-<id>.png/@2x : standalone icon badges cropped from the SAME five-mode
//                       rows (sword/crown/scroll/people/gear). Composited into
//                       the icon slot at runtime + live label + action.
//   contact-sheet.png : review tiles on a checkerboard.
//
// Frame + icons come from the same sheet and the same badge geometry, so the
// punched hole and the icon asset line up by construction (no hand-measured
// coordinates to drift). The script PRINTS the slot rects to paste into the
// catalog. Background keying uses a low flood tolerance because the dark plate
// sits only ~14-20 units from the near-black background while the bright frame
// edge is 60+ away.
//
// Deterministic and re-runnable. Run: node scripts/normalize-mode-buttons.mjs

import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(__dirname, '../public/assets/ui');
const OUT_DIR = path.join(UI_DIR, 'main-menu');
const FIVE = path.join(UI_DIR, 'main-menu-button-art-five-mode.png');

const FLOOD_TOL = 10;
const ICON_KEY_TOL = 60; // keying the navy plate from around the icon badge
const ICON_PX = 220; // icon export size
// Five-mode rows top-to-bottom -> icon ids. Row 0 (sword, glowing) also seeds
// the pressed/selected frame state; a plain row seeds the normal state.
const ICON_IDS = ['sword', 'crown', 'scroll', 'people', 'gear'];

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
function dist2(d, i, r, g, b) {
  const dr = d[i] - r;
  const dg = d[i + 1] - g;
  const db = d[i + 2] - b;
  return dr * dr + dg * dg + db * db;
}
function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function sampleBg(img) {
  const s = 12;
  const corners = [[0, 0], [img.w - s, 0], [0, img.h - s], [img.w - s, img.h - s]];
  const avg = corners.reduce(
    (a, [cx, cy]) => {
      for (let y = cy; y < cy + s; y++) {
        for (let x = cx; x < cx + s; x++) {
          const i = gp(img, x, y);
          a[0] += img.data[i];
          a[1] += img.data[i + 1];
          a[2] += img.data[i + 2];
          a[3] += 1;
        }
      }
      return a;
    },
    [0, 0, 0, 0],
  );
  return { r: avg[0] / avg[3], g: avg[1] / avg[3], b: avg[2] / avg[3] };
}
function rowInk(img, bg, tol) {
  const t2 = tol * tol;
  const prof = new Array(img.h).fill(0);
  for (let y = 0; y < img.h; y++) {
    let c = 0;
    for (let x = 0; x < img.w; x++) if (dist2(img.data, gp(img, x, y), bg.r, bg.g, bg.b) > t2) c++;
    prof[y] = c;
  }
  return prof;
}
function colInkRange(img, bg, tol, y0, y1) {
  const t2 = tol * tol;
  let x0 = img.w;
  let x1 = -1;
  for (let x = 0; x < img.w; x++) {
    let c = 0;
    for (let y = y0; y < y1; y++) if (dist2(img.data, gp(img, x, y), bg.r, bg.g, bg.b) > t2) c++;
    if (c > (y1 - y0) * 0.06) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
  }
  return { x0, x1 };
}
function detectBands(prof, w, { minFrac = 0.12, gapMerge = 10, minBand = 24 } = {}) {
  const thr = w * minFrac;
  const bands = [];
  let s = -1;
  for (let y = 0; y < prof.length; y++) {
    const active = prof[y] > thr;
    if (active && s < 0) s = y;
    if ((!active || y === prof.length - 1) && s >= 0) {
      bands.push([s, active ? y : y - 1]);
      s = -1;
    }
  }
  const merged = [];
  for (const b of bands) {
    const last = merged[merged.length - 1];
    if (last && b[0] - last[1] <= gapMerge) last[1] = b[1];
    else merged.push(b.slice());
  }
  return merged.filter((b) => b[1] - b[0] + 1 >= minBand);
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
function floodKey(img, bg, tol) {
  const t2 = tol * tol;
  const { w, h, data } = img;
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (seen[p]) return;
    if (dist2(data, p * 4, bg.r, bg.g, bg.b) <= t2) {
      seen[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const p = stack.pop();
    data[p * 4 + 3] = 0;
    const x = p % w;
    const y = (p - x) / w;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
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
// Average colour of opaque pixels in a rect — used to sample the plate fill/key.
function sampleColor(img, x0, y0, x1, y1) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      const i = gp(img, x, y);
      if (img.data[i + 3] < 200) continue;
      r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
    }
  }
  if (!n) return { r: 0, g: 0, b: 0 };
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
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
function resize(img, tw, th) {
  const out = makeImg(tw, th);
  const { w, h, data } = img;
  for (let ty = 0; ty < th; ty++) {
    const sy0 = Math.floor((ty * h) / th);
    const sy1 = Math.max(sy0 + 1, Math.floor(((ty + 1) * h) / th));
    for (let tx = 0; tx < tw; tx++) {
      const sx0 = Math.floor((tx * w) / tw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((tx + 1) * w) / tw));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = gp(img, sx, sy);
          const al = data[i + 3] / 255;
          r += data[i] * al;
          g += data[i + 1] * al;
          b += data[i + 2] * al;
          a += data[i + 3];
          n++;
        }
      }
      const di = gp(out, tx, ty);
      const as = a / 255;
      out.data[di] = as > 0 ? Math.round(r / as) : 0;
      out.data[di + 1] = as > 0 ? Math.round(g / as) : 0;
      out.data[di + 2] = as > 0 ? Math.round(b / as) : 0;
      out.data[di + 3] = Math.round(a / n);
    }
  }
  return out;
}
function writePNG(img, p) {
  const png = new PNG({ width: img.w, height: img.h });
  img.data.copy(png.data);
  fs.writeFileSync(p, PNG.sync.write(png));
}
function checkerboard(w, h, cell = 12) {
  const img = makeImg(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? 54 : 38;
      const i = gp(img, x, y);
      img.data[i] = c;
      img.data[i + 1] = c;
      img.data[i + 2] = c + 4;
      img.data[i + 3] = 255;
    }
  }
  return img;
}
function over(dst, src, ox, oy) {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const dx = ox + x;
      const dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= dst.w || dy >= dst.h) continue;
      const si = gp(src, x, y);
      const di = gp(dst, dx, dy);
      const sa = src.data[si + 3] / 255;
      const da = 1 - sa;
      dst.data[di] = Math.round(src.data[si] * sa + dst.data[di] * da);
      dst.data[di + 1] = Math.round(src.data[si + 1] * sa + dst.data[di + 1] * da);
      dst.data[di + 2] = Math.round(src.data[si + 2] * sa + dst.data[di + 2] * da);
      dst.data[di + 3] = 255;
    }
  }
}

// Badge rect (sheet coords) for a detected band, given the band's plate left x.
function badgeRectFor(band, plateX0) {
  const bandH = band[1] - band[0] + 1;
  const size = Math.round(bandH * 0.92);
  return {
    x: plateX0 + Math.round(bandH * 0.05),
    y: Math.round((band[0] + band[1]) / 2 - size / 2),
    w: size,
    h: size,
  };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sheet = readPNG(FIVE);
  const bg = sampleBg(sheet);
  const bands = detectBands(rowInk(sheet, bg, FLOOD_TOL), sheet.w);
  if (bands.length < 5) throw new Error(`expected 5 bands, got ${bands.length}`);
  console.log(`five-mode ${sheet.w}x${sheet.h}: ${bands.length} bands`);

  // Plate geometry from a plain row (band 1) so the glow on band 0 is excluded.
  const plain = colInkRange(sheet, bg, FLOOD_TOL, bands[1][0], bands[1][1]);
  const plateX0 = plain.x0;
  const plateW = plain.x1 - plain.x0 + 1;
  const plateH = median(bands.slice(1).map((b) => b[1] - b[0] + 1));
  const badge = badgeRectFor(bands[1], plateX0);
  const localBadge = { x: badge.x - plateX0, y: Math.round((plateH - badge.h) / 2), w: badge.w, h: badge.h };
  console.log(`plate ${plateW}x${plateH} @x${plateX0}; icon slot (local) ${JSON.stringify(localBadge)}`);

  // --- frame states (icon-less) ---
  const cropState = (band, glow) => {
    const cy = glow ? Math.round((band[0] + band[1]) / 2 - plateH / 2) : band[0];
    const c = crop(sheet, plateX0, cy, plateW, plateH);
    floodKey(c, bg, FLOOD_TOL);
    // Fill the icon area with this state's plate colour (sampled from clean plate
    // above the label) rather than punching a transparent hole, so a
    // transparent-background badge composites onto continuous plate -> no seam.
    const plate = sampleColor(c, Math.round(plateW * 0.42), 16, Math.round(plateW * 0.58), 42);
    fillRect(c, localBadge, plate);
    return c;
  };
  const normal = cropState(bands[1], false); // plain
  const pressed = cropState(bands[0], true); // glowing -> selected, halo cropped off
  const frameSheet = makeImg(plateW, plateH * 2);
  copyInto(frameSheet, normal, 0, 0);
  copyInto(frameSheet, pressed, 0, plateH);
  writePNG(frameSheet, path.join(OUT_DIR, 'button-9slice.png'));

  // --- icons: crop every badge with the SAME plain-plate geometry (`badge`),
  // centered on each band's plate. The selected row (sword) has a taller inked
  // band because of its glow halo; using per-band height there inflated the crop
  // and baked the halo into the icon. Centering the fixed-size badge on the plate
  // excludes the halo so every icon matches.
  bands.forEach((b, i) => {
    const id = ICON_IDS[i];
    if (!id) return;
    const cy = Math.round((b[0] + b[1]) / 2 - badge.h / 2);
    const badgeImg = crop(sheet, badge.x, cy, badge.w, badge.h);
    // Transparent-background badge: flood-key the navy plate from the corners so
    // only the emblem remains (its border stops the flood). Composites cleanly
    // onto the plate-filled frame — no square seam.
    const plate = sampleColor(badgeImg, 0, 0, Math.round(badge.w * 0.1), Math.round(badge.h * 0.1));
    floodKey(badgeImg, plate, ICON_KEY_TOL);
    writePNG(resize(badgeImg, ICON_PX, ICON_PX), path.join(OUT_DIR, `icon-${id}.png`));
    writePNG(resize(badgeImg, ICON_PX * 2, ICON_PX * 2), path.join(OUT_DIR, `icon-${id}@2x.png`));
  });

  // --- slot rects for the catalog (state-local coords) ---
  const arrowSlot = {
    x: Math.round(plateW * 0.875),
    y: Math.round(plateH * 0.32),
    w: Math.round(plateW * 0.085),
    h: Math.round(plateH * 0.36),
  };
  const textInset = {
    x: localBadge.x + localBadge.w + Math.round(plateW * 0.02),
    y: Math.round(plateH * 0.2),
    w: arrowSlot.x - (localBadge.x + localBadge.w) - Math.round(plateW * 0.04),
    h: Math.round(plateH * 0.6),
  };

  // --- contact sheet ---
  const pad = 16;
  const cw = plateW + pad * 2;
  const ch = pad * 3 + plateH * 2 + Math.round(ICON_PX * 0.6);
  const cs = checkerboard(cw, ch);
  over(cs, normal, pad, pad);
  over(cs, pressed, pad, pad * 2 + plateH);
  const isz = Math.round(ICON_PX * 0.6);
  ICON_IDS.forEach((id, i) => over(cs, resize(readPNG(path.join(OUT_DIR, `icon-${id}.png`)), isz, isz), pad + i * (isz + 8), pad * 3 + plateH * 2));
  writePNG(cs, path.join(OUT_DIR, 'contact-sheet.png'));

  console.log('\n=== paste into asset-catalog.json (button-9slice.main-menu) ===');
  console.log(`sheet: { image: "/assets/ui/main-menu/button-9slice.png", width: ${plateW}, height: ${plateH * 2} }`);
  console.log(`states.normal.rect: { x: 0, y: 0, w: ${plateW}, h: ${plateH} }`);
  console.log(`states.pressed.rect:   { x: 0, y: ${plateH}, w: ${plateW}, h: ${plateH} }`);
  console.log(`rules.iconSlot:  ${JSON.stringify(localBadge)}`);
  console.log(`rules.textInset: ${JSON.stringify(textInset)}`);
  console.log(`rules.arrowSlot: ${JSON.stringify(arrowSlot)}`);
  console.log(`done -> ${path.relative(process.cwd(), OUT_DIR)} (frame + ${ICON_IDS.length} icons + contact sheet)`);
}

main();
