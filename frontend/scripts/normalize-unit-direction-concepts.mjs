import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const FRONTEND_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.join(FRONTEND_ROOT, '..');
const SOURCE_ROOT = path.join(REPO_ROOT, 'docs', 'art', 'unit-concepts', 'directions');
const OUTPUT_ROOT = path.join(FRONTEND_ROOT, 'public', 'assets', 'units', 'normalized-concepts');
const OUTPUT_SIZE = 160;
const MAX_FOREGROUND_HEIGHT = 132;
const BASELINE_Y = 148;
const MASK_DILATION_RADIUS = 7;
const DIRECTIONS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

const indexOf = (png, x, y) => (y * png.width + x) * 4;
const maskIndex = (width, x, y) => y * width + x;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const relativeToRepo = (targetPath) => path.relative(REPO_ROOT, targetPath).replaceAll(path.sep, '/');

function pixelStats(png, x, y) {
  const i = indexOf(png, x, y);
  const r = png.data[i];
  const g = png.data[i + 1];
  const b = png.data[i + 2];
  const a = png.data[i + 3];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return { r, g, b, a, max, min, chroma: max - min, luma };
}

function isSalientPixel(png, x, y) {
  const { r, g, b, max, chroma, luma, a } = pixelStats(png, x, y);
  if (a <= 8) return false;
  const blueSprite = b >= r + 14 && b >= g - 10 && chroma >= 20 && max >= 38;
  const goldTrim = r >= 112 && g >= 72 && b <= 94 && chroma >= 30;
  const redOrWarmTrim = r >= 88 && r >= b + 24 && chroma >= 28 && luma >= 38;
  const steelOrHighlight = luma >= 66 && chroma >= 10 && max <= 235;
  const darkInk = luma <= 82 && max <= 132 && chroma >= 8;
  return blueSprite || goldTrim || redOrWarmTrim || steelOrHighlight || darkInk;
}

function isFloodableBackground(png, x, y, protectedMask) {
  const p = maskIndex(png.width, x, y);
  if (protectedMask[p]) return false;
  const { r, g, b, a, max, chroma, luma } = pixelStats(png, x, y);
  if (a <= 8) return true;

  const lightChecker = luma >= 214 && chroma <= 18;
  const warmLightMatte = r >= 215 && g >= 210 && b >= 205 && chroma <= 28;
  const darkVignette = luma <= 35 && r <= 36 && g <= 44 && b <= 60;
  const dimBlueVignette = max <= 72 && chroma <= 34 && b >= r;
  return lightChecker || warmLightMatte || darkVignette || dimBlueVignette;
}

function dilate(mask, width, height, radius) {
  let current = mask;
  for (let pass = 0; pass < radius; pass += 1) {
    const next = new Uint8Array(current);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const p = maskIndex(width, x, y);
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

function buildProtectedMask(png) {
  const mask = new Uint8Array(png.width * png.height);
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (isSalientPixel(png, x, y)) mask[maskIndex(png.width, x, y)] = 1;
    }
  }
  return dilate(mask, png.width, png.height, MASK_DILATION_RADIUS);
}

function floodBackground(png, protectedMask) {
  const { width, height } = png;
  const background = new Uint8Array(width * height);
  const queue = [];

  function enqueue(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = maskIndex(width, x, y);
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
    const sourceIndex = start * 4;
    if (png.data[sourceIndex + 3] <= 8) continue;

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
        const n = maskIndex(width, nx, ny);
        const ni = n * 4;
        if (!seen[n] && !backgroundMask[n] && png.data[ni + 3] > 8) {
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
      if (!mask[maskIndex(width, x, y)]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) throw new Error('No foreground component found.');

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    maxX,
    maxY,
  };
}

function edgeTouchFlags(bbox, sourceWidth, sourceHeight) {
  return {
    top: bbox.y <= 0,
    right: bbox.maxX >= sourceWidth - 1,
    bottom: bbox.maxY >= sourceHeight - 1,
    left: bbox.x <= 0,
  };
}

function hasAnyEdgeTouch(flags) {
  return flags.top || flags.right || flags.bottom || flags.left;
}

function resampleNearest(source, foregroundMask, bbox) {
  const out = new PNG({ width: OUTPUT_SIZE, height: OUTPUT_SIZE });
  const scale = Math.min(MAX_FOREGROUND_HEIGHT / bbox.height, OUTPUT_SIZE / bbox.width);
  const drawnWidth = Math.max(1, Math.round(bbox.width * scale));
  const drawnHeight = Math.max(1, Math.round(bbox.height * scale));
  const offsetX = Math.floor((OUTPUT_SIZE - drawnWidth) / 2);
  const offsetY = clamp(BASELINE_Y - drawnHeight + 1, 0, OUTPUT_SIZE - drawnHeight);
  let opaquePixels = 0;

  for (let y = 0; y < drawnHeight; y += 1) {
    for (let x = 0; x < drawnWidth; x += 1) {
      const sx = clamp(bbox.x + Math.floor(x / scale), 0, source.width - 1);
      const sy = clamp(bbox.y + Math.floor(y / scale), 0, source.height - 1);
      const sourceMaskIndex = maskIndex(source.width, sx, sy);
      if (!foregroundMask[sourceMaskIndex]) continue;

      const sourceIndex = indexOf(source, sx, sy);
      const targetIndex = indexOf(out, offsetX + x, offsetY + y);
      out.data[targetIndex] = source.data[sourceIndex];
      out.data[targetIndex + 1] = source.data[sourceIndex + 1];
      out.data[targetIndex + 2] = source.data[sourceIndex + 2];
      out.data[targetIndex + 3] = source.data[sourceIndex + 3];
      opaquePixels += out.data[targetIndex + 3] > 0 ? 1 : 0;
    }
  }

  return {
    png: out,
    scale: Number(scale.toFixed(6)),
    drawnWidth,
    drawnHeight,
    offsetX,
    offsetY,
    baselineY: BASELINE_Y,
    opaquePixels,
  };
}

function normalizeOne(piece, direction) {
  const sourcePath = path.join(SOURCE_ROOT, piece, `${direction}.png`);
  const outputPath = path.join(OUTPUT_ROOT, piece, `${direction}.png`);
  const source = PNG.sync.read(fs.readFileSync(sourcePath));
  const protectedMask = buildProtectedMask(source);
  const backgroundMask = floodBackground(source, protectedMask);
  const { mask: foregroundMask, pixels: foregroundPixels } = largestForegroundComponent(source, backgroundMask);
  const bbox = bboxForMask(foregroundMask, source.width, source.height);
  const edgeTouch = edgeTouchFlags(bbox, source.width, source.height);
  const rendered = resampleNearest(source, foregroundMask, bbox);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, PNG.sync.write(rendered.png));

  const sourcePixels = source.width * source.height;
  const backgroundPixels = backgroundMask.reduce((count, value) => count + value, 0);
  const protectedPixels = protectedMask.reduce((count, value) => count + value, 0);

  return {
    piece,
    direction,
    source: relativeToRepo(sourcePath),
    output: relativeToRepo(outputPath),
    sourceWidth: source.width,
    sourceHeight: source.height,
    bbox,
    scale: rendered.scale,
    drawnWidth: rendered.drawnWidth,
    drawnHeight: rendered.drawnHeight,
    offsetX: rendered.offsetX,
    offsetY: rendered.offsetY,
    baselineY: rendered.baselineY,
    opaquePixels: rendered.opaquePixels,
    edgeTouch,
    flags: {
      foregroundTouchesSourceEdge: hasAnyEdgeTouch(edgeTouch),
      lowOpaquePixels: rendered.opaquePixels < 100,
    },
    stats: {
      sourcePixels,
      protectedPixels,
      backgroundPixels,
      foregroundPixels,
      foregroundCoverage: Number((foregroundPixels / sourcePixels).toFixed(4)),
    },
  };
}

function discoverPieces() {
  return fs
    .readdirSync(SOURCE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function assertInputs(pieces) {
  const missing = [];
  for (const piece of pieces) {
    for (const direction of DIRECTIONS) {
      const sourcePath = path.join(SOURCE_ROOT, piece, `${direction}.png`);
      if (!fs.existsSync(sourcePath)) missing.push(relativeToRepo(sourcePath));
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing directional concept PNGs:\n${missing.map((item) => `- ${item}`).join('\n')}`);
  }
}

function main() {
  const strict = process.argv.includes('--strict');
  const pieces = discoverPieces();
  assertInputs(pieces);

  const entries = [];
  const byPiece = {};
  for (const piece of pieces) {
    byPiece[piece] = {};
    for (const direction of DIRECTIONS) {
      const report = normalizeOne(piece, direction);
      byPiece[piece][direction] = report;
      entries.push(report);
    }
  }

  const flagged = entries.filter((entry) =>
    entry.flags.foregroundTouchesSourceEdge || entry.flags.lowOpaquePixels
  );
  const report = {
    generatedAt: new Date(0).toISOString(),
    sourceRoot: relativeToRepo(SOURCE_ROOT),
    outputRoot: relativeToRepo(OUTPUT_ROOT),
    outputSize: OUTPUT_SIZE,
    maxForegroundHeight: MAX_FOREGROUND_HEIGHT,
    baselineY: BASELINE_Y,
    directions: DIRECTIONS,
    pieces: byPiece,
    flagged: flagged.map((entry) => ({
      piece: entry.piece,
      direction: entry.direction,
      output: entry.output,
      flags: entry.flags,
      edgeTouch: entry.edgeTouch,
    })),
    notes: [
      'Deterministic matte extends the south-facing sprite extractor with light/checker background flood fill.',
      'Each direction is scaled to the shared max foreground height, horizontally centered, and bottom-aligned to the shared baseline.',
      'Foreground edge-touch is reported as a QA flag; pass --strict to make flags fail the command.',
    ],
  };

  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'qa-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  if (strict && flagged.length > 0) {
    throw new Error(`Normalized ${entries.length} concepts with ${flagged.length} QA flag(s). See ${relativeToRepo(path.join(OUTPUT_ROOT, 'qa-report.json'))}`);
  }

  console.log(
    `Normalized ${entries.length} unit direction concepts to ${relativeToRepo(OUTPUT_ROOT)} ` +
      `(${flagged.length} QA flag${flagged.length === 1 ? '' : 's'}).`
  );
}

main();
