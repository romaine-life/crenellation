import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

// A live design surface for matching screens to their accepted art direction.
// Two side-by-side panes; each pane picks from a list of OPTIONS, where each
// option is one of:
//   - an ACCEPTED ART image  (src "art:<id>")
//   - a LIVE app route       (src "live:<route>")  — the honest on-disk baseline
//   - a LIVE route + speculative CSS injected into it (a proposed change shown
//     live, WITHOUT being saved to the app)
//
// By default the option list is every art + every route. But a curated, labeled
// list can be baked into the URL so a crafted comparison only shows the few
// relevant choices (e.g. "Art — concept", "Current — baseline", "Spec — 46px"):
//
//   ?opts=<base64 JSON [{label,src,css}]>&l=<index>&r=<index>&lcss=&rcss=
//
// Iframes are same-origin, so the parent injects a <style> into a live pane when
// it has speculative CSS — nothing touches the codebase.

type ArtEntry = { id: string; label: string; src: string; route: string };

const INSPO = '/assets/artwork/inspiration/ui-screen-concepts';

const ART: ArtEntry[] = [
  { id: 'settings-general', label: 'Settings · General', src: `${INSPO}/generated/settings-general-concept-v1.png`, route: '/settings/general' },
  { id: 'settings-audio', label: 'Settings · Audio', src: `${INSPO}/generated/settings-audio-concept-v1.png`, route: '/settings/audio' },
  { id: 'settings-gameplay', label: 'Settings · Gameplay', src: `${INSPO}/generated/settings-gameplay-concept-v1.png`, route: '/settings/gameplay' },
  { id: 'settings-creator-tools', label: 'Settings · Creator Tools', src: `${INSPO}/generated/settings-creator-tools-concept-v1.png`, route: '/settings/creator-tools' },
  { id: 'settings-overview', label: 'Settings · Overview', src: `${INSPO}/generated/settings-page-concept-v1.png`, route: '/settings/general' },
  { id: 'main-menu', label: 'Main Menu', src: `${INSPO}/01-main-menu-aspirational.png`, route: '/' },
  { id: 'campaign-editor', label: 'Campaign Editor', src: `${INSPO}/02-campaign-editor.png`, route: '/campaigns-next' },
  { id: 'level-editor', label: 'Level Editor', src: `${INSPO}/03-level-editor.png`, route: '/level-editor' },
  { id: 'skirmish', label: 'Skirmish', src: `${INSPO}/04-skirmish.png`, route: '/skirmish' },
];

const ROUTES = Array.from(new Set(ART.map((a) => a.route)));
const LIVE_W = 1440; // render live routes at desktop width, scaled to fit the pane
const LIVE_H = 900;

type Opt = { label: string; src: string; css: string; link?: string };
type Source = { kind: 'art'; id: string } | { kind: 'live'; route: string } | { kind: 'img'; src: string };

// UTF-8-safe base64 (plain btoa/atob mangle non-ASCII like em dashes in labels).
function b64encode(s: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64decode(b: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
}

function parseSource(s: string): Source {
  if (s.startsWith('live:')) return { kind: 'live', route: s.slice(5) };
  // `img:<url>` — compare an arbitrary asset (e.g. a forged kit atom) against the
  // concept, not just a whole route. The url is served from /public.
  if (s.startsWith('img:')) return { kind: 'img', src: s.slice(4) };
  return { kind: 'art', id: s.startsWith('art:') ? s.slice(4) : s };
}

function defaultOpts(): Opt[] {
  return [
    ...ART.map((a) => ({ label: `ART · ${a.label}`, src: `art:${a.id}`, css: '' })),
    ...ROUTES.map((r) => ({ label: `LIVE · ${r}`, src: `live:${r}`, css: '' })),
  ];
}

function inject(ifr: HTMLIFrameElement | null, css: string): void {
  if (!ifr) return;
  try {
    const doc = ifr.contentDocument;
    if (!doc) return;
    let el = doc.getElementById('__ac_spec') as HTMLStyleElement | null;
    if (!el) {
      el = doc.createElement('style');
      el.id = '__ac_spec';
      doc.head.appendChild(el);
    }
    el.textContent = css;
  } catch {
    /* transient access during navigation — re-runs on next change */
  }
}

// Module-level so it never remounts (which would reload the iframe on every keystroke).
function ComparePane({ opts, value, css, onPick, onReload, reloadKey }: {
  opts: Opt[];
  value: number;
  css: string;
  onPick: (idx: number) => void;
  onReload: () => void;
  reloadKey: number;
}): ReactElement {
  const opt = opts[value] ?? opts[0];
  const src = parseSource(opt.src);
  const stage = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [imgAspect, setImgAspect] = useState(LIVE_H / LIVE_W);
  const [box, setBox] = useState({ w: 400, h: 250, scale: 0.28 });

  const aspect = src.kind === 'live' ? LIVE_H / LIVE_W : imgAspect;
  const liveRoute = src.kind === 'live' ? src.route : '';

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const recompute = () => {
      const pad = 40; // leave room for the frame's own border + inner inset
      const availW = Math.max(1, el.clientWidth - pad);
      const availH = Math.max(1, el.clientHeight - pad);
      const w = Math.min(availW, availH / aspect);
      setBox({ w: Math.round(w), h: Math.round(w * aspect), scale: w / LIVE_W });
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  useEffect(() => {
    if (src.kind === 'live') inject(iframe.current, css);
  }, [css, liveRoute, reloadKey, src.kind]);

  const art = src.kind === 'art' ? (ART.find((a) => a.id === src.id) ?? ART[0]) : null;
  const isSpec = src.kind === 'live' && css.trim().length > 0;
  const dedicated = opt.link ?? (src.kind === 'live' ? src.route : src.kind === 'img' ? src.src : art ? art.src : '#');

  return (
    <div className="ac-pane">
      <header className="ac-bar">
        <select value={value} onChange={(e) => onPick(Number(e.target.value))} aria-label="Pane source">
          {opts.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
        </select>
        <a className="ac-open" href={dedicated} target="_blank" rel="noopener noreferrer"
          title={src.kind === 'live' ? 'Open this page in a new tab' : 'Open this artwork in a new tab'}>↗</a>
        {src.kind === 'live' ? <button type="button" onClick={onReload} title="Reload live panes">↻</button> : null}
        {isSpec ? <span className="ac-tag ac-tag-spec">+ CSS</span> : null}
      </header>
      <div className="ac-stage" ref={stage}>
        <div className={`ac-frame ${isSpec ? 'ac-frame-spec' : ''}`} style={{ width: box.w, height: box.h }}>
          {src.kind === 'art' && art ? (
            <img
              className="ac-art-img"
              src={art.src}
              alt={`${art.label} concept art`}
              onLoad={(e) => setImgAspect(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)}
            />
          ) : src.kind === 'live' ? (
            <iframe
              key={`${src.route}-${reloadKey}`}
              ref={iframe}
              title="Live"
              src={src.route}
              onLoad={() => inject(iframe.current, css)}
              style={{ width: LIVE_W, height: LIVE_H, transform: `scale(${box.scale})`, transformOrigin: 'top left', border: 0 }}
            />
          ) : src.kind === 'img' ? (
            <img
              className="ac-art-img"
              src={src.src}
              alt={opt.label}
              onLoad={(e) => setImgAspect(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

type Pane = { idx: number; css: string };
type Config = { opts: Opt[]; custom: boolean; left: Pane; right: Pane };

function readConfig(): Config {
  const p = new URLSearchParams(window.location.search);
  let opts = defaultOpts();
  let custom = false;
  const raw = p.get('opts');
  if (raw) {
    try {
      const parsed = JSON.parse(b64decode(decodeURIComponent(raw)));
      if (Array.isArray(parsed) && parsed.length) {
        opts = parsed.map((o) => ({ label: String(o.label ?? o.src ?? ''), src: String(o.src ?? ''), css: String(o.css ?? ''), link: o.link ? String(o.link) : undefined }));
        custom = true;
      }
    } catch {
      /* malformed opts — fall back to the full list */
    }
  }
  const idx = (v: string | null, def: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n < opts.length ? n : def;
  };
  const li = idx(p.get('l'), 0);
  const ri = idx(p.get('r'), Math.min(1, opts.length - 1));
  const dec = (v: string | null) => (v == null ? null : decodeURIComponent(v));
  const lcss = dec(p.get('lcss'));
  const rcss = dec(p.get('rcss'));
  return {
    opts,
    custom,
    left: { idx: li, css: lcss ?? opts[li].css },
    right: { idx: ri, css: rcss ?? opts[ri].css },
  };
}

export function ArtworkCompare(): ReactElement {
  const [cfg, setCfg] = useState(readConfig);
  const [reloadKey, setReloadKey] = useState(0);
  const { opts, custom, left, right } = cfg;

  useEffect(() => {
    const p = new URLSearchParams();
    if (custom) p.set('opts', encodeURIComponent(b64encode(JSON.stringify(opts))));
    p.set('l', String(left.idx));
    p.set('r', String(right.idx));
    if (left.css !== (opts[left.idx]?.css ?? '')) p.set('lcss', encodeURIComponent(left.css));
    if (right.css !== (opts[right.idx]?.css ?? '')) p.set('rcss', encodeURIComponent(right.css));
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${p.toString()}`);
  }, [opts, custom, left, right]);

  const pickLeft = (idx: number) => setCfg((c) => ({ ...c, left: { idx, css: c.opts[idx]?.css ?? '' } }));
  const pickRight = (idx: number) => setCfg((c) => ({ ...c, right: { idx, css: c.opts[idx]?.css ?? '' } }));
  const setLeftCss = (css: string) => setCfg((c) => ({ ...c, left: { ...c.left, css } }));
  const setRightCss = (css: string) => setCfg((c) => ({ ...c, right: { ...c.right, css } }));
  const reload = () => setReloadKey((k) => k + 1);

  const leftLive = useMemo(() => parseSource(opts[left.idx]?.src ?? '').kind === 'live', [opts, left.idx]);
  const rightLive = useMemo(() => parseSource(opts[right.idx]?.src ?? '').kind === 'live', [opts, right.idx]);

  return (
    <section className="ac">
      <style>{AC_CSS}</style>

      <div className="ac-panes">
        <ComparePane opts={opts} value={left.idx} css={left.css} onPick={pickLeft} onReload={reload} reloadKey={reloadKey} />
        <ComparePane opts={opts} value={right.idx} css={right.css} onPick={pickRight} onReload={reload} reloadKey={reloadKey} />
      </div>

      <footer className="ac-editor">
        <div className="ac-edit-col">
          <label className="ac-tag" htmlFor="ac-lcss">LEFT CSS {leftLive ? '' : '(left pane is art — pick a Live option to apply)'}</label>
          <textarea id="ac-lcss" value={left.css} onChange={(e) => setLeftCss(e.target.value)} spellCheck={false}
            placeholder=".brand-lockup-mark { height: 46px; width: 46px; }" />
        </div>
        <div className="ac-edit-col">
          <label className="ac-tag" htmlFor="ac-rcss">RIGHT CSS {rightLive ? '' : '(right pane is art — pick a Live option to apply)'}</label>
          <textarea id="ac-rcss" value={right.css} onChange={(e) => setRightCss(e.target.value)} spellCheck={false}
            placeholder=".brand-lockup-mark { height: 50px; width: 50px; }" />
        </div>
      </footer>
    </section>
  );
}

const AC_CSS = `
.ac { position: fixed; inset: var(--app-header-h) 0 0 0; z-index: 5; display: flex; flex-direction: column;
  background: #06080d; color: #cfe3ff; font-family: var(--ds-font-sans, system-ui, sans-serif); }
.ac-panes { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; }
.ac-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid #1b2740; }
.ac-pane:last-child { border-right: 0; }
.ac-bar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #0b1220; border-bottom: 1px solid #1b2740; }
.ac-tag { font-size: 11px; letter-spacing: .12em; font-weight: 700; color: #7fd4ff; white-space: nowrap; }
.ac-tag-spec { color: #ffd479; }
.ac-bar select, .ac-bar button { appearance: none; -webkit-appearance: none;
  font-family: var(--ds-font-sans, system-ui, sans-serif); font-size: 24px; line-height: 1;
  min-height: 0; height: 46px; margin: 0; padding: 0 14px;
  background: #111a2c; background-image: none; color: #eaf3ff;
  border: 1px solid #2a3c5e; border-radius: 4px; box-shadow: none; text-shadow: none; cursor: pointer; }
.ac-bar select { flex: 1 1 auto; min-width: 0; }
.ac-bar button { width: 46px; padding: 0; flex: 0 0 auto; }
.ac-bar button:hover { background: #17223a; }
.ac-open { display: inline-flex; align-items: center; justify-content: center; height: 46px; width: 46px;
  flex: 0 0 auto; text-decoration: none; color: #9fd8ff; background: #111a2c;
  border: 1px solid #2a3c5e; border-radius: 4px; font-size: 22px; }
.ac-open:hover { background: #17223a; color: #cfeaff; }
.ac-stage { position: relative; flex: 1 1 auto; min-height: 0; overflow: auto; background: #06080d;
  display: flex; justify-content: center; align-items: center; padding: 12px; }
.ac-frame { box-sizing: content-box; overflow: hidden; position: relative; flex: 0 0 auto;
  padding: 6px; background: #06080d; border: 2px solid #79c4ff; border-radius: 5px;
  box-shadow: 0 0 0 1px rgba(2, 7, 11, .9), 0 8px 22px rgba(0, 0, 0, .5); }
.ac-frame-spec { border-color: #ffd479; }
.ac-art-img { width: 100%; height: 100%; object-fit: contain; display: block; image-rendering: pixelated; }
.ac-editor { flex: 0 0 auto; display: flex; gap: 12px; padding: 10px 12px; background: #0b1220; border-top: 1px solid #1b2740; }
.ac-edit-col { flex: 1 1 0; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ac-editor textarea { width: 100%; height: 60px; resize: vertical; box-sizing: border-box;
  font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.4;
  color: #dbe9ff; background: #0a0f1c; border: 1px solid #2a3c5e; border-radius: 4px; padding: 8px; }
`;
