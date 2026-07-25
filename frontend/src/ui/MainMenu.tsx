import { useEffect, useState, useSyncExternalStore, type ReactElement } from 'react';
import { AmbienceBackground } from './AmbienceBackground';
import { useScreenEntrance } from './shell/useScreenEntrance';
import { MENU_MODES } from './design/catalogData';
import { getSnapshot, markReady, subscribe } from './shell/coldReveal';

const ICONS = '/assets/ui/main-menu/icons-carved';
const BRAND_SHIELD = '/assets/ui/kit/icons/brand-shield.png';
// The heaviest button asset — the carved-stone surface behind every rail tab. The
// buttons layer only counts as "ready" once this (plus the icons) has decoded, so the
// rail never reveals as bare panels with the stone snapping in underneath later.
const STONE_SURFACE = '/assets/ui/surfaces/baseline-stone-blue.avif';
// The title bar's wooden surface — gate the title layer on it (plus the brand shield)
// so the bar reveals whole, not wordmark-first then wood.
const TITLE_SURFACE = '/assets/ui/surfaces/hybrid-wood-oak.png';

const MODE_HREFS: Record<string, string> = {
  'solo-skirmish': '/play',
  'campaign-editor': '/campaigns-next',
  'level-editor': '/edit',
  lobbies: '/lobbies',
  settings: '/settings',
};

interface MenuTab { slug: string; label: string; href: string; iconSlug: string }

// The main-menu rail. The Campaign (play) mode is menu-only — not a design-catalog
// widget — so it lives here rather than in MENU_MODES (the catalog's source of
// truth). It leads the rail as the headline mode and sits apart from the Campaign
// Editor so the shared placeholder icon doesn't read as a duplicate of an adjacent
// tab. Temp icon: reuses the campaign-editor carving until a dedicated 'campaign'
// carving is forged.
const MENU_TABS: MenuTab[] = [
  { slug: 'campaign', label: 'Campaign', href: '/campaign', iconSlug: 'campaign-editor' },
  // Settings is excluded from the rail — it now lives in the trailing "settings +
  // user" chrome cluster (the gear beside the account control), not as a mode tab.
  ...MENU_MODES
    .filter((mode) => mode.slug !== 'settings')
    .map((mode) => ({
      slug: mode.slug,
      label: mode.label,
      href: MODE_HREFS[mode.slug] || '/',
      iconSlug: mode.slug,
    })),
];

// The trailing-edge Settings control (carved gear) — moved out of the rail into the
// account cluster (ADR-0036). Lives next to the avatar so the top-right reads as one
// "settings + user" unit.
const SETTINGS_ICON = `${ICONS}/settings.png`;

// A mode entry rendered as a settings-style rail tab (shared baked-skin frame —
// line frame over the stone surface — carved icon + label). The same chrome the
// Settings sidebar uses, so the menu and the rest of the app read as one family
// (retires the bespoke stone slabs).
function ModeTab({ tab }: { tab: MenuTab }): ReactElement {
  return (
    <a className="settings-tab main-menu-mode-tab" href={tab.href}>
      <span className="settings-tab-icon" aria-hidden="true">
        <img src={`${ICONS}/${tab.iconSlug}.png`} alt="" />
      </span>
      <span><strong>{tab.label}</strong></span>
    </a>
  );
}

export function MainMenu(): ReactElement {
  // Cold-load reveal: the menu's layers fade in in a fixed order — background -> title
  // -> buttons (rain drifts in last on its own) — driven by the shared reveal director
  // (see shell/coldReveal). Here MainMenu just REPORTS readiness for the title's brand
  // mark and the buttons' art (icons + stone surface) and gates the background + button
  // layers off the director's stage; the director owns the ordering and the background
  // probe. On any non-cold load the store is already fully revealed, so this is inert.
  const reveal = useSyncExternalStore(subscribe, getSnapshot);
  // Shared screen-entrance fade (ADR-0046): fades the chrome in when you navigate TO the menu
  // (e.g. back from settings), leaving the ambience rain continuous. No-ops on the cold load,
  // where the reveal director above owns the first paint.
  const entranceClass = useScreenEntrance();

  useEffect(() => {
    const shell = document.querySelector('.shell');
    shell?.classList.add('main-menu-active');
    return () => shell?.classList.remove('main-menu-active');
  }, []);

  // Soft-nav arrival fade: on a later navigation INTO the menu (e.g. campaign editor ->
  // menu) the reveal store is already fully revealed, so the buttons would otherwise snap
  // in. Withhold data-reveal-buttons for one frame after mount (then flip `entered`) so the
  // existing .main-menu-twin-screen opacity transition runs as an arrival fade — matching
  // the editor's entrance so the hop dissolves the chrome both ways over the steady
  // backdrop. On a COLD load this is harmless: the director hasn't opened `buttons` yet, so
  // the gate already holds them hidden and `entered` flips long before that stage opens. The
  // timeout backstops a throttled rAF (backgrounded tab) so the menu can never strand blank.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    const t = window.setTimeout(() => setEntered(true), 120);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t); };
  }, []);

  useEffect(() => {
    // Warm + decode each layer's art, then signal the director. decode() resolves once
    // the bitmap is ready; failures (404 / no-AVIF UA) resolve too so a watchdog backstops.
    const decode = (src: string): Promise<void> => {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
      return (img.decode?.() ?? Promise.reject(new Error('decode unsupported'))).then(
        () => {},
        () => {},
      );
    };
    // Title: the brand shield + the wooden bar surface, so the bar reveals whole.
    void Promise.allSettled([BRAND_SHIELD, TITLE_SURFACE].map(decode)).then(() => markReady('title'));
    // Buttons: the carved icons + the heaviest stone rail surface.
    const buttonArt = [SETTINGS_ICON, STONE_SURFACE, ...MENU_TABS.map((tab) => `${ICONS}/${tab.iconSlug}.png`)];
    void Promise.allSettled(buttonArt.map(decode)).then(() => markReady('buttons'));
  }, []);

  return (
    <div
      className="menu-layer main-menu-layer"
      data-testid="main-menu-next"
      data-reveal-bg={reveal.has('bg') ? '' : undefined}
      data-reveal-buttons={reveal.has('buttons') && entered ? '' : undefined}
    >
      <AmbienceBackground />
      {/* Settings-twin layout (ADR-0003 superseded): shared app title bar + a rail of
          mode tabs + a framed feature panel — the same baked-skin chrome as /settings. */}
      <div className="settings-screen main-menu-twin-screen app-shell-bar-pad">
        <div className={`settings-shell ${entranceClass}`.trim()}>
          <aside className="settings-frame settings-rail-frame" aria-label="Game modes">
            {MENU_TABS.map((tab) => <ModeTab key={tab.slug} tab={tab} />)}
          </aside>
        </div>
      </div>
    </div>
  );
}
