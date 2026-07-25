// 9-slice editor. You align a kit 9-slice by nudging its pieces one pixel at a
// time; the tool renders the rest of the frame from those nudges, live.
//
// Decomposition (the model we settled on):
//   - KEYLINE: the corner border + the edges, LOCKED together as ONE continuous
//     line. The original misalignment was the corner keyline drifting out of step
//     with the edge keyline — a seam. Locked, that seam can't exist; nudging the
//     keyline moves corner + all four edges as a rigid border.
//   - BRACKET: the gold corner decoration, FREE to nudge against that border.
//   - CONTENT: an inset guide marking where text/icons start (consumption-side).
// Toggle the outer/content guide boxes (fixed at the footprint) to align against.
//
// Edge handedness is copied verbatim from scripts/assemble-frame.mjs (the proven
// assembler): right = rot90(edge), left = flipH(right), top = edge, bottom =
// flipV(edge). Same rot90 pixel transform, so left/right can't reverse.
//
// In dev, Save writes config/nine-slice/<asset>.json and regenerates the asset
// (via the Vite dev endpoint). Routing follows repo convention (lazy in App.tsx).
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import nineSliceRegistry from '../../config/nine-slice-registry.json';
import { SURFACE_ASSETS } from './surfaceCatalog';

type Off = { dx: number; dy: number };
type Frame = { w: number; h: number };
type EditState = { keyline: Off; bracket: Off; content: number; fill: number };
type PieceKey = 'keyline' | 'bracket';

type Asset = { id: string; label: string; corner: string; edge: string; fill: string; target: string; frame: Frame; carve?: boolean; flipSides?: boolean };

// Derived from the SINGLE registry (shared with the Node bake + the catalog). Every
// atom-built frame appears here automatically — adding one is a registry edit, not a
// code change in three files.
type RegAsset = { label: string; atoms: { corner: string; edge: string; fill: string }; frame: Frame; carve?: boolean; flipSides?: boolean; variants: { out: string }[] };
const REGISTRY = (nineSliceRegistry as { assets: Record<string, RegAsset> }).assets;
const ASSETS: Asset[] = Object.entries(REGISTRY).map(([id, a]) => ({
  id,
  label: a.label,
  corner: `/assets/ui/kit/atoms/${a.atoms.corner}.png`,
  edge: `/assets/ui/kit/atoms/${a.atoms.edge}.png`,
  fill: `/assets/ui/kit/atoms/${a.atoms.fill}.png`,
  target: `/assets/ui/kit/${a.variants[0].out}`,
  frame: a.frame,
  carve: !!a.carve,
  flipSides: !!a.flipSides,
}));

// 0 = no content inset, matching the bake's fallback (normalizeConfig in
// scripts/nine-slice-kit.mjs) so an unsaved asset previews exactly what it bakes.
const DEFAULT_CONTENT = 0;
// 0 = the fill boundary IS the footprint edge (no inset). The fill box marks where a surface
// painted behind this frame should stop — the frame's corners can bleed outside it.
const DEFAULT_FILL = 0;
const STORAGE_KEY = 'nine-slice-editor-v4';
const Z = 6;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

// Content fingerprint (first 5 bytes of SHA-256, hex) of the EXACT tile bytes the
// server hands this page — fetched with no-store so it reflects what's on the wire,
// not a cached copy. This is what makes "the file I checked" and "the pixels you're
// looking at" the same string: it hashes the same bytes the editor assembles from.
async function tileFingerprint(url: string): Promise<string> {
  const buf = await (await fetch(url, { cache: 'no-store' })).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].slice(0, 5).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toCanvas(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!; g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0); return c;
}

function flip(src: CanvasImageSource, w: number, h: number, fx: boolean, fy: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
  g.translate(fx ? w : 0, fy ? h : 0); g.scale(fx ? -1 : 1, fy ? -1 : 1); g.drawImage(src, 0, 0); return c;
}

// rot90 copied from assemble-frame.mjs: dest(x,y) = src(y, h-1-x). Same chirality
// as the proven assembler, so the side edges land on the correct sides.
function rot90(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const sd = toCanvas(src, w, h).getContext('2d')!.getImageData(0, 0, w, h);
  const dW = h, dH = w;
  const c = document.createElement('canvas'); c.width = dW; c.height = dH;
  const dctx = c.getContext('2d')!; const dd = dctx.createImageData(dW, dH);
  for (let y = 0; y < dH; y++) for (let x = 0; x < dW; x++) {
    const si = ((h - 1 - x) * w + y) * 4, di = (y * dW + x) * 4;
    for (let k = 0; k < 4; k++) dd.data[di + k] = sd.data[si + k];
  }
  dctx.putImageData(dd, 0, 0); return c;
}

// Carve navy bleed outside the rail back to transparent (ports generate-row's
// carveExterior to canvas): flood from the edges across dark navy, stop at the
// brighter rail. Mirrors what the shipped row.png does, so the preview matches.
function carveExterior(canvas: HTMLCanvasElement): void {
  const { width: w, height: h } = canvas; const g = canvas.getContext('2d')!;
  const img = g.getImageData(0, 0, w, h); const d = img.data;
  const i4 = (x: number, y: number) => (y * w + x) * 4;
  const isNavy = (x: number, y: number) => { const i = i4(x, y); return d[i + 3] > 20 && Math.max(d[i], d[i + 1], d[i + 2]) < 45; };
  const seen = new Uint8Array(w * h); const stack: number[] = [];
  const push = (x: number, y: number) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const p = y * w + x; if (seen[p]) return; seen[p] = 1; stack.push(x, y); };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) { const y = stack.pop()!, x = stack.pop()!; if (!isNavy(x, y)) continue; d[i4(x, y) + 3] = 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
  g.putImageData(img, 0, 0);
}

// Split a corner atom into base (cool keyline) and accent (warm gold bracket).
function splitWarm(img: HTMLImageElement): { base: HTMLCanvasElement; accent: HTMLCanvasElement; hasAccent: boolean } {
  const w = img.width, h = img.height;
  const d = toCanvas(img, w, h).getContext('2d')!.getImageData(0, 0, w, h);
  const base = document.createElement('canvas'); base.width = w; base.height = h;
  const accent = document.createElement('canvas'); accent.width = w; accent.height = h;
  const bg = base.getContext('2d')!, ag = accent.getContext('2d')!;
  const bd = bg.createImageData(w, h), ad = ag.createImageData(w, h);
  let hasAccent = false;
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i], b = d.data[i + 2], a = d.data[i + 3];
    const warm = a > 40 && r > b + 15;
    const t = warm ? ad : bd;
    for (let k = 0; k < 4; k++) t.data[i + k] = d.data[i + k];
    if (warm) hasAccent = true;
  }
  bg.putImageData(bd, 0, 0); ag.putImageData(ad, 0, 0);
  return { base, accent, hasAccent };
}

// Bounding box of a piece's opaque pixels — used to clamp nudges so a piece can't
// be pushed out of the footprint, and to compute "max out" (offset = -min = flush).
function opaqueBox(c: HTMLCanvasElement): { minX: number; minY: number; maxX: number; maxY: number } {
  const { width: w, height: h } = c; const d = c.getContext('2d')!.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 20) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return maxX < 0 ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY };
}

const tileH = (g: CanvasRenderingContext2D, t: HTMLCanvasElement, x0: number, x1: number, y: number) => { for (let x = x0; x < x1; x += t.width) g.drawImage(t, x, y); };
const tileV = (g: CanvasRenderingContext2D, t: HTMLCanvasElement, y0: number, y1: number, x: number) => { for (let y = y0; y < y1; y += t.height) g.drawImage(t, x, y); };
const tileRect = (g: CanvasRenderingContext2D, t: HTMLCanvasElement, x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y < y1; y += t.height) for (let x = x0; x < x1; x += t.width) g.drawImage(t, x, y); };

type Loaded = { base: HTMLCanvasElement; accent: HTMLCanvasElement; hasAccent: boolean; edge: HTMLImageElement; fill: HTMLImageElement; target: HTMLImageElement | null; cw: number; ch: number; ew: number; eh: number; baseBox: { minX: number; minY: number; maxX: number; maxY: number }; accentBox: { minX: number; minY: number; maxX: number; maxY: number } };

// Assemble the 9-slice at an arbitrary W×H (no margin) with the keyline/bracket
// offsets baked in. This is the single source of truth for both the editor canvas
// and the live previews, so a preview can never diverge from what you're editing.
function buildFrameCanvas(L: Loaded, kx: number, ky: number, bdx: number, bdy: number, w: number, h: number, carve = false, flipSides = false, noFill = false): HTMLCanvasElement {
  const { cw, ch, ew, eh } = L;
  const W = Math.max(2 * cw, w), H = Math.max(2 * ch, h);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
  // noFill = ornament only (transparent interior) — the "line" frame a surface shows through.
  if (!noFill) tileRect(g, toCanvas(L.fill, L.fill.width, L.fill.height), 0, 0, W, H);
  const topS = toCanvas(L.edge, ew, eh);
  const botS = flip(topS, ew, eh, false, true);
  // Side edges via rot90; flipSides swaps L/R for beveled rails (row) so the bevel
  // matches the corner at the join instead of reversing — mirrors assemble-frame.
  const r = rot90(L.edge, ew, eh);
  const fr = flip(r, r.width, r.height, true, false);
  const rightS = flipSides ? fr : r;
  const leftS = flipSides ? r : fr;
  tileH(g, topS, cw, W - cw, ky);
  tileH(g, botS, cw, W - cw, H - botS.height - ky);
  tileV(g, leftS, ch, H - ch, kx);
  tileV(g, rightS, ch, H - ch, W - rightS.width - kx);
  const corner = (art: HTMLCanvasElement, ox: number, oy: number) => {
    g.drawImage(art, ox, oy);
    g.drawImage(flip(art, cw, ch, true, false), W - cw - ox, oy);
    g.drawImage(flip(art, cw, ch, false, true), ox, H - ch - oy);
    g.drawImage(flip(art, cw, ch, true, true), W - cw - ox, H - ch - oy);
  };
  corner(L.base, kx, ky);
  if (L.hasAccent) corner(L.accent, bdx, bdy);
  if (carve) carveExterior(c);
  return c;
}

// Editor asset ids + labels, exported so the host studio can default/seed the frame
// selection without reaching into the registry itself.
export const NINE_SLICE_ASSETS: { id: string; label: string }[] = ASSETS.map((a) => ({ id: a.id, label: a.label }));
export const DEFAULT_NINE_SLICE_ASSET = ASSETS[0].id;

// The 9-slice editor as an embedded studio surface — the Assets editing kind, the
// frame twin of PortraitLab. It renders [main][aside] straight into the studio
// shell like every other Viewer surface: the canvas stage is the main pane, the
// editing controls are the Controls panel. Asset selection is owned by the studio
// (assetId/onAssetId ride its URL), so there is NO own route, NO page chrome, and
// NO "Back" link — the Catalog tab is back (docs/studio-control-architecture.md).
export function NineSliceLab({ assetId, onAssetId, header }: { assetId: string; onAssetId: (id: string) => void; header?: ReactNode }): ReactElement {
  const asset = useMemo(() => ASSETS.find((a) => a.id === assetId) ?? ASSETS[0], [assetId]);
  const aid = asset.id;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Fingerprints of the exact tile bytes this view is built from (corner/edge/fill),
  // shown in the header so the asset on screen is identifiable and matchable to disk.
  const [tileHashes, setTileHashes] = useState<{ corner?: string; edge?: string; fill?: string }>({});
  const [active, setActive] = useState<PieceKey>('bracket');
  const [showOuter, setShowOuter] = useState(true);
  const [showContent, setShowContent] = useState(false);
  const [showFill, setShowFill] = useState(false);
  // What backs the ornament in the preview. The frame you edit IS the ornament (brackets +
  // keyline); the body/fill is a separate backing the consumer supplies, so it's a chosen layer
  // here, not a baked-in default. 'none' = ornament on the checkerboard (the honest default — and a
  // stray fill-coloured pixel in the art can't hide against it); 'fill' = the asset's baked body;
  // 'surface' = a real surface clipped to the fill box (audits the fill boundary).
  const [backing, setBacking] = useState<'none' | 'fill' | 'surface'>('none');
  const [previewSurfaceName, setPreviewSurfaceName] = useState(SURFACE_ASSETS[0]?.name ?? '');
  const [surfaceImg, setSurfaceImg] = useState<HTMLImageElement | null>(null);
  // gap from each outer-box edge to the art's outermost opaque pixel. + = gap inside; − = beyond (overflow).
  const [status, setStatus] = useState<{ top: number; right: number; bottom: number; left: number } | null>(null);
  const [edits, setEdits] = useState<Record<string, EditState>>(() => {
    // Only keep well-formed entries — a malformed/old saved shape must never blank the editor.
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const clean: Record<string, EditState> = {};
      for (const k of Object.keys(raw)) {
        const e = raw[k];
        if (e && e.keyline && typeof e.keyline.dx === 'number' && e.bracket && typeof e.bracket.dx === 'number') clean[k] = e;
      }
      return clean;
    } catch { return {}; }
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pvActualRef = useRef<HTMLCanvasElement>(null);
  const pvUseRef = useRef<HTMLCanvasElement>(null);
  const DEFAULT_EDIT: EditState = { keyline: { dx: 0, dy: 0 }, bracket: { dx: 0, dy: 0 }, content: DEFAULT_CONTENT, fill: DEFAULT_FILL };
  const stored = edits[aid];
  const edit: EditState = {
    keyline: stored?.keyline ?? { dx: 0, dy: 0 },
    bracket: stored?.bracket ?? { dx: 0, dy: 0 },
    content: stored?.content ?? DEFAULT_CONTENT,
    fill: stored?.fill ?? DEFAULT_FILL,
  };

  useEffect(() => {
    let live = true; setLoaded(null);
    Promise.all([loadImage(asset.corner), loadImage(asset.edge), loadImage(asset.fill), loadImage(asset.target).catch(() => null)])
      .then(([corner, edge, fill, target]) => {
        if (!live) return;
        const { base, accent, hasAccent } = splitWarm(corner);
        setLoaded({ base, accent, hasAccent, edge, fill, target, cw: corner.width, ch: corner.height, ew: edge.width, eh: edge.height, baseBox: opaqueBox(base), accentBox: hasAccent ? opaqueBox(accent) : { minX: 0, minY: 0, maxX: corner.width - 1, maxY: corner.height - 1 } });
      }).catch(() => { if (live) setLoaded(null); });
    return () => { live = false; };
  }, [asset]);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(edits)); }, [edits]);

  // Fingerprint the actual served bytes of this asset's tiles (no cache), so the
  // header shows exactly which artwork the on-screen frame is assembled from.
  useEffect(() => {
    let live = true;
    setTileHashes({});
    (async () => {
      const keys = ['corner', 'edge', 'fill'] as const;
      const entries = await Promise.all(keys.map(async (k) => [k, await tileFingerprint(asset[k]).catch(() => 'err')] as const));
      if (live) setTileHashes(Object.fromEntries(entries));
    })();
    return () => { live = false; };
  }, [asset]);

  // Load the chosen preview surface (for the fill preview).
  useEffect(() => {
    const s = SURFACE_ASSETS.find((a) => a.name === previewSurfaceName);
    if (!s) { setSurfaceImg(null); return; }
    let live = true;
    loadImage(s.file).then((img) => { if (live) setSurfaceImg(img); }).catch(() => { if (live) setSurfaceImg(null); });
    return () => { live = false; };
  }, [previewSurfaceName]);

  // Hydrate from the on-disk config (dev) the first time each asset is opened, so the
  // editor reflects what's actually baked — not stale localStorage or defaults. This
  // is what stops a fresh editor from saving default values over your real config.
  const hydrated = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!((import.meta as { env?: { DEV?: boolean } }).env?.DEV) || hydrated.current.has(aid)) return;
    let live = true;
    fetch(`/__nine-slice/config?asset=${aid}`)
      .then((r) => r.json())
      .then((j) => {
        if (!live || !j.ok || !j.config) return;
        hydrated.current.add(aid);
        setEdits((prev) => ({ ...prev, [aid]: { keyline: j.config.keyline, bracket: j.config.bracket, content: j.config.content, fill: j.config.fill ?? DEFAULT_FILL } }));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [aid]);

  const update = (mut: (cur: EditState) => EditState) => setEdits((prev) => {
    const cur = prev[aid] ?? DEFAULT_EDIT;
    return { ...prev, [aid]: mut(cur) };
  });
  // Clamp an offset so the active piece's opaque pixels stay inside the footprint —
  // outward stops at flush (you can't push out of bounds; that's never wanted), inward
  // stops before the far edge. -box.min is exactly the "max out" flush position.
  const clampOffset = (dx: number, dy: number): Off => {
    if (!loaded) return { dx, dy };
    const box = active === 'keyline' ? loaded.baseBox : loaded.accentBox;
    const W = asset.frame.w, H = asset.frame.h;
    return {
      dx: Math.max(-box.minX, Math.min(W - 1 - box.maxX, dx)),
      dy: Math.max(-box.minY, Math.min(H - 1 - box.maxY, dy)),
    };
  };
  const nudge = (dx: number, dy: number) => update((cur) => ({ ...cur, [active]: clampOffset(cur[active].dx + dx, cur[active].dy + dy) }));
  // Send the active piece to its max outward position — flush with the footprint corner.
  const maxOut = () => {
    if (!loaded) return;
    const box = active === 'keyline' ? loaded.baseBox : loaded.accentBox;
    update((cur) => ({ ...cur, [active]: { dx: -box.minX, dy: -box.minY } }));
  };
  const setContent = (dc: number) => update((cur) => ({ ...cur, content: Math.max(0, (cur.content ?? DEFAULT_CONTENT) + dc) }));
  // Fill inset can't exceed half the smaller frame dim (box would invert); clamp to >= 0.
  const setFill = (df: number) => update((cur) => ({ ...cur, fill: Math.max(0, Math.min(Math.floor(Math.min(asset.frame.w, asset.frame.h) / 2) - 1, (cur.fill ?? DEFAULT_FILL) + df)) }));
  const reset = () => update(() => DEFAULT_EDIT);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      const moves: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      const m = moves[e.key]; if (!m) return;
      e.preventDefault(); nudge(m[0], m[1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, aid, loaded]);

  useEffect(() => {
    if (!loaded) return;
    const W = asset.frame.w, H = asset.frame.h;        // canvas = the asset footprint
    // keyline is inert (the border is continuous by construction) — always 0, matching the bake.
    const off = buildFrameCanvas(loaded, 0, 0, edit.bracket.dx, edit.bracket.dy, W, H, asset.carve, asset.flipSides);        // full frame (baked body)
    const orn = buildFrameCanvas(loaded, 0, 0, edit.bracket.dx, edit.bracket.dy, W, H, asset.carve, asset.flipSides, true);  // ornament only (no fill)
    const g = off.getContext('2d')!; // status reads the full frame's opaque box

    const view = canvasRef.current; if (!view) return;
    view.width = W * Z; view.height = H * Z;
    const vg = view.getContext('2d')!; vg.imageSmoothingEnabled = false;
    for (let y = 0; y < view.height; y += 8) for (let x = 0; x < view.width; x += 8) { vg.fillStyle = ((x / 8 + y / 8) & 1) ? '#3a3f48' : '#2b2f37'; vg.fillRect(x, y, 8, 8); }
    if (backing === 'surface' && surfaceImg) {
      // Surface clipped to the FILL box, ornament on top — audits the fill boundary against a real
      // backing. Outside the fill box (the checkerboard ring) is whatever sits behind.
      const f = edit.fill;
      vg.save();
      vg.beginPath();
      vg.rect(f * Z, f * Z, (W - 2 * f) * Z, (H - 2 * f) * Z);
      vg.clip();
      const tile = 16 * Z; // 16 footprint px per tile — enough texture to read
      for (let y = 0; y < view.height; y += tile) for (let x = 0; x < view.width; x += tile) vg.drawImage(surfaceImg, x, y, tile, tile);
      vg.restore();
      vg.drawImage(orn, 0, 0, W, H, 0, 0, W * Z, H * Z);
    } else if (backing === 'fill') {
      vg.drawImage(off, 0, 0, W, H, 0, 0, W * Z, H * Z);   // the asset's baked body
    } else {
      vg.drawImage(orn, 0, 0, W, H, 0, 0, W * Z, H * Z);   // 'none' — ornament on the checkerboard
    }

    // Guides are FIXED references at the asset footprint — you position the
    // keyline/bracket RELATIVE to them; they do NOT follow the art.
    // OUTER box = the footprint edge. CONTENT box = inset by `content` px.
    if (showOuter) {
      vg.strokeStyle = '#ff5cf0'; vg.lineWidth = 2;
      vg.strokeRect(0, 0, W * Z, H * Z);
    }
    if (showContent) {
      const c = edit.content;
      vg.strokeStyle = '#5cff9e'; vg.lineWidth = 2;
      vg.strokeRect(c * Z, c * Z, (W - 2 * c) * Z, (H - 2 * c) * Z);
    }
    // FILL box = where a surface behind this frame stops (inset by `fill` from the footprint).
    if (showFill) {
      const f = edit.fill;
      vg.strokeStyle = '#ffb454'; vg.lineWidth = 2;
      vg.strokeRect(f * Z, f * Z, (W - 2 * f) * Z, (H - 2 * f) * Z);
    }

    // STATUS: where the art's outermost opaque pixels sit vs the footprint edge.
    // Only surfaces on overflow (pixels beyond the box).
    const od = g.getImageData(0, 0, W, H).data;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (od[(y * W + x) * 4 + 3] > 20) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    setStatus(maxX < 0 ? null : { top: minY, left: minX, right: (W - 1) - maxX, bottom: (H - 1) - maxY });
  }, [loaded, edit, showOuter, showContent, showFill, backing, surfaceImg, asset]);

  // LIVE previews — the same builder rendered at actual size and stretched in-use,
  // so you can judge the real result here without an apply-and-screenshot round trip.
  useEffect(() => {
    if (!loaded) return;
    const fw = asset.frame.w, fh = asset.frame.h;
    const draw = (ref: React.RefObject<HTMLCanvasElement | null>, w: number, h: number, scale: number, label: string | null) => {
      const cvs = ref.current; if (!cvs) return;
      cvs.width = w * scale; cvs.height = h * scale;
      const g = cvs.getContext('2d')!; g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, cvs.width, cvs.height);
      const f = buildFrameCanvas(loaded, 0, 0, edit.bracket.dx, edit.bracket.dy, w, h, asset.carve, asset.flipSides, backing !== 'fill');
      g.drawImage(f, 0, 0, w, h, 0, 0, w * scale, h * scale);
      if (label) {
        g.fillStyle = '#e8f0ff'; g.font = `${13 * scale}px system-ui, sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(label, cvs.width / 2, cvs.height / 2);
      }
    };
    draw(pvActualRef, fw, fh, 1, null);
    draw(pvUseRef, 150, 44, 2, 'Settings');
  }, [loaded, edit.keyline, edit.bracket, asset, backing]);

  const exportJson = JSON.stringify({ asset: aid, keyline: edit.keyline, bracket: edit.bracket, content: edit.content, fill: edit.fill }, null, 2);
  // Only the bracket is nudgeable. Keyline is inert (continuous border by construction);
  // exposing a keyline nudge would let the preview show a state the bake can't reproduce.
  const pieces: PieceKey[] = loaded?.hasAccent ? ['bracket'] : [];

  // Save straight to the on-disk config + regenerate the asset, via the dev-only
  // Vite endpoint. import.meta.env.DEV gates the button; the endpoint only exists
  // while `vite` is serving — so this whole path is dev-only by construction.
  const isDev = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
  const [saveMsg, setSaveMsg] = useState('');
  const saveToDisk = async () => {
    setSaveMsg('saving…');
    try {
      const r = await fetch('/__nine-slice/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: exportJson });
      const j = await r.json();
      const warn = (j.warns && j.warns.length) ? ` · ⚠ ${j.warns.join('; ')}` : '';
      setSaveMsg(j.ok ? `saved ${j.config} → ${j.written.join(', ')}${warn} · hard-refresh to see it${j.note ? ` (${j.note})` : ''}` : `error: ${j.error}`);
    } catch (e) { setSaveMsg(`error: ${String(e)}`); }
  };

  return (
    <>
      <section className="al-lab-main" aria-label="9-slice frame editor">
        <div style={ST.stage}>
          <canvas ref={canvasRef} style={{ imageRendering: 'pixelated', maxWidth: '100%' }} />
          <div style={ST.previewStrip}>
            <div style={ST.previewItem}><span style={ST.previewLabel}>actual size · 1×</span><canvas ref={pvActualRef} style={{ imageRendering: 'pixelated' }} /></div>
            <div style={ST.previewItem}><span style={ST.previewLabel}>stretched in-use · 2×</span><canvas ref={pvUseRef} style={{ imageRendering: 'pixelated' }} /></div>
          </div>
        </div>
      </section>
      <aside className="tileset-view-controls" aria-label="9-slice controls">
        <section className="tileset-inspector-section">
          <h2>Controls</h2>
          <div className="tileset-control-stack">
            {header}
            <label className="tileset-category-select" title="Which kit frame you're aligning.">
              <span>Frame</span>
              <select value={aid} onChange={(e) => onAssetId(e.target.value)} aria-label="9-slice frame">
                {ASSETS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </label>
            <div style={ST.fpBox}>
              <div style={ST.fpHead}>Tiles in this view — served path · sha-256[:5]</div>
              {(['corner', 'edge', 'fill'] as const).map((k) => (
                <div key={k} style={ST.fpRow}>
                  <span style={ST.fpPath}>{asset[k]}</span>
                  <span style={ST.fp}>{tileHashes[k] ?? '…'}</span>
                </div>
              ))}
            </div>
          <div style={ST.pieceRow}>
            {pieces.map((k) => (
              <button key={k} type="button" onClick={() => setActive(k)} style={{ ...ST.pieceBtn, ...(active === k ? ST.pieceBtnOn : {}) }}>{k}</button>
            ))}
          </div>
          <p style={ST.hint}>Editing the <b>bracket</b> (the gold corner accent) — arrow keys nudge 1px. The keyline border is fixed/continuous by construction.</p>
          <div style={ST.dpad}>
            <div /><button type="button" style={ST.nb} onClick={() => nudge(0, -1)}>↑</button><div />
            <button type="button" style={ST.nb} onClick={() => nudge(-1, 0)}>←</button>
            <button type="button" style={ST.nbReset} onClick={reset}>0</button>
            <button type="button" style={ST.nb} onClick={() => nudge(1, 0)}>→</button>
            <div /><button type="button" style={ST.nb} onClick={() => nudge(0, 1)}>↓</button><div />
          </div>
          <button type="button" style={ST.maxBtn} onClick={maxOut}>⤢ Send {active} to max (flush to box corner)</button>
          <div style={ST.sizeBox}>
            <label style={ST.toggle}>
              <input type="checkbox" checked={showOuter} onChange={(e) => setShowOuter(e.target.checked)} />
              <span style={{ color: '#ff5cf0' }}>■</span> Outer box — outermost pixels of the 9-slice (centering guide)
            </label>
            <label style={ST.toggle}>
              <input type="checkbox" checked={showContent} onChange={(e) => setShowContent(e.target.checked)} />
              <span style={{ color: '#5cff9e' }}>■</span> Content box — where text / icons start
            </label>
            <div style={ST.sizeRow}>
              <span style={ST.sizeW}>inset {edit.content} px</span>
              <button type="button" style={ST.sb} onClick={() => setContent(-1)}>−</button>
              <button type="button" style={ST.sb} onClick={() => setContent(1)}>＋</button>
              <span style={ST.sizeLabel}>uniform on all sides</span>
            </div>
            <label style={ST.toggle}>
              <input type="checkbox" checked={showFill} onChange={(e) => setShowFill(e.target.checked)} />
              <span style={{ color: '#ffb454' }}>■</span> Fill box — where a surface fill stops (frame may bleed outside it)
            </label>
            <div style={ST.sizeRow}>
              <span style={ST.sizeW}>inset {edit.fill} px</span>
              <button type="button" style={ST.sb} onClick={() => setFill(-1)}>−</button>
              <button type="button" style={ST.sb} onClick={() => setFill(1)}>＋</button>
              <span style={ST.sizeLabel}>uniform on all sides</span>
            </div>
            <div style={ST.sizeRow}>
              <span style={{ ...ST.sizeLabel, color: '#cfe3ff', minWidth: 52 }}>Backing</span>
              <select value={backing} onChange={(e) => setBacking(e.target.value as 'none' | 'fill' | 'surface')} style={{ ...ST.select, fontSize: 13, flex: 1 }}>
                <option value="none">None — ornament only</option>
                <option value="fill">Default fill — baked body</option>
                <option value="surface">Surface…</option>
              </select>
            </div>
            {backing === 'surface' && (
              <div style={ST.sizeRow}>
                <select value={previewSurfaceName} onChange={(e) => setPreviewSurfaceName(e.target.value)} style={{ ...ST.select, fontSize: 13, flex: 1 }}>
                  {SURFACE_ASSETS.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
                </select>
              </div>
            )}
            <span style={ST.sizeLabel}>Preview only — you're editing the ornament; the body is a backing the consumer supplies (Save still writes the asset as-is).</span>
          </div>
          {status && (status.top < 0 || status.right < 0 || status.bottom < 0 || status.left < 0) && (
            <div style={{ ...ST.statusBox, borderColor: '#e0556a', color: '#ff9aa8' }}>
              <div style={{ fontWeight: 700 }}>✗ overflow — pixels extend beyond the box</div>
              <div style={ST.statusGrid}>
                {status.top < 0 && <span>T {-status.top} over</span>}
                {status.right < 0 && <span>R {-status.right} over</span>}
                {status.bottom < 0 && <span>B {-status.bottom} over</span>}
                {status.left < 0 && <span>L {-status.left} over</span>}
              </div>
            </div>
          )}
          <div style={ST.offsets}>
            <div>bracket: dx {edit.bracket.dx}, dy {edit.bracket.dy}</div>
            <div>content inset: {edit.content} px</div>
            <div>fill inset: {edit.fill} px</div>
          </div>
          {isDev && (
            <>
              <button type="button" style={ST.save} onClick={saveToDisk}>💾 Save to disk + regenerate (dev)</button>
              {saveMsg && <div style={{ ...ST.hint, color: saveMsg.startsWith('error') ? '#ff9aa8' : '#9affc4' }}>{saveMsg}</div>}
            </>
          )}
          <label style={ST.hint}>Export — paste this back:</label>
          <textarea readOnly value={exportJson} style={ST.export} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" style={ST.copy} onClick={() => navigator.clipboard?.writeText(exportJson)}>Copy JSON</button>
          </div>
        </section>
      </aside>
    </>
  );
}

const ST: Record<string, CSSProperties> = {
  select: { fontSize: 15, padding: '4px 8px', background: '#111a2c', color: '#eaf3ff', border: '1px solid #2a3c5e', borderRadius: 4 },
  fpBox: { display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', background: '#0a0f1c', border: '1px solid #1b2740', borderRadius: 6 },
  fpHead: { fontSize: 11, color: '#7f93ad', letterSpacing: 0.2 },
  fpRow: { display: 'flex', flexWrap: 'wrap', gap: '0 10px', alignItems: 'baseline', justifyContent: 'space-between' },
  fpPath: { fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#9fc4d5', wordBreak: 'break-all' },
  fp: { fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#bfe3ff', fontWeight: 600, flex: 'none' },
  stage: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26, overflow: 'auto', padding: 20 },
  previewStrip: { display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap', justifyContent: 'center' },
  previewItem: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', padding: 16, background: '#0e1626', border: '1px solid #1b2740', borderRadius: 8 },
  previewLabel: { fontSize: 11, color: '#9fc4d5', letterSpacing: 0.3 },
  pieceRow: { display: 'flex', gap: 6 },
  pieceBtn: { flex: 1, padding: '8px 0', background: '#111a2c', color: '#c4d6e6', border: '1px solid #2a3c5e', borderRadius: 4, cursor: 'pointer', textTransform: 'capitalize' },
  pieceBtnOn: { background: '#1d5f9e', color: '#fff', borderColor: '#4fbdf0' },
  hint: { fontSize: 13, color: '#9fc4d5', margin: 0, textTransform: 'none', fontWeight: 400, letterSpacing: 0 },
  dpad: { display: 'grid', gridTemplateColumns: 'repeat(3, 56px)', gridAutoRows: '56px', gap: 6, justifyContent: 'center' },
  nb: { fontSize: 22, background: '#111a2c', color: '#eaf3ff', border: '1px solid #2a3c5e', borderRadius: 6, cursor: 'pointer' },
  nbReset: { fontSize: 14, background: '#17223a', color: '#9fc4d5', border: '1px solid #2a3c5e', borderRadius: 6, cursor: 'pointer' },
  maxBtn: { padding: '9px 0', background: '#15324a', color: '#bfe3ff', border: '1px solid #3a7fb0', borderRadius: 6, cursor: 'pointer', fontSize: 13, textTransform: 'capitalize' },
  sizeBox: { display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0', borderTop: '1px solid #1b2740' },
  sizeLabel: { fontSize: 12, color: '#9fc4d5' },
  sizeRow: { display: 'flex', alignItems: 'center', gap: 6 },
  sizeW: { fontFamily: 'ui-monospace, monospace', fontSize: 13, minWidth: 46, color: '#dbe9ff' },
  sb: { width: 34, height: 30, fontSize: 16, background: '#111a2c', color: '#eaf3ff', border: '1px solid #2a3c5e', borderRadius: 5, cursor: 'pointer' },
  toggle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#cfe3ff', textTransform: 'none', fontWeight: 400, letterSpacing: 0 },
  statusBox: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, padding: '8px 10px', border: '1px solid', borderRadius: 6, background: '#0a0f1c' },
  statusGrid: { display: 'flex', gap: 14, fontFamily: 'ui-monospace, monospace', fontSize: 13 },
  offsets: { fontSize: 13, fontFamily: 'ui-monospace, monospace', color: '#dbe9ff', display: 'grid', gap: 2 },
  export: { width: '100%', minHeight: 130, flexShrink: 0, resize: 'vertical', background: '#0a0f1c', color: '#dbe9ff', border: '1px solid #2a3c5e', borderRadius: 4, fontFamily: 'ui-monospace, monospace', fontSize: 12, padding: 8, boxSizing: 'border-box' },
  save: { padding: '10px 0', background: '#15532f', color: '#dffbe8', border: '1px solid #43b06a', borderRadius: 4, cursor: 'pointer', fontWeight: 700 },
  copy: { padding: '8px 0', background: '#1d5f9e', color: '#fff', border: '1px solid #4fbdf0', borderRadius: 4, cursor: 'pointer' },
};
