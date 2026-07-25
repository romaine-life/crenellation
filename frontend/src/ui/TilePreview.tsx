// This file implements the Studio. It MUST follow the control architecture spec in
// docs/studio-control-architecture.md — read it before adding a mode, category, or surface.
// Invariants: ONE persistent surface (the board); Board/Tile/Unit/Doodad are *focuses*
// (control sets that share that board), NOT separate views; the frame never moves; a new
// board-placeable thing is a catalogCategories entry + a focus, never a bespoke view or a
// `category === '…'` branch.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { tileFamilies, edgeTiles } from '../art/tileset';
import { nonProductionTileAssets, nonProductionTileFamilyOf } from '../art/nonProductionTiles';
import {
  terrainLabels,
  transitionPairs,
  transitionPairById,
  transitionPairsForFamily,
  transitionSlotsForPair,
  type TileAssetKind,
  type TileFamilyId,
  type TileSocketAsset,
  type TerrainPairId,
} from '../core/tileSockets';
import { CatalogGrid, CatalogControls, CatalogFilters, type CatalogType, type CatalogFilterDim } from './studio/Catalog';
import { AssetLibraryStudio, AssetLab, ASSET_TYPE_FACETS, type AssetFilters } from './design/AssetLibraryStudio';
import { ArtworkLibraryStudio, ArtworkLab, ARTWORK_GROUPS } from './design/ArtworkLibraryStudio';
import { CroppedView, loadCrops, type Piece as PortraitPiece } from './PortraitEditor';
import { PORTRAIT_METHODS, PORTRAIT_PIECES, portraitMasterSrc, type PortraitMethod } from './portraitCandidates';
import { GlossaryLibraryStudio, GlossaryLab } from './design/GlossaryLibraryStudio';
import { SurfaceLibraryStudio, SurfaceViewer } from './SurfaceLibraryStudio';
import { TileSidesViewer } from './TileSidesViewer';
import { TILE_SIDE_ITEMS, tileSideFamilyCount, type TileSideItem } from './tileSideCatalog';
import { ScrollbarLibraryStudio, ScrollbarViewer } from './ScrollbarLibraryStudio';
import { PagesLibraryStudio, PagesViewer } from './PagesLibraryStudio';
import { PAGE_ENTRIES } from './pagesCatalog';
import { SliderLibraryStudio, SliderViewer } from './SliderLibraryStudio';
import { SfxLibraryStudio, SfxViewer } from './SfxLibraryStudio';
import { PortraitLab } from './PortraitEditor';
import { NineSliceLab, DEFAULT_NINE_SLICE_ASSET } from './NineSliceEditor';
import { DOODAD_ASSETS, type DoodadAsset } from './doodadCatalog';
import kitManifest from './design/kitManifest.json';
import artworkManifest from './design/artworkManifest.json';
import { navigateApp } from './navigation';
import {
  activeUnitFamilies,
  familyLabels,
  hasDirectionSprite,
  rookDirections,
  unitAssets,
  UNIT_METHOD_OPTIONS,
  type Direction,
  type PieceId,
  type UnitAsset,
} from './unitCatalog';
import {
  useAnimationClock,
  FacingCompass,
  assetFrameSrc,
  studioFamilies,
  type StudioAsset,
  type StudioFamily,
  type StudioFamilyId,
} from './studioBoard';





// The studio has two persistent destinations (tier-1), both always reachable and
// decoupled from the catalog category: 'catalog' browses a grid; 'viewer' is the
// read-only stage for one finished, non-manipulable thing (an asset or an artwork).
// Board editing lives in the standalone Level Editor (/level-editor), which the
// catalog cards and the "Lab" tab route to. See docs/studio-control-architecture.md.
type StudioMode = 'catalog' | 'viewer';

// The catalog's kinds-of-thing. Category governs only what the Catalog shows; it
// does not decide which destination tab you can reach.
type StudioCategory = 'tiles' | 'tilesides' | 'units' | 'doodads' | 'assets' | 'artwork' | 'portraits' | 'glossary' | 'surfaces' | 'scrollbars' | 'sliders' | 'pages' | 'sfx';

// What the Viewer is currently holding. Assets and artwork feed read-only stages;
// 'portrait' is the embedded portrait crop editor and 'nineslice' the embedded
// 9-slice frame editor (the two in-studio editing kinds); 'glossary' reads one term
// in full (definition + any long-form process doc). This records the active kind.
type ViewerKind = 'asset' | 'artwork' | 'portrait' | 'nineslice' | 'glossary' | 'surface' | 'scrollbar' | 'slider' | 'page' | 'tileside' | 'sfx';

// Default selection for the Artwork viewer, so the Viewer shows a real piece
// instead of an empty stage before anything is opened.
const FIRST_ARTWORK_ID: string = artworkManifest.groups[0]?.items[0]?.id ?? '';

// The Portraits catalog's assets: every piece × every bake-off method (navy only). A
// dedicated top-level category so portraits get their own Unit + Treatment filters,
// rendered through the accepted per-piece crop. Method labels come from the registry.
type PortraitCandidateAsset = { id: string; piece: PortraitPiece; method: PortraitMethod; methodLabel: string; methodSub: string };
const PORTRAIT_CANDIDATE_ASSETS: PortraitCandidateAsset[] = PORTRAIT_PIECES.flatMap((piece) =>
  PORTRAIT_METHODS.map((m) => ({ id: `${piece}-${m.key}`, piece, method: m.key, methodLabel: m.label, methodSub: m.sub })));
type TileFilter = 'base' | 'board';
type LabMode = 'board' | 'tile' | 'unit' | 'doodad';
type CollectionFilter = Exclude<TileFilter, 'board'>;
type TransitionViewMode = 'tile' | 'proof' | 'sample';


interface TilesetStudioRouteState {
  familyId: StudioFamilyId;
  studioMode: StudioMode;
  category?: StudioCategory;
  selectedAssetName?: string;
  selectedArtworkName?: string;
  selectedGlossaryName?: string;
  selectedPageName?: string;
  selectedTileSideId?: string;
  selectedFrameName?: string;
  viewerKind?: ViewerKind;
  labMode: LabMode;
  tileFilter: TileFilter;
  selectedPairId: TerrainPairId;
  selectedAssetId?: string;
  selectedSlotMask?: number;
  boardMode: 'generated' | 'concept';
  boardScope: 'family' | 'mixed';
  boardSize: 'small' | 'wide';
  boardSeed: number;
  brushKind: 'tile' | 'unit' | 'doodad';
  selectedUnitId?: string;
}



const studioDefaults: TilesetStudioRouteState = {
  familyId: 'grass',
  studioMode: 'catalog',
  labMode: 'board',
  tileFilter: 'base',
  selectedPairId: 'grass-stone',
  boardMode: 'generated',
  boardScope: 'family',
  boardSize: 'small',
  boardSeed: 4217,
  brushKind: 'tile',
};


const transitionAssets: StudioAsset[] = [];


// Non-production reference tiles (legacy textured, codex→filter, rejected bake-off methods).
// Injected into the Tiles CATALOG only (below) — deliberately NOT in studioFamilies, so they
// never reach board generation or the Level Editor brush. See art/nonProductionTiles.ts.
const nonProductionStudioTiles: StudioAsset[] = nonProductionTileAssets.map((asset): StudioAsset => ({ ...asset }));

const familyCounts = (family: StudioFamily): string => {
  const variants = family.assets.filter((asset) => asset.kind === 'tile').length;
  return `${variants} ${variants === 1 ? 'tile' : 'tiles'}`;
};

const familySample = (family: StudioFamily): StudioAsset => family.assets.find((asset) => asset.kind === 'tile') ?? family.assets[0];

const studioFamilyById = (familyId: StudioFamilyId): StudioFamily =>
  studioFamilies.find((item) => item.id === familyId) ?? studioFamilies[0];

const isStudioFamilyId = (value: string | null): value is StudioFamilyId => value === 'grass' || value === 'stone' || value === 'water';

const isStudioMode = (value: string | null): value is StudioMode => value === 'catalog' || value === 'viewer';
const isStudioCategory = (value: string | null): value is StudioCategory => value === 'tiles' || value === 'tilesides' || value === 'units' || value === 'doodads' || value === 'assets' || value === 'artwork' || value === 'portraits' || value === 'glossary' || value === 'surfaces' || value === 'scrollbars' || value === 'sliders' || value === 'pages' || value === 'sfx';
const isLabMode = (value: string | null): value is LabMode => value === 'board' || value === 'tile' || value === 'unit' || value === 'doodad';

const isTileFilter = (value: string | null): value is TileFilter => value === 'base' || value === 'transitions' || value === 'references' || value === 'board';

const isTerrainPairId = (value: string | null): value is TerrainPairId => value === 'grass-stone' || value === 'grass-water' || value === 'stone-water';
const isUnitAssetId = (value: string | null): value is string => unitAssets.some((unit) => unit.id === value);

const readTilesetStudioRoute = (): TilesetStudioRouteState => {
  const params = new URLSearchParams(window.location.search);
  const family = params.get('family');
  const mode = params.get('mode');
  const cat = params.get('cat');
  const kit = params.get('kit');
  const art = params.get('art');
  const gloss = params.get('gloss');
  const page = params.get('page');
  const side = params.get('side');
  const vk = params.get('vk');
  const lab = params.get('lab');
  const view = params.get('view');
  const collection = params.get('collection');
  const pair = params.get('pair');
  const asset = params.get('asset');
  const unit = params.get('unit');
  const slot = Number(params.get('slot'));
  const seed = Number(params.get('seed'));
  // /nine-slice-editor is a deep-link ALIAS into this one studio (like /unit-studio):
  // it opens the embedded 9-slice surface (Assets category, Viewer mode, 'nineslice'
  // kind) with ?asset=<frame>. The studio's own route writer then canonicalises the
  // URL to /tileset-studio?…&frame=<frame>. No separate route, no page chrome.
  const isNineSliceAlias = window.location.pathname === '/nine-slice-editor';
  const frame = params.get('frame') || (isNineSliceAlias ? asset : null);
  // Destination is decoupled from category — any mode is valid with any category,
  // so the URL is taken at face value (no normalization).
  const studioMode = isNineSliceAlias ? 'viewer' : isStudioMode(mode) ? mode : studioDefaults.studioMode;
  const routeCategory = isNineSliceAlias ? 'assets' : isStudioCategory(cat) ? cat : undefined;
  const routeTileFilter = view === 'board' ? 'board' : isTileFilter(collection) ? collection : studioDefaults.tileFilter;
  const explicitLabMode = isLabMode(lab) ? lab : undefined;
  const brushParam = params.get('brush');
  const brushKind =
    brushParam === 'unit' || explicitLabMode === 'unit' ? 'unit'
    : brushParam === 'doodad' || explicitLabMode === 'doodad' ? 'doodad'
    : studioDefaults.brushKind;
  const routeLabMode = explicitLabMode ?? (routeTileFilter === 'board' ? 'board' : brushKind === 'unit' ? 'unit' : brushKind === 'doodad' ? 'doodad' : 'tile');
  const effectiveTileFilter =
    studioMode === 'catalog'
      ? routeTileFilter === 'board' ? studioDefaults.tileFilter : routeTileFilter
      : routeTileFilter;
  return {
    familyId: isStudioFamilyId(family) ? family : studioDefaults.familyId,
    studioMode,
    category: routeCategory,
    selectedAssetName: kit || undefined,
    selectedArtworkName: art || undefined,
    selectedGlossaryName: gloss || undefined,
    selectedPageName: page || undefined,
    selectedTileSideId: side || undefined,
    selectedFrameName: frame || undefined,
    viewerKind: isNineSliceAlias ? 'nineslice'
      : vk === 'asset' || vk === 'artwork' || vk === 'portrait' || vk === 'nineslice' || vk === 'glossary' || vk === 'surface' || vk === 'scrollbar' || vk === 'slider' || vk === 'page' || vk === 'tileside' || vk === 'sfx' ? vk : undefined,
    labMode: routeLabMode,
    tileFilter: effectiveTileFilter,
    selectedPairId: isTerrainPairId(pair) ? pair : studioDefaults.selectedPairId,
    selectedAssetId: isNineSliceAlias ? undefined : asset || undefined,
    selectedSlotMask: Number.isInteger(slot) && slot >= 1 && slot <= 14 ? slot : undefined,
    boardMode: params.get('board') === 'concept' ? 'concept' : studioDefaults.boardMode,
    boardScope: params.get('scope') === 'mixed' ? 'mixed' : studioDefaults.boardScope,
    boardSize: params.get('size') === 'wide' ? 'wide' : studioDefaults.boardSize,
    boardSeed: Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : studioDefaults.boardSeed,
    brushKind,
    selectedUnitId: isUnitAssetId(unit) ? unit : undefined,
  };
};

const STUDIO_PATH = '/tileset-studio';

const writeTilesetStudioRoute = (route: TilesetStudioRouteState): void => {
  // Canonicalise to /tileset-studio even when entered via the /nine-slice-editor
  // alias, so the alias is a pure entry point and all subsequent state rides the
  // one studio URL (the embedded 9-slice surface is not its own route).
  if (window.location.pathname !== STUDIO_PATH && window.location.pathname !== '/nine-slice-editor') return;
  if (route.studioMode === 'catalog') {
    // Tiles is the default, so it stays a clean bare URL; Units/Assets get a
    // ?cat= so the chosen catalog survives a reload and is directly linkable.
    const catalogParams = new URLSearchParams();
    if (route.category && route.category !== 'tiles') catalogParams.set('cat', route.category);
    // Keep the catalog URL clean: persist only the active category's own selection.
    if (route.category === 'assets' && route.selectedAssetName) catalogParams.set('kit', route.selectedAssetName);
    if (route.category === 'artwork' && route.selectedArtworkName) catalogParams.set('art', route.selectedArtworkName);
    if (route.category === 'glossary' && route.selectedGlossaryName) catalogParams.set('gloss', route.selectedGlossaryName);
    if (route.category === 'tilesides' && route.selectedTileSideId) catalogParams.set('side', route.selectedTileSideId);
    const catalogQuery = catalogParams.toString();
    const nextHref = catalogQuery ? `${STUDIO_PATH}?${catalogQuery}` : STUDIO_PATH;
    const currentHref = `${window.location.pathname}${window.location.search}`;
    if (nextHref !== currentHref) {
      window.history.replaceState({}, '', nextHref);
    }
    return;
  }
  const params = new URLSearchParams();
  params.set('family', route.familyId);
  params.set('mode', route.studioMode);
  if (route.category && route.category !== 'tiles') params.set('cat', route.category);
  if (route.studioMode === 'viewer') {
    // The Viewer persists which kind it last held and, for the named kinds, the item.
    // Portrait state lives in localStorage; 'nineslice' persists the frame being edited.
    params.set('vk', route.viewerKind ?? 'artwork');
    if (route.viewerKind === 'asset' && route.selectedAssetName) params.set('kit', route.selectedAssetName);
    else if (route.viewerKind === 'artwork' && route.selectedArtworkName) params.set('art', route.selectedArtworkName);
    else if (route.viewerKind === 'glossary' && route.selectedGlossaryName) params.set('gloss', route.selectedGlossaryName);
    else if (route.viewerKind === 'page' && route.selectedPageName) params.set('page', route.selectedPageName);
    else if (route.viewerKind === 'tileside' && route.selectedTileSideId) params.set('side', route.selectedTileSideId);
    else if (route.viewerKind === 'nineslice' && route.selectedFrameName) params.set('frame', route.selectedFrameName);
  }
  params.set('collection', route.tileFilter);
  if (route.selectedAssetId) params.set('asset', route.selectedAssetId);
  if (route.selectedSlotMask) params.set('slot', String(route.selectedSlotMask));
  params.set('pair', route.selectedPairId);
  params.set('board', route.boardMode);
  params.set('scope', route.boardScope);
  params.set('size', route.boardSize);
  params.set('seed', String(route.boardSeed));
  if (route.brushKind === 'unit') params.set('brush', 'unit');
  else if (route.brushKind === 'doodad') params.set('brush', 'doodad');
  if (route.selectedUnitId) params.set('unit', route.selectedUnitId);
  const nextHref = `${STUDIO_PATH}?${params.toString()}`;
  const currentHref = `${window.location.pathname}${window.location.search}`;
  if (nextHref !== currentHref) {
    window.history.replaceState({}, '', nextHref);
  }
};

const defaultViewZoom = (kind: 'tile' | 'transition' | 'board'): number => {
  if (kind === 'tile') return 1.35;
  if (kind === 'transition') return 1.15;
  return 0.95;
};

const defaultTransitionViewModeForRoute = (route: TilesetStudioRouteState): TransitionViewMode => {
  return route.selectedAssetId && transitionAssets.some((asset) => asset.id === route.selectedAssetId) ? 'tile' : 'proof';
};




export function TilesetStudio({ initialCategory = 'tiles' }: { initialCategory?: StudioCategory } = {}): ReactElement {
  const initialRoute = useMemo(() => readTilesetStudioRoute(), []);
  const initialHasViewTarget = Boolean(initialRoute.selectedAssetId || initialRoute.selectedSlotMask || initialRoute.tileFilter === 'board');
  const [familyId, setFamilyId] = useState<StudioFamilyId>(initialRoute.familyId);
  const [studioMode, setStudioMode] = useState<StudioMode>(initialRoute.studioMode);
  const [category, setCategory] = useState<StudioCategory>(initialRoute.category ?? initialCategory);
  const [labMode, setLabMode] = useState<LabMode>(initialRoute.labMode);
  const [doodadBrushId, setDoodadBrushId] = useState<string>(DOODAD_ASSETS[0].id);
  const [viewHasTarget, setViewHasTarget] = useState(initialHasViewTarget);
  const [tileFilter, setTileFilter] = useState<TileFilter>(initialRoute.tileFilter);
  const [selectedFamilyIds, setSelectedFamilyIds] = useState<StudioFamilyId[]>(studioFamilies.map((fam) => fam.id));
  const [selectedCollectionFilters, setSelectedCollectionFilters] = useState<CollectionFilter[]>(
    initialRoute.tileFilter === 'board' ? ['base'] : [initialRoute.tileFilter],
  );
  const [catalogQuery, setCatalogQuery] = useState('');
  const [assetFilters, setAssetFilters] = useState<AssetFilters>({ type: 'all', prov: 'all', gate: 'all' });
  const [assetSearch, setAssetSearch] = useState('');
  const [artworkSearch, setArtworkSearch] = useState('');
  const [selectedArtworkGroups, setSelectedArtworkGroups] = useState<string[]>(ARTWORK_GROUPS.map((g) => g.id));
  const [selectedPortraitPieces, setSelectedPortraitPieces] = useState<PortraitPiece[]>([...PORTRAIT_PIECES]);
  const [selectedPortraitMethods, setSelectedPortraitMethods] = useState<PortraitMethod[]>(PORTRAIT_METHODS.map((m) => m.key));
  const [selectedPortraitId, setSelectedPortraitId] = useState<string | undefined>(undefined);
  const [surfaceSearch, setSurfaceSearch] = useState('');
  const [scrollbarSearch, setScrollbarSearch] = useState('');
  const [selectedScrollbarName, setSelectedScrollbarName] = useState<string | undefined>(undefined);
  const [selectedSurfaceName, setSelectedSurfaceName] = useState<string | undefined>(undefined);
  const [tileSideSearch, setTileSideSearch] = useState('');
  const [selectedTileSideId, setSelectedTileSideId] = useState<string | undefined>(initialRoute.selectedTileSideId);
  const [selectedSideFamilies, setSelectedSideFamilies] = useState<TileFamilyId[]>(studioFamilies.map((fam) => fam.id));
  const [sliderSearch, setSliderSearch] = useState('');
  const [selectedSliderName, setSelectedSliderName] = useState<string | undefined>(undefined);
  const [sfxSearch, setSfxSearch] = useState('');
  const [selectedSfxName, setSelectedSfxName] = useState<string | undefined>(undefined);
  const [pageSearch, setPageSearch] = useState('');
  const [selectedPageName, setSelectedPageName] = useState<string | undefined>(initialRoute.selectedPageName);
  const [glossarySearch, setGlossarySearch] = useState('');
  // Assets and artwork each own their own selection — never one shared field
  // (that's how an Assets id like 'gear' used to leak into the Artwork stage).
  const [selectedAssetName, setSelectedAssetName] = useState(initialRoute.selectedAssetName ?? 'gear');
  const [selectedArtworkName, setSelectedArtworkName] = useState(initialRoute.selectedArtworkName ?? FIRST_ARTWORK_ID);
  const [selectedGlossaryName, setSelectedGlossaryName] = useState(initialRoute.selectedGlossaryName ?? '9-slice');
  // Which kit frame the embedded 9-slice editor (Viewer 'nineslice' kind) is aligning.
  const [selectedFrameName, setSelectedFrameName] = useState(initialRoute.selectedFrameName ?? DEFAULT_NINE_SLICE_ASSET);
  // Which item the Viewer is showing (independent of the catalog category).
  const [viewerKind, setViewerKind] = useState<ViewerKind>(initialRoute.viewerKind ?? 'artwork');
  const [selectedUnitFamilies, setSelectedUnitFamilies] = useState<PieceId[]>(activeUnitFamilies);
  const [selectedUnitMethods, setSelectedUnitMethods] = useState<string[]>(UNIT_METHOD_OPTIONS.map((m) => m.id));
  // Facing for the Units catalog preview — the compass in the rail rotates every unit card.
  const [catalogFacing, setCatalogFacing] = useState<Direction>('south');
  const rotateCatalogFacingCw = (): void => {
    const i = rookDirections.indexOf(catalogFacing);
    setCatalogFacing(rookDirections[(i + 1) % rookDirections.length] ?? 'south');
  };
  const [selectedDoodadTerrains, setSelectedDoodadTerrains] = useState<StudioFamilyId[]>(studioFamilies.map((fam) => fam.id));
  const [selectedPairId, setSelectedPairId] = useState<TerrainPairId>(initialRoute.selectedPairId);
  const [zoom, setZoom] = useState(1);
  const [, setViewZoom] = useState(1);
  const [, setViewPan] = useState({ x: 0, y: 0 });
  const [transitionViewMode, setTransitionViewMode] = useState<TransitionViewMode>(() => defaultTransitionViewModeForRoute(initialRoute));
  const [boardMode, setBoardMode] = useState<'generated' | 'concept'>(initialRoute.boardMode);
  const [boardScope, setBoardScope] = useState<'family' | 'mixed'>(initialRoute.boardScope);
  const [boardSize, setBoardSize] = useState<'small' | 'wide'>(initialRoute.boardSize);
  const [boardSeed, setBoardSeed] = useState(initialRoute.boardSeed);
  const [animationPlaying] = useState(true);
  const [manualAnimationFrame, setManualAnimationFrame] = useState(0);
  // Unified editable board (temporary, in-memory only — re-seeds when a new view loads).
  const [, setTool] = useState<'select' | 'brush' | 'erase'>(initialRoute.brushKind === 'unit' ? 'brush' : 'select');
  const [brushKind, setBrushKind] = useState<'tile' | 'unit' | 'doodad'>(initialRoute.brushKind);
  const [unitBrushId, setUnitBrushId] = useState<string>(initialRoute.selectedUnitId ?? unitAssets[0].id);

  const family = studioFamilies.find((item) => item.id === familyId) ?? studioFamilies[0];
  // The Blender textured tileset is hard-edged: only base tiles, no transition or
  // reference collections. (The transition/reference code paths are now unreachable.)
  const collectionFilters: Array<[CollectionFilter, string]> = [
    ['base', 'Base'],
  ];
  const selectedFamilies = studioFamilies.filter((item) => selectedFamilyIds.includes(item.id));
  const activeFamilies = selectedFamilies;
  const selectedFamilyLabel =
    activeFamilies.length === 0
      ? 'No families'
      : activeFamilies.length === studioFamilies.length
        ? 'All Tiles'
        : activeFamilies.length === 1
          ? activeFamilies[0].label
          : `${activeFamilies.length} families`;
  const selectedCollectionLabel =
    selectedCollectionFilters.length === 0
      ? 'No collections'
      : selectedCollectionFilters.map((filter) => collectionFilters.find(([id]) => id === filter)?.[1]).filter(Boolean).join(' + ');
  const [selectedAssetId, setSelectedAssetId] = useState(initialRoute.selectedAssetId ?? family.assets[0].id);
  const [selectedSlotMask, setSelectedSlotMask] = useState<number | undefined>(initialRoute.selectedSlotMask);
  const familyTransitionPairs = transitionPairsForFamily(family.id);
  const selectedPair = familyTransitionPairs.find((pair) => pair.id === selectedPairId) ?? familyTransitionPairs[0] ?? transitionPairs[0];
  const allStudioAssets = useMemo(() => [...studioFamilies.flatMap((item) => item.assets), ...transitionAssets], []);
  const selectedAsset = allStudioAssets.find((asset) => asset.id === selectedAssetId) ?? family.assets[0];
  const resolveUnitAsset = (id: string): UnitAsset | undefined => unitAssets.find((unit) => unit.id === id);
  const unitBrushAsset = resolveUnitAsset(unitBrushId) ?? unitAssets[0];
  const catalogBaseAssets = activeFamilies.flatMap((item) => item.assets.filter((asset) => asset.kind === 'tile'));
  const normalizedCatalogQuery = catalogQuery.trim().toLowerCase();
  const matchesCatalogQuery = (asset: StudioAsset): boolean => {
    if (!normalizedCatalogQuery) return true;
    return [asset.label, asset.role, asset.source, asset.notes, asset.pairId ?? '', ...(asset.terrains ?? [])]
      .join(' ')
      .toLowerCase()
      .includes(normalizedCatalogQuery);
  };
  const visibleCatalogBaseAssets = catalogBaseAssets.filter(matchesCatalogQuery);
  const visibleCatalogCount = selectedCollectionFilters.includes('base') ? visibleCatalogBaseAssets.length : 0;
  const selectedTransitionSlot = selectedSlotMask
    ? transitionSlotsForPair(selectedPair, transitionAssets).find((slot) => slot.mask === selectedSlotMask)
    : undefined;
  const selectedAssetPair = selectedAsset.pairId ? transitionPairById(selectedAsset.pairId) : undefined;
  const selectedAssetTransitionSlot =
    selectedAssetPair && selectedAsset.socketMask
      ? transitionSlotsForPair(selectedAssetPair, transitionAssets).find((slot) => slot.mask === selectedAsset.socketMask)
      : undefined;
  const viewTransitionSlot = selectedTransitionSlot ?? selectedAssetTransitionSlot;
  const viewTransitionPair = selectedTransitionSlot ? selectedPair : selectedAssetPair;
  const viewTransitionAsset = selectedTransitionSlot ? selectedTransitionSlot.assets[0] : selectedAssetTransitionSlot ? selectedAsset : undefined;
  const viewKind = tileFilter === 'board' ? 'board' : viewTransitionSlot ? 'transition' : 'tile';
  const viewVisualKind = viewKind === 'transition' && transitionViewMode === 'tile' ? 'tile' : viewKind;
  const inspectedAnimatedAsset =
    viewKind === 'transition' && viewTransitionAsset?.animation
      ? viewTransitionAsset
      : viewKind === 'tile' && selectedAsset.animation
        ? selectedAsset
        : undefined;
  const inspectedAnimation = inspectedAnimatedAsset?.animation;
  const animationFrameCount = inspectedAnimation?.frames.length ?? 8;
  const autoAnimationFrame = useAnimationClock(animationPlaying, animationFrameCount, inspectedAnimation?.frameMs ?? 150);
  const animationFrame = inspectedAnimation ? (animationPlaying ? autoAnimationFrame : manualAnimationFrame) : autoAnimationFrame;

  useEffect(() => {
    const shell = document.querySelector('.shell');
    shell?.classList.add('tileset-studio-active');
    return () => shell?.classList.remove('tileset-studio-active');
  }, []);

  useEffect(() => {
    const assetSources = allStudioAssets.flatMap((asset) => [asset.src, ...(asset.animation?.frames ?? [])]);
    const preloadedImages = Array.from(new Set(assetSources)).map((src) => {
      const image = new Image();
      image.decoding = 'sync';
      image.src = src;
      return image;
    });

    return () => {
      preloadedImages.forEach((image) => {
        image.src = '';
      });
    };
  }, [allStudioAssets]);

  useEffect(() => {
    const syncFromRoute = () => {
      const route = readTilesetStudioRoute();
      const routeFamily = studioFamilyById(route.familyId);
      setFamilyId(route.familyId);
      setSelectedFamilyIds([route.familyId]);
      setStudioMode(route.studioMode);
      if (route.category) setCategory(route.category);
      if (route.selectedAssetName) setSelectedAssetName(route.selectedAssetName);
      if (route.selectedArtworkName) setSelectedArtworkName(route.selectedArtworkName);
      if (route.selectedGlossaryName) setSelectedGlossaryName(route.selectedGlossaryName);
      if (route.selectedTileSideId) setSelectedTileSideId(route.selectedTileSideId);
      if (route.selectedFrameName) setSelectedFrameName(route.selectedFrameName);
      if (route.viewerKind) setViewerKind(route.viewerKind);
      setViewHasTarget(Boolean(route.selectedAssetId || route.selectedSlotMask || route.tileFilter === 'board'));
      setTileFilter(route.tileFilter);
      setLabMode(route.labMode);
      if (route.tileFilter !== 'board') setSelectedCollectionFilters([route.tileFilter]);
      setSelectedPairId(route.selectedPairId);
      setSelectedAssetId(route.selectedAssetId ?? routeFamily.assets[0].id);
      setSelectedSlotMask(route.selectedSlotMask);
      setTransitionViewMode(defaultTransitionViewModeForRoute(route));
      setBoardMode(route.boardMode);
      setBoardScope(route.boardScope);
      setBoardSize(route.boardSize);
      setBoardSeed(route.boardSeed);
      setBrushKind(route.brushKind);
      if (route.brushKind === 'unit') setTool('brush');
      if (route.selectedUnitId) setUnitBrushId(route.selectedUnitId);
    };

    window.addEventListener('popstate', syncFromRoute);
    return () => window.removeEventListener('popstate', syncFromRoute);
  }, []);

  useEffect(() => {
    if (!allStudioAssets.some((asset) => asset.id === selectedAssetId)) {
      setSelectedAssetId(family.assets[0].id);
      setSelectedSlotMask(undefined);
    }
  }, [allStudioAssets, family.assets, selectedAssetId]);

  useEffect(() => {
    if (!familyTransitionPairs.some((pair) => pair.id === selectedPairId)) {
      setSelectedPairId(familyTransitionPairs[0]?.id ?? 'grass-stone');
    }
  }, [familyTransitionPairs, selectedPairId]);

  useEffect(() => {
    const visibleAssets = tileFilter === 'base' ? family.assets.filter((asset) => asset.kind === 'tile') : [];
    if (tileFilter !== 'board' && visibleAssets.length > 0) {
      setSelectedAssetId((currentAssetId) => (visibleAssets.some((asset) => asset.id === currentAssetId) ? currentAssetId : visibleAssets[0].id));
    }
  }, [family, selectedPair.id, tileFilter]);

  useEffect(() => {
    setSelectedSlotMask(undefined);
  }, [tileFilter]);

  useEffect(() => {
    setManualAnimationFrame((frame) => frame % animationFrameCount);
  }, [animationFrameCount, inspectedAnimatedAsset?.id]);

  useEffect(() => {
    setViewPan({ x: 0, y: 0 });
    setViewZoom(defaultViewZoom(viewVisualKind));
  }, [boardMode, boardScope, boardSeed, boardSize, selectedAsset.id, selectedSlotMask, viewVisualKind]);

  useEffect(() => {
    writeTilesetStudioRoute({
      familyId,
      studioMode,
      category,
      selectedAssetName,
      selectedArtworkName,
      selectedGlossaryName,
      selectedPageName,
      selectedTileSideId,
      selectedFrameName,
      viewerKind,
      labMode,
      tileFilter,
      selectedPairId,
      selectedAssetId: viewHasTarget ? selectedAsset.id : undefined,
      selectedSlotMask: viewHasTarget ? selectedSlotMask : undefined,
      boardMode,
      boardScope,
      boardSize,
      boardSeed,
      brushKind,
      selectedUnitId: unitBrushId,
    });
  }, [boardMode, boardScope, boardSeed, boardSize, brushKind, category, familyId, labMode, selectedAsset.id, selectedAssetName, selectedArtworkName, selectedGlossaryName, selectedPageName, selectedTileSideId, selectedFrameName, viewerKind, selectedPairId, selectedSlotMask, studioMode, tileFilter, unitBrushId, viewHasTarget]);

  // Returning to the Catalog (from the Viewer/Lab, or a deep-link) must land you on
  // the card you came from — not the top of the grid. The selection is already kept
  // (the card is highlighted); here we scroll that highlighted card into view inside
  // the catalog's scroll pane. Fires when you (re)enter Catalog mode; the active
  // category's grid is mounted by then. Not keyed on category, so a manual category
  // switch while browsing doesn't yank the scroll.
  useEffect(() => {
    if (studioMode !== 'catalog') return;
    const raf = window.requestAnimationFrame(() => {
      const card = document.querySelector('.tileset-studio-shell .tileset-studio-tab-panel .tileset-studio-card.is-selected');
      card?.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
    return () => window.cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioMode]);

  const toggleFamilyFilter = (nextFamilyId: StudioFamilyId) => {
    setSelectedFamilyIds((current) => {
      const next = current.includes(nextFamilyId) ? current.filter((item) => item !== nextFamilyId) : [...current, nextFamilyId];
      if (next.length > 0) {
        setFamilyId(next[0]);
      }
      if (next.length > 0 && !next.includes(familyId)) {
        const nextFamily = studioFamilyById(next[0]);
        setSelectedAssetId(familySample(nextFamily).id);
        setSelectedSlotMask(undefined);
      }
      return next;
    });
  };

  // Every catalog card (tile/unit/doodad, paintbrush + inspect) now opens the standalone
  // Level Editor with that asset pre-armed as the brush — the in-studio board lab is retired.
  const openInLevelEditor = (kind: 'tile' | 'unit' | 'doodad', id: string): void => {
    navigateApp(`/level-editor?from=studio&kind=${kind}&brush=${encodeURIComponent(id)}`);
  };

  const viewSubtitle =
    labMode === 'unit'
      ? `${unitBrushAsset.family} unit · ${selectedAsset.label} tile`
      : viewKind === 'board'
      ? `${boardScope === 'family' ? selectedFamilyLabel : 'Mixed terrain'} · seed ${boardSeed}`
      : viewKind === 'transition'
        ? `${viewTransitionPair?.label ?? 'Transition'} · mask ${viewTransitionSlot?.code ?? selectedAsset.socketMask ?? ''}`
        : `${family.label} · ${selectedAsset.role}`;
  const normalizedUnitQuery = catalogQuery.trim().toLowerCase();
  const visibleUnits = normalizedUnitQuery
    ? unitAssets.filter((unit) => [unit.label, unit.badge, unit.family, unit.read, unit.status].join(' ').toLowerCase().includes(normalizedUnitQuery))
    : unitAssets;
  const openCatalogMode = (): void => {
    if (tileFilter === 'board') setTileFilter('base');
    setStudioMode('catalog');
  };
  const openViewer = (kind: ViewerKind): void => {
    setViewerKind(kind);
    setStudioMode('viewer');
  };
  const selectUnitInCatalog = (unitId: string): void => {
    setUnitBrushId(unitId);
  };
  const selectDoodadInCatalog = (doodadId: string): void => {
    setDoodadBrushId(doodadId);
  };
  // Catalog asset-type descriptors. The generic <CatalogGrid>/<CatalogControls>
  // render either of these; a new asset type is just another descriptor.
  const tileFamilyOf = new Map<string, StudioFamilyId>();
  for (const fam of studioFamilies) for (const a of fam.assets) tileFamilyOf.set(a.id, fam.id);
  for (const a of nonProductionStudioTiles) tileFamilyOf.set(a.id, nonProductionTileFamilyOf.get(a.id) ?? 'grass');
  const tilesCatalogType: CatalogType<StudioAsset> = {
    id: 'tiles',
    label: 'Tiles',
    assets: [...studioFamilies.flatMap((fam) => fam.assets), ...nonProductionStudioTiles],
    card: (a) => ({ img: assetFrameSrc(a, animationFrame), title: a.label, badge: a.role }),
    sections: (visible) => {
      const tiles = visible.filter((a) => a.kind === 'tile');
      const prod = tiles.filter((a) => !a.speculative);
      const spec = tiles.filter((a) => a.speculative);
      const out: { id: string; label: string; assets: StudioAsset[] }[] = [];
      if (prod.length) out.push({ id: 'base', label: 'Base Tiles', assets: prod });
      if (spec.length) out.push({ id: 'non-production', label: 'Non-production — reference & rejected bake-off methods', assets: spec });
      return out;
    },
    query: {
      value: catalogQuery,
      set: setCatalogQuery,
      placeholder: 'label, source, socket...',
      match: (a, q) => [a.label, a.role, a.source, a.notes, a.method ?? '', a.speculative ? 'non-production speculative' : '', ...(a.terrains ?? [])].join(' ').toLowerCase().includes(q),
    },
    zoom: { value: zoom, set: setZoom, min: 0.75, max: 2, step: 0.05, cssVar: '--tile-zoom' },
    filters: [
      {
        id: 'family',
        label: 'Tile Family',
        options: studioFamilies.map((fam) => ({ id: fam.id, label: fam.label, sub: familyCounts(fam) })),
        memberOf: (a) => [tileFamilyOf.get(a.id) ?? 'grass'],
        selected: selectedFamilyIds,
        toggle: (id) => toggleFamilyFilter(id as StudioFamilyId),
        selectAll: () => setSelectedFamilyIds(studioFamilies.map((fam) => fam.id)),
        clear: () => setSelectedFamilyIds([]),
      },
    ],
    onSelect: (a) => { setSelectedAssetId(a.id); setSelectedSlotMask(undefined); },
    onView: (a) => openInLevelEditor('tile', a.id),
    onArm: (a) => openInLevelEditor('tile', a.id),
    selectedId: selectedAssetId,
  };
  const unitFamilyCount = (family: PieceId) => unitAssets.filter((u) => u.family === family).length;
  const unitsCatalogType: CatalogType<UnitAsset> = {
    id: 'units',
    label: 'Units',
    assets: unitAssets,
    card: (u) => ({ img: hasDirectionSprite(u, catalogFacing) ? u.sprite('navy-blue', catalogFacing) : u.preview, title: u.label, badge: u.badge, isUnit: true }),
    sections: (visible) => {
      const prod = visible.filter((u) => !u.speculative);
      const spec = visible.filter((u) => u.speculative);
      const out: { id: string; label: string; assets: UnitAsset[] }[] = [];
      if (prod.length) out.push({ id: 'production', label: 'Production Units', assets: prod });
      if (spec.length) out.push({ id: 'speculative', label: 'Speculative — pixel-art candidate libraries (navy only)', assets: spec });
      return out;
    },
    query: {
      value: catalogQuery,
      set: setCatalogQuery,
      placeholder: 'piece, library, read...',
      match: (u, q) => [u.label, u.badge, u.family, u.read, u.status, u.method ?? '', u.speculative ? 'speculative' : 'production'].join(' ').toLowerCase().includes(q),
    },
    zoom: { value: zoom, set: setZoom, min: 0.75, max: 2, step: 0.05, cssVar: '--tile-zoom' },
    filters: [
      {
        id: 'family',
        label: 'Unit Family',
        options: activeUnitFamilies.map((family) => {
          const n = unitFamilyCount(family);
          return { id: family, label: familyLabels[family], sub: `${n} ${n === 1 ? 'unit' : 'units'}` };
        }),
        memberOf: (u) => [u.family],
        selected: selectedUnitFamilies,
        toggle: (id) => setSelectedUnitFamilies((cur) => (cur.includes(id as PieceId) ? cur.filter((x) => x !== id) : [...cur, id as PieceId])),
        selectAll: () => setSelectedUnitFamilies(activeUnitFamilies),
        clear: () => setSelectedUnitFamilies([]),
      },
      {
        id: 'method',
        label: 'Library',
        options: UNIT_METHOD_OPTIONS.map((m) => {
          const n = unitAssets.filter((u) => (u.method ?? 'Production') === m.id).length;
          return { id: m.id, label: m.label, sub: `${m.sub} · ${n}` };
        }),
        memberOf: (u) => [u.method ?? 'Production'],
        selected: selectedUnitMethods,
        toggle: (id) => setSelectedUnitMethods((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])),
        selectAll: () => setSelectedUnitMethods(UNIT_METHOD_OPTIONS.map((m) => m.id)),
        clear: () => setSelectedUnitMethods([]),
      },
    ],
    onSelect: (u) => selectUnitInCatalog(u.id),
    onView: (u) => openInLevelEditor('unit', u.id),
    onArm: (u) => openInLevelEditor('unit', u.id),
    selectedId: unitBrushId,
    extra: (
      <div className="tileset-catalog-facing">
        <span>Facing</span>
        <FacingCompass direction={catalogFacing} onSelect={setCatalogFacing} onRotate={rotateCatalogFacingCw} />
      </div>
    ),
    note: 'Select a unit card to place it in the shared lab board.',
  };
  const doodadsCatalogType: CatalogType<DoodadAsset> = {
    id: 'doodads',
    label: 'Doodads',
    assets: DOODAD_ASSETS,
    card: (d) => ({ img: d.front, title: d.label, badge: d.terrains.join(', ') }),
    sections: (visible) => [{ id: 'doodads', label: 'Doodads', assets: [...visible] }],
    query: {
      value: catalogQuery,
      set: setCatalogQuery,
      placeholder: 'doodad, terrain, status...',
      match: (d, q) => [d.label, d.status, ...d.terrains].join(' ').toLowerCase().includes(q),
    },
    zoom: { value: zoom, set: setZoom, min: 0.75, max: 2, step: 0.05, cssVar: '--tile-zoom' },
    filters: [
      {
        id: 'terrain',
        label: 'Home Terrain',
        options: studioFamilies.map((fam) => {
          const n = DOODAD_ASSETS.filter((d) => d.terrains.includes(fam.id)).length;
          return { id: fam.id, label: fam.label, sub: `${n} ${n === 1 ? 'doodad' : 'doodads'}` };
        }),
        memberOf: (d) => d.terrains,
        selected: selectedDoodadTerrains,
        toggle: (id) => setSelectedDoodadTerrains((cur) => (cur.includes(id as StudioFamilyId) ? cur.filter((x) => x !== id) : [...cur, id as StudioFamilyId])),
        selectAll: () => setSelectedDoodadTerrains(studioFamilies.map((fam) => fam.id)),
        clear: () => setSelectedDoodadTerrains([]),
      },
    ],
    onSelect: (d) => selectDoodadInCatalog(d.id),
    onView: (d) => openInLevelEditor('doodad', d.id),
    onArm: (d) => openInLevelEditor('doodad', d.id),
    selectedId: doodadBrushId,
    note: 'Doodads place only on their home terrain. Pick one to arm the brush, then paint a matching tile.',
  };

  // Artwork browses via a bespoke library component (not a CatalogType), so it wires the
  // shared Filters dropdown directly: one dimension, the manifest Group. memberOf is unused
  // here (CatalogFilters only reads options/selected/toggle); the grid filters in the component.
  const artworkGroupFilter: CatalogFilterDim<{ id: string }> = {
    id: 'group',
    label: 'Group',
    options: ARTWORK_GROUPS.map((g) => ({ id: g.id, label: g.label, sub: `${g.count} ${g.count === 1 ? 'piece' : 'pieces'}` })),
    memberOf: () => [],
    selected: selectedArtworkGroups,
    toggle: (id) => setSelectedArtworkGroups((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])),
    selectAll: () => setSelectedArtworkGroups(ARTWORK_GROUPS.map((g) => g.id)),
    clear: () => setSelectedArtworkGroups([]),
  };

  // Portraits — the bake-off as its own catalog category, so portraits get their own
  // Unit (piece) and Treatment (method) filters. Cards render through the accepted
  // per-piece crop (loadCrops + CroppedView via cardMedia), navy-only, held out of game.
  const portraitCatalogCrops = loadCrops();
  const portraitsCatalogType: CatalogType<PortraitCandidateAsset> = {
    id: 'portraits',
    label: 'Portraits',
    assets: PORTRAIT_CANDIDATE_ASSETS,
    card: (a) => ({ img: portraitMasterSrc(a.piece, 'navy-blue', a.method), title: a.methodLabel, badge: a.methodSub }),
    cardMedia: (a) => (
      <span className="studio-portrait-crop">
        <CroppedView src={portraitMasterSrc(a.piece, 'navy-blue', a.method)} crop={portraitCatalogCrops[a.piece]} />
      </span>
    ),
    sections: (visible) => PORTRAIT_PIECES
      .map((piece) => ({ id: piece, label: familyLabels[piece], assets: visible.filter((a) => a.piece === piece) }))
      .filter((s) => s.assets.length),
    query: {
      value: catalogQuery,
      set: setCatalogQuery,
      placeholder: 'piece, treatment...',
      match: (a, q) => [familyLabels[a.piece], a.methodLabel, a.methodSub, a.method].join(' ').toLowerCase().includes(q),
    },
    zoom: { value: zoom, set: setZoom, min: 0.75, max: 2, step: 0.05, cssVar: '--tile-zoom' },
    filters: [
      {
        id: 'piece',
        label: 'Unit',
        options: PORTRAIT_PIECES.map((piece) => ({ id: piece, label: familyLabels[piece], sub: `${PORTRAIT_METHODS.length} treatments` })),
        memberOf: (a) => [a.piece],
        selected: selectedPortraitPieces,
        toggle: (id) => setSelectedPortraitPieces((cur) => (cur.includes(id as PortraitPiece) ? cur.filter((x) => x !== id) : [...cur, id as PortraitPiece])),
        selectAll: () => setSelectedPortraitPieces([...PORTRAIT_PIECES]),
        clear: () => setSelectedPortraitPieces([]),
      },
      {
        id: 'method',
        label: 'Treatment',
        options: PORTRAIT_METHODS.map((m) => ({ id: m.key, label: m.label, sub: m.sub })),
        memberOf: (a) => [a.method],
        selected: selectedPortraitMethods,
        toggle: (id) => setSelectedPortraitMethods((cur) => (cur.includes(id as PortraitMethod) ? cur.filter((x) => x !== id) : [...cur, id as PortraitMethod])),
        selectAll: () => setSelectedPortraitMethods(PORTRAIT_METHODS.map((m) => m.key)),
        clear: () => setSelectedPortraitMethods([]),
      },
    ],
    onSelect: (a) => setSelectedPortraitId(a.id),
    onView: () => openViewer('portrait'),
    selectedId: selectedPortraitId,
    note: 'Navy-only bake-off. The compare-at-HUD-framing grid is in Viewer › Portrait.',
  };

  // The catalog is one registry, not a chain of `category === …` branches: every
  // category supplies its grid (`main`) and its rail body (`controls`), and the
  // selector tabs / main pane / controls are rendered by mapping or reading the
  // active entry. Adding a category is one entry here — it cannot ship missing a
  // shared control. (docs/studio-control-architecture.md)
  // Tile SIDES — a read-only inspection catalog. Same tiles as the placement catalog (plus the
  // frayed perimeter edges), but routed to the Viewer instead of the Level Editor, and with no
  // 🖌 arm action — it's for scrutinising the cliff/side faces, not painting. Descriptor path,
  // so Search + family filter + Zoom + View-Selected come for free (ADR-0029).
  const tileSideFamilies = Object.keys(tileFamilies) as TileFamilyId[];
  const tileSidesCatalogType: CatalogType<TileSideItem> = {
    id: 'tilesides',
    label: 'Tile Sides',
    assets: TILE_SIDE_ITEMS,
    card: (item) => ({ img: item.src, title: item.label, badge: item.role }),
    sections: (visible) => {
      const edges = visible.filter((item) => item.role === 'edge');
      const base = visible.filter((item) => item.role !== 'edge');
      const out: { id: string; label: string; assets: TileSideItem[] }[] = [];
      if (base.length) out.push({ id: 'tiles', label: 'Tiles', assets: base });
      if (edges.length) out.push({ id: 'edges', label: 'Frayed perimeter edges', assets: edges });
      return out;
    },
    query: {
      value: tileSideSearch,
      set: setTileSideSearch,
      placeholder: 'family, role...',
      match: (item, q) => [item.label, item.family, item.role].join(' ').toLowerCase().includes(q),
    },
    zoom: { value: zoom, set: setZoom, min: 0.75, max: 2, step: 0.05, cssVar: '--tile-zoom' },
    filters: [
      {
        id: 'family',
        label: 'Tile Family',
        options: tileSideFamilies.map((fam) => ({ id: fam, label: terrainLabels[fam], sub: `${tileSideFamilyCount(fam)} tiles` })),
        memberOf: (item) => [item.family],
        selected: selectedSideFamilies,
        toggle: (id) => setSelectedSideFamilies((cur) => (cur.includes(id as TileFamilyId) ? cur.filter((x) => x !== id) : [...cur, id as TileFamilyId])),
        selectAll: () => setSelectedSideFamilies(tileSideFamilies),
        clear: () => setSelectedSideFamilies([]),
      },
    ],
    onSelect: (item) => setSelectedTileSideId(item.id),
    onView: (item) => { setSelectedTileSideId(item.id); openViewer('tileside'); },
    selectedId: selectedTileSideId,
    note: 'Inspect each tile’s cliff/side faces — includes the frayed perimeter edges.',
  };
  const catalogCategories: { id: StudioCategory; label: string; hint: string; main: ReactElement; controls: ReactElement }[] = [
    {
      id: 'tiles', label: 'Tiles', hint: 'Browse terrain tiles.',
      main: <CatalogGrid type={tilesCatalogType} />,
      controls: <CatalogControls type={tilesCatalogType} />,
    },
    {
      id: 'tilesides', label: 'Tile Sides', hint: 'Inspect the cliff/side faces of every tile, including the frayed perimeter edges.',
      main: <CatalogGrid type={tileSidesCatalogType} />,
      controls: <CatalogControls type={tileSidesCatalogType} />,
    },
    {
      id: 'units', label: 'Units', hint: 'Browse chess-piece units.',
      main: <CatalogGrid type={unitsCatalogType} />,
      controls: <CatalogControls type={unitsCatalogType} />,
    },
    {
      id: 'doodads', label: 'Doodads', hint: 'Browse terrain doodads (placed on matching tiles).',
      main: <CatalogGrid type={doodadsCatalogType} />,
      controls: <CatalogControls type={doodadsCatalogType} />,
    },
    {
      id: 'assets', label: 'Assets', hint: 'Browse the UI-kit asset library.',
      main: <AssetLibraryStudio filters={assetFilters} search={assetSearch} zoom={zoom} selected={selectedAssetName} onSelect={setSelectedAssetName} />,
      controls: (
        <>
          <label className="tileset-catalog-search">
            <span>Search</span>
            <input type="search" value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="asset name…" />
          </label>
          <label className="tileset-catalog-zoom">
            <span>Zoom</span>
            <input type="range" min="0.75" max="2" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          </label>
          <div className="tileset-filter-field">
            <span>Screen</span>
            <div className="tileset-tier-seg" aria-label="Filter by screen">
              {ASSET_TYPE_FACETS.map((opt) => (
                <button key={opt.value} type="button" className={assetFilters.type === opt.value ? 'is-active' : ''} onClick={() => setAssetFilters((s) => ({ ...s, type: opt.value }))}>{opt.label}</button>
              ))}
            </div>
          </div>
          <div className="tileset-filter-field">
            <span>Provenance</span>
            <div className="tileset-tier-seg" aria-label="Filter by provenance">
              {(['all', 'forged', 'original'] as const).map((option) => (
                <button key={option} type="button" className={assetFilters.prov === option ? 'is-active' : ''} onClick={() => setAssetFilters((s) => ({ ...s, prov: option }))}>
                  {option === 'all' ? 'All' : option === 'forged' ? 'Forged' : 'Original'}
                </button>
              ))}
            </div>
          </div>
          <div className="tileset-filter-field">
            <span>Gate</span>
            <div className="tileset-tier-seg" aria-label="Filter by gate result">
              {(['all', 'pass', 'fail'] as const).map((option) => (
                <button key={option} type="button" className={assetFilters.gate === option ? 'is-active' : ''} onClick={() => setAssetFilters((s) => ({ ...s, gate: option }))}>
                  {option === 'all' ? 'All' : option === 'pass' ? 'Pass' : 'Fail'}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="tileset-view-action" onClick={() => openViewer('asset')}>View Selected</button>
        </>
      ),
    },
    {
      id: 'artwork', label: 'Artwork', hint: 'Browse the artwork library — scenes, portraits, key art, concepts.',
      main: (
        <ArtworkLibraryStudio
          search={artworkSearch}
          zoom={zoom}
          groups={selectedArtworkGroups}
          selected={selectedArtworkName}
          onSelect={setSelectedArtworkName}
          onView={(id) => { setSelectedArtworkName(id); openViewer('artwork'); }}
          onEditPortrait={() => openViewer('portrait')}
        />
      ),
      controls: (
        <>
          <label className="tileset-catalog-search">
            <span>Search</span>
            <input type="search" value={artworkSearch} onChange={(event) => setArtworkSearch(event.target.value)} placeholder="artwork name…" />
          </label>
          <label className="tileset-catalog-zoom">
            <span>Zoom</span>
            <input type="range" min="0.75" max="2" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          </label>
          <CatalogFilters filters={[artworkGroupFilter]} />
          <button type="button" className="tileset-view-action" onClick={() => openViewer('artwork')}>View Selected</button>
        </>
      ),
    },
    {
      id: 'portraits', label: 'Portraits', hint: 'Browse the unit portrait bake-off — filter by unit and treatment.',
      main: <CatalogGrid type={portraitsCatalogType} />,
      controls: <CatalogControls type={portraitsCatalogType} />,
    },
    {
      id: 'glossary', label: 'Glossary', hint: 'Vocabulary + the agreed process docs (how chrome renders, etc.).',
      main: (
        <GlossaryLibraryStudio
          search={glossarySearch}
          selected={selectedGlossaryName}
          onSelect={setSelectedGlossaryName}
          onView={(term) => { setSelectedGlossaryName(term); openViewer('glossary'); }}
        />
      ),
      controls: (
        <>
          <label className="tileset-catalog-search">
            <span>Search</span>
            <input type="search" value={glossarySearch} onChange={(event) => setGlossarySearch(event.target.value)} placeholder="term…" />
          </label>
          <button type="button" className="tileset-view-action" onClick={() => openViewer('glossary')}>View Selected</button>
        </>
      ),
    },
    {
      id: 'surfaces', label: 'Surfaces', hint: 'Browse accepted background surfaces — seamless, tileable pixel-art tiles.',
      main: <SurfaceLibraryStudio search={surfaceSearch} zoom={zoom} selected={selectedSurfaceName} onSelect={setSelectedSurfaceName} />,
      controls: (
        <>
          <label className="tileset-catalog-search">
            <span>Search</span>
            <input type="search" value={surfaceSearch} onChange={(event) => setSurfaceSearch(event.target.value)} placeholder="surface, material…" />
          </label>
          <label className="tileset-catalog-zoom">
            <span>Zoom</span>
            <input type="range" min="0.75" max="2" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          </label>
          <button type="button" className="tileset-view-action" onClick={() => openViewer('surface')}>View Selected</button>
        </>
      ),
    },
    {
      id: 'scrollbars', label: 'Scrollbars', hint: 'Scrollbar-grip candidates — carved wooden elements. PixelLab is the current preferred default.',
      main: <ScrollbarLibraryStudio search={scrollbarSearch} zoom={zoom} selected={selectedScrollbarName} onSelect={setSelectedScrollbarName} />,
      controls: (
        <>
          <label className="tileset-catalog-search">
            <span>Search</span>
            <input type="search" value={scrollbarSearch} onChange={(event) => setScrollbarSearch(event.target.value)} placeholder="scrollbar, approach…" />
          </label>
          <label className="tileset-catalog-zoom">
            <span>Zoom</span>
            <input type="range" min="0.75" max="2" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          </label>
          <button type="button" className="tileset-view-action" onClick={() => openViewer('scrollbar')}>View Selected</button>
        </>
      ),
    },
    {
      id: 'sliders', label: 'Sliders', hint: 'Slide-bar candidates — CSS-skinned native sliders. Bronze/stone (ADR-0025) is the current default; forged stone/wood material is pending.',
      main: <SliderLibraryStudio search={sliderSearch} zoom={zoom} selected={selectedSliderName} onSelect={setSelectedSliderName} />,
      controls: (
        <>
          <label className="tileset-catalog-search">
            <span>Search</span>
            <input type="search" value={sliderSearch} onChange={(event) => setSliderSearch(event.target.value)} placeholder="slider, material…" />
          </label>
          <label className="tileset-catalog-zoom">
            <span>Zoom</span>
            <input type="range" min="0.75" max="2" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          </label>
          <button type="button" className="tileset-view-action" onClick={() => openViewer('slider')}>View Selected</button>
        </>
      ),
    },
    {
      id: 'sfx', label: 'Sound Effects', hint: 'Audition the landing sounds — recorded foley (grass/water/sand) + the arrival thump. Played live.',
      main: <SfxLibraryStudio search={sfxSearch} zoom={zoom} selected={selectedSfxName} onSelect={setSelectedSfxName} />,
      controls: (
        <>
          <label className="tileset-catalog-search">
            <span>Search</span>
            <input type="search" value={sfxSearch} onChange={(event) => setSfxSearch(event.target.value)} placeholder="terrain, character…" />
          </label>
          <label className="tileset-catalog-zoom">
            <span>Zoom</span>
            <input type="range" min="0.75" max="2" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          </label>
          <button type="button" className="tileset-view-action" onClick={() => openViewer('sfx')}>Assign sounds…</button>
        </>
      ),
    },
    {
      id: 'pages', label: 'Pages', hint: 'Browse the app screens — inspect each live page; tune the Main Menu in place.',
      main: <PagesLibraryStudio search={pageSearch} selected={selectedPageName} onSelect={setSelectedPageName} />,
      controls: (
        <>
          <label className="tileset-catalog-search">
            <span>Search</span>
            <input type="search" value={pageSearch} onChange={(event) => setPageSearch(event.target.value)} placeholder="page name…" />
          </label>
          <button type="button" className="tileset-view-action" onClick={() => openViewer('page')}>View Selected</button>
        </>
      ),
    },
  ];
  const activeCatalog = catalogCategories.find((entry) => entry.id === category) ?? catalogCategories[0];

  // The Viewer's kind selector — which item type the Viewer shows. A dropdown, not a button
  // strip: eight kinds can't fit the 260px controls rail without clipping each label to its
  // initials, and a <select> mirrors the Catalog's category control. Injected as each Viewer
  // surface's header.
  const viewerKindSelect = (
    <label className="tileset-category-select" title="Which kind of item the Viewer shows.">
      <span>Viewer</span>
      <select value={viewerKind} onChange={(event) => setViewerKind(event.target.value as ViewerKind)} aria-label="Viewer kind">
        <option value="asset">Asset</option>
        <option value="artwork">Artwork</option>
        <option value="portrait">Portrait</option>
        <option value="nineslice">9-Slice</option>
        <option value="glossary">Glossary</option>
        <option value="surface">Surface</option>
        <option value="scrollbar">Scrollbar</option>
        <option value="slider">Slider</option>
        <option value="sfx">Sound Assignments</option>
        <option value="page">Page</option>
        <option value="tileside">Tile Sides</option>
      </select>
    </label>
  );

  // The studio workspace switcher (Catalog / Lab / Viewer). Per the title-bar
  // standardization (ADR-0023) it lives in the CONTROL PANEL, not the title bar:
  // it rides the top of the catalog controls rail and the Viewer labs' `header`
  // slot, so it shows in both modes while the bar carries only brand + account.
  const studioModeTabs = (
    <div className="tileset-mode-field">
      <span className="tileset-control-label">Workspace</span>
      <span className="tileset-mode-tabs" aria-label="Workspace">
        <button type="button" className={studioMode === 'catalog' ? 'is-active' : ''} onClick={openCatalogMode} title="Browse the catalogs.">
          Catalog
        </button>
        <button type="button" onClick={() => navigateApp('/level-editor?from=studio')} title="Open the Level Editor — paint tiles and units and set the board size.">
          Lab
        </button>
        <button type="button" className={studioMode === 'viewer' ? 'is-active' : ''} onClick={() => setStudioMode('viewer')} title="View one finished asset or artwork.">
          Viewer
        </button>
      </span>
    </div>
  );
  // Viewer labs render their controls through a `header` slot; lead it with the
  // workspace switcher so the relocated tabs sit atop the Viewer control panel too.
  const studioViewerHeader = <>{studioModeTabs}{viewerKindSelect}</>;

  return (
    <main className="tileset-studio-page app-shell-bar-pad">
      <section className={`tileset-studio-shell is-${studioMode} ${category === 'units' ? 'is-units' : ''} ${category === 'artwork' ? 'is-artwork' : ''}`} aria-label="Tileset browser">
        {studioMode === 'catalog' ? (
        <>
        {activeCatalog.main}
        <aside className="tileset-view-controls tileset-catalog-controls" aria-label="Catalog controls">
          <section className="tileset-inspector-section">
            <h2>Controls</h2>
            <div className="tileset-control-stack">
              {studioModeTabs}
              <label className="tileset-category-select" title={activeCatalog.hint}>
                <span>Category</span>
                <select value={category} onChange={(event) => setCategory(event.target.value as StudioCategory)} aria-label="Catalog category">
                  {catalogCategories.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.label}</option>
                  ))}
                </select>
              </label>
              {activeCatalog.controls}
            </div>
          </section>
        </aside>
        </>
        ) : studioMode === 'viewer' ? (
          viewerKind === 'portrait'
            ? <PortraitLab header={studioViewerHeader} />
            : viewerKind === 'nineslice'
            ? <NineSliceLab assetId={selectedFrameName} onAssetId={setSelectedFrameName} header={studioViewerHeader} />
            : viewerKind === 'artwork'
              ? <ArtworkLab name={selectedArtworkName} header={studioViewerHeader} />
              : viewerKind === 'glossary'
                ? <GlossaryLab name={selectedGlossaryName} header={studioViewerHeader} />
                : viewerKind === 'surface'
                  ? <SurfaceViewer name={selectedSurfaceName} header={studioViewerHeader} />
                  : viewerKind === 'scrollbar'
                    ? <ScrollbarViewer name={selectedScrollbarName} header={studioViewerHeader} />
                    : viewerKind === 'slider'
                      ? <SliderViewer name={selectedSliderName} header={studioViewerHeader} />
                      : viewerKind === 'page'
                        ? <PagesViewer name={selectedPageName} header={studioViewerHeader} />
                        : viewerKind === 'tileside'
                          ? <TileSidesViewer name={selectedTileSideId} header={studioViewerHeader} />
                          : viewerKind === 'sfx'
                            ? <SfxViewer header={studioViewerHeader} />
                            : <AssetLab name={selectedAssetName} header={studioViewerHeader} onEditFrame={(id) => { setSelectedFrameName(id); openViewer('nineslice'); }} />
        ) : null}
      </section>
    </main>
  );
}
