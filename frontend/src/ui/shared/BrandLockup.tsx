import { type ReactElement } from 'react';

// The single brand lockup in the top-left of every screen. The game wordmark is the
// persistent header — it's the dominant line on every page — with the screen name as
// the small line beneath it. Same mark, same structure, same spot everywhere; only
// `screenName` changes. DOM order is brand-then-name so it reads and renders top-down
// without any reordering. This is the one source; do not hand-roll a per-screen brand
// mark. Links home, like a logo should.
export function BrandLockup({ screenName }: { screenName: string }): ReactElement {
  return (
    <a className="brand-lockup" href="/" aria-label={`${screenName} — Chess Tactics home`}>
      <img className="brand-lockup-mark" src="/assets/ui/kit/icons/brand-shield.png" alt="" aria-hidden="true" />
      <span className="brand-lockup-copy">
        <em>Chess Tactics</em>
        <strong>{screenName}</strong>
      </span>
    </a>
  );
}
