import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNIT_ROOT = path.join(ROOT, 'public', 'assets', 'units');
const CONCEPT_ROOT = path.join(UNIT_ROOT, 'concepts');
const OUTPUT_SIZE = 128;
const SOURCE_PADDING = 24;

const PIECES = [
  { id: 'pawn', label: 'Pawn', concept: 'pawn-helmet-south-concept.png' },
  { id: 'rook', label: 'Rook', concept: 'rook-south-concept.png' },
  { id: 'knight', label: 'Knight', concept: 'knight-south-concept.png' },
  { id: 'bishop', label: 'Bishop', concept: 'bishop-south-concept.png' },
  { id: 'queen', label: 'Queen', concept: 'queen-south-concept.png' },
  { id: 'king', label: 'King', concept: 'king-south-concept.png' },
];

const VARIANTS = {
  blue: { hue: 213, saturationScale: 1, lightnessScale: 1 },
  red: { hue: 358, saturationScale: 1.03, lightnessScale: 0.98 },
  neutral: { hue: 216, saturationScale: 0.12, lightnessScale: 0.86 },
};

const indexOf = (png, x, y) => (y * png.width + x) * 4;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const relativeToRoot = (targetPath) => path.relative(ROOT, targetPath).replaceAll(path.sep, '/');

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }

  return [h, s, l];
}

function hueToRgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  h /= 360;
  let r;
  let g;
  let b;

  if (s === 0) {
    r = l;
    g = l;
    b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function colorStats(png, x, y) {
  const i = indexOf(png, x, y);
  const r = png.data[i];
  const g = png.data[i + 1];
  const b = png.data[i + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return { r, g, b, max, min, chroma: max - min, luma };
}

function isSalientPixel(png, x, y) {
  const { r, g, b, max, chroma, luma } = colorStats(png, x, y);
  const blueSprite = b >= r + 16 && b >= g - 8 && chroma >= 22 && max >= 42;
  const goldTrim = r >= 115 && g >= 75 && b <= 85 && chroma >= 34;
  const redOrWarmTrim = r >= 95 && r >= b + 28 && chroma >= 32 && luma >= 42;
  const steelOrHighlight = luma >= 74 && chroma >= 10;
  return blueSprite || goldTrim || redOrWarmTrim || steelOrHighlight;
}

function isFloodableBackground(png, x, y, protectedMask) {
  const p = y * png.width + x;
  if (protectedMask[p]) return false;
  const { r, g, b, max, chroma, luma } = colorStats(png, x, y);
  const darkVignette = luma <= 35 && r <= 35 && g <= 42 && b <= 58;
  const dimBlueVignette = max <= 72 && chroma <= 34 && b >= r;
  const lightCheckerMatte = luma >= 96 && chroma <= 22;
  return darkVignette || dimBlueVignette || lightCheckerMatte;
}

function dilate(mask, width, height, radius) {
  let current = mask;
  for (let pass = 0; pass < radius; pass += 1) {
    const next = new Uint8Array(current);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const p = y * width + x;
        if (current[p]) continue;
        if (
          current[p - 1] ||
          current[p + 1] ||
          current[p - width] ||
          current[p + width] ||
          current[p - width - 1] ||
          current[p - width + 1] ||
          current[p + width - 1] ||
          current[p + width + 1]
        ) {
          next[p] = 1;
        }
      }
    }
    current = next;
  }
  return current;
}

function buildSalienceMask(png) {
  const mask = new Uint8Array(png.width * png.height);
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (isSalientPixel(png, x, y)) mask[y * png.width + x] = 1;
    }
  }
  return dilate(mask, png.width, png.height, 7);
}

function floodBackground(png, protectedMask) {
  const { width, height } = png;
  const background = new Uint8Array(width * height);
  const queue = [];

  function enqueue(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (background[p] || !isFloodableBackground(png, x, y, protectedMask)) return;
    background[p] = 1;
    queue.push(p);
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  for (let head = 0; head < queue.length; head += 1) {
    const p = queue[head];
    const x = p % width;
    const y = Math.floor(p / width);
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  return background;
}

function largestForegroundComponent(png, backgroundMask) {
  const { width, height } = png;
  const seen = new Uint8Array(width * height);
  let best = [];

  for (let start = 0; start < width * height; start += 1) {
    if (seen[start] || backgroundMask[start]) continue;
    const queue = [start];
    const component = [];
    seen[start] = 1;

    for (let head = 0; head < queue.length; head += 1) {
      const p = queue[head];
      component.push(p);
      const x = p % width;
      const y = Math.floor(p / width);
      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (!seen[n] && !backgroundMask[n]) {
          seen[n] = 1;
          queue.push(n);
        }
      }
    }

    if (component.length > best.length) best = component;
  }

  const mask = new Uint8Array(width * height);
  for (const p of best) mask[p] = 1;
  return { mask, pixels: best.length };
}

function bboxForMask(mask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) throw new Error('No foreground component found in concept image.');

  const paddedMinX = clamp(minX - SOURCE_PADDING, 0, width - 1);
  const paddedMinY = clamp(minY - SOURCE_PADDING, 0, height - 1);
  const paddedMaxX = clamp(maxX + SOURCE_PADDING, 0, width - 1);
  const paddedMaxY = clamp(maxY + SOURCE_PADDING, 0, height - 1);

  return {
    x: paddedMinX,
    y: paddedMinY,
    width: paddedMaxX - paddedMinX + 1,
    height: paddedMaxY - paddedMinY + 1,
  };
}

function isTeamBluePixel(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  return h >= 185 && h <= 230 && s >= 0.22 && l >= 0.12 && b >= r + 14 && b >= g - 18;
}

function recolorPixel(r, g, b, variant) {
  if (!isTeamBluePixel(r, g, b)) return [r, g, b];
  const [, s, l] = rgbToHsl(r, g, b);
  return hslToRgb(
    variant.hue,
    clamp(s * variant.saturationScale, 0, 1),
    clamp(l * variant.lightnessScale, 0, 1),
  );
}

function resampleSprite(source, foregroundMask, crop, variant) {
  const out = new PNG({ width: OUTPUT_SIZE, height: OUTPUT_SIZE });
  const scale = Math.min(OUTPUT_SIZE / crop.width, OUTPUT_SIZE / crop.height);
  const drawnWidth = Math.max(1, Math.round(crop.width * scale));
  const drawnHeight = Math.max(1, Math.round(crop.height * scale));
  const offsetX = Math.floor((OUTPUT_SIZE - drawnWidth) / 2);
  const offsetY = Math.floor((OUTPUT_SIZE - drawnHeight) / 2);
  let opaquePixels = 0;

  for (let y = 0; y < drawnHeight; y += 1) {
    for (let x = 0; x < drawnWidth; x += 1) {
      const sx = clamp(crop.x + Math.floor(x / scale), 0, source.width - 1);
      const sy = clamp(crop.y + Math.floor(y / scale), 0, source.height - 1);
      const sourceMaskIndex = sy * source.width + sx;
      const targetIndex = ((offsetY + y) * OUTPUT_SIZE + offsetX + x) * 4;

      if (!foregroundMask[sourceMaskIndex]) {
        out.data[targetIndex + 3] = 0;
        continue;
      }

      const sourceIndex = indexOf(source, sx, sy);
      const [r, g, b] = recolorPixel(
        source.data[sourceIndex],
        source.data[sourceIndex + 1],
        source.data[sourceIndex + 2],
        variant,
      );
      out.data[targetIndex] = r;
      out.data[targetIndex + 1] = g;
      out.data[targetIndex + 2] = b;
      out.data[targetIndex + 3] = source.data[sourceIndex + 3];
      opaquePixels += out.data[targetIndex + 3] > 0 ? 1 : 0;
    }
  }

  return { png: out, drawnWidth, drawnHeight, offsetX, offsetY, opaquePixels };
}

function generatePiece(piece) {
  const sourcePath = path.join(CONCEPT_ROOT, piece.concept);
  const outRoot = path.join(UNIT_ROOT, piece.id);
  const source = PNG.sync.read(fs.readFileSync(sourcePath));
  const protectedMask = buildSalienceMask(source);
  const backgroundMask = floodBackground(source, protectedMask);
  const { mask: foregroundMask, pixels: foregroundPixels } = largestForegroundComponent(source, backgroundMask);
  const crop = bboxForMask(foregroundMask, source.width, source.height);
  const outputs = {};

  for (const [name, variant] of Object.entries(VARIANTS)) {
    const outDir = path.join(outRoot, name);
    fs.mkdirSync(outDir, { recursive: true });
    const result = resampleSprite(source, foregroundMask, crop, variant);
    const outPath = path.join(outDir, 'south.png');
    fs.writeFileSync(outPath, PNG.sync.write(result.png));
    outputs[name] = {
      path: relativeToRoot(outPath),
      width: OUTPUT_SIZE,
      height: OUTPUT_SIZE,
      drawnWidth: result.drawnWidth,
      drawnHeight: result.drawnHeight,
      offsetX: result.offsetX,
      offsetY: result.offsetY,
      opaquePixels: result.opaquePixels,
    };
  }

  const sourcePixels = source.width * source.height;
  const backgroundPixels = backgroundMask.reduce((count, value) => count + value, 0);
  const protectedPixels = protectedMask.reduce((count, value) => count + value, 0);
  const report = {
    piece: piece.id,
    label: piece.label,
    source: relativeToRoot(sourcePath),
    sourceWidth: source.width,
    sourceHeight: source.height,
    outputSize: OUTPUT_SIZE,
    crop,
    stats: {
      sourcePixels,
      protectedPixels,
      backgroundPixels,
      foregroundPixels,
      foregroundCoverage: Number((foregroundPixels / sourcePixels).toFixed(4)),
    },
    notes: [
      'Deterministic first-pass matte from color salience plus edge-connected dark-background flood fill.',
      'Background removal is approximate; dark outer shadow pixels can be lost and dark halo pixels near protected color regions can remain.',
      'Team variants recolor only saturated blue/cyan sprite pixels; gold, white, black, red, and steel trim are intentionally preserved.',
    ],
    outputs,
  };

  fs.mkdirSync(outRoot, { recursive: true });
  fs.writeFileSync(path.join(outRoot, 'extraction-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function main() {
  const reports = PIECES.map(generatePiece);
  const combinedReport = {
    generatedAt: new Date(0).toISOString(),
    outputSize: OUTPUT_SIZE,
    pieces: Object.fromEntries(reports.map((report) => [report.piece, report])),
  };

  fs.writeFileSync(path.join(UNIT_ROOT, 'extraction-report.json'), `${JSON.stringify(combinedReport, null, 2)}\n`);
  console.log(`Generated ${reports.length} south-facing unit sprite sets in ${relativeToRoot(UNIT_ROOT)}`);
}

main();
