import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const conceptDir = path.join(repoRoot, 'docs', 'art', 'unit-concepts');
const outputPath = path.join(conceptDir, 'accepted-unit-concepts-reference.png');

const pieces = [
  ['pawn', 'pawn-helmet-south-concept.png'],
  ['rook', 'rook-south-concept.png'],
  ['knight', 'knight-south-concept.png'],
  ['bishop', 'bishop-south-concept.png'],
  ['queen', 'queen-south-concept.png'],
  ['king', 'king-south-concept.png'],
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

function findBounds(png) {
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const alpha = png.data[idx(png.width, x, y) + 3];
      if (alpha < 12) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return maxX >= minX ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: png.width - 1, maxY: png.height - 1 };
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

function resizeNearest(png, width, height) {
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

function drawImage(dest, image, x0, y0) {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const dstX = x0 + x;
      const dstY = y0 + y;
      if (dstX < 0 || dstY < 0 || dstX >= dest.width || dstY >= dest.height) continue;
      const src = idx(image.width, x, y);
      const dst = idx(dest.width, dstX, dstY);
      const alpha = image.data[src + 3] / 255;
      dest.data[dst] = Math.round(image.data[src] * alpha + dest.data[dst] * (1 - alpha));
      dest.data[dst + 1] = Math.round(image.data[src + 1] * alpha + dest.data[dst + 1] * (1 - alpha));
      dest.data[dst + 2] = Math.round(image.data[src + 2] * alpha + dest.data[dst + 2] * (1 - alpha));
      dest.data[dst + 3] = 255;
    }
  }
}

function drawText(dest, text, x, y, color = [222, 236, 244, 255]) {
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
    N: ['10001', '11001', '10101', '10011', '10001'],
    O: ['01110', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '11110', '10000', '10000'],
    Q: ['01110', '10001', '10001', '10011', '01111'],
    R: ['11110', '10001', '11110', '10010', '10001'],
    S: ['01111', '10000', '01110', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100'],
    U: ['10001', '10001', '10001', '10001', '01110'],
    W: ['10001', '10001', '10101', '10101', '01010'],
    ' ': ['00000', '00000', '00000', '00000', '00000'],
  };

  let cursor = x;
  for (const char of text.toUpperCase()) {
    const glyph = glyphs[char] ?? glyphs[' '];
    for (let gy = 0; gy < glyph.length; gy += 1) {
      for (let gx = 0; gx < glyph[gy].length; gx += 1) {
        if (glyph[gy][gx] !== '1') continue;
        for (let py = 0; py < 3; py += 1) {
          for (let px = 0; px < 3; px += 1) {
            const dstX = cursor + gx * 3 + px;
            const dstY = y + gy * 3 + py;
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
    cursor += 19;
  }
}

const cellW = 280;
const cellH = 300;
const margin = 28;
const sheet = new PNG({ width: margin * 2 + cellW * pieces.length, height: 380 });

for (let y = 0; y < sheet.height; y += 1) {
  for (let x = 0; x < sheet.width; x += 1) {
    const offset = idx(sheet.width, x, y);
    const checker = Math.floor(x / 20 + y / 20) % 2 === 0;
    const color = checker ? [5, 15, 20, 255] : [9, 25, 32, 255];
    sheet.data[offset] = color[0];
    sheet.data[offset + 1] = color[1];
    sheet.data[offset + 2] = color[2];
    sheet.data[offset + 3] = color[3];
  }
}

drawText(sheet, 'ACCEPTED UNIT CONCEPTS', margin, 20, [94, 192, 232, 255]);

pieces.forEach(([piece, fileName], index) => {
  const x = margin + index * cellW;
  const source = readPng(path.join(conceptDir, fileName));
  const cropped = crop(source, findBounds(source));
  const scale = Math.min(210 / cropped.width, 240 / cropped.height);
  const resized = resizeNearest(cropped, Math.round(cropped.width * scale), Math.round(cropped.height * scale));
  drawImage(sheet, resized, x + Math.floor((cellW - resized.width) / 2), 78);
  drawText(sheet, piece, x + 36, 332, [222, 236, 244, 255]);
});

writePng(outputPath, sheet);
console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
