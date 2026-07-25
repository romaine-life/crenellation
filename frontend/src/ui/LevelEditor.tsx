// The standalone Level Editor (/level-editor, /edit). Split out of TilePreview.tsx so
// it ships its own small lazy chunk instead of dragging the entire design Studio:
// the heavy library studios + manifests live in TilePreview.tsx and are never
// imported here. Shared board core (tile families, the animation clock, the facing
// compass, the per-frame src) comes from ./studioBoard.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { boardLabCellPosition } from '../render/BoardLabBoard';
import { DoodadSprite } from '../render/BoardDoodad';
import { PropSprite } from '../render/BoardStructure';
import { PROP_DEFS, propCells, propDef, type PropDef, type PropKind } from '../core/props';
import { TileGrid, type TileGridCell } from '../render/TileGrid';
import { studioBoardSprites, studioCellArt } from '../render/StudioReadOnlyBoard';
import { KitScroll } from './KitScroll';
import { ViewPane } from './shared/ViewPane';
import { TitleBarSlot } from './shell/TitleBarSlot';
import { Stepper } from './shared/Stepper';
import { Toggle } from './shared/Toggle';
import { BoardSizePanel } from './shared/BoardSizePanel';
import { doodadAsset, DOODAD_ASSETS, type DoodadAsset } from './doodadCatalog';
import { readBoardParam, encodeBoard, type EditorBoard, type FeatureCell } from './boardCode';
import { DEFAULT_BACKGROUND_SET } from '../art/backgroundSets';
import {
  hasDirectionSprite,
  productionUnitAssets,
  rookDirections,
  unitAssets,
  type Direction,
  type Faction,
  type UnitAsset,
} from './unitCatalog';
import {
  studioFamilies,
  useAnimationClock,
  FacingCompass,
  type StudioAsset,
  type StudioFamily,
} from './studioBoard';
import { featureThumbSrc } from '../art/tileset';
import { featureMaskAt, roadEdgeKey, FEATURE_DIRS, featureMaterials, defaultFeatureMaterial, FEATURE_MATERIAL_LABELS, FENCE_ART_PENDING, type FeatureKind, type FeatureMaterial } from '../core/featureAutotile';
import { type TileFamilyId } from '../core/tileSockets';
import { generateSocketBoard } from '../core/tileBoardGenerator';
import { GroundCoverLayer } from '../render/GroundCoverLayer';
import { groundCoverSet, rollGroundCover, type GroundCover, type GroundCoverDensity } from '../core/groundCover';
import { UNIT_PALETTES, type UnitPalette } from '../core/pieces';
import { useCampaigns } from '../campaign/store';
import { ensureCampaignsHydrated } from '../campaign/hydrate';
import { editorBoardToLevel, levelToEditorBoard } from '../core/levelBoard';
import { tierOf, saveUserWorkspace, publishOfficialWorkspace, mapSaveError } from '../campaign/save';
import { fetchMe, goSignIn, type AuthUser } from '../net/auth';

type BoardUnitPlacement = {
  unitId: string;
  direction: Direction;
  faction: Faction;
};

// Unified editable board: every Studio view renders through this. It's a full
// clickable grid seeded from whatever was loaded (a tile, a transition, a
// generated board). The `tool` decides what a click does — select (highlight),
// brush (stamp), or erase. Purely in-memory, so it resets when a new view loads.
function StudioEditableBoard({
  cols,
  rows,
  cells: placed,
  units: placedUnits,
  doodads: placedDoodads,
  props: placedProps = {},
  features: placedFeatures = {},
  resolveAsset,
  resolveUnit,
  resolveDoodad,
  resolveProp,
  tool,
  selectedCell,
  showFootprint,
  boardZoom,
  boardPan,
  animationFrame,
  onPaint,
  onErase,
  onSelect,
  onMove,
  canMoveTo,
  propBrush,
  overlay,
  hidden,
}: {
  cols: number;
  rows: number;
  cells: Record<string, string>;
  units: Record<string, BoardUnitPlacement>;
  doodads: Record<string, { doodadId: string }>;
  /** Multi-cell props keyed by ANCHOR cell "x,y" -> {propId}. */
  props?: Record<string, { propId: string }>;
  /** Linear-feature overlays (roads + rivers) keyed by "x,y" -> {kind, material, mask}. */
  features?: Record<string, { kind: FeatureKind; material: FeatureMaterial; mask: number }>;
  resolveAsset: (id: string) => StudioAsset | undefined;
  resolveUnit: (id: string) => UnitAsset | undefined;
  resolveDoodad: (id: string) => DoodadAsset | undefined;
  resolveProp: (id: string) => PropDef | undefined;
  tool: 'select' | 'brush' | 'erase' | 'move';
  selectedCell: { x: number; y: number } | null;
  showFootprint: boolean;
  boardZoom: number;
  boardPan: { x: number; y: number };
  animationFrame: number;
  onPaint: (x: number, y: number) => void;
  onErase: (x: number, y: number) => void;
  onSelect: (x: number, y: number) => void;
  /** Move tool: drag a placed unit from one cell to another (drop cancelled if omitted). */
  onMove?: (from: { x: number; y: number }, to: { x: number; y: number }) => void;
  /** Move tool: whether a held unit may drop on (x,y) — drives the destination ring's colour. */
  canMoveTo?: (x: number, y: number) => boolean;
  /** When the prop brush is armed: its def + a placeability test, used for the footprint hover. */
  propBrush?: { def: PropDef; canPlaceAt: (ax: number, ay: number) => boolean } | null;
  overlay?: ReactNode;
  /** Per-layer visibility — a true value hides that layer's elements on the board. */
  hidden?: { tile: boolean; unit: boolean; doodad: boolean };
}): ReactElement {
  const paintingRef = useRef(false);
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null);
  // The unit picked up under the Move tool (its source cell), held while the pointer drags to a
  // destination. It's state (not a ref) so the source/target highlights re-render as you drag.
  const [movingFrom, setMovingFrom] = useState<{ x: number; y: number } | null>(null);
  const applyTool = (x: number, y: number) => {
    if (tool === 'brush') onPaint(x, y);
    else if (tool === 'erase') onErase(x, y);
    else if (tool === 'move') { /* handled via drag in the pointer handlers below */ }
    else onSelect(x, y);
  };
  // End a pointer interaction: drop a held unit at the cell under the cursor (a no-op if it's the
  // same cell or off-board), then clear the paint/move latches. Fired on pointer-up over the board.
  const endInteraction = () => {
    if (movingFrom) {
      if (hoverCell && !(hoverCell.x === movingFrom.x && hoverCell.y === movingFrom.y)) onMove?.(movingFrom, hoverCell);
      setMovingFrom(null);
    }
    paintingRef.current = false;
  };

  // The editor is an adapter over the shared StudioReadOnlyBoard render path (the same cell
  // art + sprite seating the Campaign Editor's read-only viewer uses): it supplies the SHARED
  // tile/feature art via `studioCellArt`, then layers its own interaction chrome — the selection
  // ring and the paint/erase/select hit target — on top per cell.
  const cells: TileGridCell[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const key = `${x},${y}`;
      const assetId = placed[key];
      const asset = assetId ? resolveAsset(assetId) : undefined;
      const isSelected = selectedCell?.x === x && selectedCell?.y === y;
      // Move-tool feedback reuses the built-in diamond tile-ring (not an axis-aligned box): the
      // picked-up unit's cell, plus the cell under the cursor tinted by whether a drop is legal.
      const isMoveFrom = tool === 'move' && movingFrom?.x === x && movingFrom?.y === y;
      const isMoveTo = tool === 'move' && !!movingFrom && !isMoveFrom && hoverCell?.x === x && hoverCell?.y === y;
      const moveDroppable = isMoveTo && (canMoveTo ? canMoveTo(x, y) : true);
      cells.push({
        key,
        x,
        y,
        className: `tileset-placement-cell ${asset ? '' : 'is-empty'} ${isSelected ? 'is-selected' : ''}`.trim(),
        children: (
          <>
            {/* Fences are PLUMBING-ONLY (no baked mask art yet): don't pass a fence feature to
                studioCellArt, or featureFrameSrc would 404. They render no image until art ships —
                see FENCE_ART_PENDING. */}
            {studioCellArt({ tileAsset: asset, feature: placedFeatures[key]?.kind === 'fence' ? undefined : placedFeatures[key], animationFrame, hidden, x, y })}
            {isSelected ? <span className="tileset-cell-ring" aria-hidden="true" /> : null}
            {isMoveFrom ? <span className="tileset-cell-ring is-move-from" aria-hidden="true" /> : null}
            {isMoveTo ? <span className={`tileset-cell-ring ${moveDroppable ? 'is-move-ok' : 'is-move-blocked'}`} aria-hidden="true" /> : null}
            <span
              className="tileset-cell-hit"
              onPointerDown={(event) => {
                if (event.button === 2) return; // right-click erases via onContextMenu
                event.stopPropagation(); // don't let the ViewPane start a pan while editing
                if (tool === 'move') {
                  // Pick up a unit to drag — only if one sits here; empty cells aren't grabbable.
                  if (placedUnits[`${x},${y}`]) { setMovingFrom({ x, y }); setHoverCell({ x, y }); }
                  return;
                }
                if (tool !== 'select') paintingRef.current = true;
                applyTool(x, y);
              }}
              onPointerEnter={() => { setHoverCell({ x, y }); if (paintingRef.current) applyTool(x, y); }}
              onContextMenu={(event) => { event.preventDefault(); onErase(x, y); }}
            />
          </>
        ),
      });
    }
  }

  // Units + doodads render at GRID level via the SHARED seat (.board-unit-seat) and the
  // shared <DoodadSprite> through `studioBoardSprites` — exactly the same seating the read-only
  // viewer uses, so they can't drift. The editor injects a transparent doodad hit target
  // alongside each prop: the doodad stands UP above its foot cell and the shared sprite is
  // pointer-events:none, so clicking the visible body would otherwise fall through to the cell
  // behind it. The hit routes the tool to the doodad's OWN cell; transparent in brush mode so
  // painting still flows to the tiles underneath, catching clicks only while erasing/selecting.
  const overlaySprites: ReactNode[] = studioBoardSprites({
    units: placedUnits,
    doodads: placedDoodads,
    resolveUnit,
    resolveDoodad,
    hidden,
    renderDoodadExtra: ({ x: cx, y: cy, left, top, zIndex }) => (
      <span
        key={`dd-hit-${cx},${cy}`}
        className="tileset-doodad-hit"
        style={{ position: 'absolute', left, top, zIndex: zIndex + 20002, width: 54, height: 88, transform: 'translate(-50%, -75%)', pointerEvents: tool === 'brush' || tool === 'move' ? 'none' : 'auto' }}
        onPointerDown={(event) => {
          if (event.button === 2) return;
          event.stopPropagation();
          if (tool !== 'select') paintingRef.current = true;
          applyTool(cx, cy);
        }}
        onContextMenu={(event) => { event.preventDefault(); onErase(cx, cy); }}
      />
    ),
  });

  // Multi-cell props: the tall PropSprite (back/front halves) seated over its footprint, plus a
  // Studio-only hit target spanning the footprint's screen bbox so a click on the prop body routes
  // select/erase to the OWNING ANCHOR (the shared sprite is pointer-events:none, so otherwise the
  // click falls through to whatever cell is behind it).
  for (const [key, placement] of Object.entries(placedProps)) {
    const def = resolveProp(placement.propId);
    if (!def) continue; // unknown prop id — skip (matches the renderer/collision skip)
    const [ax, ay] = key.split(',').map(Number);
    overlaySprites.push(<PropSprite key={`prop-${key}`} prop={{ x: ax, y: ay, propId: placement.propId }} def={def} />);
    // Footprint screen bbox: project all footprint cell centres, take their extent, pad to the
    // diamond half-width/height. zIndex above the front-most cell's sprite so clicks land on it.
    const cells = propCells(ax, ay, def);
    const pts = cells.map((c) => boardLabCellPosition(c));
    const minLeft = Math.min(...pts.map((p) => p.left));
    const maxLeft = Math.max(...pts.map((p) => p.left));
    const minTop = Math.min(...pts.map((p) => p.top));
    const maxTop = Math.max(...pts.map((p) => p.top));
    const frontZ = (ax + def.w - 1) + (ay + def.h - 1) + 20000;
    overlaySprites.push(
      <span
        key={`prop-hit-${key}`}
        className="tileset-doodad-hit"
        style={{
          position: 'absolute',
          left: minLeft,
          top: minTop,
          zIndex: frontZ + 2,
          width: (maxLeft - minLeft) + 96,
          height: (maxTop - minTop) + 96,
          transform: 'translate(-50%, -75%)',
          pointerEvents: tool === 'brush' || tool === 'move' ? 'none' : 'auto',
        }}
        onPointerDown={(event) => {
          if (event.button === 2) return;
          event.stopPropagation();
          if (tool !== 'select') paintingRef.current = true;
          applyTool(ax, ay);
        }}
        onContextMenu={(event) => { event.preventDefault(); onErase(ax, ay); }}
      />,
    );
  }

  // Footprint hover preview for the prop brush: outline every cell the prop would occupy under the
  // cursor (placeable vs blocked), and ghost the PropSprite at the anchor so the author sees both
  // where it lands and what it looks like before committing.
  if (propBrush && tool === 'brush' && hoverCell) {
    const { def } = propBrush;
    const placeable = propBrush.canPlaceAt(hoverCell.x, hoverCell.y);
    for (const c of propCells(hoverCell.x, hoverCell.y, def)) {
      if (c.x < 0 || c.x >= cols || c.y < 0 || c.y >= rows) continue;
      const { left, top, zIndex } = boardLabCellPosition(c);
      overlaySprites.push(
        <span
          key={`prop-ghostcell-${c.x},${c.y}`}
          className={`le-prop-ghost-cell ${placeable ? 'is-ok' : 'is-blocked'}`}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left,
            top,
            zIndex: zIndex + 19000,
            width: 96,
            height: 55,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            outline: `2px solid ${placeable ? 'rgba(80,220,140,.95)' : 'rgba(240,90,90,.95)'}`,
            background: placeable ? 'rgba(80,220,140,.18)' : 'rgba(240,90,90,.18)',
          }}
        />,
      );
    }
    overlaySprites.push(
      <span key="prop-ghost-sprite" aria-hidden="true" style={{ opacity: placeable ? 0.65 : 0.3, position: 'absolute', left: 0, top: 0 }}>
        <PropSprite prop={{ x: hoverCell.x, y: hoverCell.y, propId: def.id }} def={def} />
      </span>,
    );
  }

  return (
    <TileGrid
      cells={cells}
      className={`tileset-placement-board is-tool-${tool}`}
      ariaLabel="Editable tile board"
      showFootprint={showFootprint}
      boardZoom={boardZoom}
      boardPan={boardPan}
      onPointerUp={endInteraction}
      onPointerLeave={() => { setMovingFrom(null); paintingRef.current = false; setHoverCell(null); }}
    >
      {overlay}
      {overlaySprites}
    </TileGrid>
  );
}

// ---------------------------------------------------------------------------
// Level Editor (front-of-house). The functional Studio Lab board, re-dressed as
// a literal sibling of the Skirmish page: it reuses the real .skirmish-screen /
// .skirmish-war-room / .skirmish-field / .skirmish-board-frame / .skirmish-hud /
// .skirmish-card chrome (so it IS the same game), with the proven
// StudioEditableBoard inside, and the editor controls in .skirmish-card rail
// sections. M1 = the shell + tile painting; units/doodads/persistence land in
// later milestones. The Studio Lab (TilesetStudio) is untouched — this duplicates
// its board logic for now; a shared hook will dedupe them once it has settled.
// ---------------------------------------------------------------------------
const LE_COLS = 10;
const LE_ROWS = 10;
const leGrassFamily = studioFamilies.find((family) => family.id === 'grass') ?? studioFamilies[0];
const leDefaultTile = leGrassFamily.assets.find((asset) => asset.kind === 'tile') ?? leGrassFamily.assets[0];
const leTileGroups = studioFamilies.map((family) => ({ family, tiles: family.assets.filter((asset) => asset.kind === 'tile') }));
const leTileAssets = leTileGroups.flatMap(({ tiles }) => tiles);
const leFamilyAssets = studioFamilies.reduce((acc, family) => {
  acc[family.id] = family.assets.filter((asset) => asset.kind === 'tile');
  return acc;
}, {} as Record<TileFamilyId, readonly StudioAsset[]>);
const leAllTiles = studioFamilies.flatMap((family) => family.assets);
const leFamilyOfTile = (id: string): StudioFamily | undefined => studioFamilies.find((family) => family.assets.some((asset) => asset.id === id));
const leSeedBoard = (): Record<string, string> => {
  const cells: Record<string, string> = {};
  for (let y = 0; y < LE_ROWS; y += 1) for (let x = 0; x < LE_COLS; x += 1) cells[`${x},${y}`] = leDefaultTile.id;
  return cells;
};
const LE_FACTION_LABELS: Record<UnitPalette, string> = {
  'navy-blue': 'Navy',
  crimson: 'Crimson',
  golden: 'Golden',
  emerald: 'Emerald',
};
const leUnitAssets = productionUnitAssets.length ? productionUnitAssets : unitAssets;

// A stable fingerprint of an editor board, the basis of the real dirty flag: encodeBoard is
// deterministic + lossless, so two boards encode identically iff they're the same board.
const boardSignature = (board: EditorBoard): string => encodeBoard(board);
const cloneEditorBoard = (board: EditorBoard): EditorBoard => structuredClone(board) as EditorBoard;
const HISTORY_LIMIT = 100;
const LEVEL_EDITOR_LAYER_OPTIONS = [
  { id: 'board', label: 'Board' },
  { id: 'tile', label: 'Tile' },
  { id: 'road', label: 'Road' },
  { id: 'river', label: 'River' },
  { id: 'fence', label: 'Fence' },
  { id: 'unit', label: 'Unit' },
  { id: 'doodad', label: 'Doodad' },
  { id: 'prop', label: 'Prop' },
  { id: 'cover', label: 'Cover' },
] as const;
type LevelEditorLayer = typeof LEVEL_EDITOR_LAYER_OPTIONS[number]['id'];
type LevelEditorBrushKind = Exclude<LevelEditorLayer, 'board'>;
const defaultLevelEditorLayer = (): LevelEditorLayer => LEVEL_EDITOR_LAYER_OPTIONS[0].id;
const brushKindForLayer = (editorLayer: LevelEditorLayer): LevelEditorBrushKind => editorLayer === 'board' ? 'tile' : editorLayer;
const toolForLayer = (editorLayer: LevelEditorLayer): 'select' | 'brush' => editorLayer === 'board' ? 'select' : 'brush';

// The 4-edge connection control for a selected feature tile. Mirrors the iso diamond:
// each edge is one cardinal neighbour (grid N/E/S/W = the screen NE/SE/SW/NW edges).
// Every edge is clickable and toggles the SHARED edge, so both tiles re-cap together:
//   • a SAME-KIND neighbour → joined (solid cyan) ↔ cut (dashed amber): sever / rejoin.
//   • NO same-kind neighbour (board boundary or a non-feature tile) → none (dim) ↔ exit
//     (solid green): force the ribbon to run OFF that edge instead of capping.
// Roads only connect to roads, rivers to rivers.
function FeatureConnections({
  cell,
  kind,
  features,
  cuts,
  exits,
  onToggle,
  onToggleExit,
}: {
  cell: { x: number; y: number };
  kind: FeatureKind;
  features: Record<string, FeatureCell>;
  cuts: Record<string, true>;
  exits: Record<string, true>;
  onToggle: (edge: string) => void;
  onToggleExit: (edge: string) => void;
}): ReactElement {
  const kindLabel = kind === 'river' ? 'river' : 'road';
  // Diamond geometry (viewBox 128x96): apex, right, bottom, left vertices.
  const V = { apex: [64, 14], right: [114, 48], bottom: [64, 82], left: [14, 48] } as const;
  const EDGE_GEO: Record<string, readonly [readonly [number, number], readonly [number, number]]> = {
    N: [V.apex, V.right],
    E: [V.right, V.bottom],
    S: [V.bottom, V.left],
    W: [V.left, V.apex],
  };
  return (
    <svg className="le-roadconn" viewBox="0 0 128 96" role="group" aria-label={`${kindLabel} connections for the selected tile`}>
      <polygon points={`${V.apex} ${V.right} ${V.bottom} ${V.left}`} fill="rgba(8,20,28,.55)" stroke="rgba(82,142,170,.35)" strokeWidth="1" />
      {FEATURE_DIRS.map((dir) => {
        const nx = cell.x + dir.dx;
        const ny = cell.y + dir.dy;
        const hasNeighbor = features[`${nx},${ny}`]?.kind === kind; // only same-kind neighbours connect
        const edge = roadEdgeKey(cell.x, cell.y, nx, ny);
        const severed = cuts[edge] === true;
        const exited = exits[edge] === true;
        const [[x1, y1], [x2, y2]] = EDGE_GEO[dir.edge];
        // With a neighbour: joined ↔ cut. Without one: none ↔ exit (forced outward stub).
        const state = hasNeighbor ? (severed ? 'cut' : 'joined') : exited ? 'exit' : 'none';
        const stroke =
          state === 'joined' ? 'var(--skirmish-cyan, #38d7ff)'
          : state === 'cut' ? '#f0a23a'
          : state === 'exit' ? '#67d98a'
          : 'rgba(120,150,165,.35)';
        const toggle = (): void => (hasNeighbor ? onToggle(edge) : onToggleExit(edge));
        const label =
          state === 'joined' ? `Sever ${dir.edge} ${kindLabel} connection`
          : state === 'cut' ? `Rejoin ${dir.edge} ${kindLabel} connection`
          : state === 'exit' ? `Close ${dir.edge} edge — stop running the ${kindLabel} off it`
          : `Run the ${kindLabel} off the ${dir.edge} edge`;
        return (
          <g
            key={dir.edge}
            className={`le-roadconn-edge is-${state}`}
            role="button"
            aria-label={label}
            aria-pressed={state === 'cut' || state === 'exit'}
            tabIndex={0}
            onClick={toggle}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
          >
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth="20" strokeLinecap="round" />
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth="6" strokeLinecap="round" strokeDasharray={state === 'cut' ? '5 5' : undefined} />
          </g>
        );
      })}
    </svg>
  );
}

export function LevelEditor(): ReactElement {
  const animationFrame = useAnimationClock(true, 8, 150);
  // The Studio routes here with ?from=studio (show a "back to catalog" link) and optionally
  // ?kind=tile|unit|doodad&brush=<id> to pre-arm the brush you clicked in the catalog. Read
  // once at mount; reached from the main menu these are all absent and we open on the first layer.
  const studioArm = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const kindParam = params.get('kind');
    const kind: 'tile' | 'unit' | 'doodad' | undefined =
      kindParam === 'unit' || kindParam === 'doodad' || kindParam === 'tile' ? kindParam : undefined;
    return {
      fromStudio: params.get('from') === 'studio',
      kind,
      brush: params.get('brush') ?? undefined,
    };
  }, []);
  const cameFromStudio = studioArm.fromStudio;
  const initialLayer = studioArm.kind ?? defaultLevelEditorLayer();
  // The campaign path deep-links here with ?campaignId&levelId (&returnTo): which level to
  // edit, and where "Back" returns after a save. Read once at mount; absent ⇒ a standalone
  // (board-link / blank) board with no campaign target.
  const routeParams = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      campaignId: params.get('campaignId') ?? undefined,
      levelId: params.get('levelId') ?? undefined,
      returnTo: params.get('returnTo') ?? undefined,
    };
  }, []);
  // Optional `?board=<code>` deep-link: decode a whole board to start from (see boardCode.ts).
  // It takes precedence over a campaign level (it's the explicit "inspect this exact board").
  const loadedBoard = useMemo(() => readBoardParam(), []);
  const [boardCells, setBoardCells] = useState<Record<string, string>>(() => loadedBoard?.cells ?? leSeedBoard());
  const [boardCols, setBoardCols] = useState(loadedBoard?.cols ?? LE_COLS);
  const [boardRows, setBoardRows] = useState(loadedBoard?.rows ?? LE_ROWS);
  const [playerFaction, setPlayerFaction] = useState<UnitPalette | null>(() =>
    (loadedBoard?.playerFaction && (UNIT_PALETTES as readonly string[]).includes(loadedBoard.playerFaction)) ? loadedBoard.playerFaction as UnitPalette : null,
  );
  const [tool, setTool] = useState<'select' | 'brush' | 'erase' | 'move'>(toolForLayer(initialLayer));
  const [brushId, setBrushId] = useState<string>(studioArm.kind === 'tile' && studioArm.brush ? studioArm.brush : leDefaultTile.id);
  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(null);
  const [showFootprint, setShowFootprint] = useState(true);
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [brushKind, setBrushKind] = useState<LevelEditorBrushKind>(brushKindForLayer(initialLayer));
  const [layer, setLayer] = useState<LevelEditorLayer>(initialLayer);
  const [boardUnits, setBoardUnits] = useState<Record<string, BoardUnitPlacement>>((loadedBoard?.units as Record<string, BoardUnitPlacement>) ?? {});
  const [boardDoodads, setBoardDoodads] = useState<Record<string, { doodadId: string }>>(loadedBoard?.doodads ?? {});
  // Multi-cell props (trees/houses), keyed by ANCHOR cell. Seeded from a loaded board, else empty.
  const [boardProps, setBoardProps] = useState<Record<string, { propId: string }>>(loadedBoard?.props ?? {});
  const [propBrushId, setPropBrushId] = useState<string>(PROP_DEFS[0].id);
  // Ground cover is a per-tile FEATURE (density), not a doodad: which tiles grow vegetation
  // and how thick. Tufts are rolled deterministically from this density (see core/groundCover).
  const [boardCover, setBoardCover] = useState<Record<string, GroundCoverDensity>>(loadedBoard?.cover ?? {});
  const [coverBrushDensity, setCoverBrushDensity] = useState<GroundCoverDensity>('sparse');
  const [coverSeed, setCoverSeed] = useState(1234);
  // Roads and rivers are LINEAR features (ribbons you draw), not per-cell terrain materials:
  // store each painted cell's {kind, material}, then derive its connection mask from its
  // SAME-KIND neighbours so the renderer picks straight/corner/T/cross. One unified layer —
  // roads connect to roads, rivers to rivers, never to each other. See core/featureAutotile.ts.
  const [boardFeatures, setBoardFeatures] = useState<Record<string, FeatureCell>>(loadedBoard?.features ?? {});
  // The remembered brush material PER kind, so switching Road↔River keeps each picker's choice.
  const [featureBrushMaterial, setFeatureBrushMaterial] = useState<Record<FeatureKind, FeatureMaterial>>({
    road: defaultFeatureMaterial('road'),
    river: defaultFeatureMaterial('river'),
    fence: defaultFeatureMaterial('fence'),
  });
  // Manually SEVERED feature connections, keyed by the shared edge between two cells
  // (roadEdgeKey, order-independent). A cut overrides auto-connect for BOTH tiles.
  const [featureCuts, setFeatureCuts] = useState<Record<string, true>>(loadedBoard?.featureCuts ?? {});
  // Forced outward stubs, the mirror of a cut: each keyed edge has NO same-kind neighbour but is
  // pushed to connect anyway, so the ribbon runs off the board edge (or into a non-feature tile)
  // instead of capping. Same edge keying as cuts (roadEdgeKey); the neighbour may be off-board.
  const [featureExits, setFeatureExits] = useState<Record<string, true>>(loadedBoard?.featureExits ?? {});
  // The active feature kind = the current layer when it's a feature layer, else null.
  const featureKind: FeatureKind | null = brushKind === 'road' || brushKind === 'river' || brushKind === 'fence' ? brushKind : null;
  const [unitBrushId, setUnitBrushId] = useState<string>(studioArm.kind === 'unit' && studioArm.brush ? studioArm.brush : leUnitAssets[0].id);
  const [doodadBrushId, setDoodadBrushId] = useState<string>(studioArm.kind === 'doodad' && studioArm.brush ? studioArm.brush : DOODAD_ASSETS[0].id);
  const [unitBrushDirection, setUnitBrushDirection] = useState<Direction>('south');
  const [unitFaction, setUnitFaction] = useState<UnitPalette>('navy-blue');
  const [undoStack, setUndoStack] = useState<EditorBoard[]>([]);
  const [redoStack, setRedoStack] = useState<EditorBoard[]>([]);

  // The level being edited (campaign path). `levelId` is the store key the Save writes back
  // through; `editingId` may differ once a cold board is saved (Phase 3). The name shows in
  // the title bar; `savedSig` is the board signature at last save, the basis of the dirty chip.
  const [editingId, setEditingId] = useState<string | undefined>(routeParams.levelId);
  const [levelName, setLevelName] = useState<string>('Untitled level');
  const [savedSig, setSavedSig] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [me, setMe] = useState<AuthUser | null>(null);

  // Who's signed in — for the publish confirm/label copy. The server's requireAdmin is the
  // real gate (a non-admin save of an official level fails closed → 403 surfaced below).
  useEffect(() => {
    let active = true;
    fetchMe().then((user) => { if (active) setMe(user); }).catch(() => {});
    return () => { active = false; };
  }, []);

  // Go full-bleed like Skirmish (is-immersive): #root owns the whole viewport so the
  // editor sits under only the persistent app-shell title bar, with no inset/gap.
  useEffect(() => {
    const shell = document.querySelector('.shell');
    shell?.classList.add('is-immersive');
    return () => shell?.classList.remove('is-immersive');
  }, []);

  // Cold deep-link / campaign path: hydrate the shared store (idempotent), then — unless a
  // `?board=` override was supplied — seed the board from the resolved level and mark it
  // clean. Falls through to the blank/board-link board when no level resolves.
  useEffect(() => {
    let active = true;
    void (async () => {
      await ensureCampaignsHydrated();
      if (!active || loadedBoard || !routeParams.levelId) return;
      const level = useCampaigns.getState().levels[routeParams.levelId];
      if (!level) return;
      const board = levelToEditorBoard(level);
      setBoardCols(board.cols);
      setBoardRows(board.rows);
      setBoardCells(board.cells);
      setBoardUnits(board.units as Record<string, BoardUnitPlacement>);
      setBoardDoodads(board.doodads);
      setBoardProps(board.props);
      setBoardCover(board.cover);
      setBoardFeatures(board.features);
      setFeatureCuts(board.featureCuts);
      setFeatureExits(board.featureExits);
      setPlayerFaction((board.playerFaction && (UNIT_PALETTES as readonly string[]).includes(board.playerFaction)) ? board.playerFaction as UnitPalette : null);
      setUndoStack([]);
      setRedoStack([]);
      setEditingId(level.id);
      setLevelName(level.name);
      setSavedSig(boardSignature(board));
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolveAsset = (id: string): StudioAsset | undefined => leAllTiles.find((asset) => asset.id === id);
  // The current painted board as a single EditorBoard — the one shape both the board link
  // and the level save serialize from, so they can never describe different boards.
  const currentEditorBoard = useMemo<EditorBoard>(
    () => ({ cols: boardCols, rows: boardRows, playerFaction, cells: boardCells, units: boardUnits, doodads: boardDoodads, props: boardProps, cover: boardCover, features: boardFeatures, featureCuts, featureExits }),
    [boardCols, boardRows, playerFaction, boardCells, boardUnits, boardDoodads, boardProps, boardCover, boardFeatures, featureCuts, featureExits],
  );
  const currentEditorBoardRef = useRef(currentEditorBoard);
  useEffect(() => { currentEditorBoardRef.current = currentEditorBoard; }, [currentEditorBoard]);
  const applyEditorBoard = (board: EditorBoard): void => {
    setBoardCols(board.cols);
    setBoardRows(board.rows);
    setBoardCells(board.cells);
    setBoardUnits(board.units as Record<string, BoardUnitPlacement>);
    setBoardDoodads(board.doodads);
    setBoardProps(board.props);
    setBoardCover(board.cover);
    setBoardFeatures(board.features);
    setFeatureCuts(board.featureCuts);
    setFeatureExits(board.featureExits);
    setPlayerFaction((board.playerFaction && (UNIT_PALETTES as readonly string[]).includes(board.playerFaction)) ? board.playerFaction as UnitPalette : null);
  };
  const commitEditorBoard = (next: EditorBoard, selection?: { x: number; y: number } | null): boolean => {
    const current = currentEditorBoardRef.current;
    if (boardSignature(next) === boardSignature(current)) return false;
    setUndoStack((prev) => [...prev, cloneEditorBoard(current)].slice(-HISTORY_LIMIT));
    setRedoStack([]);
    currentEditorBoardRef.current = next;
    applyEditorBoard(next);
    if (selection !== undefined) setSelectedCell(selection);
    return true;
  };
  const undoBoard = (): void => {
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    setRedoStack((next) => [cloneEditorBoard(currentEditorBoardRef.current), ...next].slice(0, HISTORY_LIMIT));
    setUndoStack((next) => next.slice(0, -1));
    const restored = cloneEditorBoard(prev);
    currentEditorBoardRef.current = restored;
    applyEditorBoard(restored);
    setSelectedCell(null);
  };
  const redoBoard = (): void => {
    const next = redoStack[0];
    if (!next) return;
    setUndoStack((prev) => [...prev, cloneEditorBoard(currentEditorBoardRef.current)].slice(-HISTORY_LIMIT));
    setRedoStack((prev) => prev.slice(1));
    const restored = cloneEditorBoard(next);
    currentEditorBoardRef.current = restored;
    applyEditorBoard(restored);
    setSelectedCell(null);
  };
  const setPlayerFactionWithHistory = (faction: UnitPalette | null): void => {
    if (playerFaction === faction) return;
    const next = cloneEditorBoard(currentEditorBoardRef.current);
    next.playerFaction = faction;
    commitEditorBoard(next);
  };
  const brushAsset = resolveAsset(brushId) ?? leDefaultTile;
  const resolveUnitAsset = (id: string): UnitAsset | undefined => leUnitAssets.find((unit) => unit.id === id) ?? unitAssets.find((unit) => unit.id === id);
  const unitBrushAsset = resolveUnitAsset(unitBrushId) ?? leUnitAssets[0];
  // Facing sets the brush direction AND rotates the unit selected on the board (in place).
  const setUnitFacing = (dir: Direction): void => {
    setUnitBrushDirection(dir);
    const key = selectedCell ? `${selectedCell.x},${selectedCell.y}` : null;
    if (!key || !boardUnits[key] || boardUnits[key].direction === dir) return;
    const next = cloneEditorBoard(currentEditorBoardRef.current);
    next.units[key] = { ...next.units[key], direction: dir };
    commitEditorBoard(next);
  };
  // Center hub: spin one step clockwise (rookDirections is N→NE→E…→NW), skipping directions this unit lacks.
  const rotateFacingCw = (): void => {
    const n = rookDirections.length;
    const start = rookDirections.indexOf(unitBrushDirection);
    for (let step = 1; step <= n; step += 1) {
      const next = rookDirections[(start + step) % n];
      if (hasDirectionSprite(unitBrushAsset, next)) { setUnitFacing(next); return; }
    }
  };
  const resolveDoodadAsset = (id: string): DoodadAsset | undefined => doodadAsset(id);
  const doodadBrushAsset = resolveDoodadAsset(doodadBrushId) ?? DOODAD_ASSETS[0];
  // HARD terrain gate (mirrors the Studio): a doodad only lands on a tile of its home terrain.
  const doodadFitsTile = (doodad: DoodadAsset, tileId: string | undefined): boolean => {
    const terrain = tileId ? leFamilyOfTile(tileId)?.id : undefined;
    return terrain !== undefined && doodad.terrains.includes(terrain);
  };
  const resolvePropDef = (id: string): PropDef | undefined => propDef(id);
  const propBrushDef = resolvePropDef(propBrushId) ?? PROP_DEFS[0];
  // Generalised doodadFitsTile for a W×H footprint: EVERY footprint cell must be in-bounds AND
  // its tile's family must be a terrain the prop allows. (Overlap with units/other props is a
  // separate check at paint time — fit is purely about the terrain bed.)
  const propFitsBoard = (def: PropDef, ax: number, ay: number): boolean => {
    if (ax < 0 || ay < 0 || ax + def.w > boardCols || ay + def.h > boardRows) return false;
    return propCells(ax, ay, def).every((c) => {
      const fam = boardCells[`${c.x},${c.y}`] ? leFamilyOfTile(boardCells[`${c.x},${c.y}`])?.id : undefined;
      return fam !== undefined && def.terrains.includes(fam);
    });
  };
  // The footprint cells of every already-placed prop (skipping unknown ids), so a new prop can't
  // overlap an existing one. Recomputed per call — cheap for a hand-authored board.
  const occupiedPropCells = (): Set<string> => {
    const set = new Set<string>();
    for (const [key, placement] of Object.entries(boardProps)) {
      const def = resolvePropDef(placement.propId);
      if (!def) continue;
      const [ax, ay] = key.split(',').map(Number);
      for (const c of propCells(ax, ay, def)) set.add(`${c.x},${c.y}`);
    }
    return set;
  };
  // A prop places at (ax,ay) iff it FITS (bounds + terrain) AND no footprint cell collides with a
  // placed unit or another prop's footprint. Used for the paint gate AND the hover preview styling.
  const canPlaceProp = (def: PropDef, ax: number, ay: number): boolean => {
    if (!propFitsBoard(def, ax, ay)) return false;
    const occupied = occupiedPropCells();
    return propCells(ax, ay, def).every((c) => {
      const key = `${c.x},${c.y}`;
      return !boardUnits[key] && !occupied.has(key);
    });
  };

  // Derive each cell's connection mask from the painted set, live. Connectivity is PER KIND:
  // a road's mask is resolved against road neighbours only, a river's against rivers only, so
  // a road and a river crossing adjacent cells never knit together. Cheap (one pass) and the
  // painted set is the source of truth, so the ribbon re-knits whenever a cell changes.
  const featureOverlays = useMemo(() => {
    const isSevered = (edge: string): boolean => featureCuts[edge] === true;
    const isExit = (edge: string): boolean => featureExits[edge] === true;
    const presentByKind: Record<FeatureKind, Set<string>> = { road: new Set(), river: new Set(), fence: new Set() };
    for (const [key, f] of Object.entries(boardFeatures)) presentByKind[f.kind].add(key);
    const out: Record<string, { kind: FeatureKind; material: FeatureMaterial; mask: number }> = {};
    for (const [key, f] of Object.entries(boardFeatures)) {
      const [x, y] = key.split(',').map(Number);
      out[key] = { kind: f.kind, material: f.material, mask: featureMaskAt(presentByKind[f.kind], x, y, isSevered, isExit) };
    }
    return out;
  }, [boardFeatures, featureCuts, featureExits]);

  const paintCell = (x: number, y: number): void => {
    const key = `${x},${y}`;
    const next = cloneEditorBoard(currentEditorBoardRef.current);
    if (featureKind) {
      const material = featureBrushMaterial[featureKind];
      next.features[key] = { kind: featureKind, material };
      commitEditorBoard(next);
      return;
    }
    // A unit/doodad/cover must not land on a placed prop's footprint: for a BLOCKING prop the
    // collision bridge gives an authored unit priority and DROPS that cell's collider
    // (game/setup.ts), silently un-blocking the prop; and any sprite there would overlap the prop.
    // Refuse so the editor matches in-game collision. (Props ↔ features don't gate each other.)
    if ((brushKind === 'unit' || brushKind === 'doodad' || brushKind === 'cover') && occupiedPropCells().has(key)) return;
    if (brushKind === 'unit') {
      next.units[key] = { unitId: unitBrushAsset.id, direction: unitBrushDirection, faction: unitFaction };
      commitEditorBoard(next);
      return;
    }
    if (brushKind === 'doodad') {
      // A doodad only lands on a tile of its home terrain; painting elsewhere is a no-op.
      if (!doodadFitsTile(doodadBrushAsset, boardCells[key])) return;
      next.doodads[key] = { doodadId: doodadBrushAsset.id };
      commitEditorBoard(next);
      return;
    }
    if (brushKind === 'prop') {
      // A multi-cell prop anchors at the clicked cell and must FIT (bounds + terrain) with no
      // footprint cell overlapping a unit or another prop. Anything else is a no-op.
      if (!canPlaceProp(propBrushDef, x, y)) return;
      next.props[key] = { propId: propBrushDef.id };
      commitEditorBoard(next);
      return;
    }
    if (brushKind === 'cover') {
      // Cover grows only on a tile whose terrain has a cover set (grass for now).
      const terrain = boardCells[key] ? leFamilyOfTile(boardCells[key])?.id : undefined;
      if (!terrain || !groundCoverSet(terrain as TileFamilyId)) return;
      next.cover[key] = coverBrushDensity;
      commitEditorBoard(next);
      return;
    }
    next.cells[key] = brushAsset.id;
    commitEditorBoard(next);
  };
  const eraseCell = (x: number, y: number): void => {
    const key = `${x},${y}`;
    const next = cloneEditorBoard(currentEditorBoardRef.current);
    if (featureKind) {
      delete next.features[key];
      for (const edge of Object.keys(next.featureCuts)) if (edge.split('|').includes(key)) delete next.featureCuts[edge];
      for (const edge of Object.keys(next.featureExits)) if (edge.split('|').includes(key)) delete next.featureExits[edge];
      commitEditorBoard(next);
      return;
    }
    if (brushKind === 'unit') { delete next.units[key]; commitEditorBoard(next); return; }
    if (brushKind === 'doodad') { delete next.doodads[key]; commitEditorBoard(next); return; }
    if (brushKind === 'prop') {
      // Erase the prop whose FOOTPRINT contains the clicked cell — not only an exact anchor hit,
      // so clicking anywhere on a 2×2 removes it. Reverse-scan so the last-placed (top) prop wins
      // when footprints somehow overlap (they can't via the paint gate, but be defensive).
      const entries = Object.entries(next.props);
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const [anchorKey, placement] = entries[i];
        const def = resolvePropDef(placement.propId);
        if (!def) continue;
        const [ax, ay] = anchorKey.split(',').map(Number);
        if (propCells(ax, ay, def).some((c) => c.x === x && c.y === y)) {
          delete next.props[anchorKey];
          commitEditorBoard(next);
          return;
        }
      }
      return;
    }
    if (brushKind === 'cover') { delete next.cover[key]; commitEditorBoard(next); return; }
    delete next.cells[key];
    commitEditorBoard(next);
  };
  const clearBoard = (): void => {
    commitEditorBoard({ ...cloneEditorBoard(currentEditorBoardRef.current), cells: {}, units: {}, doodads: {}, props: {}, cover: {}, features: {}, featureCuts: {}, featureExits: {} }, null);
  };
  const fillBoard = (mode: 'empty' | 'all'): void => {
    const next = cloneEditorBoard(currentEditorBoardRef.current);
    if (mode === 'all') next.cells = {};
      for (let y = 0; y < boardRows; y += 1) for (let x = 0; x < boardCols; x += 1) {
        const key = `${x},${y}`;
        if (mode === 'all' || !(key in next.cells)) next.cells[key] = brushAsset.id;
      }
    commitEditorBoard(next);
  };
  const randomizeBoardTiles = (): void => {
    const seed = (Date.now() ^ (boardCols * 73856093) ^ (boardRows * 19349663)) >>> 0;
    const generated = generateSocketBoard({
      assets: leTileAssets,
      seed,
      columns: boardCols,
      rows: boardRows,
      familyAssets: leFamilyAssets,
    });
    const next = cloneEditorBoard(currentEditorBoardRef.current);
    next.cells = Object.fromEntries(generated.cells.map((cell) => [`${cell.x},${cell.y}`, cell.asset?.id ?? leDefaultTile.id]));
    commitEditorBoard(next, null);
  };
  // Real dirty flag: the board has unsaved changes when its signature differs from the one
  // captured at the last save. A standalone board (never saved) seeds savedSig lazily on
  // first render below, so it reads clean until the first edit.
  const currentSig = useMemo(() => boardSignature(currentEditorBoard), [currentEditorBoard]);
  const dirty = savedSig === null ? false : currentSig !== savedSig;
  // Seed the saved signature once for a board that wasn't hydrated from a campaign level
  // (a blank or `?board=` board): the first render establishes the clean baseline.
  useEffect(() => {
    if (savedSig === null && !routeParams.levelId) setSavedSig(currentSig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const targetLevelId = editingId ?? routeParams.levelId;
  const isCampaignLevel = useCampaigns((s) =>
    Boolean(routeParams.campaignId || (targetLevelId && s.campaigns.some((campaign) => campaign.levels.some((ref) => ref.levelId === targetLevelId)))),
  );
  const needsPlayerFaction = isCampaignLevel && !playerFaction;

  // Save the painted board. Campaign path: serialize into the resolved level id and write it
  // back into the store, then route by TIER — an official (`off-`) level publishes to all
  // players (confirmed); a private/unassigned level saves to the user workspace. The server's
  // requireAdmin is the real gate; a non-admin official save fails closed (403 surfaced here).
  const saveLevel = async (): Promise<void> => {
    if (saving) return;
    if (needsPlayerFaction) {
      setSaveStatus('Choose player faction.');
      return;
    }
    const targetId = targetLevelId;
    if (!targetId) {
      // Cold path (no campaign level): a standalone board authored outside a campaign.
      // Mint a fresh per-user level id (`l<n>`) and write it into the user workspace — never
      // an `off-` id (INV8). createUnassignedLevel stamps the minted id onto the level and
      // returns it; the editor then tracks that id so subsequent saves write back to it.
      const newLevel = editorBoardToLevel(currentEditorBoard, { id: 'new', name: levelName });
      const newId = useCampaigns.getState().createUnassignedLevel(newLevel);
      setEditingId(newId);
      setSaving(true);
      setSaveStatus('');
      try {
        await saveUserWorkspace();
        setSaveStatus('Saved to server.');
        setSavedSig(currentSig);
      } catch (e) {
        const mapped = mapSaveError(e);
        if ('action' in mapped) { goSignIn(); return; }
        setSaveStatus(mapped.message);
      } finally {
        setSaving(false);
      }
      return;
    }
    // Carry the existing level's authored metadata (objective/difficulty/economy/notes/theme)
    // so a board save doesn't reset them; only the painted board + name are re-derived here.
    const existing = useCampaigns.getState().levels[targetId];
    const level = editorBoardToLevel(currentEditorBoard, {
      id: targetId,
      name: levelName,
      notes: existing?.notes,
      objective: existing?.objective,
      difficulty: existing?.difficulty,
      economy: existing?.economy,
      theme: existing?.theme,
      // Preserve non-editor-expressible terrain (road/bridge/cliff/rock) from the saved level so
      // republishing a legacy official (no boardCode) doesn't flatten those surfaces to grass.
      previousTerrain: existing?.layers.terrain,
    });
    useCampaigns.getState().replaceLevel(level);
    const official = tierOf(level.id) === 'official';
    if (official && !window.confirm('Publish changes to the official campaigns? Every player will receive them.')) return;
    setSaving(true);
    setSaveStatus('');
    try {
      if (official) {
        const { revision } = await publishOfficialWorkspace();
        setSaveStatus(`Published (revision ${revision}).`);
      } else {
        await saveUserWorkspace();
        setSaveStatus('Saved to server.');
      }
      setSavedSig(currentSig);
    } catch (e) {
      const mapped = mapSaveError(e);
      if ('action' in mapped) { goSignIn(); return; }
      setSaveStatus(mapped.message);
    } finally {
      setSaving(false);
    }
  };

  // Export the whole board as a /level-editor?board=<code> link (round-trips via boardCode.ts).
  const copyBoardLink = (): void => {
    const code = encodeBoard(currentEditorBoard);
    void navigator.clipboard?.writeText(`${window.location.origin}/level-editor?board=${code}`);
  };
  const selectLayer = (nextLayer: LevelEditorLayer): void => {
    if (nextLayer === 'fence' && FENCE_ART_PENDING) return;
    setLayer(nextLayer);
    if (nextLayer === 'board') {
      setTool('select');
      return;
    }
    setBrushKind(nextLayer);
    setTool('brush');
  };
  const selectCell = (x: number, y: number): void => setSelectedCell({ x, y });
  // A held unit may drop on an in-bounds cell that has no other unit and isn't under a prop
  // footprint — the same collision the unit brush enforces, so a moved unit lands where a
  // freshly-painted one could. Drives the destination ring colour and gates the drop itself.
  const canMoveUnitTo = (x: number, y: number): boolean => {
    const key = `${x},${y}`;
    return x >= 0 && y >= 0 && x < boardCols && y < boardRows && !boardUnits[key] && !occupiedPropCells().has(key);
  };
  // Relocate a placed unit (drag-and-drop under the Move tool): re-key its placement from the
  // source cell to the destination, preserving piece/side/facing. Rejected if the source is
  // empty or the destination is occupied; keeps the selection on the unit at its new home.
  const moveUnit = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
    const fromKey = `${from.x},${from.y}`;
    const toKey = `${to.x},${to.y}`;
    if (!boardUnits[fromKey] || !canMoveUnitTo(to.x, to.y)) return;
    const next = cloneEditorBoard(currentEditorBoardRef.current);
    const placement = next.units[fromKey];
    if (!placement) return;
    delete next.units[fromKey];
    next.units[toKey] = placement;
    commitEditorBoard(next, to);
  };
  const adjustZoom = (delta: number): void => setViewZoom((z) => Math.min(4, Math.max(0.4, Number((z + delta).toFixed(2)))));
  // Resize the board. Growing exposes new empty (paintable) cells; shrinking prunes any
  // tiles/units — and a now-offboard selection — whose coordinates fall outside the new
  // bounds, so nothing keeps rendering or counting off the edge of the board.
  const resizeBoard = (nextCols: number, nextRows: number): void => {
    const within = (key: string): boolean => {
      const [cx, cy] = key.split(',').map(Number);
      return cx < nextCols && cy < nextRows;
    };
    const prune = <T,>(map: Record<string, T>): Record<string, T> => {
      const next: Record<string, T> = {};
      let dropped = false;
      for (const key of Object.keys(map)) { if (within(key)) next[key] = map[key]; else dropped = true; }
      return dropped ? next : map;
    };
    const nextBoard = cloneEditorBoard(currentEditorBoardRef.current);
    nextBoard.cells = prune(nextBoard.cells);
    nextBoard.units = prune(nextBoard.units);
    nextBoard.doodads = prune(nextBoard.doodads);
    // Props are FOOTPRINT-aware: drop a prop if its anchor OR any footprint cell falls outside
    // the new bounds (a 2×2 anchored at the last column would otherwise hang off the edge).
    {
      const next: Record<string, { propId: string }> = {};
      let dropped = false;
      for (const [key, placement] of Object.entries(nextBoard.props)) {
        const def = resolvePropDef(placement.propId);
        const [ax, ay] = key.split(',').map(Number);
        const fits = def
          ? ax >= 0 && ay >= 0 && ax + def.w <= nextCols && ay + def.h <= nextRows
          : within(key); // unknown id: fall back to the anchor-only check
        if (fits) next[key] = placement;
        else dropped = true;
      }
      if (dropped) nextBoard.props = next;
    }
    nextBoard.cover = prune(nextBoard.cover);
    nextBoard.features = prune(nextBoard.features);
    // Cuts are keyed by edge ("a|b"); keep only edges whose BOTH endpoints survive.
    {
      const next: Record<string, true> = {};
      let dropped = false;
      for (const edge of Object.keys(nextBoard.featureCuts)) {
        const [p1, p2] = edge.split('|');
        if (within(p1) && within(p2)) next[edge] = true;
        else dropped = true;
      }
      if (dropped) nextBoard.featureCuts = next;
    }
    // Exits point at an OFF-board neighbour (always out of bounds by design), so keep an exit
    // whenever its owning cell — whichever endpoint is still on the board — survives.
    {
      const next: Record<string, true> = {};
      let dropped = false;
      for (const edge of Object.keys(nextBoard.featureExits)) {
        const [p1, p2] = edge.split('|');
        if (within(p1) || within(p2)) next[edge] = true;
        else dropped = true;
      }
      if (dropped) nextBoard.featureExits = next;
    }
    nextBoard.cols = nextCols;
    nextBoard.rows = nextRows;
    commitEditorBoard(nextBoard, selectedCell && (selectedCell.x >= nextCols || selectedCell.y >= nextRows) ? null : selectedCell);
  };

  const paintedCount = Object.keys(boardCells).length;
  const unitCount = Object.keys(boardUnits).length;
  const doodadCount = Object.keys(boardDoodads).length;
  const propCount = Object.keys(boardProps).length;
  const selectedTileId = selectedCell ? boardCells[`${selectedCell.x},${selectedCell.y}`] : undefined;
  const selectedAsset = selectedTileId ? resolveAsset(selectedTileId) : undefined;
  const selectedUnit = selectedCell ? boardUnits[`${selectedCell.x},${selectedCell.y}`] : undefined;
  const selectedUnitAsset = selectedUnit ? resolveUnitAsset(selectedUnit.unitId) : undefined;
  const selectedDoodad = selectedCell ? boardDoodads[`${selectedCell.x},${selectedCell.y}`] : undefined;
  const selectedDoodadAsset = selectedDoodad ? resolveDoodadAsset(selectedDoodad.doodadId) : undefined;
  // The prop whose footprint contains the selected cell (a click anywhere on a 2×2 selects it),
  // plus its def — for the Details panel.
  const selectedProp = useMemo(() => {
    if (!selectedCell) return undefined;
    for (const [key, placement] of Object.entries(boardProps)) {
      const def = resolvePropDef(placement.propId);
      if (!def) continue;
      const [ax, ay] = key.split(',').map(Number);
      if (propCells(ax, ay, def).some((c) => c.x === selectedCell.x && c.y === selectedCell.y)) {
        return { anchor: { x: ax, y: ay }, def };
      }
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCell, boardProps]);
  const coverCount = Object.keys(boardCover).length;
  // Resolve the painted cover into concrete tufts (once, here — not per render). Re-roll
  // bumps coverSeed to reshuffle every cell's scatter while keeping the same densities.
  const coverCells = useMemo(() => {
    const list: Array<{ x: number; y: number; terrain: TileFamilyId; groundCover: GroundCover }> = [];
    for (const [key, density] of Object.entries(boardCover)) {
      const [x, y] = key.split(',').map(Number);
      const tileId = boardCells[key];
      const terrain = tileId ? (leFamilyOfTile(tileId)?.id as TileFamilyId | undefined) : undefined;
      if (!terrain || !groundCoverSet(terrain)) continue;
      list.push({ x, y, terrain, groundCover: { density, tufts: rollGroundCover(terrain, x, y, coverSeed, density) } });
    }
    return list;
  }, [boardCover, boardCells, coverSeed]);
  const selectedFeature = selectedCell ? boardFeatures[`${selectedCell.x},${selectedCell.y}`] : undefined;
  const toggleFeatureCut = (edge: string): void => {
    const next = cloneEditorBoard(currentEditorBoardRef.current);
    if (next.featureCuts[edge]) delete next.featureCuts[edge];
    else next.featureCuts[edge] = true;
    commitEditorBoard(next);
  };
  const toggleFeatureExit = (edge: string): void => {
    const next = cloneEditorBoard(currentEditorBoardRef.current);
    if (next.featureExits[edge]) delete next.featureExits[edge];
    else next.featureExits[edge] = true;
    commitEditorBoard(next);
  };
  const screenStyle = { '--skirmish-world-bg': `url("${DEFAULT_BACKGROUND_SET.world}")` } as CSSProperties;

  // Tier of the level under edit drives the Save verb (INV6): an official (`off-`) level
  // PUBLISHES to all players; a private/unassigned level just SAVES. A level only resolves a
  // tier once a target id is known (campaign path); a fresh standalone board saves as private.
  const isOfficialTarget = targetLevelId ? tierOf(targetLevelId) === 'official' : false;
  const saveLabel = isOfficialTarget ? 'Publish to all players' : 'Save';
  const isAdmin = Boolean(me?.is_admin);
  const saveStateLabel = saving ? 'Saving…' : needsPlayerFaction ? 'Choose player faction' : dirty ? 'Unsaved' : 'Saved';
  const saveStateClass = saving ? 'is-saving' : needsPlayerFaction ? 'is-dirty' : dirty ? 'is-dirty' : 'is-clean';

  return (
    <div className="skirmish-screen level-editor-screen" data-testid="level-editor" style={screenStyle}>
        {/* The title bar lives in the app shell now; the editor paints its live
            save-state + actions into it via portals (state stays in this component). */}
        <TitleBarSlot region="center">
          <div className="le-topbar-stats" aria-label="Level status">
            <span className="le-level-name">{levelName}</span>
            {isOfficialTarget && isAdmin ? <span className="le-official-tag">OFFICIAL</span> : null}
            <span className={`le-save-state ${saveStateClass}`}>{saveStatus || saveStateLabel}</span>
          </div>
        </TitleBarSlot>
        <TitleBarSlot region="actions">
          <nav className="le-topbar-actions" aria-label="Editor actions">
            {cameFromStudio ? <a className="app-header-button le-back-catalog" href="/tileset-studio" title="Return to the Studio catalog">‹ Catalog</a> : null}
            {routeParams.returnTo ? <a className="app-header-button" href={routeParams.returnTo} title="Return to the campaign editor">‹ Back</a> : null}
            <button
              type="button"
              className="app-header-button"
              onClick={undoBoard}
              disabled={!undoStack.length}
              title={undoStack.length ? 'Undo the last board edit.' : 'Nothing to undo.'}
            >Undo</button>
            <button type="button" className="app-header-button" disabled title="Validation arrives once the editor is hosted.">Test</button>
            <button
              type="button"
              className="app-header-button app-header-button-active"
              data-testid="le-save"
              disabled={saving || !dirty || needsPlayerFaction}
              title={needsPlayerFaction ? 'Assign one faction to the player before saving this campaign level.' : isOfficialTarget ? 'Publish this level to every player (admin-gated).' : 'Save this level to your workspace.'}
              onClick={() => { void saveLevel(); }}
            >
              {saveLabel}
            </button>
          </nav>
        </TitleBarSlot>

        <div className="skirmish-field">
          <div className="skirmish-board-frame">
            <ViewPane kind="board" ariaLabel="Level editor board" zoom={viewZoom} pan={viewPan} minZoom={0.4} maxZoom={4} onZoomChange={setViewZoom} onPanChange={setViewPan}>
              <div className="tileset-view-board-content is-board">
                <StudioEditableBoard
                  cols={boardCols}
                  rows={boardRows}
                  cells={boardCells}
                  units={boardUnits}
                  doodads={boardDoodads}
                  props={boardProps}
                  features={featureOverlays}
                  resolveAsset={resolveAsset}
                  resolveUnit={resolveUnitAsset}
                  resolveDoodad={resolveDoodadAsset}
                  resolveProp={resolvePropDef}
                  tool={tool}
                  selectedCell={selectedCell}
                  showFootprint={showFootprint}
                  boardZoom={viewZoom}
                  boardPan={viewPan}
                  animationFrame={animationFrame}
                  onPaint={paintCell}
                  onErase={eraseCell}
                  onSelect={selectCell}
                  onMove={moveUnit}
                  canMoveTo={canMoveUnitTo}
                  propBrush={brushKind === 'prop' ? { def: propBrushDef, canPlaceAt: (ax, ay) => canPlaceProp(propBrushDef, ax, ay) } : null}
                  overlay={<GroundCoverLayer cells={coverCells} />}
                />
              </div>
            </ViewPane>
          </div>
        </div>

      <aside className="skirmish-hud" aria-label="Editor controls">
        <section className="skirmish-card">
          <h2>Layer</h2>
          <div className="le-seg">
            {LEVEL_EDITOR_LAYER_OPTIONS.map((option) => {
              const disabled = option.id === 'fence' && FENCE_ART_PENDING;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`le-seg-btn ${layer === option.id ? 'active' : ''}`.trim()}
                  disabled={disabled}
                  title={option.id === 'fence' ? (FENCE_ART_PENDING ? 'Fence art is pending — the brush is disabled until the mask set ships.' : 'Paint fences (visual only).') : undefined}
                  onClick={() => selectLayer(option.id)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>

        <KitScroll className="le-hud-scroll">
        {layer === 'board' ? (
          <section className="skirmish-card">
            <h2>Board</h2>
            <BoardSizePanel cols={boardCols} rows={boardRows} onResize={resizeBoard} />
            <p className="le-board-note">Width × Height in tiles. Shrinking drops tiles &amp; units outside the new bounds.</p>
            <button type="button" className="le-seg-btn" style={{ width: '100%', marginTop: 8 }} onClick={randomizeBoardTiles} title="Replace every tile with a generated mix of production terrain.">Randomize tiles</button>
            <button type="button" className="le-seg-btn" style={{ width: '100%', marginTop: 8 }} onClick={copyBoardLink} title="Copy a /level-editor?board=… link that recreates this exact board.">Copy board link</button>
          </section>
        ) : (<>

        <section className="skirmish-card">
          <h2>Tool</h2>
          <div className="le-seg">
            <button type="button" className={`le-seg-btn ${tool === 'select' ? 'active' : ''}`.trim()} onClick={() => setTool('select')}><span className="le-ico ic-eyedropper" aria-hidden="true" />Select</button>
            <button type="button" className={`le-seg-btn ${tool === 'brush' ? 'active' : ''}`.trim()} onClick={() => setTool('brush')}><span className="le-ico ic-brush" aria-hidden="true" />Brush</button>
            <button type="button" className={`le-seg-btn ${tool === 'erase' ? 'active' : ''}`.trim()} onClick={() => setTool('erase')}><span className="le-ico ic-eraser" aria-hidden="true" />Erase</button>
            <button type="button" className={`le-seg-btn ${tool === 'move' ? 'active' : ''}`.trim()} onClick={() => setTool('move')} title="Drag a placed unit to a new cell — it keeps its piece, side and facing."><span className="le-ico" aria-hidden="true" />Move</button>
          </div>
          {tool === 'move' ? <p className="le-board-note">Drag a placed unit to a new cell. It keeps its piece, side and facing; you can't drop onto another unit or a prop.</p> : null}
          <div className="le-brush-pick">
            <span className="le-brush-thumb">
              {brushKind === 'unit'
                ? <img src={unitBrushAsset.sprite(unitFaction, 'south')} alt="" draggable={false} />
                : brushKind === 'doodad'
                ? <img src={doodadBrushAsset.front} alt="" draggable={false} />
                : brushKind === 'prop'
                ? <img src={`/assets/props/${propBrushDef.id}/front.png`} alt="" draggable={false} />
                : featureKind === 'fence'
                ? <span className="le-brush-thumb-pending" aria-hidden="true" /> /* fence art pending — no thumb to request */
                : featureKind
                ? <img src={featureThumbSrc(featureKind, featureBrushMaterial[featureKind])} alt="" draggable={false} />
                : <img src={brushAsset.src} alt="" draggable={false} />}
            </span>
            <span className="le-brush-meta">
              <strong>{brushKind === 'unit' ? unitBrushAsset.label : brushKind === 'doodad' ? doodadBrushAsset.label : brushKind === 'prop' ? propBrushDef.label : brushKind === 'cover' ? `${coverBrushDensity} grass` : featureKind ? `${FEATURE_MATERIAL_LABELS[featureBrushMaterial[featureKind]]} ${featureKind}` : brushAsset.label}</strong>
              <span>Active brush · {brushKind === 'unit' ? `unit · ${LE_FACTION_LABELS[unitFaction]}` : brushKind === 'doodad' ? 'doodad' : brushKind === 'prop' ? `prop · ${propBrushDef.w}×${propBrushDef.h}` : brushKind === 'cover' ? 'ground cover' : featureKind ? `feature · ${featureKind}` : 'tile'}</span>
            </span>
          </div>
        </section>

        {brushKind === 'cover' ? (
          <section className="skirmish-card">
            <h2>Cover density</h2>
            <div className="le-seg">
              <button type="button" className={`le-seg-btn ${coverBrushDensity === 'sparse' ? 'active' : ''}`.trim()} onClick={() => setCoverBrushDensity('sparse')}>Sparse</button>
              <button type="button" className={`le-seg-btn ${coverBrushDensity === 'filled' ? 'active' : ''}`.trim()} onClick={() => setCoverBrushDensity('filled')}>Filled</button>
            </div>
            <p className="le-board-note">Brush paints {coverBrushDensity} grass on grass tiles; Erase clears a tile. The tufts scatter from the density.</p>
            <button type="button" className="le-seg-btn" style={{ width: '100%', marginTop: 8 }} onClick={() => setCoverSeed((s) => s + 1)}>Re-roll scatter</button>
            <p className="le-board-note">{coverCount} tile{coverCount === 1 ? '' : 's'} with cover.</p>
          </section>
        ) : null}

        {brushKind === 'unit' ? (
          <section className="skirmish-card le-brush-panel">
            <h2>Faction</h2>
            <div className="le-seg">
              {UNIT_PALETTES.map((faction) => (
                <button
                  type="button"
                  key={faction}
                  className={`le-seg-btn ${unitFaction === faction ? 'active' : ''}`.trim()}
                  onClick={() => setUnitFaction(faction)}
                >{LE_FACTION_LABELS[faction]}</button>
              ))}
            </div>
            <h2 className="le-card-subhead">Player</h2>
            <div className="le-seg">
              {!isCampaignLevel ? (
                <button type="button" className={`le-seg-btn ${playerFaction === null ? 'active' : ''}`.trim()} onClick={() => setPlayerFactionWithHistory(null)}>None</button>
              ) : null}
              {UNIT_PALETTES.map((faction) => (
                <button
                  type="button"
                  key={faction}
                  className={`le-seg-btn ${playerFaction === faction ? 'active' : ''}`.trim()}
                  onClick={() => setPlayerFactionWithHistory(faction)}
                >{LE_FACTION_LABELS[faction]}</button>
              ))}
            </div>
            <h2 className="le-card-subhead">Facing</h2>
            <FacingCompass
              direction={unitBrushDirection}
              onSelect={setUnitFacing}
              onRotate={rotateFacingCw}
              available={(d) => hasDirectionSprite(unitBrushAsset, d)}
            />
            <h2 className="le-card-subhead">Units</h2>
            <div className="le-swatches">
              {leUnitAssets.map((unit) => (
                <button
                  type="button"
                  key={unit.id}
                  className={`le-swatch ${unitBrushId === unit.id && tool !== 'erase' ? 'active' : ''}`.trim()}
                  title={unit.label}
                  onClick={() => { setUnitBrushId(unit.id); setBrushKind('unit'); setTool('brush'); }}
                >
                  <img src={unit.sprite(unitFaction, 'south')} alt="" draggable={false} />
                  <small>{unit.label}</small>
                </button>
              ))}
            </div>
          </section>
        ) : brushKind === 'doodad' ? (
          <section className="skirmish-card le-brush-panel">
            <h2>Doodads</h2>
              <div className="le-swatches">
                {DOODAD_ASSETS.map((doodad) => (
                  <button
                    type="button"
                    key={doodad.id}
                    className={`le-swatch ${doodadBrushId === doodad.id && tool !== 'erase' ? 'active' : ''}`.trim()}
                    title={`${doodad.label} · ${doodad.terrains.join(', ')}`}
                    onClick={() => { setDoodadBrushId(doodad.id); setBrushKind('doodad'); setTool('brush'); }}
                  >
                    <img src={doodad.front} alt="" draggable={false} />
                    <small>{doodad.label}</small>
                  </button>
                ))}
              </div>
            <p className="le-board-note">Doodads only land on a tile of their home terrain.</p>
          </section>
        ) : brushKind === 'prop' ? (
          <section className="skirmish-card le-brush-panel">
            {(['tree', 'house'] as PropKind[]).map((kind) => {
              const group = PROP_DEFS.filter((def) => def.kind === kind);
              if (!group.length) return null;
              return (
                <div className="le-pal-group" key={kind}>
                  <span className="le-pal-grouplabel">{kind === 'tree' ? 'Trees' : 'Houses'}</span>
                  <div className="le-swatches">
                    {group.map((def) => (
                      <button
                        type="button"
                        key={def.id}
                        className={`le-swatch ${propBrushId === def.id && tool !== 'erase' ? 'active' : ''}`.trim()}
                        title={`${def.label} · ${def.w}×${def.h} · ${def.terrains.join(', ')}${def.blocking ? ' · blocks' : ''}`}
                        onClick={() => { setPropBrushId(def.id); setBrushKind('prop'); setLayer('prop'); setTool('brush'); }}
                      >
                        <img src={`/assets/props/${def.id}/front.png`} alt="" draggable={false} />
                        <small>{def.label}</small>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <p className="le-board-note">Props span {propBrushDef.w}×{propBrushDef.h} tiles, anchored at the clicked cell. They only land where every footprint tile is one of their terrains and no unit or other prop is in the way. Blocking props (trees, houses) become impassable in play.</p>
          </section>
        ) : featureKind === 'fence' ? (
          <section className="skirmish-card le-brush-panel">
            <h2>Fence</h2>
            <p className="le-board-note">
              Fences are <strong>visual only</strong> and the art is still pending, so the brush is
              disabled for now. They never affect movement — edge-blocking is a later milestone.
            </p>
          </section>
        ) : featureKind ? (
          <section className="skirmish-card le-brush-panel">
            <h2>{featureKind === 'river' ? 'River material' : 'Road material'}</h2>
            <div className="le-swatches">
              {featureMaterials(featureKind).map((mat) => (
                <button
                  type="button"
                  key={mat}
                  className={`le-swatch ${featureBrushMaterial[featureKind] === mat && tool !== 'erase' ? 'active' : ''}`.trim()}
                  title={FEATURE_MATERIAL_LABELS[mat]}
                  onClick={() => { setFeatureBrushMaterial((prev) => ({ ...prev, [featureKind]: mat })); setBrushKind(featureKind); setLayer(featureKind); setTool('brush'); }}
                >
                  <img src={featureThumbSrc(featureKind, mat)} alt="" draggable={false} />
                  <small>{FEATURE_MATERIAL_LABELS[mat]}</small>
                </button>
              ))}
            </div>
            <p className="le-board-note">
              {featureKind === 'river'
                ? 'Drag to draw a river; each tile picks its own piece (straight, bend, fork) from its river neighbours. Rivers connect only to rivers, never to roads. Erase to cut; the ends re-cap.'
                : 'Drag to draw a road; each tile picks its own piece (straight, corner, junction) from its road neighbours. Roads of any material connect (the surface just changes per cell), but never to rivers. Erase to cut; the ends re-cap.'}
            </p>
          </section>
        ) : brushKind === 'tile' ? (
          <section className="skirmish-card le-brush-panel">
            <h2>Palette</h2>
              {leTileGroups.map(({ family, tiles }) => (
                <div className="le-pal-group" key={family.id}>
                  <span className="le-pal-grouplabel">{family.label}</span>
                  <div className="le-swatches">
                    {tiles.map((tile) => (
                      <button
                        type="button"
                        key={tile.id}
                        className={`le-swatch ${brushId === tile.id && tool !== 'erase' ? 'active' : ''}`.trim()}
                        title={tile.label}
                        onClick={() => { setBrushId(tile.id); setTool('brush'); }}
                      >
                        <img src={tile.src} alt="" draggable={false} />
                        <small>{tile.label}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </section>
        ) : null}

        {featureKind && selectedCell && selectedFeature && selectedFeature.kind === featureKind ? (
          <section className="skirmish-card">
            <h2>{featureKind === 'river' ? 'River connections' : 'Road connections'}</h2>
            <FeatureConnections cell={selectedCell} kind={featureKind} features={boardFeatures} cuts={featureCuts} exits={featureExits} onToggle={toggleFeatureCut} onToggleExit={toggleFeatureExit} />
            <p className="le-board-note">Click an edge that has a neighbour to sever or rejoin it. Click an edge with no neighbour — a board boundary or a non-{featureKind} tile — to run the {featureKind} <em>off</em> that edge instead of capping it.</p>
          </section>
        ) : null}

        <section className="skirmish-card">
          <h2>Fill</h2>
          <div className="le-seg">
            <button type="button" className="le-seg-btn" onClick={() => fillBoard('empty')} title="Fill blank cells with the current brush.">Empty</button>
            <button type="button" className="le-seg-btn" onClick={() => fillBoard('all')} title="Fill the whole board with the current brush.">Whole</button>
            <button type="button" className="le-seg-btn" onClick={randomizeBoardTiles} title="Replace every tile with a generated mix of production terrain.">Randomize</button>
            <button type="button" className="le-seg-btn" onClick={clearBoard} title="Remove every tile from the board.">Clear</button>
          </div>
        </section>

        </>)}

        <section className="skirmish-card">
          <h2>View</h2>
          <div className="le-ctrlrow">
            <span className="le-ctrllabel">Footprint</span>
            <Toggle checked={showFootprint} label="Toggle footprint overlay" onChange={setShowFootprint} />
          </div>
          <div className="le-ctrlrow">
            <span className="le-ctrllabel">Zoom</span>
            <Stepper
              value={Math.round(viewZoom * 100)}
              suffix="%"
              decreaseLabel="Zoom out"
              increaseLabel="Zoom in"
              onDecrease={() => adjustZoom(-0.2)}
              onIncrease={() => adjustZoom(0.2)}
            />
          </div>
        </section>

        {(selectedUnitAsset || selectedDoodadAsset || selectedProp || selectedAsset || selectedCell) ? (
        <section className="skirmish-card le-details">
          <h2>Details · {selectedUnitAsset ? 'Unit' : selectedDoodadAsset ? 'Doodad' : selectedProp ? 'Prop' : selectedAsset ? 'Tile' : 'Cell'}</h2>
          {selectedUnitAsset && selectedUnit ? (
            <dl>
              <div><dt>Piece</dt><dd>{selectedUnitAsset.label}</dd></div>
              <div><dt>Faction</dt><dd>{LE_FACTION_LABELS[selectedUnit.faction as UnitPalette] ?? selectedUnit.faction}</dd></div>
              <div><dt>Control</dt><dd>{playerFaction && selectedUnit.faction === playerFaction ? 'Player' : 'CPU'}</dd></div>
              <div><dt>Facing</dt><dd>{selectedUnit.direction}</dd></div>
            </dl>
          ) : selectedDoodadAsset && selectedDoodad ? (
            <dl>
              <div><dt>Doodad</dt><dd>{selectedDoodadAsset.label}</dd></div>
              <div><dt>Terrain</dt><dd>{selectedDoodadAsset.terrains.join(', ')}</dd></div>
              <div><dt>Cell</dt><dd>{selectedCell?.x}, {selectedCell?.y}</dd></div>
            </dl>
          ) : selectedProp ? (
            <dl>
              <div><dt>Prop</dt><dd>{selectedProp.def.label}</dd></div>
              <div><dt>Footprint</dt><dd>{selectedProp.def.w}×{selectedProp.def.h}{selectedProp.def.blocking ? ' · blocks' : ''}</dd></div>
              <div><dt>Anchor</dt><dd>{selectedProp.anchor.x}, {selectedProp.anchor.y}</dd></div>
            </dl>
          ) : selectedAsset ? (
            <dl>
              <div><dt>Type</dt><dd>{leFamilyOfTile(selectedAsset.id)?.label ?? '—'}</dd></div>
              <div><dt>Source</dt><dd>{selectedAsset.id}</dd></div>
              <div><dt>Cell</dt><dd>{selectedCell?.x}, {selectedCell?.y}</dd></div>
            </dl>
          ) : (
            <dl>
              <div><dt>Tiles</dt><dd>{paintedCount}</dd></div>
              <div><dt>Units</dt><dd>{unitCount}</dd></div>
              <div><dt>Doodads</dt><dd>{doodadCount}</dd></div>
              <div><dt>Props</dt><dd>{propCount}</dd></div>
            </dl>
          )}
        </section>
        ) : null}

        <div className="le-statusline">
          {selectedCell ? <>Cell <b>{selectedCell.x},{selectedCell.y}</b> · </> : null}<b>{paintedCount}</b> tiles · <b>{unitCount}</b> units · <b>{doodadCount}</b> doodads · <b>{propCount}</b> props · {boardCols}×{boardRows}
        </div>
        </KitScroll>
      </aside>
    </div>
  );
}
