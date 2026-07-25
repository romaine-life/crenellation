import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const variant = process.argv[2] ?? "rook-v3";
const sourceDir = path.join(repoRoot, "docs", "art", "unit-concepts", "blender-units", variant, "clean");
const outputPath = path.join(repoRoot, "docs", "art", "unit-concepts", "blender-units", variant, `${variant}-render-contact-sheet.png`);
const directions = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"];

function readPng(filePath) {
  return PNG.sync.read(fs.readFileSync(filePath));
}

function idx(width, x, y) {
  return (y * width + x) * 4;
}

function checker(x, y) {
  const dark = Math.floor(x / 16 + y / 16) % 2 === 0;
  return dark ? [8, 18, 25, 255] : [13, 30, 40, 255];
}

function draw(dest, src, x0, y0, scale) {
  for (let y = 0; y < src.height * scale; y += 1) {
    for (let x = 0; x < src.width * scale; x += 1) {
      const dx = x0 + x;
      const dy = y0 + y;
      if (dx < 0 || dy < 0 || dx >= dest.width || dy >= dest.height) continue;
      const sx = Math.floor(x / scale);
      const sy = Math.floor(y / scale);
      const srcOffset = idx(src.width, sx, sy);
      const dstOffset = idx(dest.width, dx, dy);
      const alpha = src.data[srcOffset + 3] / 255;
      const base = checker(dx, dy);
      dest.data[dstOffset] = Math.round(src.data[srcOffset] * alpha + base[0] * (1 - alpha));
      dest.data[dstOffset + 1] = Math.round(src.data[srcOffset + 1] * alpha + base[1] * (1 - alpha));
      dest.data[dstOffset + 2] = Math.round(src.data[srcOffset + 2] * alpha + base[2] * (1 - alpha));
      dest.data[dstOffset + 3] = 255;
    }
  }
}

function drawText(dest, text, x, y) {
  const glyphs = {
    A: ["01110", "10001", "11111", "10001", "10001"],
    D: ["11110", "10001", "10001", "10001", "11110"],
    E: ["11111", "10000", "11110", "10000", "11111"],
    H: ["10001", "10001", "11111", "10001", "10001"],
    N: ["10001", "11001", "10101", "10011", "10001"],
    O: ["01110", "10001", "10001", "10001", "01110"],
    R: ["11110", "10001", "11110", "10010", "10001"],
    S: ["01111", "10000", "01110", "00001", "11110"],
    T: ["11111", "00100", "00100", "00100", "00100"],
    U: ["10001", "10001", "10001", "10001", "01110"],
    W: ["10001", "10001", "10101", "10101", "01010"],
    "-": ["00000", "00000", "01110", "00000", "00000"],
    " ": ["00000", "00000", "00000", "00000", "00000"],
  };
  let cursor = x;
  for (const letter of text.toUpperCase()) {
    const glyph = glyphs[letter] ?? glyphs[" "];
    for (let gy = 0; gy < glyph.length; gy += 1) {
      for (let gx = 0; gx < glyph[gy].length; gx += 1) {
        if (glyph[gy][gx] !== "1") continue;
        for (let py = 0; py < 2; py += 1) {
          for (let px = 0; px < 2; px += 1) {
            const dx = cursor + gx * 2 + px;
            const dy = y + gy * 2 + py;
            if (dx < 0 || dy < 0 || dx >= dest.width || dy >= dest.height) continue;
            const offset = idx(dest.width, dx, dy);
            dest.data[offset] = 103;
            dest.data[offset + 1] = 200;
            dest.data[offset + 2] = 242;
            dest.data[offset + 3] = 255;
          }
        }
      }
    }
    cursor += 12;
  }
}

const cellW = 220;
const cellH = 230;
const sheet = new PNG({ width: cellW * 4, height: cellH * 2 });
for (let y = 0; y < sheet.height; y += 1) {
  for (let x = 0; x < sheet.width; x += 1) {
    const offset = idx(sheet.width, x, y);
    const color = checker(x, y);
    sheet.data[offset] = color[0];
    sheet.data[offset + 1] = color[1];
    sheet.data[offset + 2] = color[2];
    sheet.data[offset + 3] = 255;
  }
}

directions.forEach((direction, index) => {
  const src = readPng(path.join(sourceDir, `${direction}.png`));
  const col = index % 4;
  const row = Math.floor(index / 4);
  const x = col * cellW;
  const y = row * cellH;
  drawText(sheet, direction, x + 12, y + 12);
  draw(sheet, src, x + Math.floor((cellW - src.width * 0.34) / 2), y + 38, 0.34);
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, PNG.sync.write(sheet));
console.log(outputPath);
