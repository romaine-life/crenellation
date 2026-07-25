import { useState } from 'react';
import { PixiStage } from './PixiStage';
import { probeVersion } from './version';

// Phase 0 walking skeleton: a single island exercising all three new layers
// (TypeScript module + React state + PixiJS canvas) inside the running app.
export function StackProbe() {
  const [clicks, setClicks] = useState(0);

  return (
    <section
      data-testid="stack-probe"
      style={{
        padding: 24,
        color: '#f2eee4',
        fontFamily: 'system-ui, sans-serif',
        position: 'relative',
        zIndex: 5,
        pointerEvents: 'auto',
      }}
    >
      <h2 style={{ color: '#d2805c', margin: '0 0 8px' }}>Stack probe — TS · React · Pixi</h2>
      <p style={{ margin: '0 0 4px' }}>
        TypeScript module reports: <strong data-testid="ts-value">{probeVersion()}</strong>
      </p>
      <p style={{ margin: '0 0 16px' }}>
        React state:{' '}
        <button type="button" data-testid="react-button" onClick={() => setClicks((c) => c + 1)}>
          clicked {clicks}×
        </button>
      </p>
      <PixiStage />
    </section>
  );
}
