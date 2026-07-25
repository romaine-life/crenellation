// The "Glossary" catalog category + Viewer surface for the Studio. Restores the
// design-portfolio glossary that was dropped when /design was folded in (#127):
// the term vocabulary (from catalogData GLOSSARY) plus, for terms that carry a
// *process/decision* rather than just a definition, a long-form explainer. This is
// the reviewable in-app home for "how our chrome actually renders" — a glossary
// TYPE, not a fake meta-asset inside an asset category.
import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react';
import { GLOSSARY } from './catalogData';

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

// Long-form docs keyed by glossary term. Terse `def` lives in catalogData; the
// deeper "why/how" lives here so the term row stays scannable but the Viewer can
// hold the full agreed explanation.
const GLOSSARY_DETAILS: Record<string, ReactNode> = {
  'split-layer doodad': (
    <>
      <h3>How a split-layer doodad works (the agreed approach)</h3>
      <p>
        Flat props painted on the board read wrong the moment a unit shares the tile:
        the sprite either sits entirely behind the unit (the unit covers it) or entirely
        in front (it covers the unit). A grass tuft a knight is standing <em>in</em> can do
        neither — part of it is behind the legs, part falls over the shins.
      </p>

      <h4>One clump, split into two halves</h4>
      <p>
        The doodad is modelled and rendered in Blender as a single clump, then{' '}
        <strong>bisected into a back half and a front half</strong> along the
        ground-contact plane. The split uses the world-plane normal{' '}
        <code>(1, −1, 0)</code> — the toward-the-viewer direction in our isometric
        projection — <strong>not</strong> a camera near-clip. A camera clip put the whole
        above-ground clump in the front half and left <code>back.png</code> empty; the
        world-plane bisect is what actually separates &ldquo;behind the unit&rdquo; from
        &ldquo;over the unit.&rdquo;
      </p>

      <h4>Both halves share one anchor</h4>
      <p>
        Each half ships as a 96×180 sprite contact-anchored at pixel <code>(48, 69)</code>,
        the same ground point, so they recombine pixel-perfectly when stacked back on the tile.
      </p>

      <figure className="doodad-layer-figure" aria-label="A unit on a grass tile, shown with the back layer only, then with the front layer added so it falls over the unit's shins">
        <span className="doodad-layer-cell">
          <span className="doodad-layer-scene">
            <span className="doodad-layer-stage">
              <span className="doodad-layer-half"><img src="/assets/tiles/textured/grass-a.png" alt="" aria-hidden="true" /></span>
              <span className="doodad-layer-half"><img src="/assets/doodads/grass-tuft/back.png" alt="" aria-hidden="true" /></span>
              <span className="board-unit-seat" style={{ left: 0, top: 0 }}><img src="/assets/units/knight/navy-blue/south.png" alt="" aria-hidden="true" /></span>
            </span>
          </span>
          <figcaption className="doodad-layer-cap"><strong>Back layer only.</strong> The whole tuft is behind the unit — it just stands in front of it.</figcaption>
        </span>
        <span className="doodad-layer-cell">
          <span className="doodad-layer-scene">
            <span className="doodad-layer-stage">
              <span className="doodad-layer-half"><img src="/assets/tiles/textured/grass-a.png" alt="" aria-hidden="true" /></span>
              <span className="doodad-layer-half"><img src="/assets/doodads/grass-tuft/back.png" alt="" aria-hidden="true" /></span>
              <span className="board-unit-seat" style={{ left: 0, top: 0 }}><img src="/assets/units/knight/navy-blue/south.png" alt="" aria-hidden="true" /></span>
              <span className="doodad-layer-half"><img src="/assets/doodads/grass-tuft/front.png" alt="" aria-hidden="true" /></span>
            </span>
          </span>
          <figcaption className="doodad-layer-cap"><strong>Back + front.</strong> The front blades cross over the shins — now the unit stands <em>inside</em> the tuft.</figcaption>
        </span>
      </figure>

      <h4>The unit sorts between them (z-bracketing)</h4>
      <p>
        On the board the unit renders at <code>z = base</code>; the doodad brackets it —
        back at <code>base − 1</code> (tucks behind), front at <code>base + 1</code> (falls
        over the shins). The unit is sandwiched, so it appears to stand <em>inside</em> the prop.
        One shared <code>&lt;DoodadSprite&gt;</code> draws this for the game board and the Studio
        alike, so the seating can&rsquo;t drift between them.
      </p>
      <p className="glossary-detail-src">
        Recipe of record: <code>docs/art/doodad-concepts/render_doodad.py</code> (the Blender bisect).
        Renderer: <code>frontend/src/render/BoardDoodad.tsx</code>.
      </p>
    </>
  ),
  '9-slice': (
    <>
      <h3>How a 9-slice actually renders (the agreed approach)</h3>
      <p>
        A 9-slice frame is <strong>one small source image</strong> (gold corners +
        edge bars + a stretchable middle). It is <strong>not</strong> a baked picture
        of a specific button — there is no stored image of "the 200px-wide button."
      </p>

      <h4>Two stages, two jobs</h4>
      <ul>
        <li>
          <strong>Build time — make the <em>source</em>.</strong> The small source
          PNG is produced once, either <em>assembled from atoms</em> (one corner
          mirrored into four, the edge tiled — see <code>scripts/assemble-frame.mjs</code>)
          or <em>extracted as real pixels</em> from the approved concept art. The
          atoms stay the source of truth; the combined PNG is a regenerable artifact.
        </li>
        <li>
          <strong>Runtime — the browser assembles the <em>frame</em>.</strong> CSS
          <code> border-image</code> takes that one source and 9-slices it live, every
          time it draws, onto an element of any size. Nothing is pre-rendered per size.
        </li>
      </ul>

      <h4>The runtime recipe (cut-and-map, not overlap)</h4>
      <p>The browser cuts the source by the slice lines into 9 regions and maps each to the element:</p>
      <ul>
        <li><strong>4 corners</strong> → the element's corners, at fixed size — <em>never stretched</em> (this keeps the gold brackets crisp).</li>
        <li><strong>4 edges</strong> → the spans between corners. As the element grows, the edge bar <em>repeats</em> (or stretches) to fill the longer gap — corners and edges have different lifecycles.</li>
        <li><strong>center</strong> → tiles/stretches to fill the middle.</li>
      </ul>
      <p>
        <strong>stretch vs repeat:</strong> <code>border-image-repeat: stretch</code>
        scales the edge bar to fit (smears detail); <code>repeat</code>/<code>round</code>
        stamps the bar pattern over and over (no smear). Our panel frames use
        <code> round</code>; that is the intelligent-repeat behaviour, not dumb stretching.
      </p>

      <h4>Why a PNG at all — and why not compose "live" from separate pieces</h4>
      <p>
        Pixel art is hand-authored bitmaps; there is no formula for the gold bracket,
        so the art is stored as pixels either way. "Live composition" (placing the
        corner/edge atoms separately at runtime) is the <em>same recipe</em> — static
        corner, repeating edge, fill — just re-implemented by hand (extra DOM and
        transforms to rotate one corner into four) with no behavioural gain. The
        usual reason to render live, resolution-independence, is actively unwanted
        here: we want fixed, chunky pixels, not vector-smooth scaling. So:
        <strong> build the source (from atoms), let the browser 9-slice it.</strong>
      </p>
      <p className="glossary-detail-src">
        Decision of record: <code>docs/ui-kit-standard.md</code> §"The decision" (#1 + Mechanism spec).
        Authorities: Unity 9-slicing · Godot NinePatchRect · CSS Backgrounds &amp; Borders L3 (<code>border-image-slice</code>).
      </p>
    </>
  ),
};

function GlossaryTag({ tag }: { tag: string }): ReactElement | null {
  if (!tag) return null;
  return <span className={`glossary-tag ${tag === 'asset' ? 'is-asset' : 'is-not-asset'}`}>{tag}</span>;
}

// One glossary term as a catalog card — same shape as an asset/artwork card
// (text-only: no image), selectable, with a View action that opens the Viewer.
function Card({ entry, selected, onSelect, onView }: {
  entry: { term: string; tag: string; def: string; src: string };
  selected: boolean;
  onSelect: (term: string) => void;
  onView: (term: string) => void;
}): ReactElement {
  const hasDoc = Boolean(GLOSSARY_DETAILS[entry.term]);
  return (
    <button
      type="button"
      className={`tileset-studio-card is-glossary ${selected ? 'is-selected' : ''}`}
      onClick={() => onSelect(entry.term)}
      aria-pressed={selected}
      title={`Select ${entry.term}`}
    >
      <span className="tileset-studio-card-meta">
        <span className="tileset-studio-card-text">
          <strong>{entry.term}{hasDoc ? <span className="glossary-doc-dot" title="has a process doc" aria-label="has a process doc" /> : null}</strong>
          <em>{entry.def}</em>
          <span className="glossary-card-src">{entry.src}</span>
        </span>
        <span className="tileset-card-actions">
          <GlossaryTag tag={entry.tag} />
          <span className="tileset-card-action" title={`View ${entry.term}`} aria-label={`View ${entry.term}`} {...cardAction(() => onView(entry.term))}>
            <ViewIcon />
          </span>
        </span>
      </span>
    </button>
  );
}

// Catalog: the glossary as a grouped grid of term cards — Assets vs Concepts —
// mirroring how every other category lists its elements. Selecting a card and
// opening it (or hitting its View action) shows the full term in the Viewer.
export function GlossaryLibraryStudio({ search, selected, onSelect, onView }: {
  search: string;
  selected: string;
  onSelect: (term: string) => void;
  onView: (term: string) => void;
}): ReactElement {
  const q = search.trim().toLowerCase();
  const match = GLOSSARY.filter((g) => !q || g.term.toLowerCase().includes(q) || g.def.toLowerCase().includes(q) || g.tag.toLowerCase().includes(q));
  const sections = [
    { id: 'assets', label: 'Assets', items: match.filter((g) => g.tag === 'asset') },
    { id: 'concepts', label: 'Concepts & structure', items: match.filter((g) => g.tag !== 'asset') },
  ].filter((s) => s.items.length);

  return (
    <section className="tileset-studio-main is-headless">
      <section className="tileset-studio-tab-panel">
        <div className="tileset-asset-sections">
          {sections.map((s) => (
            <section className="tileset-asset-section" aria-label={s.label} key={s.id}>
              <h3>{s.label}</h3>
              <div className="tileset-studio-grid glossary-grid">
                {s.items.map((g) => (
                  <Card key={g.term} entry={g} selected={selected === g.term} onSelect={onSelect} onView={onView} />
                ))}
              </div>
            </section>
          ))}
          {!sections.length ? <p className="tileset-catalog-note">No terms match this search.</p> : null}
        </div>
      </section>
    </section>
  );
}

// Viewer: one term in full — definition, source, and any long-form process doc.
export function GlossaryLab({ name, header }: { name: string; header?: ReactNode }): ReactElement {
  const g = name ? GLOSSARY.find((e) => e.term === name) : null;
  const detail = g ? GLOSSARY_DETAILS[g.term] : null;
  return (
    <>
      <section className="al-lab-main glossary-lab-main" aria-label="Glossary term">
        {!g ? (
          <p className="al-lab-empty">No term selected — pick one in the Glossary catalog.</p>
        ) : (
          <article className="glossary-entry-full">
            <header><h2>{g.term}</h2><GlossaryTag tag={g.tag} /></header>
            <p className="glossary-entry-def">{g.def}</p>
            <p className="glossary-entry-src">{g.src}</p>
            {detail ? <div className="glossary-detail">{detail}</div> : (
              <p className="glossary-detail-none">Definition only — no extended process doc for this term yet.</p>
            )}
          </article>
        )}
      </section>
      <aside className="tileset-view-controls" aria-label="Glossary controls">
        <section className="tileset-inspector-section">
          <h2>Controls</h2>
          <div className="tileset-control-stack">
            {header}
            {g ? (
              <dl className="al-meta">
                <div><dt>Tag</dt><dd>{g.tag || '—'}</dd></div>
                <div><dt>Doc</dt><dd>{detail ? 'has process doc' : 'definition only'}</dd></div>
                <div><dt>Source</dt><dd>{g.src}</dd></div>
              </dl>
            ) : null}
          </div>
        </section>
      </aside>
    </>
  );
}
