import type { ReactElement, ReactNode } from 'react';
import { boardLabCellPosition } from './boardProjection';
import { DoodadSprite } from './BoardDoodad';
import { GroundCoverLayer } from './GroundCoverLayer';
import { TileGrid, type TileGridCell } from './TileGrid';
import { TileTopLayer } from './TileTopLayer';
import { assetFrameSrc, studioFamilies, type StudioAsset } from '../ui/studioBoard';
import { featureFrameSrc } from '../art/tileset';
import {
  MISSING_DIRECTION_SPRITE,
  hasDirectionSprite,
  unitAssets,
  type Direction,
  type Faction,
  type UnitAsset,
} from '../ui/unitCatalog';
import { doodadAsset, type DoodadAsset } from '../ui/doodadCatalog';
import { featureMaskAt, type FeatureKind, type FeatureMaterial } from '../core/featureAutotile';
import { groundCoverSet, rollGroundCover, type GroundCover, type GroundCoverDensity } from '../core/groundCover';
import type { TileFamilyId } from '../core/tileSockets';
import type { EditorBoard } from '../ui/boardCode';

// THE shared, non-interactive board renderer — one source of truth for how an EditorBoard
// draws (tiles + feature overlays in the cell band; units + doodads + ground cover bracketed
// in the +20000 band, exactly like the game's SkirmishBoard). Both surfaces consume it:
//   - the Level Editor's StudioEditableBoard layers its paint/erase/select interaction on top
//     of these same cells + sprites (so the editable board and this viewer can never drift), and
//   - the Campaign Editor's selected-level viewer renders it read-only inside a ViewPane.
// It owns NO state and NO animation clock: pass `animationFrame` (default 0 = a static frame).

/** Per-layer visibility — a true value hides that layer's elements. Mirrors the editor. */
export interface BoardLayerVisibility {
  tile: boolean;
  unit: boolean;
  doodad: boolean;
}

// Linear-feature overlays (roads + rivers) already resolved to a connection mask, keyed by
// "x,y". The editor derives these live; the read-only viewer derives them from the painted set.
export type FeatureOverlayMap = Record<string, { kind: FeatureKind; material: FeatureMaterial; mask: number }>;

const allTiles: StudioAsset[] = studioFamilies.flatMap((family) => family.assets);
const resolveTileAsset = (id: string): StudioAsset | undefined => allTiles.find((asset) => asset.id === id);
const resolveUnitAsset = (id: string): UnitAsset | undefined => unitAssets.find((unit) => unit.id === id);
const familyOfTile = (id: string): TileFamilyId | undefined =>
  studioFamilies.find((family) => family.assets.some((asset) => asset.id === id))?.id;

/**
 * Derive each painted feature cell's connection mask from its SAME-KIND neighbours — the same
 * pass the editor runs live (LevelEditor.featureOverlays), pulled here so the read-only viewer
 * knits ribbons identically without owning editor state.
 */
export function deriveFeatureOverlays(
  features: EditorBoard['features'],
  featureCuts: EditorBoard['featureCuts'],
): FeatureOverlayMap {
  const isSevered = (edge: string): boolean => featureCuts[edge] === true;
  const presentByKind: Record<FeatureKind, Set<string>> = { road: new Set(), river: new Set(), fence: new Set() };
  for (const [key, f] of Object.entries(features)) presentByKind[f.kind].add(key);
  const out: FeatureOverlayMap = {};
  for (const [key, f] of Object.entries(features)) {
    const [x, y] = key.split(',').map(Number);
    out[key] = { kind: f.kind, material: f.material, mask: featureMaskAt(presentByKind[f.kind], x, y, isSevered) };
  }
  return out;
}

/** The tile + feature-overlay <img>s for one cell (no interaction chrome). Shared by both boards. */
export function studioCellArt({
  tileAsset,
  feature,
  animationFrame,
  hidden,
  x = 0,
  y = 0,
}: {
  tileAsset: StudioAsset | undefined;
  feature: { kind: FeatureKind; material: FeatureMaterial; mask: number } | undefined;
  animationFrame: number;
  hidden?: BoardLayerVisibility;
  /** Board coords; only used to phase-stagger an animated top (water ripple). */
  x?: number;
  y?: number;
}): ReactNode {
  // A tile with an animated top (water) renders as its split halves so the ripple sheet can
  // drive the surface while the side stays frozen — the same layers the game board draws
  // (top ∪ side == the combined sprite, so the static look is unchanged). Static tiles keep
  // the single combined <img>.
  const animFrames = tileAsset?.topAnimFrames ?? 0;
  return (
    <>
      {tileAsset && !hidden?.tile ? (
        animFrames > 1 ? (
          <>
            <img className="tile-layer-side" src={tileAsset.src.replace(/\.png$/, '-side.png')} alt="" draggable={false} />
            <TileTopLayer baseSrc={tileAsset.src} animFrames={animFrames} x={x} y={y} />
          </>
        ) : (
          <img src={assetFrameSrc(tileAsset, animationFrame)} alt="" draggable={false} />
        )
      ) : null}
      {feature ? (
        <img
          className="tileset-feature-overlay"
          src={featureFrameSrc(feature.kind, feature.material, feature.mask)}
          alt=""
          draggable={false}
        />
      ) : null}
    </>
  );
}

/**
 * The unit + doodad sprites for the whole board, seated via the shared `.board-unit-seat`
 * and `<DoodadSprite>` (identical to the game board). Pure (no interaction); the editor adds
 * its own doodad hit targets alongside these. `renderUnitDoodadExtra` lets a caller inject a
 * per-cell overlay (the editor's transparent doodad hit) without forking the seating logic.
 */
export function studioBoardSprites({
  units,
  doodads,
  resolveUnit = resolveUnitAsset,
  resolveDoodad = doodadAsset,
  hidden,
  renderDoodadExtra,
}: {
  units: Record<string, { unitId: string; direction: string; faction: string }>;
  doodads: Record<string, { doodadId: string }>;
  resolveUnit?: (id: string) => UnitAsset | undefined;
  resolveDoodad?: (id: string) => DoodadAsset | undefined;
  hidden?: BoardLayerVisibility;
  renderDoodadExtra?: (cell: { x: number; y: number; left: number; top: number; zIndex: number }) => ReactNode;
}): ReactNode[] {
  const sprites: ReactNode[] = [];
  for (const key of new Set([...Object.keys(units), ...Object.keys(doodads)])) {
    const [cx, cy] = key.split(',').map(Number);
    const { left, top, zIndex } = boardLabCellPosition({ x: cx, y: cy });
    const doodadEntry = doodads[key] ? resolveDoodad(doodads[key].doodadId) : undefined;
    if (doodadEntry && !hidden?.doodad) {
      sprites.push(<DoodadSprite key={`dd-${key}`} doodad={{ x: cx, y: cy, type: doodadEntry.id }} />);
      const extra = renderDoodadExtra?.({ x: cx, y: cy, left, top, zIndex });
      if (extra) sprites.push(extra);
    }
    const placement = units[key];
    const unitAsset = placement ? resolveUnit(placement.unitId) : undefined;
    if (unitAsset && placement && !hidden?.unit) {
      const direction = placement.direction as Direction;
      const sprite = hasDirectionSprite(unitAsset, direction)
        ? unitAsset.sprite(placement.faction as Faction, direction)
        : MISSING_DIRECTION_SPRITE;
      sprites.push(
        <div key={`u-${key}`} className={`board-unit-seat is-${unitAsset.family}`} style={{ left, top, zIndex: zIndex + 20000 }}>
          <img src={sprite} alt="" draggable={false} />
        </div>,
      );
    }
  }
  return sprites;
}

/** Resolve painted ground-cover densities into the concrete tufts the GroundCoverLayer renders. */
export function studioCoverCells(
  cells: Record<string, string>,
  cover: Record<string, GroundCoverDensity>,
  seed: number,
): Array<{ x: number; y: number; terrain: TileFamilyId; groundCover: GroundCover }> {
  const list: Array<{ x: number; y: number; terrain: TileFamilyId; groundCover: GroundCover }> = [];
  for (const [key, density] of Object.entries(cover)) {
    const [x, y] = key.split(',').map(Number);
    const tileId = cells[key];
    const terrain = tileId ? familyOfTile(tileId) : undefined;
    if (!terrain || !groundCoverSet(terrain)) continue;
    list.push({ x, y, terrain, groundCover: { density, tufts: rollGroundCover(terrain, x, y, seed, density) } });
  }
  return list;
}

/**
 * A static, read-only board rendered straight from an EditorBoard — tiles, feature ribbons,
 * units, doodads and ground cover, all through the SAME render core the editor uses. No
 * painting, no selection, no animation clock (the frame is fixed). Wrap it in a ViewPane for
 * pan/zoom (the Campaign Editor's selected-level viewer does exactly that).
 */
export function StudioReadOnlyBoard({
  board,
  animationFrame = 0,
  coverSeed = 1234,
  boardZoom = 1,
  boardPan = { x: 0, y: 0 },
  showFootprint = false,
  className = '',
  ariaLabel = 'Level board',
}: {
  board: EditorBoard;
  animationFrame?: number;
  coverSeed?: number;
  boardZoom?: number;
  boardPan?: { x: number; y: number };
  showFootprint?: boolean;
  className?: string;
  ariaLabel?: string;
}): ReactElement {
  const featureOverlays = deriveFeatureOverlays(board.features, board.featureCuts);

  const gridCells: TileGridCell[] = [];
  for (let y = 0; y < board.rows; y += 1) {
    for (let x = 0; x < board.cols; x += 1) {
      const key = `${x},${y}`;
      const tileAsset = board.cells[key] ? resolveTileAsset(board.cells[key]) : undefined;
      gridCells.push({
        key,
        x,
        y,
        className: `tileset-placement-cell ${tileAsset ? '' : 'is-empty'}`.trim(),
        children: studioCellArt({ tileAsset, feature: featureOverlays[key], animationFrame, x, y }),
      });
    }
  }

  const sprites = studioBoardSprites({ units: board.units, doodads: board.doodads });
  const coverCells = studioCoverCells(board.cells, board.cover, coverSeed);

  return (
    <TileGrid
      cells={gridCells}
      className={`tileset-placement-board is-readonly ${className}`.trim()}
      ariaLabel={ariaLabel}
      showFootprint={showFootprint}
      boardZoom={boardZoom}
      boardPan={boardPan}
    >
      <GroundCoverLayer cells={coverCells} />
      {sprites}
    </TileGrid>
  );
}
