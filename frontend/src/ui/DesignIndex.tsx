import type { CSSProperties } from 'react';

const link: CSSProperties = { color: 'var(--ds-accent)' };

// Design hub. The legacy app.js carried an elaborate asset catalog/glossary/
// widget gallery; those dev-only surfaces are retired with app.js. The live,
// DB-backed design portfolio remains the review surface.
export function DesignIndex() {
  return (
    <div data-testid="design-index" style={{ padding: '32px clamp(20px,6vw,80px)', color: 'var(--ds-ink-2)', fontFamily: 'var(--ds-font-sans)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontFamily: 'var(--ds-font-serif)', color: 'var(--ds-ink)', margin: 0 }}>Design</h1>
        <a href="/" style={{ ...link, textDecoration: 'none' }}>← Menu</a>
      </div>
      <p style={{ color: 'var(--ds-ink-3)', maxWidth: 560 }}>
        The component styleguide lives in the running surfaces (<a href="/play" style={link}>skirmish</a>,
        {' '}<a href="/edit" style={link}>level editor</a>, <a href="/campaigns-next" style={link}>campaign editor</a>).
        The acceptance portfolio is persisted server-side (<code>/api/design-portfolios</code>).
      </p>
    </div>
  );
}
