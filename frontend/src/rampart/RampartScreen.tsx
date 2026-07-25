import { useEffect, useRef } from 'react';
import { Application, Graphics, Text } from 'pixi.js';
import { createGameLoop, STEP_MS } from './loop';
import {
  BTN_A,
  DPAD_DOWN,
  DPAD_LEFT,
  DPAD_RIGHT,
  DPAD_UP,
  applyDeadzone,
  claimPads,
  createRepeater,
  justPressed,
  snapshotPads,
  stepRepeater,
  type PadSnapshot,
  type Repeater,
} from './input';
import { advancePhase, createPhaseState, type PhaseState } from './phases';
import { GRID_COLS, GRID_ROWS, TILE_PX, inBounds } from './board';

// Crenellation's play surface: a Pixi canvas driven by the fixed-timestep
// loop, outside React's render path (same imperative pattern as
// stack-probe/PixiStage). React owns mount/unmount; the loop owns everything
// else. This screen is the engine bring-up skeleton — grid, two pad-claimed
// cursors, phase HUD — that the actual game grows inside.

const PLAYER_COLORS = [0x5ee2ff, 0xffa14e];

interface PlayerState {
  col: number;
  row: number;
  repeater: Repeater;
  pulseMs: number;
}

export function Rampart() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const app = new Application();
    let cancelled = false;
    let loop: ReturnType<typeof createGameLoop> | null = null;

    void (async () => {
      await app.init({
        width: GRID_COLS * TILE_PX,
        height: GRID_ROWS * TILE_PX,
        background: '#141a14',
        antialias: false,
      });
      if (cancelled) {
        app.destroy(true);
        return;
      }
      host.appendChild(app.canvas);

      const grid = new Graphics();
      for (let c = 0; c <= GRID_COLS; c += 1) {
        grid.moveTo(c * TILE_PX, 0).lineTo(c * TILE_PX, GRID_ROWS * TILE_PX);
      }
      for (let r = 0; r <= GRID_ROWS; r += 1) {
        grid.moveTo(0, r * TILE_PX).lineTo(GRID_COLS * TILE_PX, r * TILE_PX);
      }
      grid.stroke({ color: 0x233223, width: 1, pixelLine: true });
      app.stage.addChild(grid);

      const cursors = PLAYER_COLORS.map((color) => {
        const g = new Graphics();
        g.rect(1, 1, TILE_PX - 2, TILE_PX - 2).stroke({ color, width: 2 });
        g.visible = false;
        app.stage.addChild(g);
        return g;
      });

      const hud = new Text({
        text: '',
        style: { fill: 0xd8e8d8, fontFamily: 'monospace', fontSize: 14 },
      });
      hud.position.set(8, 6);
      app.stage.addChild(hud);

      // --- simulation state (loop-owned, never React state) ---
      let claimed: (number | null)[] = [null, null];
      let prevPads: (PadSnapshot | null)[] = [];
      let phase: PhaseState = createPhaseState();
      const players: PlayerState[] = [
        { col: Math.floor(GRID_COLS / 4), row: Math.floor(GRID_ROWS / 2), repeater: createRepeater(), pulseMs: 0 },
        { col: Math.floor((3 * GRID_COLS) / 4), row: Math.floor(GRID_ROWS / 2), repeater: createRepeater(), pulseMs: 0 },
      ];

      const update = (dtMs: number): void => {
        const pads = snapshotPads();
        claimed = claimPads(claimed, pads);
        phase = advancePhase(phase, dtMs).state;

        players.forEach((player, i) => {
          const padIndex = claimed[i];
          if (padIndex === null) return;
          const pad = pads[padIndex] ?? null;
          const prev = prevPads[padIndex] ?? null;
          if (!pad) return;

          const [ax, ay] = applyDeadzone(pad.axes[0], pad.axes[1]);
          const dirX = (pad.buttons[DPAD_RIGHT] ? 1 : 0) - (pad.buttons[DPAD_LEFT] ? 1 : 0) || Math.sign(ax);
          const dirY = (pad.buttons[DPAD_DOWN] ? 1 : 0) - (pad.buttons[DPAD_UP] ? 1 : 0) || Math.sign(ay);
          const steps = stepRepeater(player.repeater, dirX, dirY, dtMs);
          for (let s = 0; s < steps; s += 1) {
            const nc = player.col + dirX;
            const nr = player.row + dirY;
            if (inBounds(nc, player.row)) player.col = nc;
            if (inBounds(player.col, nr)) player.row = nr;
          }

          // Placeholder action: A pulses the cursor. Becomes place/fire/rotate
          // per phase once the game rules land.
          if (justPressed(prev, pad, BTN_A)) player.pulseMs = 200;
          player.pulseMs = Math.max(0, player.pulseMs - dtMs);
        });

        prevPads = pads;
      };

      const render = (): void => {
        players.forEach((player, i) => {
          const cursor = cursors[i];
          cursor.visible = claimed[i] !== null;
          cursor.position.set(player.col * TILE_PX, player.row * TILE_PX);
          cursor.alpha = player.pulseMs > 0 ? 0.4 + 0.6 * (player.pulseMs / 200) : 1;
        });
        const seats = claimed
          .map((c, i) => (c === null ? `P${i + 1}: press any button` : `P${i + 1}: pad ${c}`))
          .join('   ');
        hud.text = `round ${phase.round}  ${phase.phase.toUpperCase()} ${(phase.remainingMs / 1000).toFixed(1)}s   ${seats}`;
      };

      loop = createGameLoop({ stepMs: STEP_MS, update, render });
      loop.start();
    })();

    return () => {
      cancelled = true;
      loop?.stop();
      try {
        app.destroy(true);
      } catch {
        // init had not completed; nothing to tear down.
      }
    };
  }, []);

  return (
    <div
      ref={hostRef}
      data-testid="rampart-screen"
      style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: '#0b0e0b' }}
    />
  );
}
