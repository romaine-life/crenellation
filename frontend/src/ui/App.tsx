import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ReactElement } from 'react';
import { MainMenu } from './MainMenu';
import { getSnapshot as getRevealSnapshot, subscribe as subscribeReveal } from './shell/coldReveal';
import { armBoardArtForNav, isBoardArtPending, subscribeBoardArt } from '../render/boardArtReady';
import { Campaign } from './Campaign';
import { Lobbies } from './Lobbies';
import { Party } from './Party';
import { Settings } from './Settings';
import { ArtworkCompare } from './ArtworkCompare';
import { TileCompare } from './TileCompare';
import { SurfaceLab } from './SurfaceLab';
import { UpdateBanner } from './UpdateBanner';
import { AppTitleBar } from './shell/AppTitleBar';
import { TitleBarPortalContext } from './shell/TitleBarPortalContext';
import { markScreenNavigation } from './shell/useScreenEntrance';
import {
  APP_NAVIGATION_EVENT,
  getAppNavigationUrl,
  navigateApp,
  normalizeRoutePath,
  shouldInterceptAppLinkClick,
} from './navigation';

// The Pixi-heavy / larger surfaces are code-split so the menu, lobbies, etc.
// don't pull the renderer bundle (preserving app.js's lazy-mount behaviour).
// The raw import() thunks are named so the same chunk can be *prefetched* on
// hover/focus (see prefetchRoute) and consumed by lazy() at click time — the
// module registry dedupes, so warming === the click-time download.
const importSkirmish = () => import('./Skirmish');
const importCampaignEditor = () => import('./CampaignEditor');
const importTilePreview = () => import('./TilePreview');
const importLevelEditor = () => import('./LevelEditor');
const importPortraitEditor = () => import('./PortraitEditor');
const importDoodadEditor = () => import('./DoodadEditor');

const Skirmish = lazy(() => importSkirmish().then((m) => ({ default: m.Skirmish })));
const CampaignEditor = lazy(() => importCampaignEditor().then((m) => ({ default: m.CampaignEditor })));
const TilesetStudio = lazy(() => importTilePreview().then((m) => ({ default: m.TilesetStudio })));
const LevelEditor = lazy(() => importLevelEditor().then((m) => ({ default: m.LevelEditor })));
const PortraitEditor = lazy(() => importPortraitEditor().then((m) => ({ default: m.PortraitEditor })));
const DoodadEditor = lazy(() => importDoodadEditor().then((m) => ({ default: m.DoodadEditor })));

const fallback = <div style={{ padding: 40, color: 'var(--ds-ink-3)', fontFamily: 'var(--ds-font-sans)' }}>Loading…</div>;

// Mirror of renderRoute's lazy routes: which chunk a path needs, if any. Eager
// routes (Campaign, Lobbies, Settings…) return null — they're already in the main
// bundle, nothing to warm.
function chunkForPath(path: string): (() => Promise<unknown>) | null {
  if (path === '/play' || path === '/skirmish') return importSkirmish;
  if (path === '/tileset-studio' || path === '/unit-studio' || path === '/nine-slice-editor') return importTilePreview;
  if (path === '/edit' || path === '/level-editor') return importLevelEditor;
  if (path === '/portrait-editor') return importPortraitEditor;
  if (path === '/doodad-editor') return importDoodadEditor;
  if (path === '/campaigns-next' || path === '/campaigns') return importCampaignEditor;
  return null;
}

// Warm a route's JS chunk on intent (hover/focus) so the click doesn't wait on a
// cold download. The set keeps us from re-invoking the thunk on every pointer move
// (the import() itself is already idempotent, but this avoids the churn).
const prefetched = new Set<() => Promise<unknown>>();
function prefetchRoute(path: string): void {
  const thunk = chunkForPath(path);
  if (!thunk || prefetched.has(thunk)) return;
  prefetched.add(thunk);
  void thunk();
}

// The cross-route veil masks the weight of entering/leaving a PIXI BOARD surface
// (skirmish, level editor) — a plain swap of those feels abrupt, and the dissolve also
// smooths the big board->menu jump. It is deliberately NOT used for the menu-family
// panel screens (menu, settings, party, lobbies, campaign EDITOR): they all share the
// SAME backdrop scene + synced rain, and the veil is a full-screen OPAQUE field — so
// veiling a hop between them would fade that shared backdrop out and back in, defeating
// the very continuity it exists for. Those hops stay instant (the menu stays painted
// until the destination's chunk is ready, then swaps in one commit), leaving the
// backdrop + rain rock-steady while only the UI changes. Tune membership here.
const HEAVY_ROUTES = new Set(['/play', '/skirmish', '/edit', '/level-editor']);
const isHeavyRoute = (path: string): boolean => HEAVY_ROUTES.has(path);

// Routes whose screen drives the board-art reveal gate (render/boardArtReady). Entering
// one, the veil holds its dissolve until the board's tiles have decoded — so the reveal
// lands on a complete board, never an empty frame that then popcorns in. Only the live
// skirmish opts in today; the level/campaign editors keep the plain JS-load veil.
const BOARD_ART_ROUTES = new Set(['/play', '/skirmish']);

// Veil timings — keep in lockstep with --route-veil-cover-ms / --route-veil-reveal-ms
// in style.css (JS drives the route swap; CSS drives the opacity fade).
const VEIL_COVER_MS = 260;
const VEIL_REVEAL_MS = 340;

// React router replacing app.js's string-HTML router. Same-origin app links are
// intercepted below so route changes keep the document, React tree, and BGM
// audio element alive. Legacy paths (/skirmish, /level-editor, /campaigns,
// /menu-next, /main-menu) resolve to React surfaces.
export function App(): ReactElement {
  const [path, setPath] = useState<string>(() => normalizeRoutePath(window.location.pathname));
  // Cross-route veil: an atmospheric field that fades OVER the current screen, lets
  // a heavy destination load + compose underneath while opaque, then fades UP into
  // it — one calm dissolve, never a "Loading…" snap. The reveal is gated on
  // useTransition's isPending, so we never fade up into a half-loaded screen. Light
  // hops skip the veil and swap instantly. Timings mirror VEIL_*_MS / style.css.
  const [veil, setVeil] = useState<'idle' | 'cover' | 'reveal'>('idle');
  const [isPending, startRouteTransition] = useTransition();
  // The persistent bar's center/actions portal targets, owned here so the routed screen
  // (a sibling of AppTitleBar) can portal its dynamic bar content into them.
  const [centerNode, setCenterNode] = useState<HTMLElement | null>(null);
  const [actionsNode, setActionsNode] = useState<HTMLElement | null>(null);
  const titleBarPortals = useMemo(() => ({ centerNode, actionsNode }), [centerNode, actionsNode]);
  // Cold-load reveal: on a fresh main-menu load the title bar is the 2nd layer to appear
  // (after the background). It reads the shared director's stage so it can hold hidden
  // until its turn. On every other route / later navigation the store is fully revealed,
  // so revealTitle is permanently true and the persistent bar never blinks.
  const reveal = useSyncExternalStore(subscribeReveal, getRevealSnapshot);
  // Board-art readiness for the veil: true while a board route's tiles are still decoding,
  // so the dissolve reveals a complete board instead of an empty frame (render/boardArtReady).
  const boardArtPending = useSyncExternalStore(subscribeBoardArt, isBoardArtPending);
  const pendingTarget = useRef<string | null>(null);
  // Set true once the cover phase has actually swapped the route. The reveal gate keys
  // off THIS, not an exact path match — a destination that redirects to a sub-route on
  // mount (e.g. /settings -> /settings/general) would otherwise never satisfy a path
  // equality check and the veil would stay stuck covering.
  const coverCommitted = useRef(false);
  const pathRef = useRef(path);
  // Layout effect (not passive): a destination's on-mount redirect runs as a passive
  // effect and dispatches a nav BEFORE a passive pathRef update would run, which made
  // onNav read a stale (heavy) source and wrongly re-trigger the veil mid-transition.
  // A layout effect lands the current path before any child's passive effect fires.
  useLayoutEffect(() => { pathRef.current = path; }, [path]);

  // Navigation + prefetch wiring (delegated at the document, like the click router).
  useEffect(() => {
    const onNav = () => {
      const next = normalizeRoutePath(window.location.pathname);
      if (next === pathRef.current) return;
      // Mark that we've navigated, so the destination screen plays its entrance fade
      // (ADR-0046). The very first cold page load never sets this, so the cold-load reveal
      // owns the initial paint without a competing fade.
      markScreenNavigation();
      // Dissolve if EITHER end is heavy — entering one, or leaving one for a light screen.
      if (isHeavyRoute(next) || isHeavyRoute(pathRef.current)) {
        pendingTarget.current = next; // hold the swap until the field is fully opaque
        coverCommitted.current = false;
        // Entering the board: mark its art pending NOW (before the board mounts) so the
        // veil's reveal gate below waits for the real tiles, not just the JS commit.
        if (BOARD_ART_ROUTES.has(next)) armBoardArtForNav();
        setVeil('cover');
      } else {
        // Light hop: keep the current screen painted (no fallback flash), swap when ready.
        startRouteTransition(() => setPath(next));
      }
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (!shouldInterceptAppLinkClick(event, anchor)) return;

      event.preventDefault();
      navigateApp(anchor.href);
    };
    // Prefetch-on-intent: warm the destination chunk when the pointer hovers (or
    // keyboard focus lands on) any in-app link, so by click time the code is
    // already cached. Delegated at the document like onClick, so every app link
    // benefits — no per-button wiring. pointerover/focusin both bubble.
    const onIntent = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const url = getAppNavigationUrl(anchor.href);
      if (url) prefetchRoute(normalizeRoutePath(url.pathname));
    };

    window.addEventListener('popstate', onNav);
    window.addEventListener(APP_NAVIGATION_EVENT, onNav);
    document.addEventListener('click', onClick);
    document.addEventListener('pointerover', onIntent);
    document.addEventListener('focusin', onIntent);
    return () => {
      window.removeEventListener('popstate', onNav);
      window.removeEventListener(APP_NAVIGATION_EVENT, onNav);
      document.removeEventListener('click', onClick);
      document.removeEventListener('pointerover', onIntent);
      document.removeEventListener('focusin', onIntent);
    };
  }, []);

  // Once the field is fully opaque, swap the route underneath it.
  useEffect(() => {
    if (veil !== 'cover') return undefined;
    const timer = window.setTimeout(() => {
      const target = pendingTarget.current;
      if (target != null) {
        coverCommitted.current = true;
        startRouteTransition(() => setPath(target));
      }
    }, VEIL_COVER_MS);
    return () => window.clearTimeout(timer);
  }, [veil]);

  // Fade up only once the cover phase has swapped the route AND nothing's still pending
  // (the chunk's loaded / the screen settled, including any on-mount sub-route redirect)
  // — so the player never sees a half-composed surface, and the veil never sticks.
  useEffect(() => {
    if (veil === 'cover' && coverCommitted.current && !isPending && !boardArtPending) {
      pendingTarget.current = null;
      setVeil('reveal');
    }
  }, [veil, path, isPending, boardArtPending]);

  // Reveal finished → idle.
  useEffect(() => {
    if (veil !== 'reveal') return undefined;
    const timer = window.setTimeout(() => setVeil('idle'), VEIL_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [veil]);

  return (
    <>
      <UpdateBanner />
      {/* The single persistent title bar, rendered OUTSIDE the routed screen so it
          survives navigation (only its contents change). It always draws the brand +
          account/settings cluster; screens only fill its optional center/actions
          slots (ADR-0042). revealTitle gates only the cold-load reveal. */}
      <AppTitleBar path={path} onCenterNode={setCenterNode} onActionsNode={setActionsNode} revealTitle={reveal.has('title')} />
      {/* ONE stable Suspense boundary above the router. Because the boundary
          persists across every route swap (rather than each route mounting its
          own), a transition navigation keeps the already-revealed screen painted
          while the next route's lazy chunk loads — so moving between surfaces no
          longer blanks to "Loading…". The fallback only shows on a genuine cold
          load straight onto a lazy route, when this boundary has revealed nothing
          yet. Heavy entrances additionally ride the veil below. */}
      <TitleBarPortalContext.Provider value={titleBarPortals}>
        <Suspense fallback={fallback}>{renderRoute(path)}</Suspense>
      </TitleBarPortalContext.Provider>
      <div
        className={`route-veil${veil === 'cover' ? ' is-cover' : ''}${veil === 'reveal' ? ' is-reveal' : ''}`}
        aria-hidden="true"
      />
      {/* Rotate-to-landscape gate. The app is played in landscape on phones; a true
          orientation lock is impossible in a mobile browser (screen.orientation.lock is
          unsupported on iOS Safari), so this overlay is shown — via a CSS media query,
          not JS — only on a touch device held in portrait, and covers everything (it sits
          above the fixed title bar). See the "MOBILE SUPPORT" block in style.css. */}
      <div className="rotate-gate" role="alertdialog" aria-label="Rotate your device to landscape">
        <div className="rotate-gate-inner">
          <svg className="rotate-gate-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="19" y="4" width="17" height="30" rx="3" />
            <line x1="27.5" y1="8.5" x2="27.5" y2="8.5" />
            <path d="M13 20 A16 16 0 0 0 23 42" />
            <polyline points="7.5 18.5 13 20 15 14.5" />
          </svg>
          <p className="rotate-gate-title">Rotate your device</p>
          <p className="rotate-gate-copy">Chess Tactics plays in landscape.</p>
        </div>
      </div>
    </>
  );
}

function renderRoute(path: string): ReactElement {
  if (path === '/play' || path === '/skirmish') return <Skirmish />;
  if (path === '/tileset-studio') return <TilesetStudio />;
  // /unit-studio is a deep-link into the one Studio with the Units shelf
  // preselected — not a separate surface. Keeps old links working while the
  // catalog/lab/brush flow stays a single mounted component (no route swaps).
  if (path === '/unit-studio') return <TilesetStudio initialCategory="units" />;
  if (path === '/portrait-editor') return <PortraitEditor />;
  if (path === '/doodad-editor') return <DoodadEditor />;
  // /nine-slice-editor is a deep-link alias into the one Studio (like /unit-studio):
  // the 9-slice editor is an embedded Viewer surface, not its own route. The studio
  // reads ?asset=<frame> off this path and canonicalises the URL to /tileset-studio.
  if (path === '/nine-slice-editor') return <TilesetStudio />;
  // The level editor is now the studio's socket-legal board in the original
  // asset-backed chrome; the old Pixi LevelEditor/EditorBoard is retired.
  if (path === '/edit' || path === '/level-editor') return <LevelEditor />;
  // /campaign (singular) is the play surface — pick a campaign; /campaigns-next is
  // the authoring editor. Distinct paths, so order here doesn't matter.
  if (path === '/campaign' || path.startsWith('/campaign/')) return <Campaign />;
  if (path === '/campaigns-next' || path === '/campaigns') return <CampaignEditor />;
  if (path === '/lobbies' || path.startsWith('/lobbies/')) return <Lobbies />;
  if (path === '/party') return <Party />;
  if (path === '/settings' || path.startsWith('/settings/')) return <Settings />;
  if (path === '/artwork-compare') return <ArtworkCompare />;
  if (path === '/tile-compare') return <TileCompare />;
  if (path === '/surface-lab') return <SurfaceLab />;
  return <MainMenu />;
}
