import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT_ROOT = path.join(ROOT, 'public', 'assets', 'units', 'normalized-concepts');
const DEFAULT_OUTPUT_ROOT = path.join(ROOT, '..', 'docs', 'art', 'unit-concepts', 'review');

const PIECES = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
const DIRECTIONS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

const COLORS = {
  page: [30, 34, 42, 255],
  panel: [42, 47, 57, 255],
  panelAlt: [48, 54, 65, 255],
  grid: [91, 101, 119, 255],
  text: [232, 226, 211, 255],
  muted: [166, 174, 188, 255],
  missing: [190, 82, 78, 255],
  checkerA: [95, 103, 116, 255],
  checkerB: [73, 80, 93, 255],
};

const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

const OPTIONS = {
  cellSize: 148,
  headerHeight: 68,
  rowLabelWidth: 84,
  spriteInset: 12,
  gap: 6,
  writeRows: true,
};

function parseArgs(argv) {
  const options = {
    inputRoot: DEFAULT_INPUT_ROOT,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    writeRows: OPTIONS.writeRows,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      i += 1;
      return value;
    };

    if (arg === '--input') options.inputRoot = path.resolve(readValue());
    else if (arg === '--output') options.outputRoot = path.resolve(readValue());
    else if (arg === '--no-rows') options.writeRows = false;
    else if (arg === '--rows') options.writeRows = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

const relativeToRepo = (targetPath) => path.relative(path.join(ROOT, '..'), targetPath).replaceAll(path.sep, '/');

function createImage(width, height, color = COLORS.page) {
  const png = new PNG({ width, height });
  fillRect(png, 0, 0, width, height, color);
  return png;
}

function setPixel(png, x, y, color) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (y * png.width + x) * 4;
  png.data[i] = color[0];
  png.data[i + 1] = color[1];
  png.data[i + 2] = color[2];
  png.data[i + 3] = color[3] ?? 255;
}

function fillRect(png, x, y, width, height, color) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) setPixel(png, xx, yy, color);
  }
}

function strokeRect(png, x, y, width, height, color) {
  fillRect(png, x, y, width, 1, color);
  fillRect(png, x, y + height - 1, width, 1, color);
  fillRect(png, x, y, 1, height, color);
  fillRect(png, x + width - 1, y, 1, height, color);
}

function alphaComposite(dst, dx, dy, src, sx, sy) {
  if (dx < 0 || dy < 0 || dx >= dst.width || dy >= dst.height) return;
  if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) return;

  const si = (sy * src.width + sx) * 4;
  const sa = src.data[si + 3] / 255;
  if (sa <= 0) return;

  const di = (dy * dst.width + dx) * 4;
  const da = dst.data[di + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;

  dst.data[di] = Math.round((src.data[si] * sa + dst.data[di] * da * (1 - sa)) / outA);
  dst.data[di + 1] = Math.round((src.data[si + 1] * sa + dst.data[di + 1] * da * (1 - sa)) / outA);
  dst.data[di + 2] = Math.round((src.data[si + 2] * sa + dst.data[di + 2] * da * (1 - sa)) / outA);
  dst.data[di + 3] = Math.round(outA * 255);
}

function drawLine(png, x0, y0, x1, y1, color) {
  let dx = Math.abs(x1 - x0);
  let sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  let sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  while (true) {
    setPixel(png, x0, y0, color);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function drawText(png, text, x, y, scale = 2, color = COLORS.text) {
  let cursor = x;
  const chars = text.toUpperCase();
  for (const char of chars) {
    const glyph = FONT[char] ?? FONT[' '];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] !== '1') continue;
        fillRect(png, cursor + col * scale, y + row * scale, scale, scale, color);
      }
    }
    cursor += 6 * scale;
  }
}

function textWidth(text, scale = 2) {
  return text.length * 6 * scale - scale;
}

function drawCenteredText(png, text, x, y, width, scale = 2, color = COLORS.text) {
  drawText(png, text, x + Math.floor((width - textWidth(text, scale)) / 2), y, scale, color);
}

function drawChecker(png, x, y, width, height, size = 8) {
  for (let yy = 0; yy < height; yy += 1) {
    for (let xx = 0; xx < width; xx += 1) {
      const color = (Math.floor(xx / size) + Math.floor(yy / size)) % 2 === 0 ? COLORS.checkerA : COLORS.checkerB;
      setPixel(png, x + xx, y + yy, color);
    }
  }
}

function drawSprite(png, sprite, x, y, maxWidth, maxHeight) {
  const scale = Math.min(1, maxWidth / sprite.width, maxHeight / sprite.height);
  const drawnWidth = Math.max(1, Math.round(sprite.width * scale));
  const drawnHeight = Math.max(1, Math.round(sprite.height * scale));
  const offsetX = x + Math.floor((maxWidth - drawnWidth) / 2);
  const offsetY = y + Math.floor((maxHeight - drawnHeight) / 2);

  for (let yy = 0; yy < drawnHeight; yy += 1) {
    for (let xx = 0; xx < drawnWidth; xx += 1) {
      const sx = Math.min(sprite.width - 1, Math.floor(xx / scale));
      const sy = Math.min(sprite.height - 1, Math.floor(yy / scale));
      alphaComposite(png, offsetX + xx, offsetY + yy, sprite, sx, sy);
    }
  }
}

function drawMissing(png, x, y, width, height) {
  fillRect(png, x, y, width, height, [61, 45, 51, 255]);
  drawLine(png, x + 4, y + 4, x + width - 5, y + height - 5, COLORS.missing);
  drawLine(png, x + width - 5, y + 4, x + 4, y + height - 5, COLORS.missing);
  drawCenteredText(png, 'MISSING', x, y + Math.floor(height / 2) - 7, width, 2, COLORS.missing);
}

function readSprites(inputRoot) {
  const sprites = new Map();
  const missing = [];

  for (const piece of PIECES) {
    for (const direction of DIRECTIONS) {
      const spritePath = path.join(inputRoot, piece, `${direction}.png`);
      if (!fs.existsSync(spritePath)) {
        missing.push(spritePath);
        continue;
      }
      sprites.set(`${piece}/${direction}`, PNG.sync.read(fs.readFileSync(spritePath)));
    }
  }

  return { sprites, missing };
}

function drawCell(png, sprites, piece, direction, x, y, width, height, alt = false) {
  fillRect(png, x, y, width, height, alt ? COLORS.panelAlt : COLORS.panel);
  const labelHeight = 24;
  const spriteX = x + OPTIONS.spriteInset;
  const spriteY = y + OPTIONS.spriteInset;
  const spriteW = width - OPTIONS.spriteInset * 2;
  const spriteH = height - OPTIONS.spriteInset * 2 - labelHeight;

  drawChecker(png, spriteX, spriteY, spriteW, spriteH);
  const sprite = sprites.get(`${piece}/${direction}`);
  if (sprite) drawSprite(png, sprite, spriteX, spriteY, spriteW, spriteH);
  else drawMissing(png, spriteX, spriteY, spriteW, spriteH);

  drawCenteredText(png, direction, x, y + height - labelHeight + 5, width, 1, COLORS.muted);
  strokeRect(png, x, y, width, height, COLORS.grid);
}

function drawSheet(sprites) {
  const cell = OPTIONS.cellSize;
  const gap = OPTIONS.gap;
  const width = OPTIONS.rowLabelWidth + DIRECTIONS.length * cell + (DIRECTIONS.length + 1) * gap;
  const height = OPTIONS.headerHeight + PIECES.length * cell + (PIECES.length + 1) * gap;
  const png = createImage(width, height);

  drawCenteredText(png, 'UNIT DIRECTION REVIEW', 0, 12, width, 2, COLORS.text);

  for (let col = 0; col < DIRECTIONS.length; col += 1) {
    const x = OPTIONS.rowLabelWidth + gap + col * (cell + gap);
    drawCenteredText(png, DIRECTIONS[col], x, OPTIONS.headerHeight - 22, cell, 1, COLORS.muted);
  }

  for (let row = 0; row < PIECES.length; row += 1) {
    const piece = PIECES[row];
    const y = OPTIONS.headerHeight + gap + row * (cell + gap);
    drawCenteredText(png, piece, 0, y + Math.floor(cell / 2) - 7, OPTIONS.rowLabelWidth, 2, COLORS.text);
    for (let col = 0; col < DIRECTIONS.length; col += 1) {
      const x = OPTIONS.rowLabelWidth + gap + col * (cell + gap);
      drawCell(png, sprites, piece, DIRECTIONS[col], x, y, cell, cell, (row + col) % 2 === 1);
    }
  }

  return png;
}

function drawPieceRow(sprites, piece) {
  const cell = OPTIONS.cellSize;
  const gap = OPTIONS.gap;
  const width = OPTIONS.rowLabelWidth + DIRECTIONS.length * cell + (DIRECTIONS.length + 1) * gap;
  const height = OPTIONS.headerHeight + cell + gap * 2;
  const png = createImage(width, height);

  drawCenteredText(png, piece, 0, 15, OPTIONS.rowLabelWidth, 2, COLORS.text);
  for (let col = 0; col < DIRECTIONS.length; col += 1) {
    const x = OPTIONS.rowLabelWidth + gap + col * (cell + gap);
    drawCell(png, sprites, piece, DIRECTIONS[col], x, OPTIONS.headerHeight, cell, cell, col % 2 === 1);
  }

  return png;
}

function writePng(filePath, png) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function usage() {
  console.log(`Usage: node scripts/generate-unit-direction-review.mjs [--input DIR] [--output DIR] [--no-rows]

Defaults:
  --input  ${relativeToRepo(DEFAULT_INPUT_ROOT)}
  --output ${relativeToRepo(DEFAULT_OUTPUT_ROOT)}
`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const { sprites, missing } = readSprites(options.inputRoot);
  if (sprites.size === 0) {
    throw new Error(`No normalized unit direction sprites found under ${options.inputRoot}`);
  }

  const sheetPath = path.join(options.outputRoot, 'unit-direction-contact-sheet.png');
  const reportPath = path.join(options.outputRoot, 'unit-direction-contact-sheet.json');
  writePng(sheetPath, drawSheet(sprites));

  const rowPaths = [];
  if (options.writeRows) {
    for (const piece of PIECES) {
      const rowPath = path.join(options.outputRoot, 'rows', `${piece}-direction-row.png`);
      writePng(rowPath, drawPieceRow(sprites, piece));
      rowPaths.push(rowPath);
    }
  }

  const report = {
    inputRoot: relativeToRepo(options.inputRoot),
    outputRoot: relativeToRepo(options.outputRoot),
    pieces: PIECES,
    directions: DIRECTIONS,
    generated: {
      contactSheet: relativeToRepo(sheetPath),
      rows: rowPaths.map(relativeToRepo),
    },
    found: sprites.size,
    expected: PIECES.length * DIRECTIONS.length,
    missing: missing.map(relativeToRepo),
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Generated unit direction review sheet: ${relativeToRepo(sheetPath)}`);
  if (rowPaths.length) console.log(`Generated ${rowPaths.length} per-piece rows in ${relativeToRepo(path.dirname(rowPaths[0]))}`);
  if (missing.length) console.warn(`Warning: ${missing.length} expected sprite(s) were missing; placeholders were drawn.`);
}

main();
