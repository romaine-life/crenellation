import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { DOODAD_ASSETS } from './doodadCatalog';

// Hands-on doodad composer: arm a doodad from the shelf, click the tile to drop it where you
// click, then move/resize/flip it and tag it front (in front of the unit) or back (behind).
// Splitting a single doodad into halves is a later concern — a placed item is a whole doodad
// assigned to one side of the unit. Save writes a JSON composition to disk (dev endpoint).

const FRAME_W = 96;
const FRAME_H = 180;
const ANCHOR_X = 48;
const ANCHOR_Y = 69;
const ZOOM = 4; // canvas px per frame px
const DEFAULT_SCALE = 0.35; // drop small (≈ shin height, ADR-0015), scale up by eye

const TILE_OPTIONS = ['grass-a', 'grass-c', 'dirt-a', 'stone-a', 'water-a', 'pebble-a', 'sand-a'];
const UNIT_OPTIONS = [
  { id: 'pawn', label: 'Pawn' },
  { id: 'knight', label: 'Knight' },
  { id: 'queen', label: 'Queen' },
];
const tileSrc = (id: string) => `/assets/tiles/textured/${id}.png`;
const unitSrc = (kind: string) => `/assets/units/${kind}/navy-blue/south.png`;

type Layer = 'front' | 'back';
interface El { id: string; doodadId: string; x: number; y: number; scale: number; layer: Layer; flip: boolean }

let nextId = 1;
const mkId = () => `el${nextId++}`;

export function DoodadEditor(): ReactElement {
  const [tileId, setTileId] = useState('grass-a');
  const [unitKind, setUnitKind] = useState('knight');
  const [showUnit, setShowUnit] = useState(true);
  const [els, setEls] = useState<El[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null); // doodadId queued for placement
  const [name, setName] = useState('untitled');
  const [status, setStatus] = useState('');
  const stageRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ id: string; px: number; py: number; ox: number; oy: number } | null>(null);

  const selected = els.find((e) => e.id === selectedId) ?? null;
  const update = (id: string, patch: Partial<El>) => setEls((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const remove = (id: string) => { setEls((list) => list.filter((e) => e.id !== id)); setSelectedId((s) => (s === id ? null : s)); };

  const placeAt = (fx: number, fy: number) => {
    if (!armed) return;
    const id = mkId();
    setEls((list) => [...list, { id, doodadId: armed, x: fx, y: fy, scale: DEFAULT_SCALE, layer: 'front', flip: false }]);
    setSelectedId(id);
  };
  const duplicate = () => {
    if (!selected) return;
    const id = mkId();
    setEls((list) => [...list, { ...selected, id, x: selected.x + 10, y: selected.y + 6 }]);
    setSelectedId(id);
  };

  // Drag a placed doodad by its anchor.
  useEffect(() => {
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      update(d.id, { x: d.ox + (ev.clientX - d.px) / ZOOM, y: d.oy + (ev.clientY - d.py) / ZOOM });
    };
    const up = () => { drag.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  // Keyboard: Esc disarms/deselects, Delete removes, arrows nudge.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = document.activeElement?.tagName;
      if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') { if (ev.key === 'Escape') (document.activeElement as HTMLElement).blur(); return; }
      if (ev.key === 'Escape') { setArmed(null); setSelectedId(null); return; }
      if (!selectedId) return;
      if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); remove(selectedId); return; }
      const step = ev.shiftKey ? 5 : 1;
      const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const delta = nudge[ev.key];
      if (delta) { ev.preventDefault(); setEls((list) => list.map((e) => (e.id === selectedId ? { ...e, x: e.x + delta[0], y: e.y + delta[1] } : e))); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  const startDrag = (e: El) => (ev: React.PointerEvent) => {
    ev.preventDefault(); ev.stopPropagation();
    setSelectedId(e.id);
    drag.current = { id: e.id, px: ev.clientX, py: ev.clientY, ox: e.x, oy: e.y };
  };
  const onStagePointerDown = (ev: React.PointerEvent) => {
    if (ev.target !== ev.currentTarget) return; // clicked an element, not the background
    if (armed && stageRef.current) {
      const r = stageRef.current.getBoundingClientRect();
      placeAt((ev.clientX - r.left) / ZOOM, (ev.clientY - r.top) / ZOOM);
    } else {
      setSelectedId(null);
    }
  };

  const composition = () => ({ tile: tileId, frame: { w: FRAME_W, h: FRAME_H, anchorX: ANCHOR_X, anchorY: ANCHOR_Y }, elements: els.map(({ id: _id, ...rest }) => rest) });
  const save = async () => {
    setStatus('saving…');
    try {
      const res = await fetch('/__save-doodad', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data: composition() }) });
      const json = await res.json();
      setStatus(json.ok ? `saved → ${json.path}` : `error: ${json.error}`);
    } catch (err) { setStatus(`error: ${String(err)} — use Download`); }
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(composition(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${name || 'untitled'}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const load = async () => {
    setStatus('loading…');
    try {
      const safe = name.replace(/[^a-z0-9_-]/gi, '-');
      const res = await fetch(`/assets/doodads/compositions/${safe}.json?t=${String(els.length)}`);
      if (!res.ok) { setStatus(`not found: ${safe}.json`); return; }
      const data = await res.json();
      if (data.tile) setTileId(data.tile);
      setEls((data.elements ?? []).map((e: Omit<El, 'id'>) => ({ ...e, flip: Boolean(e.flip), id: mkId() })));
      setSelectedId(null);
      setStatus(`loaded ${safe}.json`);
    } catch (err) { setStatus(`error: ${String(err)}`); }
  };

  const renderEl = (e: El): ReactElement => {
    const d = DOODAD_ASSETS.find((a) => a.id === e.doodadId);
    const box: CSSProperties = {
      position: 'absolute', left: e.x * ZOOM, top: e.y * ZOOM,
      width: FRAME_W * ZOOM * e.scale, height: FRAME_H * ZOOM * e.scale,
      transform: `translate(${(-ANCHOR_X / FRAME_W) * 100}%, ${(-ANCHOR_Y / FRAME_H) * 100}%) scaleX(${e.flip ? -1 : 1})`,
      cursor: 'move', outline: e.id === selectedId ? '1px dashed rgba(70,200,255,0.5)' : 'none',
    };
    return (
      <div key={e.id} style={box} onPointerDown={startDrag(e)}>
        {d ? <><img src={d.back} alt="" draggable={false} style={imgFill} /><img src={d.front} alt="" draggable={false} style={imgFill} /></> : null}
      </div>
    );
  };

  const back = els.filter((e) => e.layer === 'back');
  const front = els.filter((e) => e.layer === 'front');
  // Shin line: ~22% of unit height above the foot (ADR-0015 "cover feet, not above the shins").
  const shinY = (ANCHOR_Y - 86 * 0.22) * ZOOM;

  useEffect(() => {
    const shellEl = document.querySelector('.shell');
    shellEl?.classList.add('is-immersive');
    return () => shellEl?.classList.remove('is-immersive');
  }, []);

  return (
    <div className="dev-editor-screen app-shell-bar-pad">
      <div style={shell}>
      <aside style={panel}>
        <h2 style={h2}>Doodads</h2>
        <p style={hint}>{armed ? 'Click the tile to drop. Esc to stop.' : 'Click to arm, then click the tile.'}</p>
        <div style={paletteGrid}>
          {DOODAD_ASSETS.map((d) => (
            <button key={d.id} type="button" style={{ ...paletteBtn, ...(armed === d.id ? segActive : {}) }} title={`Arm ${d.label}`} onClick={() => setArmed((a) => (a === d.id ? null : d.id))}>
              <span style={paletteThumb}><img src={d.front} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /></span>
              <span style={{ fontSize: 11 }}>{d.label}</span>
            </button>
          ))}
        </div>

        <h2 style={h2}>Placed ({els.length})</h2>
        <div style={{ display: 'grid', gap: 4 }}>
          {els.length === 0 ? <p style={hint}>Nothing yet.</p> : [...els].reverse().map((e) => {
            const d = DOODAD_ASSETS.find((a) => a.id === e.doodadId);
            return (
              <button key={e.id} type="button" style={{ ...objRow, ...(e.id === selectedId ? segActive : {}) }} onClick={() => setSelectedId(e.id)}>
                <span>{d?.label ?? e.doodadId}</span>
                <span style={{ fontSize: 10, opacity: 0.8 }}>{e.layer === 'front' ? 'front' : 'back'}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <main style={stageWrap}>
        <div ref={stageRef} data-testid="doodad-stage" style={{ ...stage, width: FRAME_W * ZOOM, height: FRAME_H * ZOOM, cursor: armed ? 'copy' : 'default' }} onPointerDown={onStagePointerDown}>
          <div style={{ ...layerBox, zIndex: 0 }}><img src={tileSrc(tileId)} alt="" draggable={false} style={imgAnchored} /></div>
          {back.map(renderEl)}
          {showUnit ? (
            <>
              <div style={{ position: 'absolute', left: ANCHOR_X * ZOOM, top: ANCHOR_Y * ZOOM, width: 72 * ZOOM, height: 86 * ZOOM, transform: 'translate(-50%,-78%)', display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
                <img src={unitSrc(unitKind)} alt="" draggable={false} style={{ maxHeight: 92 * ZOOM, maxWidth: 78 * ZOOM, objectFit: 'contain' }} />
              </div>
              <div style={{ position: 'absolute', left: 0, right: 0, top: shinY, height: 0, borderTop: '1px dashed rgba(111,210,255,0.55)', pointerEvents: 'none' }} />
              <span style={{ position: 'absolute', left: 4, top: shinY - 14, fontSize: 10, color: '#6fd2ff', pointerEvents: 'none' }}>shin line — keep doodads below</span>
            </>
          ) : null}
          {front.map(renderEl)}
        </div>
      </main>

      <aside style={panel}>
        <h2 style={h2}>Scene</h2>
        <label style={lbl}>Tile<select value={tileId} onChange={(ev) => setTileId(ev.target.value)} style={input}>{TILE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label style={lbl}>Unit<select value={unitKind} onChange={(ev) => setUnitKind(ev.target.value)} style={input}>{UNIT_OPTIONS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</select></label>
        <label style={row}><input type="checkbox" checked={showUnit} onChange={(ev) => setShowUnit(ev.target.checked)} /> Show unit + shin line</label>

        <h2 style={h2}>Selected</h2>
        {selected ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 12, color: '#9fb6cc' }}>{DOODAD_ASSETS.find((a) => a.id === selected.doodadId)?.label}</div>
            <div style={segRow}>
              {(['back', 'front'] as Layer[]).map((l) => <button key={l} type="button" style={{ ...seg, ...(selected.layer === l ? segActive : {}) }} onClick={() => update(selected.id, { layer: l })}>{l === 'back' ? 'Behind unit' : 'In front'}</button>)}
            </div>
            <label style={{ fontSize: 12 }}>Size {selected.scale.toFixed(2)}×
              <input type="range" min={0.1} max={1.5} step={0.01} value={selected.scale} onChange={(ev) => update(selected.id, { scale: Number(ev.target.value) })} style={{ width: '100%' }} />
            </label>
            <div style={segRow}>
              <button type="button" style={seg} onClick={() => update(selected.id, { flip: !selected.flip })}>Flip ⇄</button>
              <button type="button" style={seg} onClick={duplicate}>Duplicate</button>
            </div>
            <div style={{ fontSize: 11, color: '#8197ad' }}>drag on tile to move · arrows nudge · Del removes</div>
            <button type="button" style={dangerBtn} onClick={() => remove(selected.id)}>Delete</button>
          </div>
        ) : <p style={hint}>Pick a doodad on the tile or in the Placed list.</p>}

        <h2 style={h2}>Save / Load</h2>
        <input value={name} onChange={(ev) => setName(ev.target.value)} placeholder="composition name" style={input} />
        <div style={segRow}><button type="button" style={primaryBtn} onClick={save}>Save to disk</button><button type="button" style={seg} onClick={load}>Load</button></div>
        <button type="button" style={{ ...seg, flex: 'none' }} onClick={download}>Download JSON</button>
        {status ? <p style={{ ...hint, color: status.startsWith('error') || status.startsWith('not found') ? '#f0a0a0' : '#8fd0a0' }}>{status}</p> : null}
      </aside>
      </div>
    </div>
  );
}

const imgFill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'auto' };
const layerBox: CSSProperties = { position: 'absolute', left: ANCHOR_X * ZOOM, top: ANCHOR_Y * ZOOM, width: FRAME_W * ZOOM, height: FRAME_H * ZOOM, transform: 'translate(-50%,-38.333%)', pointerEvents: 'none' };
const imgAnchored: CSSProperties = { width: '100%', height: '100%' };
const shell: CSSProperties = { display: 'grid', gridTemplateColumns: '210px minmax(0,1fr) 250px', gap: 12, height: '100%', padding: 14, boxSizing: 'border-box', background: '#071019', color: '#d9e7f7', fontFamily: 'system-ui, sans-serif', overflow: 'hidden' };
const panel: CSSProperties = { background: 'rgba(5,16,25,0.92)', border: '1px solid rgba(67,127,179,0.28)', borderRadius: 8, padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 };
const stageWrap: CSSProperties = { display: 'grid', placeItems: 'center', overflow: 'auto', background: 'rgba(5,16,25,0.6)', border: '1px solid rgba(67,127,179,0.2)', borderRadius: 8 };
const stage: CSSProperties = { position: 'relative', backgroundColor: '#0a1622', backgroundImage: 'linear-gradient(45deg,rgba(120,170,214,0.08) 25%,transparent 25%,transparent 75%,rgba(120,170,214,0.08) 75%),linear-gradient(45deg,rgba(120,170,214,0.08) 25%,transparent 25%,transparent 75%,rgba(120,170,214,0.08) 75%)', backgroundSize: '24px 24px', backgroundPosition: '0 0,12px 12px', borderRadius: 6 };
const h2: CSSProperties = { margin: '6px 0 2px', fontSize: 15 };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: '#8197ad' };
const lbl: CSSProperties = { display: 'grid', gap: 3, fontSize: 12 };
const input: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '6px 8px', background: 'rgba(12,31,48,0.92)', color: '#d8eaff', border: '1px solid rgba(91,157,216,0.38)', borderRadius: 4, font: 'inherit' };
const row: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 };
const paletteGrid: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 };
const paletteBtn: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 6, background: 'rgba(12,31,48,0.92)', border: '1px solid rgba(91,157,216,0.3)', borderRadius: 6, color: '#cfe3ef', cursor: 'pointer' };
const paletteThumb: CSSProperties = { width: 64, height: 64, display: 'grid', placeItems: 'center', overflow: 'hidden' };
const objRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', background: 'rgba(12,31,48,0.92)', border: '1px solid rgba(91,157,216,0.24)', borderRadius: 4, color: '#cfe3ef', cursor: 'pointer', fontSize: 12 };
const segRow: CSSProperties = { display: 'flex', gap: 6 };
const seg: CSSProperties = { flex: 1, padding: '6px 8px', background: 'rgba(12,31,48,0.92)', border: '1px solid rgba(91,157,216,0.34)', borderRadius: 4, color: '#cfe3ef', cursor: 'pointer', fontSize: 12 };
const segActive: CSSProperties = { background: 'rgba(25,94,132,0.95)', borderColor: 'rgba(111,210,255,0.76)', color: '#f3fbff' };
const primaryBtn: CSSProperties = { ...seg, background: 'rgba(25,94,132,0.95)', borderColor: 'rgba(111,210,255,0.6)', color: '#f3fbff' };
const dangerBtn: CSSProperties = { ...seg, flex: 'none', background: 'rgba(58,18,18,0.6)', borderColor: 'rgba(216,92,92,0.5)', color: '#f0c0c0' };
