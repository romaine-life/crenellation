import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import { createGameLoop, STEP_MS } from './loop';
import { BOARD_H, BOARD_W, GRID_COLS, GRID_ROWS, TILE_PX, cellAt, idx } from './board';
import { PHASE_LABEL } from './phases';
import {
  cannonAllowance,
  canPlace,
  createGame,
  fireAt,
  placeCannon,
  placePiece,
  rotatePiece,
  shotHeight,
  shotPosition,
  update,
  type GameState,
} from './game';

// Colours picked to read like the arcade: grass green, sea blue, stone walls.
const C_LAND = 0x2f8f2f;
const C_LAND_ALT = 0x2a802a;
const C_WATER = 0x2f5fb8;
const C_WALL = 0xb9b9c8;
const C_RUBBLE = 0x6b6b57;
const C_CASTLE = 0x2b2bd0;
const C_CANNON = 0x303038;
const C_TERRITORY = 0x2b2bd0;
const C_SHIP = 0xc03030;
const C_OK = 0x8fffa0;
const C_BAD = 0xff6060;

const SCALE = 2;

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
        width: BOARD_W * SCALE,
        height: BOARD_H * SCALE + 56,
        background: '#101410',
        antialias: false,
      });
      if (cancelled) {
        app.destroy(true);
        return;
      }
      host.appendChild(app.canvas);

      const world = new Container();
      world.scale.set(SCALE);
      app.stage.addChild(world);

      const terrainG = new Graphics();
      const piecesG = new Graphics();
      const overlayG = new Graphics();
      world.addChild(terrainG, piecesG, overlayG);

      const hud = new Text({
        text: '',
        style: { fill: 0xe6f0e6, fontFamily: 'monospace', fontSize: 13 },
      });
      hud.position.set(8, BOARD_H * SCALE + 6);
      app.stage.addChild(hud);

      const hint = new Text({
        text: 'move: mouse   place: left click   rotate: right click / scroll',
        style: { fill: 0x87a087, fontFamily: 'monospace', fontSize: 11 },
      });
      hint.position.set(8, BOARD_H * SCALE + 28);
      app.stage.addChild(hint);

      let game: GameState = createGame('map1');
      let hoverCol = Math.floor(GRID_COLS / 2);
      let hoverRow = Math.floor(GRID_ROWS / 2);

      const toCell = (ev: PointerEvent | WheelEvent) => {
        const rect = app.canvas.getBoundingClientRect();
        const sx = (ev.clientX - rect.left) / (rect.width / (BOARD_W * SCALE));
        const sy = (ev.clientY - rect.top) / (rect.height / (BOARD_H * SCALE));
        return {
          col: Math.floor(sx / (TILE_PX * SCALE)),
          row: Math.floor(sy / (TILE_PX * SCALE)),
          fx: sx / (TILE_PX * SCALE),
          fy: sy / (TILE_PX * SCALE),
        };
      };

      const onMove = (ev: PointerEvent) => {
        const p = toCell(ev);
        hoverCol = Math.max(0, Math.min(GRID_COLS - 1, p.col));
        hoverRow = Math.max(0, Math.min(GRID_ROWS - 1, p.row));
      };
      const onDown = (ev: PointerEvent) => {
        ev.preventDefault();
        const p = toCell(ev);
        if (ev.button === 2) {
          rotatePiece(game);
          return;
        }
        if (game.over) {
          game = createGame(game.mapId, Math.floor(Math.random() * 1e9));
          return;
        }
        if (game.phase.phase === 'build') placePiece(game, p.col, p.row);
        else if (game.phase.phase === 'place') placeCannon(game, p.col, p.row);
        else fireAt(game, p.fx, p.fy);
      };
      const onWheel = (ev: WheelEvent) => {
        ev.preventDefault();
        rotatePiece(game);
      };
      const onContext = (ev: Event) => ev.preventDefault();

      app.canvas.addEventListener('pointermove', onMove);
      app.canvas.addEventListener('pointerdown', onDown);
      app.canvas.addEventListener('wheel', onWheel, { passive: false });
      app.canvas.addEventListener('contextmenu', onContext);

      const drawTerrain = () => {
        terrainG.clear();
        for (let r = 0; r < GRID_ROWS; r += 1) {
          for (let c = 0; c < GRID_COLS; c += 1) {
            const cell = cellAt(game.board, c, r);
            if (!cell) continue;
            const x = c * TILE_PX;
            const y = r * TILE_PX;
            let colour = cell.terrain === 'water' ? C_WATER : (c + r) % 2 ? C_LAND : C_LAND_ALT;
            terrainG.rect(x, y, TILE_PX, TILE_PX).fill({ color: colour });
            if (game.board.territory[idx(c, r)] === 0 && cell.terrain === 'land') {
              terrainG.rect(x, y, TILE_PX, TILE_PX).fill({ color: C_TERRITORY, alpha: 0.22 });
            }
          }
        }
      };

      const drawPieces = () => {
        piecesG.clear();
        for (let r = 0; r < GRID_ROWS; r += 1) {
          for (let c = 0; c < GRID_COLS; c += 1) {
            const cell = cellAt(game.board, c, r);
            if (!cell) continue;
            const x = c * TILE_PX;
            const y = r * TILE_PX;
            if (cell.occupant === 'wall') {
              piecesG.rect(x + 1, y + 1, TILE_PX - 2, TILE_PX - 2).fill({ color: C_WALL });
            } else if (cell.occupant === 'rubble') {
              piecesG.rect(x + 4, y + 4, TILE_PX - 8, TILE_PX - 8).fill({ color: C_RUBBLE });
            } else if (cell.occupant === 'castle') {
              piecesG.rect(x, y, TILE_PX, TILE_PX).fill({ color: C_CASTLE });
              piecesG.rect(x + 4, y + 4, TILE_PX - 8, TILE_PX - 8).fill({ color: 0xf0f0ff });
            } else if (cell.occupant === 'cannon') {
              piecesG.circle(x + TILE_PX / 2, y + TILE_PX / 2, TILE_PX / 2 - 2).fill({ color: C_CANNON });
            }
          }
        }
        for (const ship of game.ships) {
          piecesG
            .rect(ship.x * TILE_PX - 6, ship.y * TILE_PX - 4, 14, 9)
            .fill({ color: C_SHIP });
        }
      };

      const drawOverlay = () => {
        overlayG.clear();

        if (game.phase.phase === 'build' && !game.over) {
          const ok = canPlace(game, hoverCol, hoverRow);
          for (const [dx, dy] of game.pieceCells) {
            const x = (hoverCol + dx) * TILE_PX;
            const y = (hoverRow + dy) * TILE_PX;
            overlayG.rect(x + 1, y + 1, TILE_PX - 2, TILE_PX - 2).fill({ color: ok ? C_OK : C_BAD, alpha: 0.55 });
          }
        } else if (game.phase.phase === 'place' && !game.over) {
          const legal =
            game.board.territory[idx(hoverCol, hoverRow)] === 0 &&
            cellAt(game.board, hoverCol, hoverRow)?.occupant === 'empty';
          overlayG
            .circle(hoverCol * TILE_PX + TILE_PX / 2, hoverRow * TILE_PX + TILE_PX / 2, TILE_PX / 2 - 2)
            .fill({ color: legal ? C_OK : C_BAD, alpha: 0.5 });
        } else if (!game.over) {
          overlayG
            .circle(hoverCol * TILE_PX + TILE_PX / 2, hoverRow * TILE_PX + TILE_PX / 2, 4)
            .stroke({ color: 0xffffff, width: 1 });
        }

        for (const shot of game.shots) {
          const p = shotPosition(shot);
          const h = shotHeight(shot) * 10;
          overlayG
            .circle(p.x * TILE_PX, p.y * TILE_PX, 2)
            .fill({ color: 0x000000, alpha: 0.35 });
          overlayG
            .circle(p.x * TILE_PX, p.y * TILE_PX - h, 3)
            .fill({ color: shot.owner === 0 ? 0xffe08a : 0xff9090 });
        }
      };

      const render = () => {
        drawTerrain();
        drawPieces();
        drawOverlay();
        const secs = Math.max(0, game.phase.remainingMs / 1000).toFixed(1);
        const extra =
          game.phase.phase === 'place'
            ? `  cannons ${game.cannonsPlaced}/${cannonAllowance(game)}`
            : game.phase.phase === 'build'
              ? `  piece ${game.piece.name}`
              : '';
        hud.text = game.over
          ? `${game.message}   score ${game.score}   — click to play again`
          : `round ${game.phase.round}  ${PHASE_LABEL[game.phase.phase]}  ${secs}s${extra}   score ${game.score}   ${game.message}`;
      };

      loop = createGameLoop({
        stepMs: STEP_MS,
        update: (dt) => update(game, dt),
        render,
      });
      loop.start();
    })();

    return () => {
      cancelled = true;
      loop?.stop();
      try {
        app.destroy(true);
      } catch {
        // init had not completed
      }
    };
  }, []);

  return (
    <div
      ref={hostRef}
      data-testid="rampart-screen"
      style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: '#0a0d0a' }}
    />
  );
}
