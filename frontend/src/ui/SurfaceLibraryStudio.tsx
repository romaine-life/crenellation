import { useState, type ReactElement, type ReactNode, type CSSProperties } from 'react';
import { SURFACE_ASSETS } from './surfaceCatalog';

// Read-only catalog grid for background surfaces. Each card shows the texture *tiled* (the
// way it renders behind panels) rather than the raw single tile, so you read it as a surface.
// Reuses the shared studio card classes so it matches the Tiles/Units grids.
export function SurfaceLibraryStudio({
  search,
  zoom,
  selected,
  onSelect,
}: {
  search: string;
  zoom: number;
  selected?: string;
  onSelect: (name: string) => void;
}): ReactElement {
  const q = search.trim().toLowerCase();
  const visible = SURFACE_ASSETS.filter((s) => !q || [s.label, s.approach, s.material].join(' ').toLowerCase().includes(q));
  return (
    <div className="tileset-studio-grid surface-grid" aria-label="Surfaces">
      {visible.map((s) => (
        <button
          key={s.name}
          type="button"
          className={`tileset-studio-card ${s.name === selected ? 'is-selected' : ''}`.trim()}
          onClick={() => onSelect(s.name)}
          aria-pressed={s.name === selected}
          title={`${s.label} — tiled surface`}
        >
          <span className="tileset-studio-card-image" style={{ '--tile-zoom': zoom } as CSSProperties}>
            <span
              className="surface-swatch"
              style={{ backgroundImage: `url("${s.file}")`, backgroundSize: `${Math.round(110 * zoom)}px` } as CSSProperties}
            />
          </span>
          <span className="tileset-studio-card-meta">
            <span className="tileset-studio-card-text">
              <strong>{s.label}</strong>
              <em>{s.material}</em>
            </span>
          </span>
        </button>
      ))}
      {visible.length === 0 ? <p className="tileset-studio-empty">No surfaces match.</p> : null}
    </div>
  );
}

// The read-only Viewer for a single surface — shown big, both in a framed panel (the way it
// renders behind chrome) and as a bare tiled field, with a Details readout. Mirrors AssetLab.
export function SurfaceViewer({ name, header }: { name?: string; header?: ReactNode }): ReactElement {
  const s = SURFACE_ASSETS.find((x) => x.name === name) ?? SURFACE_ASSETS[0];
  // Zoom scales the displayed tile size. The surface repeats, so zoom alone is enough to
  // inspect it — no panning needed; you always see filled content. Low zoom = many tiles
  // (read it as a surface), high zoom = big pixels (inspect the pixel art / seams).
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<'panel' | 'bare'>('panel');
  const bg: CSSProperties = {
    backgroundImage: `url("${s.file}")`,
    backgroundSize: `${Math.round((s.tilePx / 4) * zoom)}px`,
    backgroundRepeat: 'repeat',
    backgroundPosition: 'center',
    imageRendering: 'pixelated',
  };
  return (
    <>
      <section className="al-lab-main surface-view-main" aria-label="Surface preview">
        <div className={`surface-view-stage ${view === 'panel' ? 'is-panel' : 'is-bare'}`} style={bg} />
      </section>
      <aside className="tileset-view-controls" aria-label="Surface details">
        <section className="tileset-inspector-section">
          <h2>Controls</h2>
          <div className="tileset-control-stack">
            {header}
            <div className="tileset-filter-field">
              <span>View</span>
              <div className="tileset-tier-seg" aria-label="Surface preview mode">
                <button type="button" className={view === 'panel' ? 'is-active' : ''} onClick={() => setView('panel')}>In panel</button>
                <button type="button" className={view === 'bare' ? 'is-active' : ''} onClick={() => setView('bare')}>Bare</button>
              </div>
            </div>
            <label className="tileset-catalog-zoom">
              <span>Zoom · {zoom.toFixed(1)}×</span>
              <input type="range" min="0.5" max="8" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
            </label>
            <p className="tileset-catalog-note">Drag the preview's bottom-right corner to resize it.</p>
            <button type="button" className="tileset-view-action pages-reset" onClick={() => { setZoom(1); setView('panel'); }}>Reset to defaults</button>
            <dl className="al-meta">
              <div><dt>Surface</dt><dd>{s.label}</dd></div>
              <div><dt>Approach</dt><dd>{s.approach}</dd></div>
              <div><dt>Material</dt><dd>{s.material}</dd></div>
              <div><dt>Tile</dt><dd>{s.tilePx}px · seamless · repeat</dd></div>
            </dl>
          </div>
        </section>
      </aside>
    </>
  );
}
