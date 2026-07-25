import { useEffect, useState, type ReactElement } from 'react';

// Before/after inspection surface for the PixelLab tile pipeline. Left = the RAW PixelLab
// tile (native ~33deg, crisp). Right = what correct-iso-tile-angle.py produces (snapped to
// our ~29deg grid). Flip through every tile + family; toggle the canonical block wireframe to
// see how the geometry is forced. Route: /tile-compare.

const FAMILIES = ['grass', 'dirt', 'stone', 'pebble', 'sand', 'water'] as const;
const VARIANTS = [0, 1, 2, 3, 4, 5] as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Tile = { id: string; family: string; variant: number; label: string; raw: string; proc: string; rawH: number };
const TILES: Tile[] = FAMILIES.flatMap((f) =>
  VARIANTS.map((n) => ({
    id: `${f}-${n}`,
    family: f,
    variant: n,
    label: `${cap(f)} ${n + 1}`,
    raw: `/assets/tiles/pixel-raw/${f}-${n}.png`,
    proc: `/assets/tiles/pixel/${f}-px-${n}.png`,
    rawH: 175,
  })),
);

// Canonical block wireframe (our grid) in 96x180 tile coords.
const APEX = '48,41', RT = '96,68', LT = '0,68', FT = '48,95', RB = '96,153', LB = '0,153', FB = '48,180';
const GRID_LINES: [string, string][] = [
  [APEX, RT], [APEX, LT], [RT, FT], [LT, FT], [RT, RB], [LT, LB], [FT, FB], [RB, FB], [LB, FB],
];

function Pane({ label, src, w, h, grid }: { label: string; src: string; w: number; h: number; grid: boolean }): ReactElement {
  return (
    <div className="tc-pane">
      <div className="tc-pane-label">{label}</div>
      <div className="tc-stage">
        <div className="tc-frame" style={{ aspectRatio: `${w} / ${h}` }}>
          <img src={src} alt={label} draggable={false} />
          {grid ? (
            <svg className="tc-grid" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
              {GRID_LINES.map(([a, b], i) => <polyline key={i} points={`${a} ${b}`} />)}
            </svg>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function TileCompare(): ReactElement {
  const initial = (() => {
    const id = new URLSearchParams(window.location.search).get('tile');
    const i = TILES.findIndex((t) => t.id === id);
    return i >= 0 ? i : 0;
  })();
  const [idx, setIdx] = useState(initial);
  const [grid, setGrid] = useState(false);
  const tile = TILES[idx];

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    p.set('tile', tile.id);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${p.toString()}`);
  }, [tile.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setIdx((i) => (i + 1) % TILES.length);
      if (e.key === 'ArrowLeft') setIdx((i) => (i - 1 + TILES.length) % TILES.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <section className="tc">
      <style>{TC_CSS}</style>
      <header className="tc-bar">
        <strong className="tc-name">{tile.label}</strong>
        <code className="tc-id">{tile.id}</code>
        <button type="button" onClick={() => setIdx((i) => (i - 1 + TILES.length) % TILES.length)} title="Previous (←)">‹</button>
        <select value={idx} onChange={(e) => setIdx(Number(e.target.value))} aria-label="Tile">
          {FAMILIES.map((f) => (
            <optgroup key={f} label={cap(f)}>
              {TILES.map((t, i) => (t.family === f ? <option key={t.id} value={i}>{t.label}</option> : null))}
            </optgroup>
          ))}
        </select>
        <button type="button" onClick={() => setIdx((i) => (i + 1) % TILES.length)} title="Next (→)">›</button>
        <label className="tc-toggle"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> grid overlay</label>
        <span className="tc-hint">← → to flip · {idx + 1}/{TILES.length}</span>
      </header>

      <div className="tc-panes">
        <Pane label="RAW — PixelLab native (crisp, ~33°)" src={tile.raw} w={96} h={tile.rawH} grid={grid} />
        <Pane label="PROCESSED — snapped to our grid (~29°)" src={tile.proc} w={96} h={180} grid={grid} />
      </div>

      <footer className="tc-strip">
        {TILES.map((t, i) => (
          <button key={t.id} type="button" className={`tc-thumb ${i === idx ? 'is-active' : ''}`} title={`${t.label} — ${t.id}`} onClick={() => setIdx(i)}>
            <img src={t.proc} alt={t.label} draggable={false} />
          </button>
        ))}
      </footer>
    </section>
  );
}

const TC_CSS = `
.tc { position: fixed; inset: var(--app-header-h) 0 0 0; z-index: 5; display: flex; flex-direction: column;
  background: #0a0c12; color: #d7e6ff; font-family: var(--ds-font-sans, system-ui, sans-serif); }
.tc-bar { display: flex; align-items: center; gap: 10px; padding: 8px 14px; background: #0d1626; border-bottom: 1px solid #1b2740; }
.tc-name { font-size: 18px; font-weight: 700; letter-spacing: .02em; color: #eaf3ff; }
.tc-id { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; color: #7fd4ff;
  background: #0b1322; border: 1px solid #233248; border-radius: 4px; padding: 3px 7px; margin-right: 6px; }
.tc-bar button { appearance: none; height: 36px; min-width: 36px; padding: 0 10px; font-size: 20px; line-height: 1;
  background: #111a2c; color: #eaf3ff; border: 1px solid #2a3c5e; border-radius: 4px; cursor: pointer; }
.tc-bar button:hover { background: #17223a; }
.tc-bar select { height: 36px; min-width: 150px; padding: 0 10px; font-size: 14px; font-family: inherit;
  background: #111a2c; color: #eaf3ff; border: 1px solid #2a3c5e; border-radius: 4px; }
.tc-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #9fd8ff; cursor: pointer; }
.tc-hint { margin-left: auto; font-size: 12px; color: #6f86ab; }
.tc-panes { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; }
.tc-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid #18233a; }
.tc-pane:last-child { border-right: 0; }
.tc-pane-label { padding: 8px 12px; font-size: 12px; letter-spacing: .04em; color: #9fd8ff; background: #0b1322; border-bottom: 1px solid #18233a; }
.tc-stage { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 18px;
  background-color: #14181f;
  background-image: linear-gradient(45deg, #1b212b 25%, transparent 25%), linear-gradient(-45deg, #1b212b 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #1b212b 75%), linear-gradient(-45deg, transparent 75%, #1b212b 75%);
  background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0; }
.tc-frame { position: relative; height: min(74vh, 760px); }
.tc-frame img { height: 100%; width: 100%; object-fit: contain; display: block; image-rendering: pixelated; }
.tc-grid { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.tc-grid polyline { fill: none; stroke: #38e07b; stroke-width: 1; vector-effect: non-scaling-stroke; opacity: .85; }
.tc-strip { flex: 0 0 auto; display: flex; gap: 4px; padding: 8px 10px; overflow-x: auto; background: #0d1626; border-top: 1px solid #1b2740; }
.tc-thumb { flex: 0 0 auto; width: 40px; height: 56px; padding: 2px; background: #111a2c; border: 1px solid #2a3c5e; border-radius: 3px; cursor: pointer; }
.tc-thumb.is-active { border-color: #38e07b; box-shadow: 0 0 0 1px #38e07b; }
.tc-thumb img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
`;
