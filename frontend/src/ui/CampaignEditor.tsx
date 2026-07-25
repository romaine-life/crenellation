import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useCampaigns } from '../campaign/store';
import { saveUserWorkspace, publishOfficialWorkspace, userWorkspaceForSave, officialWorkspaceForSave, mapSaveError, tierOf } from '../campaign/save';
import { validateLevel, type Campaign, type CampaignLevelRef, type Level, type ObjectiveType } from '../core/level';
import { loadWorkspace, loadOfficialCampaigns } from '../net/campaignWorkspace';
import { fetchMe, goSignIn, isUnauthorized, signInHref, type AuthUser } from '../net/auth';
import { LevelThumbnail } from '../render/LevelThumbnail';
import { StudioReadOnlyBoard } from '../render/StudioReadOnlyBoard';
import { levelToEditorBoard } from '../core/levelBoard';
import { ViewPane } from './shared/ViewPane';
import { injectStressLevels } from '../campaign/stressFixture';
import { LevelInfoCompact } from './LevelInfoCompact';
import { TitleBarSlot } from './shell/TitleBarSlot';
import { AmbienceBackground } from './AmbienceBackground';
import { useScreenEntrance } from './shell/useScreenEntrance';

const CE_ICONS = {
  star: '/assets/ui/kit/icons/star.png',
  'chevron-up': '/assets/ui/kit/icons/chevron-up.png',
  'chevron-down': '/assets/ui/kit/icons/chevron-down.png',
  delete: '/assets/ui/kit/icons/delete.png',
  lock: '/assets/ui/kit/icons/lock.png',
} as const;

const objectiveLabel: Record<ObjectiveType, string> = {
  'capture-all': 'Capture all enemy pieces',
  'capture-king': 'Capture the enemy King',
  survive: 'Survive the assault',
  reach: 'Reach the objective',
};

function workspaceSignature(ws: { campaigns: Campaign[]; levels: Record<string, Level> }): string {
  return JSON.stringify(ws);
}

// Per-tier signatures: the user slice and the official slice are tracked separately so a
// private "Save" and an official "Publish" have independent dirty state. Both read the
// same canonical (tag-stripped) slice the corresponding PUT would send.
function userSliceSignature(): string {
  return workspaceSignature(userWorkspaceForSave());
}

function officialSliceSignature(): string {
  return workspaceSignature(officialWorkspaceForSave());
}

function validateWorkspaceImport(ws: Partial<{ campaigns: Campaign[]; levels: Record<string, Level> }>): string | null {
  if (!Array.isArray(ws.campaigns)) return 'campaigns must be an array';
  if (!ws.levels || typeof ws.levels !== 'object') return 'levels must be an object';
  for (const campaign of ws.campaigns) {
    if (!campaign || typeof campaign !== 'object') return 'campaign is not an object';
    if (typeof campaign.id !== 'string' || !campaign.id) return 'campaign id is required';
    if (typeof campaign.name !== 'string') return `campaign ${campaign.id} is missing a name`;
    if (!Array.isArray(campaign.levels)) return `campaign ${campaign.id} levels must be an array`;
    for (const ref of campaign.levels) {
      if (!ref || typeof ref.levelId !== 'string') return `campaign ${campaign.id} has an invalid level reference`;
      if (!ws.levels[ref.levelId]) return `campaign ${campaign.id} references missing level ${ref.levelId}`;
    }
  }
  for (const [id, level] of Object.entries(ws.levels)) {
    const result = validateLevel(level);
    if (!result.ok) return `level ${id} is invalid: ${result.errors[0]}`;
  }
  return null;
}

function AssetButton({
  children,
  className = '',
  danger = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }): ReactElement {
  return (
    <button type="button" className={`ce-asset-button ${danger ? 'is-danger' : ''} ${className}`.trim()} {...props}>
      <span>{children}</span>
    </button>
  );
}

function IconButton({
  children,
  danger = false,
  selected = false,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean; selected?: boolean }): ReactElement {
  return (
    <button
      type="button"
      className={`ce-icon-button ${danger ? 'is-danger' : ''} ${selected ? 'is-selected' : ''} ${className}`.trim()}
      {...props}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

function Stars({ count = 0 }: { count?: number }): ReactElement {
  return (
    <span className="ce-stars" aria-label={`${count} stars`}>
      {[0, 1, 2].map((i) => <img key={i} className={`ce-star ${i < count ? 'is-filled' : ''}`.trim()} src={CE_ICONS.star} alt="" aria-hidden="true" />)}
    </span>
  );
}

function CampaignRow({
  campaign,
  index,
  active,
  isAdmin,
  onSelect,
  onFavorite,
}: {
  campaign: Campaign;
  index: number;
  active: boolean;
  isAdmin: boolean;
  onSelect: () => void;
  onFavorite: (event: React.MouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  const isOfficial = campaign.origin === 'official';
  // Lock (and the padlock) is UI-derived: officials lock only for non-admins. An admin
  // sees officials selectable + editable, tagged "OFFICIAL" instead of a padlock.
  const locked = isOfficial && !isAdmin;
  const selectCampaign = () => {
    if (!locked) onSelect();
  };
  return (
    <div
      role="button"
      tabIndex={locked ? -1 : 0}
      aria-disabled={locked || undefined}
      className={`ce-campaign-row ${active ? 'is-selected' : ''} ${locked ? 'is-locked' : ''}`.trim()}
      onClick={selectCampaign}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectCampaign();
        }
      }}
    >
      <span className="ce-row-copy">
        <strong>{campaign.name}</strong>
        <small>{campaign.levels.length} levels</small>
      </span>
      {locked ? (
        <span className="ce-row-lock" aria-label={`${campaign.name} locked`} role="img">
          <CeIcon icon="lock" />
        </span>
      ) : isOfficial ? (
        <span className="ce-official-badge ce-row-official-tag" aria-label={`${campaign.name} is an official campaign`}>OFFICIAL</span>
      ) : (
        <button
          type="button"
          className={`ce-row-favorite ${campaign.favorite ? 'is-selected' : ''}`.trim()}
          aria-label={campaign.favorite ? `Unfavorite ${campaign.name}` : `Favorite ${campaign.name}`}
          onClick={onFavorite}
        >
          <img className="ce-star" src={CE_ICONS.star} alt="" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function CeIcon({ icon }: { icon: keyof typeof CE_ICONS }): ReactElement {
  return <img className="ce-icon-img" src={CE_ICONS[icon]} alt="" aria-hidden="true" draggable={false} />;
}

function LevelRow({
  levelRef,
  level,
  index,
  active,
  readOnly = false,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  levelRef: CampaignLevelRef;
  level: Level | undefined;
  index: number;
  active: boolean;
  readOnly?: boolean;
  onSelect: () => void;
  onMoveUp: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onMoveDown: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDelete: (event: React.MouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  const objective = levelRef.objective ?? level?.objective ?? 'capture-all';
  return (
    <div
      role="button"
      tabIndex={0}
      className={`ce-level-row ${active ? 'is-selected' : ''}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="ce-level-thumb" aria-hidden="true">
        {level ? <LevelThumbnail level={level} width={46} height={32} /> : <span className="ce-level-thumb-empty" />}
      </span>
      <span className="ce-row-copy">
        <strong>{index + 1}. {level?.name ?? levelRef.levelId}</strong>
        <small>{objectiveLabel[objective]}</small>
      </span>
      <Stars count={levelRef.stars ?? 0} />
      {readOnly ? null : (
        <span className="ce-row-actions" aria-label="Level actions">
          <IconButton onClick={onMoveUp} aria-label="Move level up"><CeIcon icon="chevron-up" /></IconButton>
          <IconButton onClick={onMoveDown} aria-label="Move level down"><CeIcon icon="chevron-down" /></IconButton>
          <IconButton danger onClick={onDelete} aria-label="Delete level"><CeIcon icon="delete" /></IconButton>
        </span>
      )}
    </div>
  );
}

export function CampaignEditor() {
  const campaigns = useCampaigns((s) => s.campaigns);
  const levels = useCampaigns((s) => s.levels);
  const selectedCampaignId = useCampaigns((s) => s.selectedCampaignId);
  const selectedLevelId = useCampaigns((s) => s.selectedLevelId);
  const [status, setStatus] = useState('');
  const [me, setMe] = useState<AuthUser | null>(null);
  const [levelView, setLevelView] = useState<'board' | 'info'>('board');
  // Pan/zoom for the SELECTED-level live viewer (the list rows stay flat baked thumbnails).
  const [viewZoom, setViewZoom] = useState(0.5);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const currentWorkspace = useMemo(() => ({ campaigns, levels }), [campaigns, levels]);
  // Two tier-scoped dirty signals: a private "Save" and an official "Publish" are
  // independent acts, each with its own last-saved signature.
  const userSig = useMemo(() => userSliceSignature(), [currentWorkspace]);
  const officialSig = useMemo(() => officialSliceSignature(), [currentWorkspace]);
  const [savedUserSig, setSavedUserSig] = useState(() => userSig);
  const [savedOfficialSig, setSavedOfficialSig] = useState(() => officialSig);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const userDirty = userSig !== savedUserSig;
  const officialDirty = officialSig !== savedOfficialSig;
  const dirty = userDirty || officialDirty;

  const resyncSavedSignatures = () => {
    setSavedUserSig(userSliceSignature());
    setSavedOfficialSig(officialSliceSignature());
  };

  const selectFirstEditable = () => {
    // Land on the first private campaign by default so a fresh load opens on editable
    // content. Officials are now editable in place (for admins) or read-only with a
    // padlock (everyone else) — selection no longer steers around them.
    const state = useCampaigns.getState();
    const first = state.campaigns.find((c) => c.origin !== 'official') ?? state.campaigns[0];
    if (first) state.selectCampaign(first.id);
  };

  useEffect(() => {
    const shell = document.querySelector('.shell');
    shell?.classList.add('campaign-editor-active');
    return () => shell?.classList.remove('campaign-editor-active');
  }, []);

  // Chrome entrance via the SHARED primitive (ADR-0046): spread onto .ce-layout + .ce-footer
  // below, so only the chrome fades in over the steady backdrop + rain. Replaces the bespoke
  // .is-entered state this screen used to hand-roll; no-ops on a cold load.
  const entranceClass = useScreenEntrance();

  useEffect(() => {
    let active = true;
    fetchMe().then((user) => { if (active) setMe(user); });
    (async () => {
      const store = useCampaigns.getState();
      // Officials always (for everyone), then the signed-in user's own on top.
      store.mergeOfficial(await loadOfficialCampaigns());
      if (!active) return;
      try {
        store.mergeUser(await loadWorkspace());
      } catch (e) {
        if (active && isUnauthorized(e)) setStatus('Official campaigns shown. Sign in to author your own.');
      }
      if (!active) return;
      // Dev-only perf harness: `?stress=<n>` injects a throwaway campaign of N generated levels
      // (selecting it) so scroll/thumbnail perf can be measured on a long list. No-op without the
      // flag, so it never touches normal use; the levels live only in the in-memory store.
      const injected = injectStressLevels();
      if (injected) setStatus(`Stress fixture: injected ${injected} generated levels.`);
      else selectFirstEditable();
      resyncSavedSignatures();
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Re-frame the live viewer whenever the selected level changes, so each board opens centred
  // at the default zoom instead of inheriting the previous level's pan/zoom.
  useEffect(() => {
    setViewZoom(0.5);
    setViewPan({ x: 0, y: 0 });
  }, [selectedLevelId]);

  // Private "Save": frictionless, writes only the user slice (officials never enter it).
  const saveUserNow = async () => {
    try {
      await saveUserWorkspace();
      setSavedUserSig(userSliceSignature());
      setStatus('Saved to server');
    } catch (e) {
      const mapped = mapSaveError(e);
      if ('action' in mapped) { goSignIn(); return; }
      setStatus(mapped.message);
    }
  };

  // "Publish to all players": a distinct, confirmed, admin-gated write of ONLY the
  // official slice. The server's requireAdmin is the real gate (403 surfaces here).
  const publishOfficialNow = async () => {
    if (!window.confirm('Publish changes to the official campaigns? Every player will receive them.')) return;
    try {
      const { revision } = await publishOfficialWorkspace();
      setSavedOfficialSig(officialSliceSignature());
      setStatus(`Published (revision ${revision}).`);
    } catch (e) {
      const mapped = mapSaveError(e);
      if ('action' in mapped) { goSignIn(); return; }
      setStatus(mapped.message);
    }
  };

  const importCampaignFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Partial<{ campaigns: Campaign[]; levels: Record<string, Level> }>;
      const validationError = validateWorkspaceImport(parsed);
      if (validationError) {
        setStatus(`Import failed: ${validationError}.`);
        return;
      }
      const importedCampaigns = parsed.campaigns!;
      const importedLevels = parsed.levels!;
      useCampaigns.getState().importWorkspace({ campaigns: importedCampaigns, levels: importedLevels });
      setStatus(`Imported ${importedCampaigns.length} campaign${importedCampaigns.length === 1 ? '' : 's'}. Save to keep them.`);
    } catch (error) {
      setStatus(`Import failed: ${(error as Error).message}`);
    }
  };

  const exportWorkspace = () => {
    // Export only the user slice (tags stripped) — never the co-mingled store, or a
    // re-import would carry origin:'official' and be silently dropped on save.
    const workspace = userWorkspaceForSave();
    const blob = new Blob([`${JSON.stringify(workspace, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const safeName = (camp?.name ?? 'campaign-workspace').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'campaign-workspace';
    anchor.href = url;
    anchor.download = `${safeName}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus('Exported campaign workspace JSON.');
  };

  const confirmDeleteCampaign = (campaign: Campaign) => {
    if (window.confirm(`Delete campaign "${campaign.name}"? This removes it from the workspace when you save.`)) {
      useCampaigns.getState().deleteCampaign(campaign.id);
      setStatus('Campaign deleted. Save to keep this change.');
    }
  };

  const confirmDeleteLevel = (level: Level) => {
    if (window.confirm(`Delete level "${level.name}"? This removes it from the workspace when you save.`)) {
      useCampaigns.getState().deleteLevel(level.id);
      setStatus('Level deleted. Save to keep this change.');
    }
  };

  const isAdmin = Boolean(me?.is_admin);
  const camp = campaigns.find((c) => c.id === selectedCampaignId) ?? null;
  const campIsOfficial = camp?.origin === 'official';
  // readOnly is UI-derived, never trusted from a baked tag: an official campaign is
  // read-only ONLY for non-admins. Admins edit officials in place. This drives every
  // mutation control below.
  const readOnly = campIsOfficial && !isAdmin;
  const ownCount = campaigns.filter((c) => c.origin !== 'official').length;
  const orderedLevels = camp ? camp.levels.slice().sort((a, b) => a.ordinal - b.ordinal) : [];
  const levelDoc = selectedLevelId ? levels[selectedLevelId] : null;
  // The SELECTED level's LIVE board, derived the SAME way the list thumbnails and the Level
  // Editor derive theirs (prefers boardCode, falls back to layers) — so what the viewer shows,
  // a row's baked thumbnail, and the editor all agree.
  const viewerBoard = useMemo(() => (levelDoc ? levelToEditorBoard(levelDoc) : null), [levelDoc]);
  const levelRef = camp && selectedLevelId ? camp.levels.find((r) => r.levelId === selectedLevelId) : null;
  const selectedLevelIndex = orderedLevels.findIndex((r) => r.levelId === selectedLevelId);
  const totalLevels = orderedLevels.length;
  const enemyCount = levelDoc?.layers.units.filter((unit) => unit.side === 'enemy').length ?? 0;
  const allyCount = levelDoc?.layers.units.filter((unit) => unit.side === 'player').length ?? 0;
  const editHref = camp && levelDoc ? `/edit?campaignId=${encodeURIComponent(camp.id)}&levelId=${encodeURIComponent(levelDoc.id)}&returnTo=${encodeURIComponent('/campaigns-next')}` : '/edit';
  const playHref = camp && levelDoc ? `/play?campaignId=${encodeURIComponent(camp.id)}&levelId=${encodeURIComponent(levelDoc.id)}&mode=test&returnTo=${encodeURIComponent('/campaigns-next')}` : '/play';

  // Unassigned levels: store level docs referenced by NO campaign — typically a board authored
  // cold in the Level Editor (createUnassignedLevel) before it is filed into a campaign. They
  // live in the workspace and round-trip through campaign_workspaces just like any other level.
  const referencedLevelIds = useMemo(
    () => new Set(campaigns.flatMap((c) => c.levels.map((r) => r.levelId))),
    [campaigns],
  );
  const unassignedLevels = useMemo(
    () => Object.values(levels).filter((level) => !referencedLevelIds.has(level.id)),
    [levels, referencedLevelIds],
  );
  // "Attach to this campaign" pushes a ref onto the selected campaign. Only enabled when a
  // campaign is selected, it is editable (not a non-admin official), AND the level shares its
  // tier — never mix an `off-` level into a private campaign (it would write an off- reference
  // into the per-user workspace, INV1/INV8) or vice-versa.
  const canAttachTo = (level: Level): boolean =>
    Boolean(camp) && !readOnly && tierOf(level.id) === tierOf(camp!.id);
  const editHrefForUnassigned = (levelId: string): string =>
    `/edit?levelId=${encodeURIComponent(levelId)}&returnTo=${encodeURIComponent('/campaigns-next')}`;

  return (
    <div className="ce-screen app-shell-bar-pad" data-testid="campaign-editor">
      {/* Same art-directed backdrop + synced rain as the main menu (.ce-screen paints the
          menu scene; this canvas adds the shared rain). Mostly overlapped by the editor
          panels, but it keeps the feel consistent with the rest of the app in the gaps. */}
      <AmbienceBackground />
      {/* Title bar lives in the app shell; the editor paints its live save-state +
          shortcuts into it via portals (workspace state stays in this component). */}
      <TitleBarSlot region="center">
        <div className="ce-topbar-stats" aria-label="Campaign workspace stats">
          <span className={`ce-save-state ${dirty ? 'is-dirty' : ''}`.trim()}>{dirty ? 'Unsaved' : 'Saved'}</span>
        </div>
      </TitleBarSlot>
      <TitleBarSlot region="actions">
        <nav className="ce-topbar-actions" aria-label="Editor shortcuts">
          {isAdmin && officialDirty ? (
            <button type="button" data-testid="publish-officials" className="app-header-button" onClick={() => void publishOfficialNow()}>Publish to all players</button>
          ) : null}
          <button type="button" data-testid="save-workspace" className="app-header-button app-header-button-active" disabled={!userDirty} onClick={() => void saveUserNow()}>Save</button>
        </nav>
      </TitleBarSlot>

      <main className={`ce-layout ${entranceClass}`.trim()}>
        <aside className="ce-panel ce-campaigns-panel" aria-label="Campaigns">
          <div className="ce-panel-head">
            <h2>Campaigns</h2>
            <span>{ownCount} / 20</span>
          </div>
          <AssetButton data-testid="new-campaign" className="ce-new-campaign" onClick={() => useCampaigns.getState().newCampaign()}>
            + New Campaign
          </AssetButton>
          <input
            ref={importInputRef}
            className="ce-file-input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              void importCampaignFile(event.currentTarget.files?.[0]);
              event.currentTarget.value = '';
            }}
          />
          {status ? <div data-testid="workspace-status" className="ce-status">{status}</div> : null}
          {me && !me.signed_in ? (
            <a href={signInHref()} data-testid="campaign-sign-in" className="ce-sign-in">Sign in to save</a>
          ) : null}
          <div className="ce-campaign-list">
            {campaigns.length === 0 ? <p className="ce-empty">No campaigns yet.</p> : null}
            {campaigns.map((campaign, index) => (
              <CampaignRow
                key={campaign.id}
                campaign={campaign}
                index={index}
                active={campaign.id === selectedCampaignId}
                isAdmin={isAdmin}
                onSelect={() => useCampaigns.getState().selectCampaign(campaign.id)}
                onFavorite={(event) => {
                  event.stopPropagation();
                  useCampaigns.getState().toggleCampaignFavorite(campaign.id);
                }}
              />
            ))}
          </div>
          <AssetButton className="ce-import-campaign" onClick={() => importInputRef.current?.click()}>
            Import Campaign
          </AssetButton>
        </aside>

        <section className="ce-panel ce-details-panel" aria-label="Campaign details and levels">
          {camp ? (
            <>
              <div className="ce-section-title">
                <h2>Campaign Details</h2>
                {readOnly
                  ? <span className="ce-official-badge">Official campaign — read-only</span>
                  : campIsOfficial
                    ? <span className="ce-official-badge">OFFICIAL</span>
                    : null}
              </div>
              <div className="ce-campaign-summary">
                <label className="ce-name-field">
                  <span>Campaign Name</span>
                  <input
                    data-testid="campaign-name"
                    value={camp.name}
                    disabled={readOnly}
                    onChange={(e) => useCampaigns.getState().renameCampaign(camp.id, e.target.value)}
                  />
                </label>
                <dl className="ce-stat-rows">
                  <div className="ce-stat-row"><dt>Chapters</dt><dd>{camp.chapters}</dd></div>
                  <div className="ce-stat-row"><dt>Levels</dt><dd>{camp.levels.length}</dd></div>
                  <div className="ce-stat-row"><dt>Difficulty</dt><dd>{camp.difficulty}</dd></div>
                </dl>
              </div>

              <div className="ce-levels-head">
                <h2>Levels</h2>
                {readOnly ? null : <AssetButton data-testid="add-level" onClick={() => useCampaigns.getState().addLevel()}>+ Add Level</AssetButton>}
              </div>
              <div className="ce-level-list">
                {orderedLevels.length === 0 ? <p className="ce-empty">No levels. Add one to begin.</p> : null}
                {orderedLevels.map((ref, index) => (
                  <LevelRow
                    key={ref.levelId}
                    levelRef={ref}
                    level={levels[ref.levelId]}
                    index={index}
                    active={ref.levelId === selectedLevelId}
                    readOnly={readOnly}
                    onSelect={() => useCampaigns.getState().selectLevel(ref.levelId)}
                    onMoveUp={(event) => { event.stopPropagation(); useCampaigns.getState().moveLevel(ref.levelId, -1); }}
                    onMoveDown={(event) => { event.stopPropagation(); useCampaigns.getState().moveLevel(ref.levelId, 1); }}
                    onDelete={(event) => { event.stopPropagation(); if (levels[ref.levelId]) confirmDeleteLevel(levels[ref.levelId]); }}
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="ce-empty ce-empty-large">Select or create a campaign.</p>
          )}

          {unassignedLevels.length > 0 ? (
            <div className="ce-unassigned" data-testid="unassigned-levels">
              <div className="ce-section-title">
                <h2>Unassigned levels</h2>
                <span>{unassignedLevels.length}</span>
              </div>
              <div className="ce-level-list">
                {unassignedLevels.map((level) => (
                  <div key={level.id} className="ce-level-row ce-unassigned-row">
                    <span className="ce-level-thumb" aria-hidden="true">
                      <LevelThumbnail level={level} width={46} height={32} />
                    </span>
                    <span className="ce-row-copy">
                      <strong>{level.name}</strong>
                      <small>{objectiveLabel[level.objective]}</small>
                    </span>
                    <span className="ce-row-actions" aria-label="Unassigned level actions">
                      <a className="ce-link-button ce-link-button-ghost" href={editHrefForUnassigned(level.id)}><span>Edit</span></a>
                      <AssetButton
                        disabled={!canAttachTo(level)}
                        title={camp ? `Attach to ${camp.name}` : 'Select a campaign to attach this level'}
                        onClick={() => {
                          useCampaigns.getState().attachLevel(level.id);
                          setStatus(`Attached "${level.name}" to ${camp?.name ?? 'the campaign'}. Save to keep this change.`);
                        }}
                      >
                        Attach to this campaign
                      </AssetButton>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="ce-panel ce-level-panel" aria-label="Selected level">
          <div className="ce-selected-head">
            <h2>{levelDoc ? `Level ${selectedLevelIndex + 1}: ${levelDoc.name}` : 'Selected Level'}</h2>
            {levelDoc ? (
              <div className="ce-force-readout" aria-label="Level forces">
                <span className="ce-force ce-force-ally"><img src="/assets/ui/main-menu/profile-rook-blue.png" alt="" />Allies <strong>{allyCount}</strong></span>
                <span className="ce-force ce-force-enemy"><img src="/assets/ui/main-menu/profile-rook-red.png" alt="" />Enemies <strong>{enemyCount}</strong></span>
              </div>
            ) : null}
          </div>
          <div className="ce-preview-frame">
            {levelDoc ? (
              <div className="ce-level-view-toggle" role="tablist" aria-label="Preview mode">
                <button type="button" role="tab" aria-selected={levelView === 'board'} className={levelView === 'board' ? 'is-active' : ''} onClick={() => setLevelView('board')}>Board</button>
                <button type="button" role="tab" aria-selected={levelView === 'info'} className={levelView === 'info' ? 'is-active' : ''} onClick={() => setLevelView('info')}>Info</button>
              </div>
            ) : null}
            {levelDoc && levelView === 'info' ? (
              <LevelInfoCompact level={levelDoc} />
            ) : levelDoc && viewerBoard ? (
              // The SELECTED viewer is a LIVE board (pan/zoom) rendered through the SAME read-only
              // renderer the editor uses, inside the shared ViewPane. Static frame (no animation
              // clock here): a preview shouldn't run a per-frame loop while the editor is open.
              <div className="ce-level-viewer">
                <ViewPane
                  kind="board"
                  ariaLabel={`${levelDoc.name} board`}
                  zoom={viewZoom}
                  pan={viewPan}
                  minZoom={0.2}
                  maxZoom={2}
                  onZoomChange={setViewZoom}
                  onPanChange={setViewPan}
                >
                  <div className="tileset-view-board-content is-board">
                    <StudioReadOnlyBoard board={viewerBoard} boardZoom={viewZoom} boardPan={viewPan} ariaLabel={`${levelDoc.name} board`} />
                  </div>
                </ViewPane>
              </div>
            ) : (
              <div className="level-preview-empty" aria-label="No level preview"><span>Select a level.</span></div>
            )}
          </div>
          {levelDoc && levelRef ? (
            <div className="ce-preview-actions">
              <a className="ce-link-button" href={editHref}><span>Edit Board</span></a>
              <a className="ce-link-button ce-link-button-ghost" href={playHref}><span>Test Play</span></a>
            </div>
          ) : (
            <p className="ce-empty ce-empty-large">Select a level.</p>
          )}
        </section>
      </main>

      <footer className={`ce-footer ${entranceClass}`.trim()}>
        <AssetButton disabled={!camp || camp.origin === 'official'} onClick={() => camp && useCampaigns.getState().duplicateCampaign(camp.id)}>Duplicate</AssetButton>
        <AssetButton className="ce-footer-secondary" disabled={!campaigns.length} onClick={exportWorkspace}>Export</AssetButton>
        <AssetButton danger disabled={!camp || readOnly} onClick={() => camp && confirmDeleteCampaign(camp)}>Delete Campaign</AssetButton>
      </footer>
    </div>
  );
}
