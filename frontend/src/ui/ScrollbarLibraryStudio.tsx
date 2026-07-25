import { type ReactElement, type ReactNode, type CSSProperties } from 'react';
import { SCROLLBAR_ASSETS } from './scrollbarCatalog';

// Read-only catalog grid for scrollbar-grip candidates. Each card shows the sprite centered
// (a scrollbar grip is a single element, not a tiled surface). Reuses the shared studio card +
// surface-swatch classes so it matches the Tiles / Units / Surfaces grids.
export function ScrollbarLibraryStudio({
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
  const visible = SCROLLBAR_ASSETS.filter((s) => !q || [s.label, s.approach, s.material].join(' ').toLowerCase().includes(q));
  return (
    <div className="tileset-studio-grid surface-grid" aria-label="Scrollbars">
      {visible.map((s) => (
        <button
          key={s.name}
          type="button"
          className={`tileset-studio-card ${s.name === selected ? 'is-selected' : ''}`.trim()}
          onClick={() => onSelect(s.name)}
          aria-pressed={s.name === selected}
          title={`${s.label} — scrollbar grip`}
        >
          <span className="tileset-studio-card-image" style={{ '--tile-zoom': zoom } as CSSProperties}>
            {/* Preview AS a scrollbar: a recessed track + a thumb skinned by this entry —
                'sprite' shows the carved shape, 'texture' fills a plain thumb with the material. */}
            <span style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '11%' } as CSSProperties}>
              <span style={{ position: 'relative', width: '22px', height: '74%', background: '#05101c', borderRadius: '2px', border: '1px solid #16314c' } as CSSProperties}>
                {s.kind === 'texture' ? (
                  <span style={{ position: 'absolute', top: '6px', left: '2px', right: '2px', height: '46%', borderRadius: '2px', backgroundImage: `url("${s.file}")`, backgroundSize: 'cover', backgroundPosition: 'center', imageRendering: 'pixelated', borderTop: '2px solid rgba(255,245,225,0.4)', borderLeft: '1px solid rgba(255,245,225,0.3)', borderBottom: '2px solid rgba(0,0,0,0.5)', borderRight: '1px solid rgba(0,0,0,0.45)' } as CSSProperties} />
                ) : (
                  <span style={{ position: 'absolute', top: '5px', left: '1px', right: '1px', height: '54%', backgroundImage: `url("${s.file}")`, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', imageRendering: 'pixelated' } as CSSProperties} />
                )}
              </span>
            </span>
          </span>
          <span className="tileset-studio-card-meta">
            <span className="tileset-studio-card-text">
              <strong>{s.label}</strong>
              <em>{s.preferred ? `${s.material} · preferred` : s.material}</em>
            </span>
          </span>
        </button>
      ))}
      {visible.length === 0 ? <p className="tileset-studio-empty">No scrollbars match.</p> : null}
    </div>
  );
}

// The Viewer for a scrollbar grip EXERCISES it: a real, live scrollable panel skinned with the
// grip, so you scroll and drag-test how it actually behaves — never a dead still image
// (ADR-0029: viewing surfaces present the asset at optimal interactivity; read-only = not
// editable, not lifeless). Custom ::-webkit-scrollbar skins render in Chrome (the app's target).
export function ScrollbarViewer({ name, header }: { name?: string; header?: ReactNode }): ReactElement {
  const s = SCROLLBAR_ASSETS.find((x) => x.name === name) ?? SCROLLBAR_ASSETS[0];
  const skin =
    `.scrollbar-demo::-webkit-scrollbar { width: 18px; }\n` +
    `.scrollbar-demo::-webkit-scrollbar-track { background: #06121f; border-radius: 2px; margin: 3px; }\n` +
    `.scrollbar-demo::-webkit-scrollbar-thumb { background: url("${s.file}") center / 100% 100% no-repeat; image-rendering: pixelated; }`;
  const lines = Array.from({ length: 24 }, (_, i) => 40 + ((i * 13) % 46));
  return (
    <>
      <section className="al-lab-main surface-view-main" aria-label="Scrollbar test">
        <style>{skin}</style>
        <div className="surface-view-stage is-bare" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            className="scrollbar-demo"
            style={{ width: '280px', height: '330px', overflowY: 'scroll', overflowX: 'hidden', background: '#0c1a2b', border: '1px solid #28415e', borderRadius: '7px', padding: '14px' }}
          >
            <div style={{ minHeight: '1100px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {lines.map((w, i) => (
                <span key={i} style={{ height: '9px', width: `${w}%`, background: 'rgba(150,180,210,0.14)', borderRadius: '3px', flex: '0 0 auto' }} />
              ))}
            </div>
          </div>
        </div>
      </section>
      <aside className="tileset-view-controls" aria-label="Scrollbar details">
        <section className="tileset-inspector-section">
          <h2>Controls</h2>
          <div className="tileset-control-stack">
            {header}
            <p className="tileset-catalog-note">Scroll the panel — drag the grip or wheel over it — to test how it behaves.</p>
            <dl className="al-meta">
              <div><dt>Scrollbar</dt><dd>{s.label}</dd></div>
              <div><dt>Approach</dt><dd>{s.approach}</dd></div>
              <div><dt>Material</dt><dd>{s.material}</dd></div>
              <div><dt>Default</dt><dd>{s.preferred ? 'preferred' : '—'}</dd></div>
            </dl>
          </div>
        </section>
      </aside>
    </>
  );
}
