// The "Artwork" catalog category for the studio — browses like Assets: a grouped
// grid of art cards in the browser pane (world scenes, portrait backgrounds, unit
// portraits, portrait-editor sources, brand/key art, concept art, inspiration).
// Search + zoom live in the studio's Controls panel (passed in as props). The
// per-piece viewer is the Lab's job. Data: the build-time manifest from
// scripts/artwork-manifest.mjs (parallel to Assets' kit-manifest). No forge/gate
// here — these are authored artworks, not generated hard-alpha glyphs.
import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react';
import manifest from './artworkManifest.json';

interface ArtworkItem { id: string; label: string; url: string; w: number; h: number; sub: string }
interface ArtworkGroup { id: string; label: string; items: ArtworkItem[] }
interface ArtworkManifest { generated: string; summary: { total: number; groups: number }; groups: ArtworkGroup[] }

const ART = manifest as ArtworkManifest;
const PORTRAIT_GROUP = 'unit-portraits';

// The manifest groups, surfaced for the catalog's Group filter (the studio builds a
// CatalogFilters dropdown from these). Kept here so the manifest is the one owner.
export const ARTWORK_GROUPS: { id: string; label: string; count: number }[] = ART.groups.map((g) => ({ id: g.id, label: g.label, count: g.items.length }));
const dimOf = (it: ArtworkItem): string => (it.w && it.h ? `${it.w}×${it.h}` : '');

// Stop a card-action icon's click from also triggering the card's select.
const cardAction = (run: () => void) => ({
  role: 'button' as const,
  tabIndex: 0,
  onClick: (e: ReactMouseEvent) => { e.stopPropagation(); run(); },
  onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); run(); } },
});

const ViewIcon = (): ReactElement => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <rect x="1.6" y="6.4" width="12.8" height="8" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M8 1.2 V5.4 M5.4 3.2 L8 5.8 L10.6 3.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const EditIcon = (): ReactElement => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path d="M10.8 2.3 L13.7 5.2 L5.6 13.3 L2.4 13.9 L3 10.7 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M9.4 3.7 L12.3 6.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

function Card({ item, selected, onSelect, onView, onEdit }: {
  item: ArtworkItem;
  selected: boolean;
  onSelect: (id: string) => void;
  onView: (id: string) => void;
  onEdit?: (id: string) => void;
}): ReactElement {
  const dim = dimOf(item);
  return (
    <button
      type="button"
      className={`tileset-studio-card is-artwork ${selected ? 'is-selected' : ''}`}
      onClick={() => onSelect(item.id)}
      aria-pressed={selected}
      title={`Select ${item.label}`}
    >
      <span className="tileset-studio-card-image"><img src={item.url} alt="" loading="lazy" draggable={false} /></span>
      <span className="tileset-studio-card-meta">
        <span className="tileset-studio-card-text"><strong>{item.label}</strong><em>{[item.sub, dim].filter(Boolean).join(' · ')}</em></span>
        <span className="tileset-card-actions">
          {onEdit ? (
            <span className="tileset-card-action" title={`Edit ${item.label} portrait crop`} aria-label={`Edit ${item.label} portrait crop`} {...cardAction(() => onEdit(item.id))}>
              <EditIcon />
            </span>
          ) : null}
          <span className="tileset-card-action" title={`View ${item.label}`} aria-label={`View ${item.label}`} {...cardAction(() => onView(item.id))}>
            <ViewIcon />
          </span>
        </span>
      </span>
    </button>
  );
}

export function ArtworkLibraryStudio({ search, zoom, selected, onSelect, onView, onEditPortrait, groups }: {
  search: string;
  zoom: number;
  selected: string;
  onSelect: (id: string) => void;
  onView: (id: string) => void;
  onEditPortrait: (id: string) => void;
  /** Selected group ids (from the catalog's Group filter); undefined ⇒ all groups. */
  groups?: readonly string[];
}): ReactElement {
  const q = search.trim().toLowerCase();
  const groupSet = groups ? new Set(groups) : null;
  const sections = ART.groups
    .filter((g) => !groupSet || groupSet.has(g.id))
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => !q || it.label.toLowerCase().includes(q) || g.label.toLowerCase().includes(q) || it.sub.toLowerCase().includes(q)),
    }))
    .filter((s) => s.items.length);

  return (
    <section className="tileset-studio-main is-headless">
      <section className="tileset-studio-tab-panel">
        <div className="tileset-asset-sections" style={{ '--tile-zoom': zoom } as CSSProperties}>
          {sections.map((s) => (
            <section className="tileset-asset-section" aria-label={s.label} key={s.id}>
              <h3>{s.label}</h3>
              <div className="tileset-studio-grid">
                {s.items.map((it) => (
                  <Card
                    key={it.id}
                    item={it}
                    selected={selected === it.id}
                    onSelect={onSelect}
                    onView={onView}
                    onEdit={s.id === PORTRAIT_GROUP ? onEditPortrait : undefined}
                  />
                ))}
              </div>
            </section>
          ))}
          {!sections.length ? <p className="tileset-catalog-note">No artwork matches the current search and filters.</p> : null}
        </div>
      </section>
    </section>
  );
}

function findArtwork(id: string): { group: ArtworkGroup; item: ArtworkItem } | null {
  for (const g of ART.groups) {
    const item = g.items.find((i) => i.id === id);
    if (item) return { group: g, item };
  }
  return null;
}

// The Artwork viewer surface — one big contained preview of the selected piece on a
// checker stage, plus a metadata readout (group, dimensions, served path). Renders
// [main][aside] straight into the shell so the frame matches every other mode. The
// `header` slot carries the Viewer's Asset|Artwork kind selector (the Viewer's tier
// control), supplied by the host so both Viewer surfaces share one selector.
export function ArtworkLab({ name, header }: { name: string; header?: ReactNode }): ReactElement {
  const found = name ? findArtwork(name) : null;
  return (
    <>
      <section className="al-lab-main" aria-label="Artwork preview">
        {!found ? (
          <p className="al-lab-empty">No artwork selected — pick a card in the Artwork catalog.</p>
        ) : (
          <div className="al-lab-stages">
            <figure className="al-stage">
              <span className="al-checker al-artwork-stage"><img src={found.item.url} alt={found.item.label} className="al-artwork-lg" /></span>
              <figcaption>{found.item.label}</figcaption>
            </figure>
          </div>
        )}
      </section>
      <aside className="tileset-view-controls" aria-label="Artwork controls">
        <section className="tileset-inspector-section">
          <h2>Controls</h2>
          <div className="tileset-control-stack">
            {header}
            {found ? (
              <dl className="al-meta">
                <div><dt>Group</dt><dd>{found.group.label}</dd></div>
                <div><dt>Size</dt><dd>{found.item.w && found.item.h ? `${found.item.w}×${found.item.h}` : '—'}</dd></div>
                <div><dt>Path</dt><dd>{found.item.url}</dd></div>
              </dl>
            ) : (
              <p className="tileset-catalog-note">No artwork selected — pick a card in the Artwork catalog.</p>
            )}
          </div>
        </section>
      </aside>
    </>
  );
}
