import { useEffect, useRef } from 'react';
import { Application, Graphics } from 'pixi.js';

// Proves PixiJS v8 renders, using the canonical "imperative Pixi inside a React
// effect" pattern (the canvas lives outside React's render path).
export function PixiStage() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const app = new Application();
    let cancelled = false;

    void (async () => {
      await app.init({ width: 320, height: 180, background: '#1b1814', antialias: false });
      if (cancelled) return;
      host.appendChild(app.canvas);
      const diamond = new Graphics();
      diamond
        .poly([160, 40, 250, 90, 160, 140, 70, 90])
        .fill({ color: 0x6cc0ff })
        .stroke({ color: 0xffffff, width: 2 });
      app.stage.addChild(diamond);
    })();

    return () => {
      cancelled = true;
      try {
        app.destroy(true);
      } catch {
        // init had not completed; nothing to tear down.
      }
    };
  }, []);

  return <div ref={hostRef} data-testid="pixi-stage" />;
}
