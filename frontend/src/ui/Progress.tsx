// Where the Rampart port actually is.
//
// Written because "it runs" and "it is decompiled" are different claims and the
// difference had not been made visible. Every number here is measured, and the
// ones that are zero are the point of the page.

const C = {
  bg: '#0d0f12',
  panel: '#151a20',
  line: '#242c35',
  ink: '#e6edf3',
  dim: '#8b98a5',
  faint: '#5a6673',
  done: '#3fb950',
  part: '#d29922',
  none: '#484f58',
  bad: '#f85149',
};

type Stage = {
  name: string;
  what: string;
  state: 'done' | 'part' | 'none';
  detail: string;
};

/** The route from a ROM image to source you can edit. */
const PIPELINE: Stage[] = [
  {
    name: 'Read the ROM',
    what: 'the bytes off the board',
    state: 'done',
    detail: '1 MiB program ROM, plus the board regions at 0x140000 and 0x500000. The first is served by a protection state machine: what the chip fetches there depends on the access sequence, and reading it byte by byte shows a different bank than executing it.',
  },
  {
    name: 'Disassemble',
    what: 'bytes → 68000 instructions',
    state: 'done',
    detail: 'Capstone over the whole image, then the hard part: telling code from data. 836 routine boundaries - the classifier found most, the running game found 24 nothing static points at, and the byte-level census found the rest, including two live routines in the protection ROM and a crash screen hiding behind the halt stub. Every byte of the image now carries exactly one verdict: code in a routine, or data with recorded evidence.',
  },
  {
    name: 'Translate',
    what: 'instructions → TypeScript that runs',
    state: 'done',
    detail: 'One function per routine, each a switch over the program counter. Every instruction rule checked against real silicon: 9,169 of 9,173 comparable cases exact, condition codes included - and the remaining four are two encodings that never start an instruction anywhere in the map.',
  },
  {
    name: 'Run it',
    what: 'boot the machine, draw the screen',
    state: 'part',
    detail: 'Boots from the reset vector and plays. The playfield is drawn; the sprite layer is not, and neither sound chip makes a sound.',
  },
  {
    name: 'Decompile',
    what: 'machine code → source a person can change',
    state: 'part',
    detail: 'A lifter recovers parameters, results and expressions, and every routine it produces is proved against the recompiled one on random machine states - all 836, with none held back. 832 are also matched against a frozen 68000: 22,500 step-state snapshots, one machine, every run identical.',
  },
];

type Layer = { name: string; state: 'done' | 'part' | 'none'; note: string };

const LAYERS: Layer[] = [
  { name: 'CPU', state: 'done', note: '68000 core, verified instruction by instruction against the chip' },
  { name: 'Playfield', state: 'done', note: '336×240 bitmap the ROM writes, with the palette decoded at its real stride' },
  { name: 'Motion objects', state: 'none', note: 'a sprite layer the port never reads. The board keeps a display list that stays populated the whole time the game runs; terrain, castles, walls, cannons and ships all come from the playfield, so what is on that list has not been pinned down yet.' },
  { name: 'Sound', state: 'none', note: 'YM2413 and OKI6295 writes are seen and ignored. Nothing is audible.' },
  { name: 'Input', state: 'part', note: 'every bit measured; one player station of three is on the keyboard' },
  { name: 'Timing', state: 'part', note: 'the game clock runs 1.4x slow, down from 7.6x. A round now plays through to its score screen.' },
];

/** What is known about each of the 836 routines. */
const KNOWLEDGE = [
  { label: 'Matched against the frozen chip — silicon agrees, snapshot by snapshot', n: 832, colour: C.done },
  { label: 'Oracle-proved only — every silicon case voided by a wild pointer the port stubs', n: 2, colour: C.part },
  { label: 'Incomparable, with the reason on record — the protection bank probe', n: 1, colour: '#2d4f6b' },
  { label: 'Outstanding — one indirect-call entry whose divergence is not yet localised', n: 1, colour: C.bad },
];

const TOTAL = 836;

const REMAINING = [
  ['Run the discovery sweep dry', 'The static instruments converged: every transfer the lifter derives lands in a routine, and every byte of the image carries a verdict. What remains is the dynamic half of the protocol in romlab/SWEEP.md - attract, service mode, full games on every station - until three consecutive sweeps find nothing.'],
  ['Motion objects', 'A video layer the port ignores. The captured display list holds 735,711 non-zero bytes across a run, so the board draws something the port does not — but the playfield already carries terrain, castles, walls and ships, so the first job is establishing what is actually on that list.'],
  ['Audio', 'Both chips are written to correctly and neither is modelled. Needs YM2413 FM and OKI6295 ADPCM synthesised.'],
  ['The last outstanding routine', 'The computed-jump entry at 0x1A256 loads a handler pointer from a structure and calls it; under one argument shape its state after the call differs from the frozen chip, and the localiser finds nothing at its snapshot points. One routine of 836.'],
  ['Two more stations', 'Four buttons and four trackball axes are measured but unwired. No two-player.'],
  ['The last 1.4x of pacing', 'The game clock ran 7.6x slow until the frame-handler status bit was measured rather than invented. It is now 1.4x, which may be nothing more than the per-instruction cycle estimates.'],
];

function Dot({ state }: { state: 'done' | 'part' | 'none' }) {
  const fill = state === 'done' ? C.done : state === 'part' ? C.part : C.none;
  return (
    <span style={{
      width: 10, height: 10, borderRadius: 10, background: fill,
      display: 'inline-block', flexShrink: 0,
      boxShadow: state === 'none' ? 'none' : `0 0 8px ${fill}66`,
    }} />
  );
}

export function Progress() {
  const pct = (n: number): number => (n / TOTAL) * 100;

  return (
    <div style={{
      background: C.bg, color: C.ink, minHeight: '100vh',
      // The app shell's title bar overlays the top of every route rather than
      // sitting above it, so a plain top padding puts the heading underneath it.
      padding: 'calc(var(--app-header-h, 56px) + 32px) 24px 48px',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
      lineHeight: 1.55,
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        <h1 style={{ fontSize: 30, margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          Rampart — where the port actually is
        </h1>
        <p style={{ color: C.dim, margin: '0 0 40px', fontSize: 15 }}>
          The arcade ROM runs in your browser. That is not the same as having
          decompiled it, and this page exists to keep the two apart.
        </p>

        {/* the headline number */}
        <div style={{
          background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10,
          padding: '22px 24px', marginBottom: 40,
          display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontSize: 40, fontWeight: 600, lineHeight: 1, color: C.done }}>836</div>
            <div style={{ color: C.dim, fontSize: 13, marginTop: 4 }}>routines, run and decompiled</div>
          </div>
          <div style={{ width: 1, alignSelf: 'stretch', background: C.line }} />
          <div>
            <div style={{ fontSize: 40, fontWeight: 600, lineHeight: 1, color: C.part }}>832</div>
            <div style={{ color: C.dim, fontSize: 13, marginTop: 4 }}>matched against the chip</div>
          </div>
          <div style={{ flex: 1, minWidth: 260, color: C.dim, fontSize: 13.5 }}>
            Running code is machine code re-expressed as TypeScript — a program
            counter and a switch. Decompiled code has parameters, results and
            names, and can be changed. Every decompiled routine here was proved
            equal to the running one before it was counted.
          </div>
        </div>

        {/* pipeline */}
        <h2 style={{ fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.faint, margin: '0 0 16px' }}>
          ROM to editable source
        </h2>
        <div style={{ marginBottom: 44 }}>
          {PIPELINE.map((s, i) => (
            <div key={s.name} style={{ display: 'flex', gap: 16 }}>
              {/* rail */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 6 }}>
                <Dot state={s.state} />
                {i < PIPELINE.length - 1 && (
                  <div style={{ width: 2, flex: 1, background: C.line, minHeight: 46 }} />
                )}
              </div>
              <div style={{ paddingBottom: i < PIPELINE.length - 1 ? 22 : 0, flex: 1 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 15.5 }}>{s.name}</strong>
                  <span style={{ color: C.faint, fontSize: 13 }}>{s.what}</span>
                  {s.state === 'none' && (
                    <span style={{
                      fontSize: 11, color: C.bad, border: `1px solid ${C.bad}55`,
                      borderRadius: 4, padding: '1px 6px', letterSpacing: '0.04em',
                    }}>NOT STARTED</span>
                  )}
                  {s.state === 'part' && (
                    <span style={{
                      fontSize: 11, color: C.part, border: `1px solid ${C.part}55`,
                      borderRadius: 4, padding: '1px 6px', letterSpacing: '0.04em',
                    }}>PARTIAL</span>
                  )}
                </div>
                <div style={{ color: C.dim, fontSize: 13.5, marginTop: 4 }}>{s.detail}</div>
              </div>
            </div>
          ))}
        </div>

        {/* what is known about the routines */}
        <h2 style={{ fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.faint, margin: '0 0 16px' }}>
          What is known about the 836 routines
        </h2>
        <div style={{
          display: 'flex', height: 34, borderRadius: 6, overflow: 'hidden',
          border: `1px solid ${C.line}`, marginBottom: 14,
        }}>
          {KNOWLEDGE.filter((k) => k.n > 0).map((k) => (
            <div key={k.label} title={`${k.label}: ${k.n}`}
              style={{ width: `${pct(k.n)}%`, background: k.colour }} />
          ))}
        </div>
        <div style={{ marginBottom: 44 }}>
          {KNOWLEDGE.map((k) => (
            <div key={k.label} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 13.5, padding: '3px 0' }}>
              <span style={{ width: 10, height: 10, background: k.colour, borderRadius: 2, flexShrink: 0 }} />
              <span style={{ width: 42, color: k.n === 0 ? C.bad : C.ink, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{k.n}</span>
              <span style={{ color: k.n === 0 ? C.ink : C.dim }}>{k.label}</span>
            </div>
          ))}
          <p style={{ color: C.faint, fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>
            A description is not source. Knowing that a routine "touches the
            motion-object table" does not let you change what it does.
          </p>
        </div>

        {/* machine layers */}
        <h2 style={{ fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.faint, margin: '0 0 16px' }}>
          The machine, part by part
        </h2>
        <div style={{ display: 'grid', gap: 8, marginBottom: 44 }}>
          {LAYERS.map((l) => (
            <div key={l.name} style={{
              display: 'flex', gap: 12, alignItems: 'center',
              background: C.panel, border: `1px solid ${C.line}`,
              borderRadius: 8, padding: '11px 14px',
            }}>
              <Dot state={l.state} />
              <strong style={{ width: 132, flexShrink: 0, fontSize: 14 }}>{l.name}</strong>
              <span style={{ color: C.dim, fontSize: 13.5 }}>{l.note}</span>
            </div>
          ))}
        </div>

        {/* remaining */}
        <h2 style={{ fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.faint, margin: '0 0 16px' }}>
          Remaining work, in the order I would do it
        </h2>
        <ol style={{ margin: 0, paddingLeft: 22, marginBottom: 40 }}>
          {REMAINING.map(([title, body]) => (
            <li key={title} style={{ marginBottom: 13 }}>
              <strong style={{ fontSize: 14.5 }}>{title}</strong>
              <div style={{ color: C.dim, fontSize: 13.5 }}>{body}</div>
            </li>
          ))}
        </ol>

        <div style={{
          borderTop: `1px solid ${C.line}`, paddingTop: 18,
          color: C.faint, fontSize: 12.5,
        }}>
          Verified against hardware, not asserted: 9,169 of 9,173 instruction
          cases exact including condition codes, the other four never start an
          instruction anywhere in the map · 832 of 836 routines matched against
          a frozen 68000 across 22,500 snapshots, every capture run freezing
          the identical machine · 591 of 593 of the original routines fully
          verified · every byte of the 1 MiB image and both board regions
          carries one verdict — code in a routine, or data with recorded
          evidence · 1,916 interrupted runs identical to undisturbed ones.
        </div>

      </div>
    </div>
  );
}

export default Progress;
