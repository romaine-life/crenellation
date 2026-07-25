import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import type { TerrainType } from '../core/types';
import { AUTHORED_SAMPLE_KEYS, authoredSampleKeyFor, previewArrival, previewSample, previewTerrain, type SampleKey } from '../sfx';
import { sfxSampleWaveform, sfxSampleWaveformCached } from '../sfxWaveform';
import { ASSIGNABLE_TERRAINS, SFX_ASSETS, type SfxAsset } from './sfxCatalog';

// Draft SFX assignments live in localStorage so they survive reloads. They do NOT change
// the running game — they're a proposal you craft here and hand to Claude (the "Copy for
// Claude" button), who bakes the final values into TERRAIN_SAMPLE / playArrival.
const ASSIGN_STORE_KEY = 'chess-tactics-sfx-assignments-v1';
const ARRIVAL_STORE_KEY = 'chess-tactics-sfx-arrival-v1';

type FiringMode = 'per-unit' | 'once';
interface ArrivalSettings { sound: string; volume: number; firing: FiringMode }
// Current baked-in behaviour: the 'arrival' set, ~0.55 call gain, one thump per unit.
const DEFAULT_ARRIVAL: ArrivalSettings = { sound: 'arrival', volume: 55, firing: 'per-unit' };

function defaultAssignments(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of ASSIGNABLE_TERRAINS) out[t] = authoredSampleKeyFor(t) ?? '';
  return out;
}

function loadAssignments(): Record<string, string> {
  const out = defaultAssignments();
  try {
    const raw = window.localStorage.getItem(ASSIGN_STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const t of ASSIGNABLE_TERRAINS) if (typeof parsed[t] === 'string') out[t] = parsed[t] as string;
    }
  } catch { /* absent / malformed → defaults */ }
  return out;
}

function loadArrival(): ArrivalSettings {
  const out = { ...DEFAULT_ARRIVAL };
  try {
    const raw = window.localStorage.getItem(ARRIVAL_STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ArrivalSettings>;
      if (typeof p.sound === 'string') out.sound = p.sound;
      if (typeof p.volume === 'number' && Number.isFinite(p.volume)) out.volume = Math.min(100, Math.max(0, p.volume));
      if (p.firing === 'per-unit' || p.firing === 'once') out.firing = p.firing;
    }
  } catch { /* absent / malformed → defaults */ }
  return out;
}

// The SFX assignment editor (terrain→sound + the arrival thump) shown above the grid.
function SfxAssignmentPanel(): ReactElement {
  const soundKeys = useMemo(() => AUTHORED_SAMPLE_KEYS.filter((k) => k !== 'arrival'), []);
  const [assign, setAssign] = useState<Record<string, string>>(() => loadAssignments());
  const [arrival, setArrival] = useState<ArrivalSettings>(() => loadArrival());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try { window.localStorage.setItem(ASSIGN_STORE_KEY, JSON.stringify(assign)); } catch { /* ignore */ }
  }, [assign]);
  useEffect(() => {
    try { window.localStorage.setItem(ARRIVAL_STORE_KEY, JSON.stringify(arrival)); } catch { /* ignore */ }
  }, [arrival]);

  const setOne = (terrain: string, key: string) => setAssign((a) => ({ ...a, [terrain]: key }));
  const setArr = (patch: Partial<ArrivalSettings>) => setArrival((a) => ({ ...a, ...patch }));
  const reset = () => { setAssign(defaultAssignments()); setArrival({ ...DEFAULT_ARRIVAL }); };
  const copy = () => {
    const w = Math.max(...ASSIGNABLE_TERRAINS.map((t) => t.length));
    const terrainLines = ASSIGNABLE_TERRAINS.map((t) => `  ${t.padEnd(w)} -> ${assign[t] ? assign[t] : '(silent)'}`);
    const text = [
      'SFX assignments (apply in frontend/src/sfx.ts + game/store.ts):',
      '',
      'Terrains (TERRAIN_SAMPLE):',
      ...terrainLines,
      '',
      'Arrival / deploy thump (playArrival):',
      `  sound  -> ${arrival.sound || 'none (off)'}`,
      `  volume -> ${arrival.volume}%`,
      `  firing -> ${arrival.firing}`,
    ].join('\n');
    void navigator.clipboard?.writeText(text)
      .then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })
      .catch(() => { /* clipboard blocked — the user can still read the rows */ });
  };

  const label: CSSProperties = { color: 'var(--ds-ink-1, #ecedf2)', textTransform: 'capitalize' };
  const heading: CSSProperties = { margin: 0, color: '#72bde8', font: '800 12px/1.3 var(--ds-font-sans, system-ui, sans-serif)', letterSpacing: 0.6, textTransform: 'uppercase' };
  const note: CSSProperties = { margin: 0 };
  const rows: CSSProperties = { display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '6px 12px', alignItems: 'center', maxWidth: 460 };

  return (
    <div aria-label="Sound assignments" style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <h2 style={heading}>Terrain sounds</h2>
        <p className="tileset-catalog-note" style={note}>
          Which recorded sound voices each terrain — ▶ to hear it. A draft; it doesn’t change the running game.
        </p>
        <div style={rows}>
          {ASSIGNABLE_TERRAINS.map((t) => (
            <Fragment key={t}>
              <span style={label}>{t}</span>
              <select value={assign[t] ?? ''} onChange={(e) => setOne(t, e.target.value)} aria-label={`Sound for ${t}`} style={{ width: '100%' }}>
                <option value="">— silent —</option>
                {soundKeys.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <button
                type="button"
                className="tileset-view-action"
                disabled={!assign[t]}
                onClick={() => { if (assign[t]) previewSample(assign[t] as SampleKey); }}
                aria-label={`Play the sound assigned to ${t}`}
              >▶</button>
            </Fragment>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <h2 style={heading}>Arrival (on deploy)</h2>
        <p className="tileset-catalog-note" style={note}>The thump layered over the terrain sound as a unit lands on the board.</p>
        <div style={rows}>
          <span style={label}>Sound</span>
          <select value={arrival.sound} onChange={(e) => setArr({ sound: e.target.value })} aria-label="Arrival sound" style={{ width: '100%' }}>
            <option value="">— none (no thump) —</option>
            {AUTHORED_SAMPLE_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button
            type="button"
            className="tileset-view-action"
            disabled={!arrival.sound}
            onClick={() => { if (arrival.sound) previewSample(arrival.sound as SampleKey, arrival.volume / 100); }}
            aria-label="Play the arrival sound at its volume"
          >▶</button>

          <span style={label}>Volume</span>
          <input
            type="range" min={0} max={100} value={arrival.volume}
            onChange={(e) => setArr({ volume: Number(e.target.value) })}
            aria-label="Arrival volume" style={{ width: '100%' }}
          />
          <span style={{ color: 'var(--ds-ink-2, #aeb4c2)', minWidth: 34, textAlign: 'right' }}>{arrival.volume}%</span>

          <span style={label}>Firing</span>
          <select value={arrival.firing} onChange={(e) => setArr({ firing: e.target.value as FiringMode })} aria-label="Arrival firing mode" style={{ width: '100%' }}>
            <option value="per-unit">per-unit (staggered)</option>
            <option value="once">once (whole squad)</option>
          </select>
          <span />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="tileset-view-action" onClick={copy}>{copied ? 'Copied ✓' : 'Copy for Claude'}</button>
        <button type="button" className="tileset-view-action" onClick={reset}>Reset to current</button>
      </div>
    </div>
  );
}

// Read-only catalog for the landing sound effects (ADR-0029 catalog requirements). Each
// card shows the sound's real recorded waveform and auditions it on click; the Viewer
// plays it big with a Details readout. "Read-only" constrains editability, not liveness —
// the whole point is to hear it. Every effect is authored foley (the recorded take's
// envelope is the card art). Reuses the shared studio card classes so it matches the grids.

/** Audition an asset live: the arrival thump, or the terrain's recorded landing sound. */
function auditionAsset(asset: SfxAsset): void {
  if (asset.sampleKey === 'arrival') previewArrival();
  else if (asset.terrain) previewTerrain(asset.terrain);
}

/** Normalized peaks for an asset, from the longest decoded take of its sample set. */
function useSfxPeaks(asset: SfxAsset, bars: number): number[] {
  const [peaks, setPeaks] = useState<number[]>(() => sfxSampleWaveformCached(asset.sampleKey, bars) ?? []);
  useEffect(() => {
    const ready = sfxSampleWaveformCached(asset.sampleKey, bars);
    if (ready) { setPeaks(ready); return; }
    let alive = true;
    void sfxSampleWaveform(asset.sampleKey, bars).then((p) => { if (alive) setPeaks(p); });
    return () => { alive = false; };
  }, [asset.sampleKey, bars]);
  return peaks;
}

/** Live amplitude envelope of an effect, drawn as centered SVG bars. */
function SfxWaveform({ asset, bars = 56 }: { asset: SfxAsset; bars?: number }): ReactElement {
  const peaks = useSfxPeaks(asset, bars);
  const n = peaks.length || bars;
  return (
    <svg
      className="sfx-wave"
      viewBox={`0 0 ${n} 100`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ display: 'block', width: '100%', height: '100%' }}
    >
      {peaks.length === 0 ? (
        <line x1="0" y1="50" x2={n} y2="50" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
      ) : (
        peaks.map((p, i) => {
          const h = Math.max(p * 96, 1.5);
          return <rect key={i} x={i + 0.12} y={(100 - h) / 2} width={0.76} height={h} fill="currentColor" />;
        })
      )}
    </svg>
  );
}

export function SfxLibraryStudio({
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
  const visible = SFX_ASSETS.filter((s) => !q || [s.label, s.terrain ?? '', s.character, s.build].join(' ').toLowerCase().includes(q));
  // Catalog main is CONTENT ONLY — a single internally-scrolling grid, no sub-headers
  // (docs/studio-control-architecture.md). The terrain→sound assignment editor is a
  // control surface and lives in the Viewer 'sfx' kind (see SfxViewer), not here.
  return (
    <div className="tileset-studio-grid surface-grid" aria-label="Sound Effects">
      {visible.map((s) => (
        <button
          key={s.name}
          type="button"
          className={`tileset-studio-card ${s.name === selected ? 'is-selected' : ''}`.trim()}
          onClick={() => { onSelect(s.name); auditionAsset(s); }}
          aria-pressed={s.name === selected}
          title={`${s.label} — click to hear`}
        >
          <span
            className="tileset-studio-card-image sfx-card-wave"
            style={{ '--tile-zoom': zoom, color: 'var(--ds-accent, #7ea2ff)', height: `${Math.round(80 * zoom)}px` } as CSSProperties}
          >
            <SfxWaveform asset={s} />
          </span>
          <span className="tileset-studio-card-meta">
            <span className="tileset-studio-card-text">
              <strong>{s.label}</strong>
              <em>{s.character}</em>
            </span>
          </span>
        </button>
      ))}
      {visible.length === 0 ? <p className="tileset-studio-empty">No sound effects match.</p> : null}
    </div>
  );
}

// The 'sfx' Viewer kind is the sound-ASSIGNMENT EDITOR (not a per-sound read-only view).
// It's a global config — the terrain→sound map + the arrival thump — so it ignores per-card
// selection and always renders the same editor. It uses the blessed editing-kind shape the
// spec names for Portrait/9-Slice (docs/studio-control-architecture.md): the editor IS the
// .al-lab-main stage (room for the matrix), and the rail carries only the standing {header}
// (Workspace tabs + Viewer-kind select) plus a one-line note — controls don't fragment
// across regions. Reached from the catalog's "Assign sounds…" affordance (openViewer('sfx'))
// or the Viewer-kind dropdown. (First global-config Viewer kind; deliberate — don't "fix" it
// back into the 260px catalog rail, where the matrix would dominate, against the spec.)
export function SfxViewer({ header }: { header?: ReactNode }): ReactElement {
  return (
    <>
      <section className="al-lab-main" aria-label="Sound assignments">
        <SfxAssignmentPanel />
      </section>
      <aside className="tileset-view-controls" aria-label="Sound assignment controls">
        <section className="tileset-inspector-section">
          <h2>Controls</h2>
          <div className="tileset-control-stack">
            {header}
            <p className="tileset-catalog-note">
              Assign which recorded sound voices each terrain and tune the arrival thump, ▶ to audition,
              then <strong>Copy for Claude</strong> and paste it into chat — I’ll bake it into the game.
            </p>
          </div>
        </section>
      </aside>
    </>
  );
}
