import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const DIRECTIONS = [
  'south',
  'south-east',
  'east',
  'north-east',
  'north',
  'north-west',
  'west',
  'south-west',
];

const SOURCE_DIR = path.join(
  repoRoot,
  'docs',
  'art',
  'unit-concepts',
  'blender-units',
  'rook-v2',
  'clean',
);

const OUTPUT_DIR = path.join(
  repoRoot,
  'docs',
  'art',
  'unit-concepts',
  'blender-units',
  'rook-v2',
  'pixel',
);

const REVIEW_DIR = path.join(
  repoRoot,
  'docs',
  'art',
  'unit-concepts',
  'blender-units',
  'rook-v2',
);

const FRAME_SIZE = 160;
const TARGET_CONTENT_HEIGHT = 140;
const TARGET_CONTENT_WIDTH = 128;
const ALPHA_THRESHOLD = 18;

const PALETTE = [
  [2, 10, 14],
  [4, 18, 25],
  [6, 29, 38],
  [9, 45, 58],
  [14, 63, 74],
  [21, 84, 94],
  [32, 103, 111],
  [37, 107, 117],
  [60, 86, 91],
  [78, 104, 109],
  [95, 121, 125],
  [116, 139, 139],
  [139, 157, 153],
  [78, 98, 93],
  [94, 110, 103],
  [112, 126, 115],
  [58, 40, 29],
  [83, 57, 38],
  [111, 78, 47],
  [138, 98, 56],
];

function readPng(filePath) {
  return PNG.sync.read(fs.readFileSync(filePath));
}

function writePng(filePath, png) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function idx(width, x, y) {
  return (y * width + x) * 4;
}

function alphaAt(png, x, y) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return 0;
  return png.data[idx(png.width, x, y) + 3];
}

function findBounds(png) {
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (alphaAt(png, x, y) <= ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return { minX: 0, minY: 0, maxX: png.width - 1, maxY: png.height - 1 };
  }

  return { minX, minY, maxX, maxY };
}

function crop(png, bounds) {
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const out = new PNG({ width, height });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = idx(png.width, bounds.minX + x, bounds.minY + y);
      const dst = idx(width, x, y);
      out.data[dst] = png.data[src];
      out.data[dst + 1] = png.data[src + 1];
      out.data[dst + 2] = png.data[src + 2];
      out.data[dst + 3] = png.data[src + 3];
    }
  }

  return out;
}

function nearestResize(png, width, height) {
  const out = new PNG({ width, height });

  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(png.height - 1, Math.floor((y / height) * png.height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(png.width - 1, Math.floor((x / width) * png.width));
      const src = idx(png.width, sx, sy);
      const dst = idx(width, x, y);
      out.data[dst] = png.data[src];
      out.data[dst + 1] = png.data[src + 1];
      out.data[dst + 2] = png.data[src + 2];
      out.data[dst + 3] = png.data[src + 3];
    }
  }

  return out;
}

function nearestPaletteColor(r, g, b) {
  let best = PALETTE[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const color of PALETTE) {
    const dr = r - color[0];
    const dg = g - color[1];
    const db = b - color[2];
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      best = color;
      bestDistance = distance;
    }
  }

  return best;
}

function quantizeSprite(png) {
  const out = new PNG({ width: png.width, height: png.height });

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = idx(png.width, x, y);
      const alpha = png.data[offset + 3];
      if (alpha <= ALPHA_THRESHOLD) {
        out.data[offset] = 0;
        out.data[offset + 1] = 0;
        out.data[offset + 2] = 0;
        out.data[offset + 3] = 0;
        continue;
      }

      const normalizedAlpha = Math.min(255, Math.max(0, Math.round(alpha * 1.25)));
      const contrast = 1.18;
      const brightness = -6;
      const r = Math.min(255, Math.max(0, (png.data[offset] - 128) * contrast + 128 + brightness));
      const g = Math.min(255, Math.max(0, (png.data[offset + 1] - 128) * contrast + 128 + brightness));
      const b = Math.min(255, Math.max(0, (png.data[offset + 2] - 128) * contrast + 128 + brightness));
      const [qr, qg, qb] = nearestPaletteColor(r, g, b);

      out.data[offset] = qr;
      out.data[offset + 1] = qg;
      out.data[offset + 2] = qb;
      out.data[offset + 3] = normalizedAlpha;
    }
  }

  return out;
}

function addOutline(png) {
  const out = new PNG({ width: png.width, height: png.height });
  png.data.copy(out.data);

  const outline = [1, 8, 11, 255];
  const rim = [42, 112, 124, 255];

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = idx(png.width, x, y);
      const alpha = png.data[offset + 3];
      if (alpha > ALPHA_THRESHOLD) {
        const hasTransparentNeighbor =
          alphaAt(png, x - 1, y) <= ALPHA_THRESHOLD ||
          alphaAt(png, x + 1, y) <= ALPHA_THRESHOLD ||
          alphaAt(png, x, y - 1) <= ALPHA_THRESHOLD ||
          alphaAt(png, x, y + 1) <= ALPHA_THRESHOLD;

        if (hasTransparentNeighbor && x < png.width * 0.45 && y < png.height * 0.55) {
          out.data[offset] = Math.max(out.data[offset], rim[0]);
          out.data[offset + 1] = Math.max(out.data[offset + 1], rim[1]);
          out.data[offset + 2] = Math.max(out.data[offset + 2], rim[2]);
          out.data[offset + 3] = 255;
        }
        continue;
      }

      const touchesOpaque =
        alphaAt(png, x - 1, y) > ALPHA_THRESHOLD ||
        alphaAt(png, x + 1, y) > ALPHA_THRESHOLD ||
        alphaAt(png, x, y - 1) > ALPHA_THRESHOLD ||
        alphaAt(png, x, y + 1) > ALPHA_THRESHOLD ||
        alphaAt(png, x - 1, y - 1) > ALPHA_THRESHOLD ||
        alphaAt(png, x + 1, y - 1) > ALPHA_THRESHOLD ||
        alphaAt(png, x - 1, y + 1) > ALPHA_THRESHOLD ||
        alphaAt(png, x + 1, y + 1) > ALPHA_THRESHOLD;

      if (touchesOpaque) {
        out.data[offset] = outline[0];
        out.data[offset + 1] = outline[1];
        out.data[offset + 2] = outline[2];
        out.data[offset + 3] = outline[3];
      }
    }
  }

  return out;
}

function placeOnFrame(png) {
  const out = new PNG({ width: FRAME_SIZE, height: FRAME_SIZE });
  const x0 = Math.floor((FRAME_SIZE - png.width) / 2);
  const y0 = FRAME_SIZE - png.height - 10;

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const src = idx(png.width, x, y);
      const alpha = png.data[src + 3];
      if (alpha <= 0) continue;
      const dstX = x0 + x;
      const dstY = y0 + y;
      if (dstX < 0 || dstY < 0 || dstX >= FRAME_SIZE || dstY >= FRAME_SIZE) continue;
      const dst = idx(FRAME_SIZE, dstX, dstY);
      out.data[dst] = png.data[src];
      out.data[dst + 1] = png.data[src + 1];
      out.data[dst + 2] = png.data[src + 2];
      out.data[dst + 3] = png.data[src + 3];
    }
  }

  return out;
}

function processSprite(source) {
  const bounds = findBounds(source);
  const cropped = crop(source, bounds);
  const scale = Math.min(
    TARGET_CONTENT_WIDTH / cropped.width,
    TARGET_CONTENT_HEIGHT / cropped.height,
  );
  const resized = nearestResize(
    cropped,
    Math.max(1, Math.round(cropped.width * scale)),
    Math.max(1, Math.round(cropped.height * scale)),
  );
  const quantized = quantizeSprite(resized);
  const outlined = addOutline(quantized);
  return placeOnFrame(outlined);
}

function checkerPixel(x, y) {
  const cell = 12;
  const dark = Math.floor(x / cell + y / cell) % 2 === 0;
  return dark ? [6, 15, 20, 255] : [10, 24, 31, 255];
}

function drawPng(dest, source, x0, y0, scale = 1, withChecker = false) {
  for (let y = 0; y < source.height * scale; y += 1) {
    for (let x = 0; x < source.width * scale; x += 1) {
      const dstX = x0 + x;
      const dstY = y0 + y;
      if (dstX < 0 || dstY < 0 || dstX >= dest.width || dstY >= dest.height) continue;

      const sx = Math.floor(x / scale);
      const sy = Math.floor(y / scale);
      const src = idx(source.width, sx, sy);
      const dst = idx(dest.width, dstX, dstY);
      const alpha = source.data[src + 3] / 255;
      const base = withChecker ? checkerPixel(dstX, dstY) : [0, 0, 0, 0];

      dest.data[dst] = Math.round(source.data[src] * alpha + base[0] * (1 - alpha));
      dest.data[dst + 1] = Math.round(source.data[src + 1] * alpha + base[1] * (1 - alpha));
      dest.data[dst + 2] = Math.round(source.data[src + 2] * alpha + base[2] * (1 - alpha));
      dest.data[dst + 3] = 255;
    }
  }
}

function drawText(dest, text, x, y, color = [184, 209, 222, 255]) {
  // Tiny block labels keep the review sheet dependency-free.
  const glyphs = {
    A: ['01110', '10001', '11111', '10001', '10001'],
    B: ['11110', '10001', '11110', '10001', '11110'],
    C: ['01111', '10000', '10000', '10000', '01111'],
    D: ['11110', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '11110', '10000', '11111'],
    G: ['01111', '10000', '10011', '10001', '01111'],
    H: ['10001', '10001', '11111', '10001', '10001'],
    I: ['11111', '00100', '00100', '00100', '11111'],
    K: ['10001', '10010', '11100', '10010', '10001'],
    L: ['10000', '10000', '10000', '10000', '11111'],
    N: ['10001', '11001', '10101', '10011', '10001'],
    O: ['01110', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '11110', '10000', '10000'],
    R: ['11110', '10001', '11110', '10010', '10001'],
    S: ['01111', '10000', '01110', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100'],
    U: ['10001', '10001', '10001', '10001', '01110'],
    V: ['10001', '10001', '10001', '01010', '00100'],
    W: ['10001', '10001', '10101', '10101', '01010'],
    X: ['10001', '01010', '00100', '01010', '10001'],
    '-': ['00000', '00000', '01110', '00000', '00000'],
    ' ': ['00000', '00000', '00000', '00000', '00000'],
  };

  let cursor = x;
  for (const raw of text.toUpperCase()) {
    const glyph = glyphs[raw] ?? glyphs[' '];
    for (let gy = 0; gy < glyph.length; gy += 1) {
      for (let gx = 0; gx < glyph[gy].length; gx += 1) {
        if (glyph[gy][gx] !== '1') continue;
        for (let py = 0; py < 2; py += 1) {
          for (let px = 0; px < 2; px += 1) {
            const dstX = cursor + gx * 2 + px;
            const dstY = y + gy * 2 + py;
            if (dstX < 0 || dstY < 0 || dstX >= dest.width || dstY >= dest.height) continue;
            const dst = idx(dest.width, dstX, dstY);
            dest.data[dst] = color[0];
            dest.data[dst + 1] = color[1];
            dest.data[dst + 2] = color[2];
            dest.data[dst + 3] = color[3];
          }
        }
      }
    }
    cursor += 12;
  }
}

function makeContactSheet(processed) {
  const cellWidth = 220;
  const cellHeight = 210;
  const header = 36;
  const sheet = new PNG({ width: cellWidth * DIRECTIONS.length, height: header + cellHeight * 2 });

  for (let y = 0; y < sheet.height; y += 1) {
    for (let x = 0; x < sheet.width; x += 1) {
      const offset = idx(sheet.width, x, y);
      const color = y < header ? [3, 13, 18, 255] : checkerPixel(x, y);
      sheet.data[offset] = color[0];
      sheet.data[offset + 1] = color[1];
      sheet.data[offset + 2] = color[2];
      sheet.data[offset + 3] = color[3];
    }
  }

  DIRECTIONS.forEach((direction, column) => {
    const x = column * cellWidth;
    drawText(sheet, direction, x + 14, 12, [99, 190, 229, 255]);
    drawText(sheet, 'raw', x + 14, header + 12, [120, 145, 155, 255]);
    drawText(sheet, 'pixel', x + 14, header + cellHeight + 12, [120, 145, 155, 255]);

    const raw = processed[direction].raw;
    const rawBounds = findBounds(raw);
    const rawCrop = crop(raw, rawBounds);
    const rawScale = Math.max(1, Math.floor(Math.min(170 / rawCrop.width, 150 / rawCrop.height)));
    const rawPreview = nearestResize(
      rawCrop,
      Math.max(1, Math.round(rawCrop.width * Math.min(170 / rawCrop.width, 150 / rawCrop.height))),
      Math.max(1, Math.round(rawCrop.height * Math.min(170 / rawCrop.width, 150 / rawCrop.height))),
    );
    drawPng(sheet, rawPreview, x + Math.floor((cellWidth - rawPreview.width * rawScale) / 2), header + 42, rawScale, true);

    const pixelScale = 1;
    drawPng(sheet, processed[direction].pixel, x + Math.floor((cellWidth - FRAME_SIZE * pixelScale) / 2), header + cellHeight + 38, pixelScale, true);
  });

  return sheet;
}

fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const processed = {};
for (const direction of DIRECTIONS) {
  const sourcePath = path.join(SOURCE_DIR, `${direction}.png`);
  const source = readPng(sourcePath);
  const pixel = processSprite(source);
  const outputPath = path.join(OUTPUT_DIR, `${direction}.png`);
  writePng(outputPath, pixel);
  processed[direction] = { raw: source, pixel };
}

const contactSheetPath = path.join(REVIEW_DIR, 'rook-v2-pixel-contact-sheet.png');
writePng(contactSheetPath, makeContactSheet(processed));

console.log(`Wrote ${DIRECTIONS.length} processed rook sprites to ${path.relative(repoRoot, OUTPUT_DIR)}`);
console.log(`Wrote review sheet to ${path.relative(repoRoot, contactSheetPath)}`);
