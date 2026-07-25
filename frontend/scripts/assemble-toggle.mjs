// Assemble a 9-slice toggle TRACK from a single codex-painted corner atom.
//
// The corner is mirrored into all 4 corners; the straight edge profile is
// DERIVED from the corner's own straight cross-section, so the stroke runs
// continuously from corner into edge with no seam. The fill colour is sampled
// from the corner interior. Because only one stroke exists (mirrored), a second
// / nested border is structurally impossible — that's the whole point versus
// whole-frame generation.
//
// Output is a small canonical PNG used as a CSS border-image source
// (`border-image: url(toggle-track.png) <CW> fill / <CW>px stretch`), plus a
// baked 152x48 preview for side-by-side comparison.
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const KIT = `${root}public/assets/ui/kit/`;
const corner = PNG.sync.read(readFileSync(`${KIT}atoms/toggle-corner.png`));
const CW = corner.width, CH = corner.height;

const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]; };
function np(w, h) { const o = new PNG({ width: w, height: h }); o.data.fill(0); return o; }
function setpx(o, x, y, c) { if (x < 0 || y < 0 || x >= o.width || y >= o.height) return; const i = (y * o.width + x) * 4; o.data[i] = c[0]; o.data[i + 1] = c[1]; o.data[i + 2] = c[2]; o.data[i + 3] = c[3]; }
// hard-alpha composite: any non-transparent source pixel overwrites
function comp(o, img, sx, sy) { for (let y = 0; y < img.height; y += 1) for (let x = 0; x < img.width; x += 1) { const c = px(img, x, y); if (c[3] === 0) continue; setpx(o, sx + x, sy + y, c); } }
function map(img, dims, coord) { const [w, h] = dims(img); const o = np(w, h); for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) setpx(o, x, y, px(img, ...coord(img, x, y))); return o; }
const flipH = (img) => map(img, (m) => [m.width, m.height], (m, x, y) => [m.width - 1 - x, y]);
const flipV = (img) => map(img, (m) => [m.width, m.height], (m, x, y) => [x, m.height - 1 - y]);
const rot90 = (img) => map(img, (m) => [m.height, m.width], (m, x, y) => [y, m.height - 1 - x]);

// fill colour: an interior pixel inside the stroke (bottom-right of the corner)
const fillC = px(corner, CW - 2, CH - 2);
// top-edge vertical profile: the corner's rightmost column is straight top edge
const edgeCol = np(1, CH);
for (let y = 0; y < CH; y += 1) setpx(edgeCol, 0, y, px(corner, CW - 1, y));
const edgeColV = flipV(edgeCol);          // bottom edge
const edgeRow = rot90(edgeCol);           // left edge (CW wide, 1 tall)
const edgeRowR = flipH(edgeRow);          // right edge

export function buildTrack(W, H) {
  const o = np(W, H);
  for (let y = CH; y < H - CH; y += 1) for (let x = CW; x < W - CW; x += 1) setpx(o, x, y, fillC);       // centre fill
  for (let x = CW; x < W - CW; x += 1) for (let y = 0; y < CH; y += 1) {                                  // top + bottom
    setpx(o, x, y, px(edgeCol, 0, y));
    setpx(o, x, H - CH + y, px(edgeColV, 0, y));
  }
  for (let y = CH; y < H - CH; y += 1) for (let x = 0; x < CW; x += 1) {                                  // left + right
    setpx(o, x, y, px(edgeRowR, x, 0));    // left: stroke flush to outer (x=0)
    setpx(o, W - CW + x, y, px(edgeRow, x, 0)); // right: stroke flush to outer (x=W-1)
  }
  comp(o, corner, 0, 0);                                                                                  // 4 mirrored corners
  comp(o, flipH(corner), W - CW, 0);
  comp(o, flipV(corner), 0, H - CH);
  comp(o, flipH(flipV(corner)), W - CW, H - CH);
  return o;
}

const canonical = buildTrack(CW * 3, CW * 3);            // 48x48 canonical border-image source
writeFileSync(`${KIT}toggle-track.png`, PNG.sync.write(canonical));
writeFileSync(`${KIT}toggle-track@2x.png`, PNG.sync.write(buildTrack(CW * 6, CW * 6)));
writeFileSync(`${root}../.pwshot/toggle-track-baked-152.png`, PNG.sync.write(buildTrack(152, 48)));
console.log(`assembled toggle-track ${CW * 3}x${CW * 3} (slice ${CW} fill) from ${CW}x${CH} corner atom; fill=${fillC.slice(0, 3)}`);
