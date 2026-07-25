import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

// usage: node crop-png.mjs in.png out.png x y w h
const [, , inPath, outPath, x, y, w, h] = process.argv;
const src = PNG.sync.read(readFileSync(inPath));
const cx = Number(x), cy = Number(y), cw = Number(w), ch = Number(h);
const dst = new PNG({ width: cw, height: ch });
for (let row = 0; row < ch; row += 1) {
  for (let col = 0; col < cw; col += 1) {
    const si = ((cy + row) * src.width + (cx + col)) * 4;
    const di = (row * cw + col) * 4;
    dst.data[di] = src.data[si];
    dst.data[di + 1] = src.data[si + 1];
    dst.data[di + 2] = src.data[si + 2];
    dst.data[di + 3] = src.data[si + 3];
  }
}
writeFileSync(outPath, PNG.sync.write(dst));
console.log(`${outPath} ${cw}x${ch}`);
