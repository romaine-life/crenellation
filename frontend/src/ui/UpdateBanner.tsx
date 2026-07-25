import { type ReactElement } from 'react';
import { useNewBuildAvailable } from '../net/appUpdate';

// A quiet, non-blocking prompt shown when a newer build has been deployed while
// this tab was open. Lets the user update on their terms before they navigate
// into a chunk the old build no longer has. Renders nothing until then.
export function UpdateBanner(): ReactElement | null {
  const available = useNewBuildAvailable();
  if (!available) return null;
  return (
    <div className="app-update-banner" role="status" aria-live="polite">
      <span>A new version of Chess Tactics is available.</span>
      <button type="button" onClick={() => window.location.reload()}>Refresh</button>
    </div>
  );
}
