// Design catalog data + geometry helpers, ported verbatim from the legacy
// app.js design surfaces (recovered from git 8b438a5~1). This is the source of
// truth the user iterated on across ~50 turns in session 930: the classification
// tree (is-a, deliberately shallow), the glossary vocabulary (every term
// attested by an engine authority), and the five completed main-menu button
// widgets. Rendering reuses the original CSS (still in style.css), so the React
// surface is pixel-faithful to what was built.
import type { CSSProperties } from 'react';
import assetCatalogRaw from '../../asset-catalog.json';
import optimizedImagesRaw from './optimized-images.json';
import kitManifest from './kitManifest.json';

export interface Rect { x: number; y: number; w: number; h: number }
export interface AssetState { label?: string; rect: Rect }
export interface AssetRules {
  textInset?: Rect;
  contentInset?: Rect;
  iconSlot?: Rect;
  arrowSlot?: Rect;
  hitbox?: Rect;
  patchMargins?: { left: number; right: number; top: number; bottom: number };
  states?: string[];
  text?: string;
  sizing?: string;
  fitsSlot?: string;
  background?: string;
  notes?: string[];
}
export interface AssetSheet { image: string; width: number; height: number }
export interface AssetSource { kind?: string; image?: string; reference?: string; note?: string }
export interface Asset {
  id: string;
  type: string;
  status?: string;
  title?: string;
  summary?: string;
  source?: AssetSource;
  sheet?: AssetSheet;
  states?: Record<string, AssetState>;
  rect?: Rect;
  rules?: AssetRules;
}
interface AssetCatalogFile { schemaVersion: number; assets: Asset[] }

// The committed catalog and the files under frontend/public/assets are the
// source of truth for art assets. Do not route image bytes through Postgres;
// the database is reserved for gameplay/design data documents.
export const assetCatalog = assetCatalogRaw as unknown as AssetCatalogFile;

export function assetById(id: string): Asset | undefined {
  return (assetCatalog.assets || []).find((asset) => asset.id === id);
}

// ---------------------------------------------------------------------------
// Optimized runtime image formats (first-visit load). PNG sources stay
// authoritative on disk; the optimizer (scripts/optimize-main-menu-assets.mjs)
// emits AVIF + WebP siblings for the paths listed in optimized-images.json.
// imageCssValue() upgrades those specific paths to a CSS image-set() so the
// browser picks AVIF -> WebP -> PNG, while every other asset path is emitted
// as a plain url() exactly as before. The PNG remains the universal fallback.
// ---------------------------------------------------------------------------
interface OptimizedImagesFile { schemaVersion: number; targets: { path: string }[] }
const optimizedImages = optimizedImagesRaw as unknown as OptimizedImagesFile;
const OPTIMIZED_IMAGE_PATHS: ReadonlySet<string> = new Set(
  (optimizedImages.targets || []).map((target) => target.path),
);

function sanitizeCssUrl(raw: string): string {
  return String(raw || '').replace(/["'\\\n\r]/g, '');
}

// Returns a CSS <image> value for an asset image URL: an image-set() with
// AVIF/WebP/PNG candidates when the path has committed derivatives, otherwise a
// plain url(). Exported for the runtime asset surfaces and tests.
export function imageCssValue(imageUrl: string): string {
  const clean = sanitizeCssUrl(imageUrl);
  if (!clean) return 'none';
  if (clean.endsWith('.png') && OPTIMIZED_IMAGE_PATHS.has(clean)) {
    const variant = (ext: string) => clean.replace(/\.png$/, ext);
    return (
      `image-set(url(${variant('.avif')}) type("image/avif"), ` +
      `url(${variant('.webp')}) type("image/webp"), ` +
      `url(${clean}) type("image/png"))`
    );
  }
  return `url(${clean})`;
}

// The single URL the browser actually fetches for this image — the top candidate
// of imageCssValue's image-set (AVIF when optimized, else the PNG). Lets callers
// preload/await exactly what the CSS background will use, with no double-fetch.
export function bestImageUrl(imageUrl: string): string {
  const clean = sanitizeCssUrl(imageUrl);
  if (clean.endsWith('.png') && OPTIMIZED_IMAGE_PATHS.has(clean)) return clean.replace(/\.png$/, '.avif');
  return clean;
}

// ---------------------------------------------------------------------------
// The classification tree. asset → 9-slice → Main Menu; asset → icon → 5 icons;
// asset → sprite atlas (planned); widget → button → Main Menu → 5 buttons.
// "is-a" nesting, leaves labelled by entity only ("Main Menu", not "Main Menu
// 9 Slice") because the path is the classifier (session 930, turn 41).
// ---------------------------------------------------------------------------
export interface TreeNode { label: string; href: string; planned?: boolean; children?: TreeNode[] }

// The kit branch is generated from the manifest so the tree drills down to every
// individual glyph/frame (like `icon › Sword`), not just group nodes. Each leaf
// links to that one asset's detail view.
const KIT_TREE: TreeNode = {
  label: 'kit',
  href: '/design/catalog/kit',
  children: [
    ...kitManifest.groups.map((g) => ({
      label: g.label.split(' ·')[0],
      href: '/design/catalog/kit',
      children: g.items.map((it) => ({ label: it.name, href: `/design/catalog/kit/${it.name}` })),
    })),
    {
      label: 'Frames & components',
      href: '/design/catalog/kit',
      children: kitManifest.frames.map((f) => ({ label: f.name, href: `/design/catalog/kit/${f.name}` })),
    },
  ],
};

export const ASSET_TREE_PROTOTYPE: TreeNode[] = [
  {
    label: 'asset',
    href: '/design/catalog',
    children: [
      {
        label: '9-slice',
        href: '/design/catalog',
        children: [
          {
            label: 'button',
            href: '/design/catalog/9-slice/button',
            children: [
              { label: 'Main Menu', href: '/design/catalog/main-menu-buttons/button-9slice.main-menu' },
            ],
          },
          {
            label: 'panel',
            href: '/design/catalog/9-slice/panel',
            children: [
              { label: 'Main Menu', href: '/design/catalog/main-menu-panels/panel-9slice.main-menu.profile' },
              { label: 'Campaign Editor', href: '/design/catalog/campaign-editor-panels/panel-9slice.campaign-editor.large' },
            ],
          },
        ],
      },
      {
        label: 'Campaign Editor',
        href: '/design/catalog/campaign-editor-panels',
        children: [
          { label: 'Panels', href: '/design/catalog/campaign-editor-panels' },
          { label: 'Buttons', href: '/design/catalog/campaign-editor-buttons' },
          { label: 'Icon Buttons', href: '/design/catalog/campaign-editor-icon-buttons' },
          { label: 'Rows', href: '/design/catalog/campaign-editor-rows' },
          { label: 'Fields', href: '/design/catalog/campaign-editor-fields' },
          { label: 'Shields', href: '/design/catalog/campaign-editor-shields' },
        ],
      },
      {
        label: 'button row',
        href: '/design/catalog/main-menu-button-rows',
        children: [
          { label: 'Solo Skirmish', href: '/design/catalog/main-menu-button-rows/button-row.main-menu.solo-skirmish' },
          { label: 'Campaign Editor', href: '/design/catalog/main-menu-button-rows/button-row.main-menu.campaign-editor' },
          { label: 'Level Editor', href: '/design/catalog/main-menu-button-rows/button-row.main-menu.level-editor' },
          { label: 'Lobbies', href: '/design/catalog/main-menu-button-rows/button-row.main-menu.lobbies' },
          { label: 'Settings', href: '/design/catalog/main-menu-button-rows/button-row.main-menu.settings' },
        ],
      },
      {
        label: 'icon',
        href: '/design/catalog/main-menu-button-icons',
        children: [
          { label: 'Sword', href: '/design/catalog/main-menu-button-icons/button-icon.main-menu.sword' },
          { label: 'Crown', href: '/design/catalog/main-menu-button-icons/button-icon.main-menu.crown' },
          { label: 'Scroll', href: '/design/catalog/main-menu-button-icons/button-icon.main-menu.scroll' },
          { label: 'Players', href: '/design/catalog/main-menu-button-icons/button-icon.main-menu.people' },
          { label: 'Gear', href: '/design/catalog/main-menu-button-icons/button-icon.main-menu.gear' },
          { label: 'Profile Crest', href: '/design/catalog/main-menu-profile-icons/profile-icon.main-menu.crest' },
          { label: 'Allies Rook', href: '/design/catalog/main-menu-profile-icons/profile-icon.main-menu.rook-blue' },
          { label: 'Enemies Rook', href: '/design/catalog/main-menu-profile-icons/profile-icon.main-menu.rook-red' },
          { label: 'Profile Cog', href: '/design/catalog/main-menu-profile-icons/profile-icon.main-menu.cog' },
        ],
      },
      { label: 'sprite atlas', href: '#', planned: true },
    ],
  },
  KIT_TREE,
  {
    label: 'widget',
    href: '/design/catalog/widgets/main-menu',
    children: [
      {
        label: 'button',
        href: '/design/catalog/widgets/main-menu',
        children: [
          {
            label: 'Main Menu',
            href: '/design/catalog/widgets/main-menu',
            children: [
              { label: 'Solo Skirmish', href: '/design/catalog/widgets/main-menu/solo-skirmish' },
              { label: 'Campaign Editor', href: '/design/catalog/widgets/main-menu/campaign-editor' },
              { label: 'Level Editor', href: '/design/catalog/widgets/main-menu/level-editor' },
              { label: 'Lobbies', href: '/design/catalog/widgets/main-menu/lobbies' },
              { label: 'Settings', href: '/design/catalog/widgets/main-menu/settings' },
            ],
          },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Glossary — the shared vocabulary. Every term attested by Unity/Unreal/Godot
// docs (session 930, turns 17-18: "nothing loose gets in").
// ---------------------------------------------------------------------------
export interface GlossaryEntry { term: string; tag: string; def: string; src: string }

export const GLOSSARY: GlossaryEntry[] = [
  { term: 'asset', tag: '', def: 'A reusable image plus contract the game operates on: it renders, state-switches, slots into, or swaps it.', src: 'Unity / Unreal' },
  { term: 'button row', tag: 'asset', def: 'A stateful, mode-specific button skin whose badge/cap, frame, and arrow are authored together while the label stays live.', src: 'project' },
  { term: '9-slice', tag: 'asset', def: 'A texture that scales while its corners stay fixed and the middle stretches; the reusable, icon-less button or panel background.', src: 'Unity 9-slicing · Godot NinePatchRect' },
  { term: 'icon', tag: 'asset', def: 'A standalone image composited into a slot.', src: 'universal' },
  { term: 'sprite atlas', tag: 'asset', def: 'One image packing several unrelated sprites (our source sheets).', src: 'Unity Sprite Atlas' },
  { term: 'catalog', tag: '', def: 'The library of all assets, browsed sorted by type. It holds assets, not widgets.', src: 'project' },
  { term: 'type', tag: '', def: 'An inventory shelf: a kind of asset (9-slice, icon). The catalog tree top levels.', src: 'project' },
  { term: 'state', tag: '', def: 'A named visual variant: normal, pressed (later highlighted, selected, disabled).', src: 'Unity UI transitions' },
  { term: 'slot', tag: '', def: 'A labelled region of a 9-slice filled at runtime by an asset (icon) or live text: iconSlot, textInset, arrowSlot.', src: 'Unreal UMG' },
  { term: 'rect', tag: '', def: 'A pixel rectangle {x, y, w, h}; the bounds of a state or slot.', src: 'Unity Rect · Godot region_rect' },
  { term: 'patch margins', tag: '', def: 'The fixed border thicknesses of a 9-slice: the parts that do not stretch.', src: 'Unity / Godot' },
  { term: 'widget', tag: 'not an asset', def: 'The general term for an interactive element the player manipulates; assembled at runtime from assets, not a stored asset. Also called a control.', src: 'Unreal UMG · Wikipedia' },
  { term: 'button', tag: 'not an asset', def: 'A kind of widget: a clickable control. Widget is the general term; button is the specific kind. The Main Menu Button is the button this catalog builds from its 9-slice and icons.', src: 'Unity / Unreal / Godot Button' },
  { term: 'template', tag: 'not an asset', def: 'The reusable definition a widget instance is built from.', src: 'Unreal UI Template · Unity Prefab' },
  { term: 'instance', tag: 'not an asset', def: 'A specific live widget produced from a template.', src: 'all engines' },
  { term: 'split-layer doodad', tag: '', def: 'A terrain prop rendered as a back/front sprite pair split at the ground-contact plane, so a unit sorts between the halves and stands inside it.', src: 'project' },
];

// ---------------------------------------------------------------------------
// 9-slice categories — the contract layer. Every 9-slice has a MANDATORY
// category (button, panel, …); the category IS its contract — which slots and
// states a 9-slice of that type must expose — i.e. the "repeating idea" that
// maps to a class/type in code. A button 9-slice always has icon/text/arrow
// slots + normal/pressed; a panel 9-slice has a content inset + margins and no
// states. The def reads glossary-style ("a 9-slice of type button …").
// ---------------------------------------------------------------------------
export interface NineSliceCategory {
  id: string;
  label: string;
  def: string;
  slots: string[];
  states: string[];
  planned?: boolean;
}

export const NINE_SLICE_CATEGORIES: NineSliceCategory[] = [
  {
    id: 'button',
    label: 'Button',
    def: 'A 9-slice of type button: a stretchable button background that exposes an icon slot, a text (label) slot, and an arrow slot, with normal and pressed states. It is never placed on its own — a button widget is assembled on top of it (the 9-slice is the frame; the icon, label, and action composite in).',
    slots: ['iconSlot', 'textInset', 'arrowSlot', 'hitbox'],
    states: ['normal', 'pressed'],
  },
  {
    id: 'panel',
    label: 'Panel',
    def: 'A 9-slice of type panel: a stretchable container/surface background for grouping content (dialogs, cards, HUD panels). It exposes a content inset and patch margins — no icon, label, or arrow slots — and a single resting state.',
    slots: ['contentInset', 'patchMargins'],
    states: [],
  },
];

// Every 9-slice asset resolves to exactly one category (mandatory). Derived
// from the asset type's role prefix (button-9slice.* -> button); returns
// undefined only for a 9-slice with no known category, which the catalog flags.
export function nineSliceCategoryId(asset: Asset): string | undefined {
  if (asset.type.startsWith('button-9slice')) return 'button';
  if (asset.type.startsWith('panel-9slice')) return 'panel';
  return undefined;
}

export function nineSliceCategory(id: string): NineSliceCategory | undefined {
  return NINE_SLICE_CATEGORIES.find((category) => category.id === id);
}

// ---------------------------------------------------------------------------
// The five completed main-menu button widgets (live, assembled from assets).
// ---------------------------------------------------------------------------
export interface MenuMode { action: string; slug: string; icon: string; row: string; label: string }

export const MENU_MODES: MenuMode[] = [
  { action: 'party', slug: 'solo-skirmish', icon: 'button-icon.main-menu.sword', row: 'button-row.main-menu.solo-skirmish', label: 'Solo Skirmish' },
  { action: 'campaigns', slug: 'campaign-editor', icon: 'button-icon.main-menu.crown', row: 'button-row.main-menu.campaign-editor', label: 'Campaign Editor' },
  { action: 'level-editor-preview', slug: 'level-editor', icon: 'button-icon.main-menu.scroll', row: 'button-row.main-menu.level-editor', label: 'Level Editor' },
  { action: 'lobbies', slug: 'lobbies', icon: 'button-icon.main-menu.people', row: 'button-row.main-menu.lobbies', label: 'Lobbies' },
  { action: 'settings', slug: 'settings', icon: 'button-icon.main-menu.gear', row: 'button-row.main-menu.settings', label: 'Settings' },
];

// ---------------------------------------------------------------------------
// Geometry helpers (ported verbatim from app.js). frameStyleForAsset crops a
// sprite sheet to a rect via CSS custom properties the .catalog-frame /
// .mode-button-* rules consume; insetStyle positions a slot inside a frame.
// ---------------------------------------------------------------------------
export function frameStyleForAsset(asset: Asset, frame: Rect): CSSProperties {
  const sheet = asset.sheet || ({} as AssetSheet);
  const sheetWidth = Number(sheet.width) || frame.w || 1;
  const sheetHeight = Number(sheet.height) || frame.h || 1;
  const scaleX = (sheetWidth / frame.w) * 100;
  const scaleY = (sheetHeight / frame.h) * 100;
  const maxX = Math.max(1, sheetWidth - frame.w);
  const maxY = Math.max(1, sheetHeight - frame.h);
  const posX = maxX === 1 ? 0 : (frame.x / maxX) * 100;
  const posY = maxY === 1 ? 0 : (frame.y / maxY) * 100;
  return {
    '--asset-image': imageCssValue(sheet.image || ''),
    '--asset-bg-x': `${posX.toFixed(4)}%`,
    '--asset-bg-y': `${posY.toFixed(4)}%`,
    '--asset-bg-w': `${scaleX.toFixed(4)}%`,
    '--asset-bg-h': `${scaleY.toFixed(4)}%`,
    '--asset-aspect': `${frame.w} / ${frame.h}`,
  } as CSSProperties;
}

export function insetStyle(inset: Rect | undefined, frame: Rect | undefined): CSSProperties {
  if (!inset) return {};
  const frameWidth = Number(frame && frame.w) || 1;
  const frameHeight = Number(frame && frame.h) || 1;
  return {
    left: `${((inset.x / frameWidth) * 100).toFixed(3)}%`,
    top: `${((inset.y / frameHeight) * 100).toFixed(3)}%`,
    width: `${((inset.w / frameWidth) * 100).toFixed(3)}%`,
    height: `${((inset.h / frameHeight) * 100).toFixed(3)}%`,
  };
}

export function assetTypeLabel(type: string): string {
  if (type === 'button-9slice.campaign-editor') return 'Campaign Editor Button 9-Slice';
  if (type === 'field.campaign-editor') return 'Campaign Editor Field';
  if (type === 'icon-button.campaign-editor') return 'Campaign Editor Icon Button';
  if (type === 'panel-9slice.campaign-editor') return 'Campaign Editor Panel 9-Slice';
  if (type === 'row.campaign-editor') return 'Campaign Editor Row';
  if (type === 'shield.campaign-editor') return 'Campaign Editor Shield';
  if (type === 'button-9slice.main-menu') return 'Main Menu Button 9-Slice';
  if (type === 'button-row.main-menu') return 'Main Menu Button Row';
  if (type === 'panel-9slice.main-menu') return 'Main Menu Panel 9-Slice';
  if (type === 'button-icon.main-menu') return 'Main Menu Button Icon';
  if (type === 'profile-icon.main-menu') return 'Main Menu Profile Icon';
  return `${type[0].toUpperCase()}${type.slice(1)}`;
}

export function assetTypePath(type: string): string {
  if (type === 'button-9slice.campaign-editor') return '/design/catalog/campaign-editor-buttons';
  if (type === 'field.campaign-editor') return '/design/catalog/campaign-editor-fields';
  if (type === 'icon-button.campaign-editor') return '/design/catalog/campaign-editor-icon-buttons';
  if (type === 'panel-9slice.campaign-editor') return '/design/catalog/campaign-editor-panels';
  if (type === 'row.campaign-editor') return '/design/catalog/campaign-editor-rows';
  if (type === 'shield.campaign-editor') return '/design/catalog/campaign-editor-shields';
  if (type === 'button-9slice.main-menu') return '/design/catalog/main-menu-buttons';
  if (type === 'button-row.main-menu') return '/design/catalog/main-menu-button-rows';
  if (type === 'panel-9slice.main-menu') return '/design/catalog/main-menu-panels';
  if (type === 'button-icon.main-menu') return '/design/catalog/main-menu-button-icons';
  if (type === 'profile-icon.main-menu') return '/design/catalog/main-menu-profile-icons';
  return `/design/catalog/${type}s`;
}

export function assetPath(asset: Asset): string {
  return `${assetTypePath(asset.type)}/${encodeURIComponent(asset.id)}`;
}

// Glossary mode reuses the classification tree but drops the specific-entity
// leaves, leaving only the glossary-term nodes; each links to its definition.
export function pruneTreeToTerms(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .filter((node) => GLOSSARY.some((g) => g.term === node.label))
    .map((node) => {
      const kids = node.children ? pruneTreeToTerms(node.children) : [];
      const out: TreeNode = { label: node.label, href: `/design/catalog/glossary/${encodeURIComponent(node.label)}` };
      if (kids.length) out.children = kids;
      return out;
    });
}
