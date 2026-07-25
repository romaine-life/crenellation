import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { AmbienceBackground } from './AmbienceBackground';
import { APP_NAVIGATION_EVENT, navigateApp, normalizeRoutePath } from './navigation';
import { useCampaigns } from '../campaign/store';
import { ensureCampaignsHydrated } from '../campaign/hydrate';
import {
  CAMPAIGN_PROGRESS_EVENT,
  isLevelUnlocked,
  orderedLevels,
  readProgress,
  type CampaignProgress,
} from '../campaign/progress';
import { OBJECTIVE_LABEL } from '../core/objectives';
import type { Campaign as CampaignDoc } from '../core/level';

const ICONS = '/assets/ui/main-menu/icons-carved';
const STAR_ICON = '/assets/ui/kit/icons/star.png';
// Temp carved icon for campaign tiles until a dedicated 'campaign' carving is forged.
const CAMPAIGN_ICON = `${ICONS}/campaign-editor.png`;

// The picked campaign is encoded in the URL (/campaign/<id>) so it is linkable,
// reloadable, and back/forward-navigable — the same pattern /settings uses for its
// active section.
function campaignIdFromPath(pathname: string): string {
  return normalizeRoutePath(pathname).match(/^\/campaign\/(.+)$/)?.[1] ?? '';
}

const starsRowStyle: CSSProperties = { display: 'inline-flex', gap: 4, alignItems: 'center' };

function Stars({ count }: { count: number }): ReactElement {
  return (
    <span style={starsRowStyle} aria-label={`${count} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <img key={i} src={STAR_ICON} alt="" aria-hidden="true" style={{ width: 18, height: 18, opacity: i < count ? 1 : 0.22 }} />
      ))}
    </span>
  );
}

// A campaign rendered as a settings-style rail tab — the same baked-skin chrome the
// main menu's mode tabs use, so the Campaign screen reads as a twin of the menu.
function CampaignTab({ campaign, active }: { campaign: CampaignDoc; active: boolean }): ReactElement {
  return (
    <a
      className={`settings-tab main-menu-mode-tab ${active ? 'is-active' : ''}`.trim()}
      href={`/campaign/${campaign.id}`}
      aria-current={active ? 'page' : undefined}
    >
      <span className="settings-tab-icon" aria-hidden="true">
        <img src={CAMPAIGN_ICON} alt="" />
      </span>
      <span><strong>{campaign.name}</strong></span>
    </a>
  );
}

// The selected campaign's levels, in play order, with progress and a Play link.
function LevelSelect({ campaign, progress }: { campaign: CampaignDoc; progress: CampaignProgress }): ReactElement {
  const levelDocs = useCampaigns((s) => s.levels);
  const refs = orderedLevels(campaign);

  return (
    <main className="settings-frame settings-main-frame">
      <div className="settings-panel-content">
        <section className="settings-section">
          <h3 className="settings-section-title">{campaign.name} — Levels</h3>
          <div className="settings-section-rows">
            {refs.length === 0 && (
              <section className="settings-row">
                <div className="settings-row-copy">
                  <h4>No levels yet</h4>
                  <p>This campaign has no levels. Add some in the Campaign Editor.</p>
                </div>
              </section>
            )}
            {refs.map((ref, index) => {
              const level = levelDocs[ref.levelId];
              const prog = progress[ref.levelId];
              const completed = Boolean(prog?.completed);
              const unlocked = isLevelUnlocked(refs, index, progress);
              const objective = level?.objective ?? ref.objective;
              const status = completed ? ' · Cleared' : unlocked ? '' : ' · Locked';
              const playHref = `/play?campaignId=${encodeURIComponent(campaign.id)}&levelId=${encodeURIComponent(ref.levelId)}`;
              return (
                <section className={`settings-row ${unlocked ? '' : 'is-disabled'}`.trim()} key={ref.levelId}>
                  <div className="settings-row-copy">
                    <h4>{index + 1}. {level?.name ?? `Level ${index + 1}`}</h4>
                    <p>{objective ? OBJECTIVE_LABEL[objective] : 'Battle'}{status}</p>
                  </div>
                  <div className="settings-row-value">
                    <Stars count={prog?.stars ?? 0} />
                  </div>
                  <div className="settings-row-control">
                    {unlocked
                      ? (
                        <a className="app-header-button app-header-button-active" href={playHref} aria-label={`Play ${level?.name ?? `level ${index + 1}`}`}>
                          {completed ? 'Replay' : 'Play'}
                        </a>
                      )
                      : <span className="app-header-button" aria-disabled="true" style={{ opacity: 0.5, pointerEvents: 'none' }}>Locked</span>}
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}

// The Campaign (play) screen: a settings-twin of the main menu. The rail lists the
// campaigns (the editor at /campaigns-next authors them; this plays them) and the
// panel is the selected campaign's level select. Click the brand lockup to go home.
export function Campaign(): ReactElement {
  const [selectedId, setSelectedId] = useState<string>(() => campaignIdFromPath(window.location.pathname));
  const [progress, setProgress] = useState<CampaignProgress>(readProgress);
  const campaigns = useCampaigns((s) => s.campaigns);

  useEffect(() => {
    const shell = document.querySelector('.shell');
    shell?.classList.add('main-menu-active');
    return () => shell?.classList.remove('main-menu-active');
  }, []);

  // Load the shared workspace the same way the editor does, so the lists match.
  useEffect(() => { void ensureCampaignsHydrated(); }, []);

  useEffect(() => {
    const sync = () => setSelectedId(campaignIdFromPath(window.location.pathname));
    window.addEventListener('popstate', sync);
    window.addEventListener(APP_NAVIGATION_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(APP_NAVIGATION_EVENT, sync);
    };
  }, []);

  // Keep the level select's progress fresh when a battle is won (live event) or a
  // background tab updates localStorage.
  useEffect(() => {
    const sync = () => setProgress(readProgress());
    window.addEventListener('storage', sync);
    window.addEventListener(CAMPAIGN_PROGRESS_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(CAMPAIGN_PROGRESS_EVENT, sync);
    };
  }, []);

  // Once campaigns load, a bare /campaign (or an unknown id) normalizes to the first
  // campaign so the URL always names a real one.
  useEffect(() => {
    if (!campaigns.length) return;
    if (!campaigns.some((c) => c.id === selectedId)) {
      navigateApp(`/campaign/${campaigns[0].id}`, { replace: true, scroll: false });
    }
  }, [campaigns, selectedId]);

  const activeId = campaigns.some((c) => c.id === selectedId) ? selectedId : campaigns[0]?.id ?? '';
  const activeCampaign = campaigns.find((c) => c.id === activeId) ?? null;
  // Tier split (ADR-0038): official campaigns show for everyone; the user's own only
  // when signed in. The store already orders officials first.
  const officialCampaigns = campaigns.filter((c) => c.origin === 'official');
  const myCampaigns = campaigns.filter((c) => c.origin !== 'official');

  return (
    // The cold-load reveal director (shell/coldReveal) arms ONLY on the home menu path,
    // so it never sequences this screen. But its opt-OUT gates hide any .main-menu-layer's
    // background (::after photo) and buttons (.main-menu-twin-screen) UNTIL data-reveal-* is
    // present (#238). The Campaign reuses those twin classes without running the director, so
    // declare both up front to render fully revealed — otherwise the photo + level buttons
    // stay stuck at opacity 0.
    <div
      className="menu-layer main-menu-layer is-ready"
      data-testid="campaign-menu"
      data-reveal-bg=""
      data-reveal-buttons=""
    >
      <AmbienceBackground />
      {/* Settings-twin layout, mirroring the main menu: shared app title bar + a rail
          of campaign tabs and a level-select panel over the ambience. */}
      <div className="settings-screen main-menu-twin-screen app-shell-bar-pad">
        <div className="settings-shell">
          <aside className="settings-frame settings-rail-frame" aria-label="Campaigns">
            {officialCampaigns.length > 0 && (
              <>
                {/* Only label the tiers when the user actually has their own (myCampaigns
                    is non-empty only when signed in — it comes from the authed merge). */}
                {myCampaigns.length > 0 ? <p className="campaign-rail-group">Official</p> : null}
                {officialCampaigns.map((campaign) => (
                  <CampaignTab key={campaign.id} campaign={campaign} active={campaign.id === activeId} />
                ))}
              </>
            )}
            {myCampaigns.length > 0 && (
              <>
                <p className="campaign-rail-group">Your Campaigns</p>
                {myCampaigns.map((campaign) => (
                  <CampaignTab key={campaign.id} campaign={campaign} active={campaign.id === activeId} />
                ))}
              </>
            )}
          </aside>

          {activeCampaign && <LevelSelect campaign={activeCampaign} progress={progress} />}
        </div>
      </div>
    </div>
  );
}
