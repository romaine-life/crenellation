import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { SkirmishBoard } from '../render/SkirmishBoard';
import { SkirmishHud } from './SkirmishHud';
import { TitleBarSlot } from './shell/TitleBarSlot';
import { useSkirmish, shouldStartFreshSkirmish } from '../game/store';
import { useCampaigns } from '../campaign/store';
import { ensureCampaignsHydrated } from '../campaign/hydrate';
import { DEFAULT_BACKGROUND_SET } from '../art/backgroundSets';
import { PALETTE_FOR_SIDE, isPlayablePieceType } from '../core/pieces';
import { masterSrc, type Piece as PortraitPiece, type Palette as PortraitPalette } from './PortraitEditor';
import { PRODUCTION_PORTRAIT_METHOD } from './portraitCandidates';
import { preloadImages } from '../art/preload';
import { livingPieces } from '../core/rules';
import { computeStars, recordLevelWin } from '../campaign/progress';

const STAR_ICON = '/assets/ui/kit/icons/star.png';

function ResultStars({ count }: { count: number }) {
  return (
    <span className="campaign-result-stars" aria-label={`${count} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <img key={i} src={STAR_ICON} alt="" aria-hidden="true" style={{ width: 26, height: 26, opacity: i < count ? 1 : 0.22 }} />
      ))}
    </span>
  );
}

const OBJECTIVE_COPY = {
  'capture-all': 'Capture all enemy pieces',
  'capture-king': 'Capture the enemy King',
  survive: 'Survive the assault',
  reach: 'Reach the objective',
} as const;

export function Skirmish() {
  const routeParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const routeCampaignId = routeParams.get('campaignId');
  const routeLevelId = routeParams.get('levelId');
  const routeMode = routeParams.get('mode');
  // Real campaign play (records progress + shows the result flow), as opposed to the
  // editor's "Test Play" (mode=test) or a free skirmish (no campaign/level).
  const isCampaignPlay = Boolean(routeCampaignId && routeLevelId && routeMode !== 'test');
  const [routeLevel, setRouteLevel] = useState(() => (routeLevelId ? useCampaigns.getState().levels[routeLevelId] ?? null : null));
  // The board mounts only once this screen has DECIDED which game to play (fresh vs resume).
  // The store ships a populated placeholder game (store.ts INITIAL_GAME), so mounting the
  // board before that decision would render the placeholder, then a second time when
  // newSkirmish swaps in the real seed — the board (and the unit deploy) would play twice,
  // the second time at the new positions. Gating the mount on this lets the board mount once,
  // fresh, for the game we actually play.
  const [boardSettled, setBoardSettled] = useState(false);
  const newSkirmish = useSkirmish((s) => s.newSkirmish);
  const game = useSkirmish((s) => s.game);
  const turnLabel = game.winner
    ? game.winner === 'draw' ? 'Stalemate' : game.winner === 'player' ? 'Victory' : 'Defeat'
    : game.turn === 'player' ? 'Player Turn' : 'Enemy Turn';

  // Stars earned this clear (3 flawless, 2 light losses, 1 any win), from the level's
  // authored player force vs. who's still standing.
  const stars = useMemo(() => {
    if (!routeLevel || game.winner !== 'player') return 0;
    const initial = routeLevel.layers.units.filter((u) => u.side === 'player').length;
    return computeStars(initial, livingPieces(game.pieces, 'player').length);
  }, [routeLevel, game.winner, game.pieces]);

  // Bank the win the moment a campaign battle is won (idempotent — keeps the best stars).
  useEffect(() => {
    if (isCampaignPlay && routeLevel && game.winner === 'player') recordLevelWin(routeLevel.id, stars);
  }, [isCampaignPlay, routeLevel, game.winner, stars]);

  const replayLevel = () => {
    if (routeLevel) newSkirmish({ seed: Math.floor(Math.random() * 999999) + 1, level: routeLevel });
  };

  useEffect(() => {
    const shell = document.querySelector('.shell');
    shell?.classList.add('skirmish-active');
    return () => shell?.classList.remove('skirmish-active');
  }, []);

  // Warm the portrait cache for the units actually on the board so the HUD bust
  // paints instantly on the first click instead of waiting for a fetch+decode at
  // that moment. The HUD renders the bust live from the editor master render (via
  // <UnitPortrait>), so preload THOSE — not the no-longer-used baked PNGs — plus
  // the backdrop scene. Scoped to the current roster (both sides are focusable).
  useEffect(() => {
    const urls: string[] = [];
    for (const piece of game.pieces) {
      if (!isPlayablePieceType(piece.type)) continue;
      urls.push(masterSrc(piece.type as PortraitPiece, PALETTE_FOR_SIDE[piece.side] as PortraitPalette, PRODUCTION_PORTRAIT_METHOD));
      urls.push(DEFAULT_BACKGROUND_SET.portraits[piece.type]);
    }
    preloadImages(urls);
  }, [game.pieces]);

  useEffect(() => {
    // Returning here from the menu (or any other screen) should resume, not
    // restart: the store is a singleton that already holds the live board. Only
    // build a fresh game when there isn't a matching in-progress one — i.e. the
    // first launch, after a finished game, or when a different level is opened.
    const shouldStartFresh = (levelId: string | null): boolean =>
      shouldStartFreshSkirmish(useSkirmish.getState(), levelId);
    const freshSeed = () => Math.floor(Math.random() * 999999) + 1;

    if (!routeLevelId || routeLevel) {
      const levelId = routeLevel?.id ?? null;
      if (shouldStartFresh(levelId)) newSkirmish({ seed: freshSeed(), level: routeLevel ?? undefined });
      setBoardSettled(true);
      return;
    }
    let active = true;
    // Hydrate the shared workspace the same way the menu does (server when reachable,
    // else the bundled default) so a deep-link / reload of a campaign battle resolves
    // its level offline too — not just when arriving from the level select.
    ensureCampaignsHydrated()
      .then(() => {
        if (!active) return;
        if (routeCampaignId) useCampaigns.getState().selectCampaign(routeCampaignId);
        useCampaigns.getState().selectLevel(routeLevelId);
        const level = useCampaigns.getState().levels[routeLevelId] ?? null;
        setRouteLevel(level);
        if (shouldStartFresh(level?.id ?? null)) newSkirmish({ seed: freshSeed(), level: level ?? undefined });
        setBoardSettled(true);
      })
      .catch(() => { if (shouldStartFresh(null)) newSkirmish({ seed: freshSeed() }); setBoardSettled(true); });
    return () => { active = false; };
  }, [newSkirmish, routeCampaignId, routeLevel, routeLevelId]);

  const screenStyle = {
    '--skirmish-world-bg': `url("${DEFAULT_BACKGROUND_SET.world}")`,
  } as CSSProperties;

  return (
    <div data-testid="skirmish" className="skirmish-screen" style={screenStyle}>
      {/* Title bar lives in the app shell now; the in-game live status portals into its
          center section (turn/objective read from the game store, in scope here). The
          brand + account cluster are rendered by the shell bar itself. */}
      <TitleBarSlot region="center">
        <div className="skirmish-topbar-status">
          <div className="skirmish-status-chip skirmish-turn-plate">
            <strong>{turnLabel}</strong>
            <small>{game.winner ? 'Skirmish Complete' : 'Live Board'}</small>
          </div>
          <div className="skirmish-status-chip skirmish-objective">
            <span className="skirmish-icon skirmish-icon-flag" aria-hidden="true" />
            <span>
              <strong>Objective</strong>
              <small>{routeLevel ? OBJECTIVE_COPY[routeLevel.objective] : 'Capture the enemy King'}</small>
            </span>
          </div>
        </div>
      </TitleBarSlot>

      <section className="skirmish-war-room" aria-label="Skirmish battlefield">
        <div className="skirmish-field">
          <div className="skirmish-board-frame">
            {boardSettled ? <SkirmishBoard /> : null}
          </div>
        </div>
      </section>
      <SkirmishHud />

      {isCampaignPlay && routeLevel && game.winner && (
        <div className="campaign-result" role="dialog" aria-modal="true" aria-label="Battle result" data-testid="campaign-result">
          <div className="settings-frame campaign-result-panel">
            <h2>{game.winner === 'player' ? 'Victory' : game.winner === 'draw' ? 'Stalemate' : 'Defeat'}</h2>
            {game.winner === 'player' && <ResultStars count={stars} />}
            <p>{routeLevel.name} — {OBJECTIVE_COPY[routeLevel.objective]}</p>
            <div className="campaign-result-actions">
              <button type="button" className="app-header-button" onClick={replayLevel}>
                {game.winner === 'player' ? 'Replay' : 'Retry'}
              </button>
              <a className="app-header-button app-header-button-active" href={`/campaign/${routeCampaignId}`}>
                {game.winner === 'player' ? 'Continue' : 'Back to Campaign'}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
