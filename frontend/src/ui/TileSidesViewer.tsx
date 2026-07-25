import { useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { TILE_SIDE_ITEMS, tileSideItemById } from './tileSideCatalog';
import { terrainLabels } from '../core/tileSockets';

// Read-only Viewer for a single tile's SIDE faces — the tile shown big on an inspection
// backdrop with a zoom up to 8× so you can scrutinise the cliff cross-section pixel-by-pixel.
// Mirrors SurfaceViewer (al-lab-main stage + tileset-view-controls Details). The tile is the
// real shipped sprite (96×180), pixelated and grafted 1:1 — never a re-scaled still.
const STAGE_BG: Record<'void' | 'sky', string> = {
  void: '#080b14',
  sky: '#16243c',
};

export function TileSidesViewer({ name, header }: { name?: string; header?: ReactNode }): ReactElement {
  const item = tileSideItemById(name) ?? TILE_SIDE_ITEMS[0];
  const [zoom, setZoom] = useState(3);
  const [backdrop, setBackdrop] = useState<'void' | 'sky'>('void');
  const width = Math.round(96 * zoom);
  const height = Math.round(180 * zoom);
  const stage: CSSProperties = {
    background: STAGE_BG[backdrop],
    display: 'grid',
    placeItems: 'center',
    overflow: 'auto',
  };
  return (
    <>
      <section className="al-lab-main surface-view-main" aria-label="Tile side preview">
        <div className="surface-view-stage tile-side-stage" style={stage}>
          <img
            src={item.src}
            alt={`${item.label} side faces`}
            width={width}
            height={height}
            style={{ imageRendering: 'pixelated' }}
            draggable={false}
          />
        </div>
      </section>
      <aside className="tileset-view-controls" aria-label="Tile side details">
        <section className="tileset-inspector-section">
          <h2>Controls</h2>
          <div className="tileset-control-stack">
            {header}
            <div className="tileset-filter-field">
              <span>Backdrop</span>
              <div className="tileset-tier-seg" aria-label="Inspection backdrop">
                <button type="button" className={backdrop === 'void' ? 'is-active' : ''} onClick={() => setBackdrop('void')}>Void</button>
                <button type="button" className={backdrop === 'sky' ? 'is-active' : ''} onClick={() => setBackdrop('sky')}>Sky</button>
              </div>
            </div>
            <label className="tileset-catalog-zoom">
              <span>Zoom · {zoom.toFixed(1)}×</span>
              <input type="range" min="1" max="8" step="0.5" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
            </label>
            <button type="button" className="tileset-view-action pages-reset" onClick={() => { setZoom(3); setBackdrop('void'); }}>Reset to defaults</button>
            <dl className="al-meta">
              <div><dt>Tile</dt><dd>{item.label}</dd></div>
              <div><dt>Family</dt><dd>{terrainLabels[item.family]}</dd></div>
              <div><dt>Role</dt><dd>{item.role}</dd></div>
              <div><dt>Canvas</dt><dd>96 × 180 px</dd></div>
              <div><dt>Side face</dt><dd>≈ 85 px below the top diamond</dd></div>
            </dl>
          </div>
        </section>
      </aside>
    </>
  );
}
