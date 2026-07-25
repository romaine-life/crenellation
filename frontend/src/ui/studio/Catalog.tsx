import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';

// One catalog, any asset type. A `CatalogType<A>` descriptor binds an asset type's
// data + actions to the host studio; <CatalogGrid> and <CatalogControls> render it
// generically. Adding an asset type is a new descriptor — no per-type chrome.

export interface CatalogFilterDim<A> {
  id: string;
  label: string;
  options: { id: string; label: string; sub?: string }[];
  /** Which option ids the asset belongs to (intersection with the selection filters it). */
  memberOf: (asset: A) => readonly string[];
  selected: readonly string[];
  toggle: (optionId: string) => void;
  selectAll: () => void;
  clear: () => void;
}

export interface CatalogCardModel {
  img: string;
  title: string;
  badge: string;
  /** Adds the unit card-image styling (taller, non-iso). */
  isUnit?: boolean;
}

export interface CatalogType<A extends { id: string }> {
  id: string;
  label: string;
  assets: readonly A[];
  card: (asset: A) => CatalogCardModel;
  /** Group the (already query+filter-filtered) assets into rendered sections. */
  sections: (visible: readonly A[]) => { id: string; label: string; assets: A[] }[];
  /** Present ⇒ a Search box; predicate runs against the lowercased query. */
  query?: { value: string; set: (value: string) => void; match: (asset: A, normalized: string) => boolean; placeholder?: string };
  /** Present ⇒ a Zoom slider; cssVar is set on each card image. */
  zoom?: { value: number; set: (value: number) => void; min: number; max: number; step: number; cssVar: string };
  /** Custom card media (e.g. a live-cropped portrait); when present it replaces the default <img>. */
  cardMedia?: (asset: A) => ReactNode;
  /** Present ⇒ active-filter chips + a Filters dropdown. */
  filters?: CatalogFilterDim<A>[];
  /** Select a card (highlight) without leaving the catalog. */
  onSelect: (asset: A) => void;
  /** Send a card to the Lab view. Also backs the "View Selected" rail button. */
  onView: (asset: A) => void;
  /** Arm the asset as the board brush (🖌). Omit for assets that can't be painted. */
  onArm?: (asset: A) => void;
  selectedId: string | undefined;
  /** Short helper line under the rail controls. */
  note?: string;
  emptyLabel?: string;
  /** Optional extra controls for this category's rail (e.g. the unit facing compass). */
  extra?: ReactNode;
}

/** Apply the descriptor's search + filter dimensions to its assets. */
export function catalogVisibleAssets<A extends { id: string }>(type: CatalogType<A>): A[] {
  const query = type.query?.value.trim().toLowerCase() ?? '';
  return type.assets.filter((asset) => {
    if (query && type.query && !type.query.match(asset, query)) return false;
    for (const dim of type.filters ?? []) {
      const member = dim.memberOf(asset);
      if (!member.some((id) => dim.selected.includes(id))) return false;
    }
    return true;
  });
}

const InspectIcon = (): ReactElement => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <rect x="1.6" y="6.4" width="12.8" height="8" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M8 1.2 V5.4 M5.4 3.2 L8 5.8 L10.6 3.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function CatalogCard<A extends { id: string }>({ type, asset }: { type: CatalogType<A>; asset: A }): ReactElement {
  const model = type.card(asset);
  const selected = asset.id === type.selectedId;
  const zoomStyle = type.zoom ? ({ [type.zoom.cssVar]: type.zoom.value } as CSSProperties) : undefined;
  const action = (run: () => void) => ({
    role: 'button' as const,
    tabIndex: 0,
    onClick: (event: React.MouseEvent) => { event.stopPropagation(); run(); },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); run(); }
    },
  });
  return (
    <button
      type="button"
      className={`tileset-studio-card ${model.isUnit ? 'is-unit' : ''} ${selected ? 'is-selected' : ''}`.replace(/\s+/g, ' ').trim()}
      onClick={() => type.onSelect(asset)}
      title={`Select ${model.title}`}
      aria-pressed={selected}
    >
      <span className={`tileset-studio-card-image ${model.isUnit ? 'unit-card-image' : ''}`.trim()} style={zoomStyle}>
        {type.cardMedia ? type.cardMedia(asset) : <img src={model.img} alt="" draggable={false} loading="eager" decoding="sync" />}
      </span>
      <span className="tileset-studio-card-meta">
        <span className="tileset-studio-card-text">
          <strong>{model.title}</strong>
          <em>{model.badge}</em>
        </span>
        <span className="tileset-card-actions">
          {type.onArm ? (
            <span className="tileset-card-action" title={`Use ${model.title} as the board brush`} aria-label={`Use ${model.title} as brush`} {...action(() => type.onArm!(asset))}>
              🖌
            </span>
          ) : null}
          <span className="tileset-card-action" title={`Inspect ${model.title}`} aria-label={`Inspect ${model.title}`} {...action(() => type.onView(asset))}>
            <InspectIcon />
          </span>
        </span>
      </span>
    </button>
  );
}

// Remember each catalog's scroll position. The catalog surface unmounts when the Studio
// switches to the Lab/Viewer (TilePreview studioMode), so leaving to inspect a tile and
// clicking "Catalog" to return would otherwise drop you back at the top. Keyed by catalog
// id and module-level so the value survives the unmount — UI-memory, per the studio's
// "each destination remembers its own last state" contract (docs/studio-control-architecture.md).
const catalogScrollMemory = new Map<string, number>();

export function CatalogGrid<A extends { id: string }>({ type }: { type: CatalogType<A> }): ReactElement {
  const allSections = type.sections(catalogVisibleAssets(type));
  // Drop empty sections so a filtered catalog (e.g. "Base Tiles" with all production
  // filtered out) doesn't render a bare header and read as if nothing is filtered.
  const sections = allSections.filter((section) => section.assets.length > 0);
  const empty = sections.length === 0;
  const scrollRef = useRef<HTMLElement>(null);
  // Restore the saved position on (re)mount and when switching catalog category.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const saved = catalogScrollMemory.get(type.id);
    if (el && saved != null) el.scrollTop = saved;
  }, [type.id]);
  return (
    <section className="tileset-studio-main">
      <section
        className="tileset-studio-tab-panel"
        ref={scrollRef}
        onScroll={(event) => catalogScrollMemory.set(type.id, event.currentTarget.scrollTop)}
      >
        <div className="tileset-asset-sections">
          {sections.map((section) => (
            <section key={section.id} className="tileset-asset-section" aria-label={section.label}>
              <h3>{section.label}</h3>
              <div className="tileset-studio-grid" aria-label={`${section.label} assets`}>
                {section.assets.map((asset) => (
                  <CatalogCard key={asset.id} type={type} asset={asset} />
                ))}
              </div>
            </section>
          ))}
          {empty ? (
            <div className="unit-catalog-empty">
              <h3>{type.emptyLabel ?? 'Nothing matches'}</h3>
              <p>Adjust the search or filters.</p>
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );
}

// A "Filters" dropdown driven by CatalogFilterDim[]. Extracted from CatalogControls so the
// same control can drive both the catalog and the Lab's board generation. Selection lives in
// the dropdown itself (per-group select-all/clear) — no per-filter chips outside it.
export function CatalogFilters<A extends { id: string }>({ filters }: { filters: readonly CatalogFilterDim<A>[] }): ReactElement | null {
  const [filterOpen, setFilterOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  // Popover sizing: cap the menu to the real space below the trigger and flip it
  // upward when that space is short, so a long filter list can never run off the
  // bottom of the viewport (the old fixed `calc(100vh - 170px)` cap ignored how far
  // down the trigger sat). Recomputed on open and on resize.
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  useEffect(() => {
    if (!filterOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && dropdownRef.current?.contains(event.target)) return;
      setFilterOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFilterOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [filterOpen]);
  useLayoutEffect(() => {
    if (!filterOpen) return;
    const place = () => {
      const trigger = dropdownRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const margin = 12;
      const gap = 8;
      const below = window.innerHeight - trigger.bottom - margin;
      const above = trigger.top - margin;
      const flipUp = below < 240 && above > below;
      const maxHeight = Math.max(120, Math.min(420, Math.floor((flipUp ? above : below) - gap)));
      setMenuStyle(flipUp ? { top: 'auto', bottom: 'calc(100% + 8px)', maxHeight } : { maxHeight });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [filterOpen]);
  if (filters.length === 0) return null;
  return (
    <>
      <div className="tileset-filter-dropdown" ref={dropdownRef}>
        <button type="button" className={filterOpen ? 'is-active' : ''} onClick={() => setFilterOpen((value) => !value)} aria-expanded={filterOpen}>
          Filters
        </button>
        {filterOpen ? (
          <div className="tileset-filter-menu" role="dialog" aria-label="Filters" style={menuStyle}>
            <div className="tileset-filter-menu-header">
              <strong>Filters</strong>
              <span>
                <button type="button" onClick={() => filters.forEach((dim) => dim.selectAll())}>Select all</button>
                <button type="button" onClick={() => filters.forEach((dim) => dim.clear())}>Clear</button>
              </span>
            </div>
            {filters.map((dim) => (
              <section key={dim.id} className="tileset-filter-group" aria-label={dim.label}>
                <div className="tileset-filter-group-head">
                  <h3>{dim.label}</h3>
                  <span className="tileset-filter-group-actions">
                    <button type="button" onClick={() => dim.selectAll()} title={`Select all ${dim.label}`} aria-label={`Select all ${dim.label}`}>
                      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2.5 8.5 L6 12 L13.5 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    <button type="button" onClick={() => dim.clear()} title={`Clear ${dim.label}`} aria-label={`Clear ${dim.label}`}>
                      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M13.5 2.5 L7 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M7 9 L3.5 12 L7.5 14 L10 9.8 Z" fill="currentColor" /><path d="M4.6 12.7 L3.9 14.5 M6.4 13.4 L6 15.2 M8.1 12.9 L8.1 14.8" fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" /></svg>
                    </button>
                  </span>
                </div>
                {dim.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`tileset-filter-option${dim.selected.includes(option.id) ? ' is-active' : ''}`}
                    aria-pressed={dim.selected.includes(option.id)}
                    onClick={() => dim.toggle(option.id)}
                  >
                    <span className="tileset-filter-mark" aria-hidden="true" />
                    <span className="tileset-filter-option-copy">
                      <strong>{option.label}</strong>
                      {option.sub ? <span>{option.sub}</span> : null}
                    </span>
                  </button>
                ))}
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}

export function CatalogControls<A extends { id: string }>({ type }: { type: CatalogType<A> }): ReactElement {
  return (
    <>
      {type.query ? (
        <label className="tileset-catalog-search">
          <span>Search</span>
          <input
            type="search"
            value={type.query.value}
            onChange={(event) => type.query!.set(event.target.value)}
            placeholder={type.query.placeholder ?? 'search...'}
          />
        </label>
      ) : null}
      {type.zoom ? (
        <label className="tileset-catalog-zoom">
          <span>Zoom</span>
          <input
            type="range"
            min={type.zoom.min}
            max={type.zoom.max}
            step={type.zoom.step}
            value={type.zoom.value}
            onChange={(event) => type.zoom!.set(Number(event.target.value))}
          />
        </label>
      ) : null}
      {type.extra ?? null}
      {type.filters && type.filters.length > 0 ? <CatalogFilters filters={type.filters} /> : null}
      <button
        type="button"
        className="tileset-view-action"
        disabled={!type.selectedId}
        onClick={() => {
          const asset = type.assets.find((item) => item.id === type.selectedId);
          if (asset) type.onView(asset);
        }}
      >
        View Selected
      </button>
      {type.note ? <p className="tileset-catalog-note">{type.note}</p> : null}
    </>
  );
}
