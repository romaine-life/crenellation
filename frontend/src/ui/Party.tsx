import { useEffect, useState } from 'react';
import { PLAYABLE_PIECE_TYPES, type PlayablePieceType } from '../core/pieces';
import { AmbienceBackground } from './AmbienceBackground';

const OPTIONS = PLAYABLE_PIECE_TYPES.filter((piece) => piece !== 'pawn');

function PieceIcon({ type }: { type: PlayablePieceType }) {
  return <span className={`utility-piece-icon icon-${type}`} aria-hidden="true" />;
}

// Squad picker (ported from legacy app.js): pawn is locked; choose two more
// pieces, then deploy into a skirmish. Wears the shared standard title bar
// (ADR-0004/0023) as a settings-twin; the pick-progress line moves into the body.
export function Party() {
  const [picks, setPicks] = useState<PlayablePieceType[]>([]);
  const toggle = (p: PlayablePieceType) => setPicks((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : cur.length < 2 ? [...cur, p] : cur);

  useEffect(() => {
    const shell = document.querySelector('.shell');
    shell?.classList.add('settings-art-active');
    return () => shell?.classList.remove('settings-art-active');
  }, []);

  return (
    <section className="settings-art-route" aria-label="Party" data-testid="party">
      <AmbienceBackground />
      <div className="settings-screen utility-twin-screen app-shell-bar-pad">
        <div className="utility-screen utility-party">
          <section className="utility-panel">
            <p className="utility-lead">Pawn is locked in. Choose two more ({picks.length}/2).</p>
            <div className="utility-squad-grid">
              <span className="utility-squad-card is-selected is-locked">
                <PieceIcon type="pawn" />
                <strong>Pawn</strong>
                <small>Locked</small>
              </span>
              {OPTIONS.map((p) => (
                <button key={p} type="button" data-testid={`party-${p}`} className={`utility-squad-card ${picks.includes(p) ? 'is-selected' : ''}`.trim()} onClick={() => toggle(p)}>
                  <PieceIcon type={p} />
                  <strong>{p}</strong>
                  <small>{picks.includes(p) ? 'Selected' : 'Available'}</small>
                </button>
              ))}
            </div>
          </section>
          <div className="utility-actions">
            <a
              href="/play"
              data-testid="party-deploy"
              aria-disabled={picks.length !== 2}
              className={`utility-button utility-button-primary ${picks.length === 2 ? '' : 'is-disabled'}`.trim()}
            >Deploy</a>
            <a href="/" className="utility-button utility-button-neutral">Menu</a>
          </div>
        </div>
      </div>
    </section>
  );
}
