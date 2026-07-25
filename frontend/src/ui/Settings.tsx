import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { readDisabledUrls, writeDisabledUrls, sendBgmCommand, BGM_STATE_EVENT } from '../bgmPrefs.js';
import { APP_NAVIGATION_EVENT, navigateApp, normalizeRoutePath } from './navigation';
import { KitScroll } from './KitScroll';
import { Stepper } from './shared/Stepper';
import { Toggle } from './shared/Toggle';
import { AmbienceBackground } from './AmbienceBackground';
import { useScreenEntrance } from './shell/useScreenEntrance';
import { SFX_SETTINGS_CHANGE_EVENT, previewTerrain } from '../sfx';

const MUTE_KEY = 'chess-tactics-bgm-muted-v1';
const MUTE_CHANGE_EVENT = 'chess-tactics:bgm-muted-change';
const SETTINGS_KEY = 'chess-tactics-settings-v1';
const ASSET_BASE = '/assets/ui/settings';
// How long the panel body fades out before swapping in the next menu's controls,
// then fades back in. MUST match --ds-duration-fade on .settings-panel-content in style.css
// (the ONE shared fade duration, ADR-0046 — same speed as the screen entrance).
const PANEL_FADE_MS = 350;

type SettingsTab = 'general' | 'audio' | 'gameplay' | 'creator-tools';
type ButtonTone = 'neutral' | 'primary' | 'danger';

interface LocalSettings {
  uiScale: number;
  masterAudio: boolean;
  musicVolume: number;
  effectsVolume: number;
  interfaceSounds: boolean;
}

interface BgmTrack {
  title: string;
  url: string;
  artist?: string;
  album?: string;
}

interface TabDefinition {
  id: SettingsTab;
  label: string;
  icon: string;
}

interface CreatorTool {
  label: string;
  href: string;
  description: string;
  // When true the href is an external URL opened in a new tab (e.g. the ambience
  // broadcast monitor), not an in-app SPA route.
  external?: boolean;
}

const DEFAULT_SETTINGS: LocalSettings = {
  uiScale: 100,
  masterAudio: true,
  musicVolume: 70,
  effectsVolume: 80,
  interfaceSounds: true,
};

const tabs: TabDefinition[] = [
  { id: 'general', label: 'General', icon: 'icon-gear-generated.png' },
  { id: 'audio', label: 'Audio', icon: 'icon-speaker-generated.png' },
  { id: 'gameplay', label: 'Gameplay', icon: 'icon-knight-generated.png' },
  { id: 'creator-tools', label: 'Creator Tools', icon: 'icon-wrench-generated.png' },
];

// Each settings section is its own route (/settings/<tab>) so it can be linked,
// reloaded, and back/forward-navigated. App.tsx mounts <Settings/> for the whole
// /settings/* subtree; the active tab is derived from the URL, not local state.
const TAB_PATHS: Record<SettingsTab, string> = {
  general: '/settings/general',
  audio: '/settings/audio',
  gameplay: '/settings/gameplay',
  'creator-tools': '/settings/creator-tools',
};

function tabFromPath(pathname: string): SettingsTab {
  // Match only the leading section segment, so deeper routes (e.g.
  // /settings/audio/tracks) still resolve to their owning tab and keep it lit.
  const id = normalizeRoutePath(pathname).match(/^\/settings\/([^/]+)/)?.[1];
  if (id === 'audio' || id === 'gameplay' || id === 'creator-tools' || id === 'general') return id;
  return 'general';
}

// The Audio tab has one sub-view: the soundtrack list at /settings/audio/tracks.
// It's its own route so the ← back button, reload, and browser back all work.
const TRACKS_PATH = '/settings/audio/tracks';

function isTracksView(pathname: string): boolean {
  return normalizeRoutePath(pathname) === TRACKS_PATH;
}

// One creator-tools entry — the studio is the single workspace: tiles, units,
// and the UI-kit asset library are all categories within it. (The broader Design
// Index still lives at /design directly.)
const creatorTools: CreatorTool[] = [
  { label: 'Studio', href: '/tileset-studio', description: 'The creator workspace — browse tiles, units, the UI-kit asset library, and the artwork gallery, all in one place.' },
  { label: 'Artwork Compare', href: '/artwork-compare', description: 'Two-panel view — the accepted concept art beside the live screen, for matching the art direction.' },
  { label: 'Broadcast Monitor', href: 'https://ambience.romaine.life/?world=chess', description: 'Inspect the live menu-rain broadcast on ambience — the current scene, what is queued up next, and the event log. Opens in a new tab.', external: true },
];

function asset(file: string): string {
  // Use the shared UI kit's generated glyphs: icon-gear-generated.png -> kit/icons/gear.png
  return `/assets/ui/kit/icons/${file.replace(/^icon-/, '').replace(/-generated/, '')}`;
}

// Build / server provenance, stamped by vite.config buildInfo, surfaced in About so
// "which server/build am I actually on?" is summonable from one place — dev or prod.
// In dev it names the WORKTREE + commit + live port (a server from the wrong worktree
// reports its own name, so being on the wrong one is a glance, not a 2-hour hunt).
declare const __BUILD_INFO__:
  | { mode: 'dev'; worktree: string; commit: string; dirty: boolean; startedAt: number }
  | { mode: 'prod'; commit: string; dirty: boolean }
  | undefined;

// The deployed entry-chunk hash (empty in dev) — the live asset-bundle id for prod.
function bootedEntryHash(): string {
  const el = document.querySelector('script[type="module"][src*="/assets/index-"]') as HTMLScriptElement | null;
  return (el?.src || '').match(/\/assets\/index-([A-Za-z0-9_-]+)\.js/)?.[1] || '';
}

function buildSummary(): { headline: string; detail: string } {
  const info = typeof __BUILD_INFO__ === 'undefined' ? undefined : __BUILD_INFO__;
  if (info && info.mode === 'dev') {
    const port = window.location.port || 'default';
    return {
      headline: `${info.worktree} · ${info.commit}${info.dirty ? '*' : ''}`,
      detail: `Local dev server · :${port} · started ${new Date(info.startedAt).toLocaleTimeString()}`,
    };
  }
  const hash = bootedEntryHash();
  return {
    headline: `${info?.commit ?? '(unknown)'}${info?.dirty ? '*' : ''}${hash ? ` · ${hash}` : ''}`,
    detail: 'Production build',
  };
}

function readMuted(): boolean {
  // Default OFF — music is muted until explicitly enabled (kept in sync with bgm.js
  // readMuted). Only an explicit 'false' (user turned it on) counts as un-muted.
  try { return localStorage.getItem(MUTE_KEY) !== 'false'; } catch { return true; }
}

function writeMuted(muted: boolean): void {
  try { localStorage.setItem(MUTE_KEY, muted ? 'true' : 'false'); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(MUTE_CHANGE_EVENT, { detail: { muted } }));
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function readLocalSettings(): LocalSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<LocalSettings>;
    return {
      uiScale: clamp(parsed.uiScale, 90, 120, DEFAULT_SETTINGS.uiScale),
      masterAudio: typeof parsed.masterAudio === 'boolean' ? parsed.masterAudio : DEFAULT_SETTINGS.masterAudio,
      musicVolume: clamp(parsed.musicVolume, 0, 100, DEFAULT_SETTINGS.musicVolume),
      effectsVolume: clamp(parsed.effectsVolume, 0, 100, DEFAULT_SETTINGS.effectsVolume),
      interfaceSounds: typeof parsed.interfaceSounds === 'boolean' ? parsed.interfaceSounds : DEFAULT_SETTINGS.interfaceSounds,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveLocalSettings(settings: LocalSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

function applyUiScale(scale: number): void {
  document.documentElement.style.setProperty('--settings-ui-scale', `${scale / 100}`);
}

function SettingsButton({
  children,
  tone = 'neutral',
  onClick,
  href,
  className = '',
  ariaLabel,
  external = false,
}: {
  children: ReactNode;
  tone?: ButtonTone;
  onClick?: () => void;
  href?: string;
  className?: string;
  ariaLabel?: string;
  external?: boolean;
}): ReactElement {
  const classes = `settings-chrome-button settings-chrome-button-${tone} ${className}`.trim();
  if (href) {
    // External links open in a new tab; rel guards against reverse-tabnabbing.
    // Internal routes (the default) stay in the SPA.
    const externalProps = external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
    return (
      <a className={classes} href={href} aria-label={ariaLabel} {...externalProps}>
        <span>{children}</span>
      </a>
    );
  }
  return (
    <button type="button" className={classes} onClick={onClick} aria-label={ariaLabel}>
      <span>{children}</span>
    </button>
  );
}

function SettingsRow({
  title,
  eyebrow,
  description,
  value,
  tall = false,
  children,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  value?: ReactNode;
  tall?: boolean;
  children?: ReactNode;
}): ReactElement {
  return (
    <section className={`settings-row ${tall ? 'settings-row-tall' : ''}`}>
      <div className="settings-row-copy">
        {eyebrow ? <span className="settings-row-eyebrow">{eyebrow}</span> : null}
        <h4>{title}</h4>
        {description ? <p>{description}</p> : null}
      </div>
      {value ? <div className="settings-row-value">{value}</div> : null}
      {children ? <div className="settings-row-control">{children}</div> : null}
    </section>
  );
}

// A labeled cluster of rows. Purely organizational: a small uppercase eyebrow
// (h3, between the tab's h2 and each row's h4) plus its grouped rows, so a long
// settings list reads as scannable sections instead of one undifferentiated stack.
function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      <div className="settings-section-rows">{children}</div>
    </section>
  );
}

function Slider({
  value,
  suffix,
  label,
  onChange,
}: {
  value: number;
  suffix: string;
  label: string;
  onChange: (value: number) => void;
}): ReactElement {
  return (
    <div className="settings-slider">
      {/* The track fills blue up to the thumb via --val (the live percentage). */}
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        aria-label={label}
        style={{ ['--val' as string]: `${value}%` }}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{value}{suffix}</output>
    </div>
  );
}

export function Settings(): ReactElement {
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => tabFromPath(window.location.pathname));
  const [showTracks, setShowTracks] = useState<boolean>(() => isTracksView(window.location.pathname));
  // The INCOMING/target panel (switches immediately on a tab change). `previous` holds the
  // OUTGOING panel only during a crossfade, rendered stacked under `display` so the two
  // overlap-fade (old 1->0 while new 0->1) in one --ds-duration-fade pass (ADR-0046). The
  // rail highlight tracks activeTab directly, so the clicked tab lights instantly.
  const [display, setDisplay] = useState<{ tab: SettingsTab; tracks: boolean }>(() => ({
    tab: tabFromPath(window.location.pathname),
    tracks: isTracksView(window.location.pathname),
  }));
  const [previous, setPrevious] = useState<{ tab: SettingsTab; tracks: boolean } | null>(null);
  const [xfade, setXfade] = useState<'idle' | 'enter' | 'active'>('idle');
  const [muted, setMuted] = useState(readMuted());
  const [settings, setSettings] = useState<LocalSettings>(readLocalSettings);
  const [tracks, setTracks] = useState<BgmTrack[] | null>(null);
  const [tracksStatus, setTracksStatus] = useState('');
  const [disabledUrls, setDisabledUrls] = useState<string[]>(() => readDisabledUrls());
  // Mirrors disabledUrls so back-to-back toggles read the latest set, not a stale
  // render snapshot (otherwise rapid toggles clobber each other before re-render).
  const disabledRef = useRef<string[]>(disabledUrls);
  // The single BGM player owns playback; we just reflect its broadcast transport
  // state so the currently-playing row shows ■ Stop and the rest show ▶ Play.
  const [nowPlaying, setNowPlaying] = useState<{ playing: boolean; currentUrl: string | null; otherTab: boolean; otherTitle: string | null }>({ playing: false, currentUrl: null, otherTab: false, otherTitle: null });
  const [confirmingReset, setConfirmingReset] = useState(false);
  // Shared screen-entrance fade (ADR-0046): spread onto the chrome root (.settings-shell)
  // below. Fades the chrome in on a navigation-driven mount, leaving the ambience sibling
  // continuous; no-ops on a cold load. Replaces the bespoke `entered` state.
  const entranceClass = useScreenEntrance();

  useEffect(() => {
    const shell = document.querySelector('.shell');
    shell?.classList.add('settings-art-active');
    return () => shell?.classList.remove('settings-art-active');
  }, []);

  useEffect(() => {
    // Bare /settings normalizes to the first section so the URL always names a tab.
    if (normalizeRoutePath(window.location.pathname) === '/settings') {
      navigateApp(TAB_PATHS.general, { replace: true, scroll: false });
    }
    const sync = () => {
      setActiveTab(tabFromPath(window.location.pathname));
      setShowTracks(isTracksView(window.location.pathname));
    };
    window.addEventListener('popstate', sync);
    window.addEventListener(APP_NAVIGATION_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(APP_NAVIGATION_EVENT, sync);
    };
  }, []);

  useEffect(() => {
    const sync = () => setMuted(readMuted());
    window.addEventListener('storage', sync);
    window.addEventListener(MUTE_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(MUTE_CHANGE_EVENT, sync);
    };
  }, []);

  useEffect(() => {
    saveLocalSettings(settings);
    applyUiScale(settings.uiScale);
    // Let the running SFX service pick up master-audio / effects-volume changes live
    // (it re-reads localStorage on this event), so the Effects slider takes effect
    // without a reload — the SFX analogue of the BGM mute-change event.
    window.dispatchEvent(new CustomEvent(SFX_SETTINGS_CHANGE_EVENT));
  }, [settings]);

  // Load the soundtrack list whenever the dedicated tracks view is opened. A fresh
  // fetch each entry (the backend caches for 5 min); `tracks === null` is the loading
  // state, an empty array means none / unavailable (disambiguated by tracksStatus).
  useEffect(() => {
    if (!showTracks) return;
    let active = true;
    setTracks(null);
    setTracksStatus('Loading tracks...');
    (async () => {
      try {
        const response = await fetch('/api/bgm');
        if (!response.ok) throw new Error(`bgm ${response.status}`);
        const payload = await response.json() as { tracks?: Array<Partial<BgmTrack>> };
        const nextTracks = Array.isArray(payload.tracks)
          ? payload.tracks
              .filter((track): track is BgmTrack => typeof track.title === 'string' && typeof track.url === 'string')
              .map((track) => ({
                title: track.title,
                url: track.url,
                artist: typeof track.artist === 'string' ? track.artist : undefined,
                album: typeof track.album === 'string' ? track.album : undefined,
              }))
          : [];
        if (!active) return;
        setTracks(nextTracks);
        setTracksStatus(nextTracks.length ? `${nextTracks.length} tracks loaded.` : 'No tracks are available.');
      } catch {
        if (!active) return;
        setTracks([]);
        setTracksStatus('Tracks are unavailable right now.');
      }
    })();
    return () => { active = false; };
  }, [showTracks]);

  // Reflect the BGM player's transport state so the playing row shows ■ Stop.
  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent).detail as { playing?: boolean; currentUrl?: string | null; otherTab?: boolean; otherTitle?: string | null };
      setNowPlaying({
        playing: Boolean(detail.playing),
        currentUrl: detail.currentUrl ?? null,
        otherTab: Boolean(detail.otherTab),
        otherTitle: detail.otherTitle ?? null,
      });
    };
    window.addEventListener(BGM_STATE_EVENT, onState);
    return () => window.removeEventListener(BGM_STATE_EVENT, onState);
  }, []);

  // Start a crossfade when the target menu changes: keep the current panel as `previous`,
  // swap `display` to the new one, and render both stacked. The data fetch keys off
  // showTracks, so the soundtrack list loads during the fade. Pure opacity = reduced-motion
  // safe (runs even with Windows animations off → Chrome `reduce`).
  useEffect(() => {
    if (display.tab === activeTab && display.tracks === showTracks) return;
    setPrevious(display);
    setDisplay({ tab: activeTab, tracks: showTracks });
    setXfade('enter');
  }, [activeTab, showTracks, display.tab, display.tracks]);

  // Drive enter -> active one frame later, so the start opacities (prev 1 / next 0) paint
  // before the transition runs — then the two overlap-fade simultaneously.
  useEffect(() => {
    if (xfade !== 'enter') return undefined;
    const raf = requestAnimationFrame(() => setXfade('active'));
    return () => cancelAnimationFrame(raf);
  }, [xfade]);

  // Once a crossfade has run its --ds-duration-fade pass, drop the outgoing layer. Keyed on
  // `previous` so a new tab click mid-fade cleanly restarts the timer (queue-last).
  useEffect(() => {
    if (!previous) return undefined;
    const timer = window.setTimeout(() => { setPrevious(null); setXfade('idle'); }, PANEL_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [previous]);

  const active = useMemo(() => tabs.find((tab) => tab.id === display.tab) || tabs[0], [display.tab]);

  const updateSetting = <Key extends keyof LocalSettings>(key: Key, value: LocalSettings[Key]) => {
    setConfirmingReset(false);
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const setMasterAudio = (enabled: boolean) => {
    updateSetting('masterAudio', enabled);
    setMuted(!enabled);
    writeMuted(!enabled);
  };

  const resetDefaults = () => {
    if (!confirmingReset) {
      setConfirmingReset(true);
      return;
    }
    setSettings(DEFAULT_SETTINGS);
    setMuted(false);
    writeMuted(false);
    setConfirmingReset(false);
  };

  const setTrackEnabled = (track: BgmTrack, enabled: boolean) => {
    const base = disabledRef.current;
    const next = enabled
      ? base.filter((url) => url !== track.url)
      : Array.from(new Set([...base, track.url]));
    disabledRef.current = next;
    setDisabledUrls(next);
    writeDisabledUrls(next); // persist + notify the running player
  };

  // Play/Shuffle start audio even when it was muted; reflect that in the controls so
  // they don't lie — turn Background Music (and Master Audio) back on to match.
  const restoreAudibleControls = () => {
    if (muted) { setMuted(false); writeMuted(false); }
    if (!settings.masterAudio) updateSetting('masterAudio', true);
  };

  const playTrack = (track: BgmTrack, playing: boolean) => {
    if (playing) { sendBgmCommand('stop'); return; }
    sendBgmCommand('play', track.url);
    restoreAudibleControls();
  };

  const shuffleTracks = () => {
    sendBgmCommand('shuffle');
    restoreAudibleControls();
  };

  const adjustScale = (delta: number) => {
    updateSetting('uiScale', clamp(settings.uiScale + delta, 90, 120, DEFAULT_SETTINGS.uiScale));
  };

  const build = buildSummary();

  // The track currently coming out of the speakers, looked up in the loaded list by
  // the player's broadcast url — drives the permanent "Now Playing" row.
  const nowPlayingTrack = nowPlaying.playing && tracks
    ? tracks.find((track) => track.url === nowPlaying.currentUrl) ?? null
    : null;

  const renderGeneral = () => (
    <>
      <SettingsSection title="Interface">
        <SettingsRow
          title="UI Scale"
          description="Interface scale for this browser."
        >
          <Stepper
            value={settings.uiScale}
            suffix="%"
            decreaseLabel="Decrease UI Scale"
            increaseLabel="Increase UI Scale"
            onDecrease={() => adjustScale(-5)}
            onIncrease={() => adjustScale(5)}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Defaults">
        <SettingsRow
          title="Reset to Defaults"
          description={confirmingReset ? 'Press reset again to confirm.' : 'Restore General and Audio settings for this browser.'}
          value={<span>{confirmingReset ? 'Confirm' : 'Ready'}</span>}
        >
          <SettingsButton tone="danger" onClick={resetDefaults}>Reset</SettingsButton>
        </SettingsRow>
      </SettingsSection>
    </>
  );

  const renderAudio = () => (
    <>
      <SettingsSection title="Master">
        <SettingsRow title="Master Audio" description="Mute or restore all browser audio for Chess Tactics.">
          <Toggle checked={settings.masterAudio} label="Toggle Master Audio" onChange={setMasterAudio} />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Music">
        {/* Background-music on/off lives on the persistent title-bar mute control now
            (ADR-0044) — it drove the same MUTE_KEY as this row, so the row was a dup.
            Master Audio above is the all-sound master; this section keeps mix + tracks. */}
        <SettingsRow title="Music Volume" description="Set the target music mix for this browser.">
          <Slider
            value={settings.musicVolume}
            suffix="%"
            label="Music Volume"
            onChange={(next) => updateSetting('musicVolume', clamp(next, 0, 100, DEFAULT_SETTINGS.musicVolume))}
          />
          <SettingsButton href={TRACKS_PATH} ariaLabel="View the soundtrack track list">View Tracks</SettingsButton>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Effects">
        <SettingsRow title="Effects Volume" description="Set the target effects mix for this browser.">
          <Slider
            value={settings.effectsVolume}
            suffix="%"
            label="Effects Volume"
            onChange={(next) => updateSetting('effectsVolume', clamp(next, 0, 100, DEFAULT_SETTINGS.effectsVolume))}
          />
          <SettingsButton onClick={() => previewTerrain('water')} ariaLabel="Play a sample effect sound">Test</SettingsButton>
        </SettingsRow>
        <SettingsRow title="Interface Sounds" description="Enable or disable menu and control feedback sounds.">
          <Toggle checked={settings.interfaceSounds} label="Toggle Interface Sounds" onChange={(enabled) => updateSetting('interfaceSounds', enabled)} />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Notes">
        <SettingsRow
          title="Local Settings"
          description="Audio settings are saved on this device."
        />
      </SettingsSection>
    </>
  );

  // Dedicated soundtrack list, reached from the Music section's "View Tracks" pill.
  // Its own route (/settings/audio/tracks); the ← back (pinned outside the scroll
  // area, see the panel header below) returns to the Audio page.
  const renderTracks = () => (
    // The "Soundtrack" eyebrow is pinned in the panel header above; here we render
    // only the scrolling rows (reusing the section-rows chrome without its title).
    <section className="settings-section">
      <div className="settings-section-rows">
        {tracks === null ? (
          <SettingsRow title="Loading tracks…" description="Fetching the background music playlist." />
        ) : tracks.length === 0 ? (
          <SettingsRow
            title="No tracks to show"
            description={tracksStatus || 'No background music is configured for this environment.'}
          />
        ) : (
          tracks.map((track) => {
            const enabled = !disabledUrls.includes(track.url);
            const playing = nowPlaying.playing && nowPlaying.currentUrl === track.url;
            return (
              <SettingsRow
                key={track.url}
                eyebrow={track.artist}
                title={track.title}
              >
                <SettingsButton
                  onClick={() => playTrack(track, playing)}
                  ariaLabel={playing ? `Stop ${track.title}` : `Play ${track.title}`}
                >{playing ? '■ Stop' : '▶ Play'}</SettingsButton>
                <Toggle
                  checked={enabled}
                  label={`Include ${track.title} in background music`}
                  onChange={(value) => setTrackEnabled(track, value)}
                />
              </SettingsRow>
            );
          })
        )}
      </div>
    </section>
  );

  const renderGameplay = () => (
    <SettingsSection title="Gameplay">
      <SettingsRow
        title="Coming Soon"
        description="Gameplay settings are not available yet."
        value={<span>Locked</span>}
        tall
      />
    </SettingsSection>
  );

  const renderCreatorTools = () => (
    <>
      <SettingsSection title="Workspaces">
        {creatorTools.map((tool) => (
          <SettingsRow key={tool.href} title={tool.label} description={tool.description}>
            <SettingsButton tone="primary" href={tool.href} external={tool.external} ariaLabel={`Open ${tool.label}`}>Open</SettingsButton>
          </SettingsRow>
        ))}
      </SettingsSection>
      <SettingsSection title="About">
        <SettingsRow
          title="Build"
          description={build.detail}
          value={<span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{build.headline}</span>}
        />
      </SettingsSection>
    </>
  );

  // One panel's content, by tab — used for BOTH the incoming and (during a crossfade) the
  // outgoing layer, so the two stack and overlap-fade in a single pass.
  const renderPanel = (d: { tab: SettingsTab; tracks: boolean }) => (
    <>
      {d.tab === 'general' ? renderGeneral() : null}
      {d.tab === 'audio' ? (d.tracks ? renderTracks() : renderAudio()) : null}
      {d.tab === 'gameplay' ? renderGameplay() : null}
      {d.tab === 'creator-tools' ? renderCreatorTools() : null}
    </>
  );

  return (
    <section className="settings-art-route" aria-label="Settings" data-testid="settings">
      {/* Same art-directed backdrop + synced rain as the main menu, behind the frames. */}
      <AmbienceBackground />
      <div className="settings-screen app-shell-bar-pad">
        <div className={`settings-shell ${entranceClass}`}>
          <aside className="settings-frame settings-rail-frame" aria-label="Settings sections">
            {tabs.map((tab) => (
              <a
                key={tab.id}
                href={TAB_PATHS[tab.id]}
                className={`settings-tab ${tab.id === activeTab ? 'is-active' : ''}`}
                aria-current={tab.id === activeTab ? 'page' : undefined}
                onClick={() => setConfirmingReset(false)}
              >
                <span className="settings-tab-icon" aria-hidden="true">
                  <img src={asset(tab.icon)} alt="" />
                </span>
                <span>
                  <strong>{tab.label}</strong>
                </span>
              </a>
            ))}
          </aside>

          <main className="settings-frame settings-main-frame">
            {/* Screen + section are already shown by the brand lockup and the active
                nav button; a visible panel heading just duplicated them. Keep an
                accessible heading for screen-reader structure. */}
            <h2 className="sr-only">{active.label}</h2>
            {display.tracks ? (
              <div className="settings-tracks-bar">
                <div className="settings-tracks-bar-col">
                  <div className="settings-tracks-bar-actions">
                    <SettingsButton href={TAB_PATHS.audio} ariaLabel="Back to Audio settings">← Back</SettingsButton>
                    <SettingsButton onClick={shuffleTracks} ariaLabel="Shuffle and play the soundtrack">⇄ Shuffle</SettingsButton>
                  </div>
                  <section className="settings-row settings-nowplaying-row" aria-label="Now playing">
                    <div className="settings-row-copy">
                      <span className="settings-nowplaying-label">Now Playing</span>
                      {nowPlaying.otherTab ? (
                        <>
                          <span className="settings-row-eyebrow">Playing in another tab</span>
                          <h4 className="settings-nowplaying-empty">{nowPlaying.otherTitle ?? '—'}</h4>
                        </>
                      ) : nowPlayingTrack ? (
                        <>
                          {nowPlayingTrack.artist ? <span className="settings-row-eyebrow">{nowPlayingTrack.artist}</span> : null}
                          <h4>{nowPlayingTrack.title}</h4>
                        </>
                      ) : (
                        <h4 className="settings-nowplaying-empty">Nothing</h4>
                      )}
                    </div>
                  </section>
                  <h3 className="settings-section-title">Soundtrack</h3>
                </div>
              </div>
            ) : null}
            <KitScroll className="settings-scroll">
              <div className={`settings-panel-content settings-xfade-${xfade}`}>
                {previous ? (
                  <div className="settings-xfade-layer settings-xfade-prev" aria-hidden="true">
                    {renderPanel(previous)}
                  </div>
                ) : null}
                <div className="settings-xfade-layer settings-xfade-next">
                  {renderPanel(display)}
                </div>
              </div>
            </KitScroll>
          </main>
        </div>
      </div>
    </section>
  );
}
