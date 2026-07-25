import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const root = path.join(repoRoot, 'docs', 'art', 'unit-concepts', 'blender-units', 'rook-v2', 'pixel-first');
const directions = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];
const rows = ['clean', 'debug'];

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

function checker(x, y) {
  const cell = 10;
  return Math.floor(x / cell + y / cell) % 2 === 0 ? [5, 14, 19, 255] : [9, 23, 30, 255];
}

function drawPng(dest, source, x0, y0, scale = 2) {
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
      const bg = checker(dstX, dstY);
      dest.data[dst] = Math.round(source.data[src] * alpha + bg[0] * (1 - alpha));
      dest.data[dst + 1] = Math.round(source.data[src + 1] * alpha + bg[1] * (1 - alpha));
      dest.data[dst + 2] = Math.round(source.data[src + 2] * alpha + bg[2] * (1 - alpha));
      dest.data[dst + 3] = 255;
    }
  }
}

function drawBlockText(dest, text, x, y, color = [104, 195, 231, 255]) {
  const glyphs = {
    A: ['01110', '10001', '11111', '10001', '10001'],
    B: ['11110', '10001', '11110', '10001', '11110'],
    C: ['01111', '10000', '10000', '10000', '01111'],
    D: ['11110', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '11110', '10000', '11111'],
    G: ['01111', '10000', '10011', '10001', '01111'],
    H: ['10001', '10001', '11111', '10001', '10001'],
    I: ['11111', '00100', '00100', '00100', '11111'],
    L: ['10000', '10000', '10000', '10000', '11111'],
    N: ['10001', '11001', '10101', '10011', '10001'],
    O: ['01110', '10001', '10001', '10001', '01110'],
    R: ['11110', '10001', '11110', '10010', '10001'],
    S: ['01111', '10000', '01110', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100'],
    U: ['10001', '10001', '10001', '10001', '01110'],
    W: ['10001', '10001', '10101', '10101', '01010'],
    '-': ['00000', '00000', '01110', '00000', '00000'],
    ' ': ['00000', '00000', '00000', '00000', '00000'],
  };

  let cx = x;
  for (const char of text.toUpperCase()) {
    const glyph = glyphs[char] ?? glyphs[' '];
    for (let gy = 0; gy < glyph.length; gy += 1) {
      for (let gx = 0; gx < glyph[gy].length; gx += 1) {
        if (glyph[gy][gx] !== '1') continue;
        for (let py = 0; py < 2; py += 1) {
          for (let px = 0; px < 2; px += 1) {
            const dstX = cx + gx * 2 + px;
            const dstY = y + gy * 2 + py;
            const dst = idx(dest.width, dstX, dstY);
            dest.data[dst] = color[0];
            dest.data[dst + 1] = color[1];
            dest.data[dst + 2] = color[2];
            dest.data[dst + 3] = color[3];
          }
        }
      }
    }
    cx += 12;
  }
}

const cellW = 220;
const cellH = 360;
const headerH = 36;
const sheet = new PNG({ width: cellW * directions.length, height: headerH + cellH * rows.length });

for (let y = 0; y < sheet.height; y += 1) {
  for (let x = 0; x < sheet.width; x += 1) {
    const offset = idx(sheet.width, x, y);
    const color = y < headerH ? [3, 12, 17, 255] : checker(x, y);
    sheet.data[offset] = color[0];
    sheet.data[offset + 1] = color[1];
    sheet.data[offset + 2] = color[2];
    sheet.data[offset + 3] = 255;
  }
}

directions.forEach((direction, column) => {
  drawBlockText(sheet, direction, column * cellW + 12, 12);
  rows.forEach((row, rowIndex) => {
    const image = readPng(path.join(root, row, `${direction}.png`));
    const x = column * cellW + Math.floor((cellW - image.width * 2) / 2);
    const y = headerH + rowIndex * cellH + 28;
    drawBlockText(sheet, row, column * cellW + 12, headerH + rowIndex * cellH + 10, [176, 198, 210, 255]);
    drawPng(sheet, image, x, y, 2);
  });
});

const out = path.join(root, 'rook-v2-pixel-first-contact-sheet.png');
writePng(out, sheet);
console.log(`Wrote ${path.relative(repoRoot, out)}`);
