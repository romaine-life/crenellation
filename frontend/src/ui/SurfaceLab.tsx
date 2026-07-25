import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { tileAssets, tileFamilies, edgeTiles, muralTiles, edgeFeatures, type TileAsset } from '../art/tileset';
import { solveSocketBoard } from '../core/tileBoardGenerator';
import { BoardLabBoard } from '../render/BoardLabBoard';

// Inspector for the production surface-swap tileset (Blender edge + flat PixelLab top,
// palette-tied sides; built by scripts/build-surface-tiles.py). Two views:
//   • Board — a real ALL-OF-ONE-FAMILY board (pick the family) through the game's
//     BoardLabBoard renderer, WITH the frayed perimeter EDGE layer (ADR-0039), so you can
//     judge a family's tiles AND its dropping edge on a clean board. Re-roll + zoom + Crisp.
//   • Tiles — per-family grid: each production tile + the flat top-down surface it came from.
// Use this to review whatever the pipeline generates next. Route: /surface-lab?view=board&family=grass.

const FAMILIES = ['grass', 'dirt', 'stone', 'pebble', 'sand', 'water'] as const;
type Family = (typeof FAMILIES)[number];
const MAX_PER_FAMILY = 14;
const baseSrc = (f: Family) => `/assets/tiles/pixel/${f}-codexfilter.png`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Card({ family, n }: { family: Family; n: number }): ReactElement | null {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <div className="sl-card">
      <div className="sl-card-head">{cap(family)} {n + 1}</div>
      <div className="sl-stage sl-stage--tile">
        <img className="sl-px" src={`/assets/tiles/surface/${family}-${n}.png`} alt={`${family} ${n + 1}`}
          draggable={false} onError={() => setOk(false)} />
      </div>
      <div className="sl-stage sl-stage--flat">
        <img className="sl-px" src={`/assets/tiles/surface-lab/${family}-surf-${n}.png`} alt={`${family} ${n + 1} surface`} draggable={false} />
      </div>
      <div className="sl-card-foot">surface ↑ · tile ↑↑</div>
    </div>
  );
}

export function SurfaceLab(): ReactElement {
  const params = new URLSearchParams(window.location.search);
  const [view, setView] = useState<'board' | 'tiles'>(() => (params.get('view') === 'tiles' ? 'tiles' : 'board'));
  const [family, setFamily] = useState<Family>(() => {
    const f = params.get('family') as Family;
    return FAMILIES.includes(f) ? f : 'grass';
  });
  const [seed, setSeed] = useState(() => {
    const s = parseInt(params.get('seed') ?? '', 10);
    return Number.isFinite(s) ? s : 7;
  });
  const [zoom, setZoom] = useState(1.1);
  const [crisp, setCrisp] = useState(() => params.get('render') !== 'smooth');
  // Story features are PARKED (the per-tile fossil doesn't read continuous across the iso
  // step — see ADR-0041); default OFF so the board shows the continuity mural, opt in via ?story=on.
  const [story, setStory] = useState(() => params.get('story') === 'on');

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    p.set('view', view); p.set('family', family); p.set('render', crisp ? 'crisp' : 'smooth');
    p.set('story', story ? 'on' : 'off'); p.set('seed', String(seed));
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${p.toString()}`);
  }, [view, family, crisp, story, seed]);

  // All-of-one-family board (the selected family) WITH the frayed perimeter edge layer
  // (ADR-0039), so the chosen family's tiles AND its dropping edge read on a real board.
  const COLS = 11;
  const ROWS = 9;
  const board = useMemo(
    () => solveSocketBoard({
      assets: tileAssets as readonly TileAsset[],
      terrainMap: Array.from({ length: COLS * ROWS }, () => family),
      seed,
      columns: COLS,
      rows: ROWS,
      familyAssets: tileFamilies,
      edgeAssets: edgeTiles,
      muralEdges: muralTiles,
      edgeFeatures: story ? edgeFeatures : undefined,
    }),
    [family, seed, story],
  );

  return (
    <section className="sl">
      <style>{SL_CSS}</style>
      <header className="sl-bar">
        <div className="sl-seg">
          <button type="button" className={`sl-tab ${view === 'board' ? 'is-active' : ''}`} onClick={() => setView('board')}>Board</button>
          <button type="button" className={`sl-tab ${view === 'tiles' ? 'is-active' : ''}`} onClick={() => setView('tiles')}>Tiles</button>
        </div>
        <nav className="sl-tabs">
          {FAMILIES.map((f) => (
            <button key={f} type="button" className={`sl-tab ${f === family ? 'is-active' : ''}`} onClick={() => setFamily(f)}>{cap(f)}</button>
          ))}
        </nav>
        {view === 'board' ? (
          <div className="sl-seg">
            <button type="button" className="sl-tab" onClick={() => setSeed((s) => (s % 9999) + 1)}>↻ Re-roll</button>
            <button type="button" className="sl-tab" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</button>
            <button type="button" className="sl-tab" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>+</button>
            <span className="sl-treat-label" style={{ marginLeft: 8 }}>render:</span>
            <button type="button" className={`sl-tab ${!crisp ? 'is-active' : ''}`} onClick={() => setCrisp(false)}>Smooth</button>
            <button type="button" className={`sl-tab ${crisp ? 'is-active' : ''}`} onClick={() => setCrisp(true)}>Crisp</button>
            <button type="button" className={`sl-tab ${story ? 'is-active' : ''}`} style={{ marginLeft: 8 }} onClick={() => setStory((s) => !s)}>Story</button>
          </div>
        ) : null}
      </header>

      {view === 'board' ? (
        <div className={`sl-board ${crisp ? 'is-crisp' : ''}`}>
          <BoardLabBoard board={board} assetFrameSrc={(a) => a.src} boardZoom={zoom} ariaLabel="Tileset board preview" />
        </div>
      ) : (
        <div className="sl-grid" key={family}>
          <div className="sl-card sl-card--ref">
            <div className="sl-card-head">edge base</div>
            <div className="sl-stage sl-stage--tile">
              <img className="sl-px" src={baseSrc(family)} alt="edge base" draggable={false} />
            </div>
            <div className="sl-stage sl-stage--flat sl-stage--empty">no surface</div>
            <div className="sl-card-foot">codexfilter edge (for contrast)</div>
          </div>
          {Array.from({ length: MAX_PER_FAMILY }, (_, n) => <Card key={`${family}-${n}`} family={family} n={n} />)}
        </div>
      )}
    </section>
  );
}

const SL_CSS = `
.sl { position: fixed; inset: var(--app-header-h) 0 0 0; z-index: 5; display: flex; flex-direction: column;
  background: #0a0c12; color: #d7e6ff; font-family: var(--ds-font-sans, system-ui, sans-serif); }
.sl-bar { display: flex; align-items: center; gap: 12px; padding: 9px 16px; background: #0d1626; border-bottom: 1px solid #1b2740; flex-wrap: wrap; }
.sl-name { font-size: 18px; font-weight: 700; color: #eaf3ff; }
.sl-seg, .sl-tabs { display: flex; gap: 4px; }
.sl-treat-label { font-size: 12px; color: #6f86ab; }
.sl-tab { appearance: none; height: 30px; padding: 0 12px; font-size: 13px; font-family: inherit; cursor: pointer;
  background: #111a2c; color: #cfe3ff; border: 1px solid #2a3c5e; border-radius: 5px; }
.sl-tab:hover { background: #17223a; }
.sl-tab.is-active { background: #1d3354; border-color: #3f74c0; color: #eaf3ff; }
.sl-board { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden;
  background: radial-gradient(120% 90% at 50% 18%, #16202f 0%, #0b1018 70%); }
.sl-board.is-crisp .tileset-generated-board-tile img { image-rendering: pixelated; }
.sl-grid { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 16px;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 14px; align-content: start; }
.sl-card { display: flex; flex-direction: column; gap: 8px;
  background: #0c1322; border: 1px solid #1b2740; border-radius: 8px; padding: 10px; }
.sl-card--ref { background: #0b1a16; border-color: #1d3a30; }
.sl-card-head { text-align: center; font-size: 13px; font-weight: 600; color: #9fd8ff; letter-spacing: .03em; }
.sl-card-foot { text-align: center; font-size: 10px; color: #5f769b; }
.sl-stage { display: flex; align-items: center; justify-content: center; border-radius: 6px;
  background-color: #14181f;
  background-image: linear-gradient(45deg, #1b212b 25%, transparent 25%), linear-gradient(-45deg, #1b212b 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #1b212b 75%), linear-gradient(-45deg, transparent 75%, #1b212b 75%);
  background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0; }
.sl-stage--tile { padding: 6px; height: 190px; }
.sl-stage--tile .sl-px { height: 100%; }
.sl-stage--flat { padding: 6px; height: 92px; }
.sl-stage--flat .sl-px { height: 100%; }
.sl-stage--empty { color: #4f6688; font-size: 12px; }
.sl-px { width: auto; object-fit: contain; display: block; image-rendering: pixelated; }
`;
