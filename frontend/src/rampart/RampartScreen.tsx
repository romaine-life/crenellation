import { useEffect, useRef } from 'react';
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { createGameLoop, STEP_MS } from './loop';
import { BOARD_H, BOARD_W, GRID_COLS, GRID_ROWS, TILE_PX, cellAt, idx } from './board';
import { PHASE_LABEL } from './phases';
import {
  ATTRACT,
  BATTLEFIELDS,
  Jukebox,
  MUSIC,
  artUrl,
  attractFrameAt,
  type Screen,
} from './screens';
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

const C_WALL = 0xb9b9c8;
const C_WALL_DARK = 0x7a7a8a;
const C_RUBBLE = 0x6b6b57;
const C_CASTLE = 0x2b2bd0;
const C_CANNON = 0x303038;
const C_TERRITORY = 0x2b2bd0;
const C_SHIP = 0xc03030;
const C_OK = 0x8fffa0;
const C_BAD = 0xff6060;

// 21x15 cells of 16px = 336x240, exactly the arcade's visible screen, so every
// captured frame drops in 1:1.
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
        height: BOARD_H * SCALE + 52,
        background: '#000000',
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

      // Full-screen arcade art (attract frames, select screens, terrain).
      const backdrop = new Sprite();
      backdrop.width = BOARD_W;
      backdrop.height = BOARD_H;
      world.addChild(backdrop);

      const objLayer = new Container();
      const territoryG = new Graphics();
      const piecesG = new Graphics();
      const overlayG = new Graphics();
      world.addChild(territoryG, objLayer, piecesG, overlayG);

      // Reuse sprites frame to frame rather than rebuilding the scene graph.
      const pool: Sprite[] = [];
      let poolUsed = 0;
      const putTile = (name: string, x: number, y: number) => {
        const tex = objTex.get(name);
        if (!tex) return false;
        let sp = pool[poolUsed];
        if (!sp) {
          sp = new Sprite();
          pool.push(sp);
          objLayer.addChild(sp);
        }
        sp.texture = tex;
        sp.position.set(x, y);
        sp.visible = true;
        poolUsed += 1;
        return true;
      };

      const hud = new Text({ text: '', style: { fill: 0xe6f0e6, fontFamily: 'monospace', fontSize: 13 } });
      hud.position.set(8, BOARD_H * SCALE + 4);
      app.stage.addChild(hud);

      const hint = new Text({ text: '', style: { fill: 0x87a087, fontFamily: 'monospace', fontSize: 11 } });
      hint.position.set(8, BOARD_H * SCALE + 26);
      app.stage.addChild(hint);

      const banner = new Text({
        text: '',
        style: { fill: 0xffffff, fontFamily: 'monospace', fontSize: 11, align: 'center' },
      });
      banner.anchor.set(0.5, 1);
      banner.position.set((BOARD_W * SCALE) / 2, BOARD_H * SCALE - 6);
      app.stage.addChild(banner);

      // Preload every screen so transitions never flash an empty frame.
      const textures = new Map<string, Texture>();
      // Object sprites cut from real arcade frames (walls, cannon, castle, tree).
      const OBJ_ORDER = ['wall_h', 'wall_v', 'wall_x', 'cannon', 'castle', 'tree'];
      const objTex = new Map<string, Texture>();
      const loadObjects = async () => {
        try {
          const base: Texture = await Assets.load(artUrl('objects'));
          OBJ_ORDER.forEach((name, i) => {
            objTex.set(
              name,
              new Texture({
                source: base.source,
                frame: new Rectangle(i * TILE_PX, 0, TILE_PX, TILE_PX),
              }),
            );
          });
        } catch {
          /* fall back to drawn shapes */
        }
      };

      const preload = async () => {
        const names = [...ATTRACT.map((f) => f.name), 'screen-select', 'screen-difficulty', ...BATTLEFIELDS];
        await Promise.all(
          names.map(async (n) => {
            try {
              textures.set(n, await Assets.load(artUrl(n)));
            } catch {
              /* keep going; a missing frame just isn't drawn */
            }
          }),
        );
      };
      await preload();
      await loadObjects();

      let screen: Screen = 'attract';
      let screenMs = 0;
      let selectIndex = 0;
      let credits = 0;
      let game: GameState = createGame(BATTLEFIELDS[0]);
      let hoverCol = Math.floor(GRID_COLS / 2);
      let hoverRow = Math.floor(GRID_ROWS / 2);
      const jukebox = new Jukebox();

      const setBackdrop = (name: string | null) => {
        const tex = name ? textures.get(name) : undefined;
        backdrop.visible = !!tex;
        if (tex) backdrop.texture = tex;
      };

      const toCell = (ev: PointerEvent | WheelEvent) => {
        const rect = app.canvas.getBoundingClientRect();
        const sx = (ev.clientX - rect.left) / (rect.width / (BOARD_W * SCALE));
        const sy = (ev.clientY - rect.top) / (rect.height / (BOARD_H * SCALE));
        return {
          col: Math.max(0, Math.min(GRID_COLS - 1, Math.floor(sx / (TILE_PX * SCALE)))),
          row: Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(sy / (TILE_PX * SCALE)))),
          fx: sx / (TILE_PX * SCALE),
          fy: sy / (TILE_PX * SCALE),
        };
      };

      const startGame = () => {
        game = createGame(BATTLEFIELDS[selectIndex], Math.floor(Math.random() * 1e9));
        screen = 'play';
        screenMs = 0;
      };

      const onMove = (ev: PointerEvent) => {
        const p = toCell(ev);
        hoverCol = p.col;
        hoverRow = p.row;
        if (screen === 'select') {
          // Sweep across the screen to choose, like rolling the trackball.
          selectIndex = Math.min(
            BATTLEFIELDS.length - 1,
            Math.max(0, Math.floor((p.fx / GRID_COLS) * BATTLEFIELDS.length)),
          );
        }
      };

      const onDown = (ev: PointerEvent) => {
        ev.preventDefault();
        const p = toCell(ev);
        if (ev.button === 2) {
          if (screen === 'play') rotatePiece(game);
          return;
        }
        if (screen === 'attract') {
          credits += 1;
          jukebox.play(MUSIC.attract);
          screen = 'select';
          screenMs = 0;
          return;
        }
        if (screen === 'select') {
          startGame();
          return;
        }
        if (screen === 'gameover') {
          screen = 'attract';
          screenMs = 0;
          return;
        }
        if (game.phase.phase === 'build') placePiece(game, p.col, p.row);
        else if (game.phase.phase === 'place') placeCannon(game, p.col, p.row);
        else fireAt(game, p.fx, p.fy);
      };

      const onWheel = (ev: WheelEvent) => {
        ev.preventDefault();
        if (screen === 'play') rotatePiece(game);
        if (screen === 'select') {
          selectIndex = (selectIndex + (ev.deltaY > 0 ? 1 : BATTLEFIELDS.length - 1)) % BATTLEFIELDS.length;
        }
      };
      const onContext = (ev: Event) => ev.preventDefault();

      app.canvas.addEventListener('pointermove', onMove);
      app.canvas.addEventListener('pointerdown', onDown);
      app.canvas.addEventListener('wheel', onWheel, { passive: false });
      app.canvas.addEventListener('contextmenu', onContext);

      // --- wall drawing: stone blocks with joins, so runs read as walls ------
      const drawWall = (c: number, r: number) => {
        const x = c * TILE_PX;
        const y = r * TILE_PX;
        piecesG.rect(x + 1, y + 1, TILE_PX - 2, TILE_PX - 2).fill({ color: C_WALL });
        piecesG.rect(x + 1, y + 1, TILE_PX - 2, 2).fill({ color: 0xdcdce8 });
        piecesG.rect(x + 1, y + TILE_PX - 3, TILE_PX - 2, 2).fill({ color: C_WALL_DARK });
        // Fill the seam toward any neighbouring wall so a run looks continuous.
        const near = (dc: number, dr: number) => cellAt(game.board, c + dc, r + dr)?.occupant === 'wall';
        if (near(1, 0)) piecesG.rect(x + TILE_PX - 2, y + 3, 3, TILE_PX - 6).fill({ color: C_WALL });
        if (near(-1, 0)) piecesG.rect(x - 1, y + 3, 3, TILE_PX - 6).fill({ color: C_WALL });
        if (near(0, 1)) piecesG.rect(x + 3, y + TILE_PX - 2, TILE_PX - 6, 3).fill({ color: C_WALL });
        if (near(0, -1)) piecesG.rect(x + 3, y - 1, TILE_PX - 6, 3).fill({ color: C_WALL });
      };

      const drawBoard = () => {
        territoryG.clear();
        piecesG.clear();
        for (const sp of pool) sp.visible = false;
        poolUsed = 0;
        for (let r = 0; r < GRID_ROWS; r += 1) {
          for (let c = 0; c < GRID_COLS; c += 1) {
            const cell = cellAt(game.board, c, r);
            if (!cell) continue;
            const x = c * TILE_PX;
            const y = r * TILE_PX;
            if (game.board.territory[idx(c, r)] === 0) {
              territoryG.rect(x, y, TILE_PX, TILE_PX).fill({ color: C_TERRITORY, alpha: 0.2 });
            }
            if (cell.occupant === 'wall') {
              // Pick the tile that matches how this wall connects to its run.
              const near = (dc: number, dr: number) =>
                cellAt(game.board, c + dc, r + dr)?.occupant === 'wall';
              const horiz = near(1, 0) || near(-1, 0);
              const vert = near(0, 1) || near(0, -1);
              const name = horiz && vert ? 'wall_x' : vert ? 'wall_v' : 'wall_h';
              if (!putTile(name, x, y)) drawWall(c, r);
            }
            else if (cell.occupant === 'rubble') {
              piecesG.rect(x + 4, y + 5, TILE_PX - 8, TILE_PX - 9).fill({ color: C_RUBBLE });
            } else if (cell.occupant === 'castle') {
              if (!putTile('castle', x, y)) {
                piecesG.rect(x, y, TILE_PX, TILE_PX).fill({ color: C_CASTLE });
                piecesG.rect(x + 3, y + 3, TILE_PX - 6, TILE_PX - 6).fill({ color: 0xf0f0ff });
              }
            } else if (cell.occupant === 'cannon') {
              if (!putTile('cannon', x, y)) {
                piecesG.circle(x + TILE_PX / 2, y + TILE_PX / 2, TILE_PX / 2 - 2).fill({ color: C_CANNON });
              }
            }
          }
        }
        for (const ship of game.ships) {
          piecesG.rect(ship.x * TILE_PX - 7, ship.y * TILE_PX - 4, 15, 9).fill({ color: C_SHIP });
          piecesG.rect(ship.x * TILE_PX - 1, ship.y * TILE_PX - 9, 2, 6).fill({ color: 0xe0e0e0 });
        }
      };

      const drawOverlay = () => {
        overlayG.clear();
        if (game.phase.phase === 'build' && !game.over) {
          const ok = canPlace(game, hoverCol, hoverRow);
          for (const [dx, dy] of game.pieceCells) {
            const x = (hoverCol + dx) * TILE_PX;
            const y = (hoverRow + dy) * TILE_PX;
            overlayG.rect(x + 1, y + 1, TILE_PX - 2, TILE_PX - 2).fill({ color: ok ? C_OK : C_BAD, alpha: 0.5 });
          }
        } else if (game.phase.phase === 'place' && !game.over) {
          const legal =
            game.board.territory[idx(hoverCol, hoverRow)] === 0 &&
            cellAt(game.board, hoverCol, hoverRow)?.occupant === 'empty';
          overlayG
            .circle(hoverCol * TILE_PX + TILE_PX / 2, hoverRow * TILE_PX + TILE_PX / 2, TILE_PX / 2 - 2)
            .fill({ color: legal ? C_OK : C_BAD, alpha: 0.45 });
        } else if (!game.over) {
          overlayG
            .circle(hoverCol * TILE_PX + TILE_PX / 2, hoverRow * TILE_PX + TILE_PX / 2, 5)
            .stroke({ color: 0xffffff, width: 1 });
        }
        for (const shot of game.shots) {
          const p = shotPosition(shot);
          const h = shotHeight(shot) * 10;
          overlayG.circle(p.x * TILE_PX, p.y * TILE_PX, 2).fill({ color: 0x000000, alpha: 0.35 });
          overlayG
            .circle(p.x * TILE_PX, p.y * TILE_PX - h, 3)
            .fill({ color: shot.owner === 0 ? 0xffe08a : 0xff9090 });
        }
      };

      const render = () => {
        if (screen === 'attract') {
          setBackdrop(attractFrameAt(screenMs).name);
          territoryG.clear();
          piecesG.clear();
          overlayG.clear();
          hud.text = `CREDITS: ${credits}`;
          hint.text = 'click to insert coin';
          banner.text = 'INSERT COIN';
          return;
        }
        if (screen === 'select') {
          setBackdrop('screen-select');
          territoryG.clear();
          piecesG.clear();
          overlayG.clear();
          hud.text = `CREDITS: ${credits}   BATTLEFIELD ${selectIndex + 1} / ${BATTLEFIELDS.length}`;
          hint.text = 'move to choose a battlefield, click to begin';
          banner.text = 'SELECT BATTLEFIELD';
          return;
        }

        setBackdrop(game.mapId);
        drawBoard();
        drawOverlay();
        banner.text = '';
        const secs = Math.max(0, game.phase.remainingMs / 1000).toFixed(1);
        if (game.over) {
          hud.text = `${game.message}   SCORE ${game.score}`;
          hint.text = 'click to return to attract';
        } else {
          const extra =
            game.phase.phase === 'place'
              ? `  cannons ${game.cannonsPlaced}/${cannonAllowance(game)}`
              : game.phase.phase === 'build'
                ? `  piece ${game.piece.name}`
                : '';
          hud.text = `ROUND ${game.phase.round}  ${PHASE_LABEL[game.phase.phase]}  ${secs}s${extra}   SCORE ${game.score}`;
          hint.text = 'move: mouse   place/fire: left click   rotate: right click / scroll';
        }
      };

      loop = createGameLoop({
        stepMs: STEP_MS,
        update: (dt) => {
          screenMs += dt;
          if (screen === 'play') {
            update(game, dt);
            jukebox.play(game.phase.phase === 'battle' ? MUSIC.battle : MUSIC.build);
            if (game.over && screenMs > 1500) screen = 'play';
          }
        },
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
        /* init had not completed */
      }
    };
  }, []);

  return (
    <div
      ref={hostRef}
      data-testid="rampart-screen"
      style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: '#000' }}
    />
  );
}
