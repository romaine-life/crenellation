import { useEffect, useState } from 'react';
import { useSkirmish } from '../game/store';
import { useSkirmishView } from '../game/skirmishView';
import { livingPieces } from '../core/rules';
import { PIECE_LABEL, PIECE_MARK, PALETTE_FOR_SIDE, isPlayablePieceType, pieceSpritePath } from '../core/pieces';
import type { Piece, PieceType, Side } from '../core/types';
import { DEFAULT_BACKGROUND_SET } from '../art/backgroundSets';
// One shared "unit portrait box" (master render + crop + the fill-frame) — the Selected-Unit
// portrait AND the roster slots both render through it, so framing/fill/crop are defined once and
// never re-derived per surface. See docs/portrait-contract.md.
import { UnitPortrait, loadCrops, STORAGE_KEY, type Piece as PortraitPiece, type Palette as PortraitPalette } from './PortraitEditor';
import { PRODUCTION_PORTRAIT_METHOD } from './portraitCandidates';

const TYPE_LABEL = PIECE_LABEL;

const ROLE: Record<PieceType, string> = {
  pawn: 'Forward footman',
  knight: 'L-shaped jumper',
  bishop: 'Diagonal runner',
  rook: 'Orthogonal siege keep',
  queen: 'Promoted raider',
  king: 'Royal commander',
  rock: 'Impassable obstacle',
  'random-rock': 'Impassable obstacle',
};

const MARK = PIECE_MARK;

type HudTab = 'unit' | 'roster' | 'log' | 'view' | 'controls';

const HUD_TABS: { id: HudTab; label: string }[] = [
  { id: 'unit', label: 'Unit' },
  { id: 'roster', label: 'Roster' },
  { id: 'log', label: 'Log' },
  { id: 'view', label: 'View' },
  { id: 'controls', label: 'Controls' },
];

function unitSprite(piece: Piece | null): string | null {
  if (!piece || piece.side === 'neutral' || !isPlayablePieceType(piece.type)) return null;
  return pieceSpritePath(piece.type, PALETTE_FOR_SIDE[piece.side], piece.facing);
}

/** Whole numbers print bare; fractional distances print to one decimal (6.5). */
function fmtStat(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function hpText(piece: Piece | null): string {
  if (!piece) return '--';
  const hp = piece.hp ?? 1;
  const maxHp = piece.maxHp ?? hp;
  return `${hp} / ${maxHp}`;
}

function apText(piece: Piece | null): string {
  if (!piece) return '--';
  const ap = piece.ap ?? 1;
  const maxAp = piece.maxAp ?? ap;
  return `${ap} / ${maxAp}`;
}

function UnitBadge({ piece, large = false }: { piece: Piece | null; large?: boolean }) {
  const side = piece?.side ?? 'neutral';
  const label = piece ? MARK[piece.type] : '?';
  const src = unitSprite(piece);
  return (
    <span className={`skirmish-unit-badge ${side} ${large ? 'large' : ''}`.trim()} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : label}
    </span>
  );
}

function CountPip({ side, count }: { side: Side; count: number }) {
  return (
    <span className={`skirmish-count-pip ${side}`}>
      <span className={`skirmish-icon skirmish-icon-rook-${side === 'enemy' ? 'red' : 'blue'}`} aria-hidden="true" />
      <strong>{count}</strong>
    </span>
  );
}

export function SkirmishHud() {
  const game = useSkirmish((s) => s.game);
  const selectedId = useSkirmish((s) => s.selectedId);
  const focusedId = useSkirmish((s) => s.focusedId);
  const log = useSkirmish((s) => s.log);
  const newSkirmish = useSkirmish((s) => s.newSkirmish);
  const select = useSkirmish((s) => s.select);
  const focus = useSkirmish((s) => s.focus);

  const [tab, setTab] = useState<HudTab>('unit');

  // Portrait crops come from the SAME source the editor writes (localStorage), so the HUD bust
  // matches the editor live; re-read when the editor saves in another tab.
  const [portraitCrops, setPortraitCrops] = useState(loadCrops);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) setPortraitCrops(loadCrops()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const showMoves = useSkirmishView((s) => s.showMoves);
  const showEnemyAttacks = useSkirmishView((s) => s.showEnemyAttacks);
  const showBlocked = useSkirmishView((s) => s.showBlocked);
  const zoom = useSkirmishView((s) => s.zoom);
  const toggleOverlay = useSkirmishView((s) => s.toggle);
  const setZoom = useSkirmishView((s) => s.setZoom);
  const resetView = useSkirmishView((s) => s.resetView);

  const selected = game.pieces.find((p) => p.id === selectedId && p.alive) ?? null;
  const focused = game.pieces.find((p) => p.id === focusedId && p.alive) ?? selected;
  const playerPieces = livingPieces(game.pieces, 'player');
  const enemyPieces = livingPieces(game.pieces, 'enemy');
  const logLines = log.length ? log.slice(0, 16) : ['Skirmish begins — capture the enemy King.'];
  const focusedPortraitBackdrop = focused && isPlayablePieceType(focused.type) ? DEFAULT_BACKGROUND_SET.portraits[focused.type] : null;
  const turnLabel = game.winner
    ? game.winner === 'draw' ? 'Stalemate' : game.winner === 'player' ? 'Victory' : 'Defeat'
    : game.turn === 'player' ? 'Your turn' : 'Enemy turn';

  return (
    <aside data-testid="skirmish-hud" className="skirmish-hud" aria-label="Skirmish command HUD">
      <section className="skirmish-score-panel" aria-label="Turn summary">
        <div>
          <span className="skirmish-eyebrow">Status</span>
          <strong data-testid="turn-label">{turnLabel}</strong>
        </div>
        <div className="skirmish-counts" aria-label="Remaining forces">
          <CountPip side="player" count={playerPieces.length} />
          <CountPip side="enemy" count={enemyPieces.length} />
        </div>
      </section>

      <div className="skirmish-hud-tabs" role="tablist" aria-label="HUD sections">
        {HUD_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`skirmish-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`skirmish-panel-${t.id}`}
            className={`skirmish-hud-tab ${tab === t.id ? 'active' : ''}`.trim()}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        className="skirmish-hud-panel"
        role="tabpanel"
        id={`skirmish-panel-${tab}`}
        aria-labelledby={`skirmish-tab-${tab}`}
      >
        {tab === 'unit' && (
          <section className="skirmish-card skirmish-selected-card" aria-label="Selected unit">
            <h2>Selected Unit</h2>
            <div className="skirmish-selected-body">
              {focused && isPlayablePieceType(focused.type) ? (
                <UnitPortrait
                  piece={focused.type as PortraitPiece}
                  palette={PALETTE_FOR_SIDE[focused.side] as PortraitPalette}
                  crop={portraitCrops[focused.type as PortraitPiece]}
                  backdrop={focusedPortraitBackdrop}
                  className="unit-portrait--hud"
                  method={PRODUCTION_PORTRAIT_METHOD}
                />
              ) : (
                <div className="unit-portrait unit-portrait--hud" style={{ display: 'grid', placeItems: 'center' }}>
                  <UnitBadge piece={focused} large />
                </div>
              )}
              <div className="skirmish-selected-copy">
                <strong data-testid="selected-name">{focused ? TYPE_LABEL[focused.type] : 'None'}</strong>
                <span>{focused ? `${focused.side === 'enemy' ? 'Enemy' : focused.side === 'player' ? 'Blue' : 'Neutral'} - ${ROLE[focused.type]}` : 'Choose a unit on the board.'}</span>
                <dl>
                  <div>
                    <dt>HP</dt>
                    <dd><span>{hpText(focused)}</span></dd>
                  </div>
                  <div>
                    <dt>AP</dt>
                    <dd><span>{apText(focused)}</span></dd>
                  </div>
                </dl>
              </div>
            </div>
            {focused && (focused.side === 'player' || focused.side === 'enemy') && (
              <div className="skirmish-service-record">
                <h3>Service Record</h3>
                <dl>
                  <div><dt>Used</dt><dd>{focused.timesUsed ?? 0}</dd></div>
                  <div><dt>Dist</dt><dd>{fmtStat(focused.squaresTraveled ?? 0)}</dd></div>
                  <div><dt>Kills</dt><dd>{focused.enemiesKilled ?? 0}</dd></div>
                  <div><dt>Escapes</dt><dd>{focused.escapes ?? 0}</dd></div>
                  <div><dt>Threats</dt><dd>{focused.threatsMade ?? 0}</dd></div>
                </dl>
              </div>
            )}
          </section>
        )}

        {tab === 'roster' && (
          <section className="skirmish-card skirmish-roster-card" aria-label="Roster">
            <h2>Roster</h2>
            <div className="skirmish-roster-rows">
              {[playerPieces, enemyPieces].map((pieces, row) => (
                <div className="skirmish-roster-strip" key={row === 0 ? 'player' : 'enemy'}>
                  {pieces.map((piece) => (
                    <button
                      key={piece.id}
                      type="button"
                      className={`skirmish-roster-slot ${piece.id === focused?.id ? 'active' : ''}`.trim()}
                      onClick={() => piece.side === 'player' ? select(piece.id) : focus(piece.id)}
                      aria-label={`${piece.side} ${TYPE_LABEL[piece.type]}`}
                    >
                      {isPlayablePieceType(piece.type) ? (
                        <UnitPortrait
                          piece={piece.type as PortraitPiece}
                          palette={PALETTE_FOR_SIDE[piece.side] as PortraitPalette}
                          crop={portraitCrops[piece.type as PortraitPiece]}
                          className="unit-portrait--roster"
                          method={PRODUCTION_PORTRAIT_METHOD}
                        />
                      ) : (
                        <UnitBadge piece={piece} />
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'log' && (
          <section className="skirmish-card skirmish-log-card" aria-label="Event log">
            <h2>Event Log</h2>
            <ul>
              {logLines.map((line, i) => (
                <li key={`${line}-${i}`}>
                  <span aria-hidden="true" />
                  <strong>T{Math.max(1, logLines.length - i)}</strong>
                  <em>{line}</em>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'view' && (
          <section className="skirmish-card skirmish-view-card" aria-label="Board view">
            <h2>Board View</h2>
            <div className="skirmish-view-group">
              <span className="skirmish-eyebrow">Zoom</span>
              <div className="skirmish-view-row">
                <button type="button" className="app-header-button" onClick={() => setZoom(zoom - 0.1)} aria-label="Zoom out">−</button>
                <span className="skirmish-zoom-readout">{Math.round(zoom * 100)}%</span>
                <button type="button" className="app-header-button" onClick={() => setZoom(zoom + 0.1)} aria-label="Zoom in">+</button>
                <button type="button" className="app-header-button" onClick={resetView}>Reset</button>
              </div>
            </div>
            <div className="skirmish-view-group">
              <span className="skirmish-eyebrow">Overlays</span>
              <div className="skirmish-view-row">
                <button type="button" className={`app-header-button ${showMoves ? 'app-header-button-active' : ''}`.trim()} onClick={() => toggleOverlay('showMoves')} aria-pressed={showMoves}>Moves</button>
                <button type="button" className={`app-header-button ${showEnemyAttacks ? 'app-header-button-active' : ''}`.trim()} onClick={() => toggleOverlay('showEnemyAttacks')} aria-pressed={showEnemyAttacks}>Attacks</button>
                <button type="button" className={`app-header-button ${showBlocked ? 'app-header-button-active' : ''}`.trim()} onClick={() => toggleOverlay('showBlocked')} aria-pressed={showBlocked}>Blocks</button>
              </div>
            </div>
          </section>
        )}

        {tab === 'controls' && (
          <section className="skirmish-card skirmish-controls-card" aria-label="Page controls">
            <h2>Controls</h2>
            <div className="skirmish-view-group">
              <span className="skirmish-eyebrow">Match</span>
              <div className="skirmish-view-row">
                <button
                  type="button"
                  className="app-header-button"
                  data-testid="new-skirmish"
                  onClick={() => newSkirmish({ seed: Date.now() & 0x7fffffff })}
                >
                  New skirmish
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
