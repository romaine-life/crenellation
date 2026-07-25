import { useState, type ReactElement, type ReactNode, type CSSProperties } from 'react';
import { SLIDER_ASSETS, type SliderAsset } from './sliderCatalog';

// Build the ::-webkit / ::-moz slider skin for one entry, scoped to a class. The filled
// portion follows --val (a percentage) so the bar fills as the value changes — exactly the
// live Settings slider, driven from the catalog's palette rather than hard-coded in style.css.
function sliderSkin(s: SliderAsset, cls: string): string {
  const track = `background: linear-gradient(90deg, ${s.fill} var(--val, 0%), ${s.channel} var(--val, 0%)); border: 1px solid ${s.edge}; height: 10px;`;
  const thumb = `background: ${s.handle}; border: 3px solid; border-color: ${s.handleLight} ${s.handleDark} ${s.handleDark} ${s.handleLight}; block-size: 20px; inline-size: 14px;`;
  return [
    `.${cls} { -webkit-appearance: none; appearance: none; width: 100%; height: 22px; background: transparent; cursor: pointer; }`,
    `.${cls}::-webkit-slider-runnable-track { ${track} }`,
    `.${cls}::-moz-range-track { ${track} }`,
    `.${cls}::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; ${thumb} margin-top: -7px; }`,
    `.${cls}::-moz-range-thumb { ${thumb} }`,
  ].join('\n');
}

// Read-only catalog grid for slide-bar candidates. Each card previews AS a slider — a static
// skinned bar at a sample fill — so it reads as a slider, not loose art. Reuses the shared
// studio card + grid classes so it matches Tiles / Units / Surfaces / Scrollbars.
export function SliderLibraryStudio({
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
  const visible = SLIDER_ASSETS.filter((s) => !q || [s.label, s.approach, s.material].join(' ').toLowerCase().includes(q));
  const sampleFill = 64; // a static value so the card reads as a partly-filled slider
  return (
    <div className="tileset-studio-grid surface-grid" aria-label="Sliders">
      {visible.map((s) => (
        <button
          key={s.name}
          type="button"
          className={`tileset-studio-card ${s.name === selected ? 'is-selected' : ''}`.trim()}
          onClick={() => onSelect(s.name)}
          aria-pressed={s.name === selected}
          title={`${s.label} — slide bar`}
        >
          <span className="tileset-studio-card-image" style={{ '--tile-zoom': zoom } as CSSProperties}>
            {/* A static slider mock: a stone channel, a bronze fill, and a beveled handle. */}
            <span style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 14%' } as CSSProperties}>
              <span style={{ position: 'relative', width: '100%', height: '10px', background: s.channel, border: `1px solid ${s.edge}` } as CSSProperties}>
                <span style={{ position: 'absolute', insetBlock: '0', left: '0', width: `${sampleFill}%`, background: s.fill } as CSSProperties} />
                <span
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: `${sampleFill}%`,
                    transform: 'translate(-50%, -50%)',
                    width: '14px',
                    height: '20px',
                    background: s.handle,
                    borderStyle: 'solid',
                    borderWidth: '3px',
                    borderColor: `${s.handleLight} ${s.handleDark} ${s.handleDark} ${s.handleLight}`,
                  } as CSSProperties}
                />
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
      {visible.length === 0 ? <p className="tileset-studio-empty">No sliders match.</p> : null}
    </div>
  );
}

// The Viewer EXERCISES the slider: a real, large, draggable <input type="range"> skinned with
// the entry, so you drag it and watch the bronze fill follow — never a dead still image
// (ADR-0029: read-only = not editable, not lifeless). Custom skins render in Chrome (the target).
export function SliderViewer({ name, header }: { name?: string; header?: ReactNode }): ReactElement {
  const s = SLIDER_ASSETS.find((x) => x.name === name) ?? SLIDER_ASSETS[0];
  const [value, setValue] = useState(64);
  return (
    <>
      <section className="al-lab-main surface-view-main" aria-label="Slider test">
        <style>{sliderSkin(s, 'slider-demo')}</style>
        <div className="surface-view-stage is-bare" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8%' }}>
          <div style={{ width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
            <input
              type="range"
              className="slider-demo"
              min={0}
              max={100}
              step={1}
              value={value}
              onChange={(event) => setValue(Number(event.target.value))}
              style={{ '--val': `${value}%` } as CSSProperties}
              aria-label={`${s.label} slider — drag to test`}
            />
            <output style={{ fontVariantNumeric: 'tabular-nums', color: '#d8c9a8', letterSpacing: '0.04em' }}>{value}%</output>
          </div>
        </div>
      </section>
      <aside className="tileset-view-controls" aria-label="Slider details">
        <section className="tileset-inspector-section">
          <h2>Controls</h2>
          <div className="tileset-control-stack">
            {header}
            <p className="tileset-catalog-note">Drag the handle — the bronze fill follows. This is the real control, not a picture.</p>
            <dl className="al-meta">
              <div><dt>Slider</dt><dd>{s.label}</dd></div>
              <div><dt>Approach</dt><dd>{s.approach}</dd></div>
              <div><dt>Material</dt><dd>{s.material}</dd></div>
              <div><dt>Default</dt><dd>{s.preferred ? 'preferred' : '—'}</dd></div>
            </dl>
            <p className="tileset-catalog-note">{s.description}</p>
          </div>
        </section>
      </aside>
    </>
  );
}
