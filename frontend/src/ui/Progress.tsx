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
    detail: 'Capstone over the whole image, then the hard part: telling code from data. 906 routine boundaries - the classifier found most, and the rest came from instruments: the lifter’s own transfers, the running game under every input pattern, the jump tables whose cases live inside their own data, and a byte-level census that alarms on any branch into a byte no routine covers. It found two live routines in the protection ROM and a crash screen behind the halt stub. Every byte of the image now carries exactly one verdict: code in a routine, or data with recorded evidence.',
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
    state: 'done',
    detail: 'A lifter recovers parameters, results and expressions, and every routine it produces is proved against the recompiled one on random machine states - all 906, with none held back. 904 are also matched against a frozen 68000: 24,097 step-state snapshots and two capture top-ups on top of them, every run freezing a machine byte-identical to the committed baselines. The other two are the protection probe halves, incomparable with the reason on record. And it reads as source: every one of the 1,187 functions carries a name that says what it does rather than the address it came from - no fn_0ccb2 survives - with each hand-written name recording the instructions it was read from. Parameters are done too: 4,419 of 4,419 say what they are rather than which register or stack slot they arrived in. That total used to read 6,279, and 1,860 of those were not parameters at all - the lifter makes every register live across a routine into one, so pieceWalker took fourteen and read six, and the rest were bookkeeping that had to survive an interrupt. They now read the register in the body instead, which is the same expression the dispatcher used to build the argument, so the two runs stay identical.',
  },
];

type Layer = { name: string; state: 'done' | 'part' | 'none'; note: string };

const LAYERS: Layer[] = [
  { name: 'CPU', state: 'done', note: '68000 core, verified instruction by instruction against the chip' },
  { name: 'Playfield', state: 'done', note: '336×240 bitmap the ROM writes, with the palette decoded at its real stride' },
  { name: 'Motion objects', state: 'none', note: 'a sprite layer the port never reads - so terrain, castles, walls, cannons and ships all come from the playfield. The list itself is now decoded and checked against a running machine (molist.test.ts): base 0x3e0000, eight bytes a slot, 0x47 slots, double-buffered at +0x230. Each slot is link, graphic, x, y. At frame 300 it is a pristine free list; by frame 600 six ships sit in it with real graphic codes. The pixels were missing too - rom.bin is exactly the two program ROMs, so the sprite graphics had never been in the port. mo.bin now carries them: 136082-1009.2n, 131,072 bytes, which the MAME region list says is the gfx ROM. The format is 8x8 tiles, 4bpp packed nibbles, 32 bytes a tile, 4,096 tiles - confirmed by rendering it, which shows castle blocks, terrain and glyphs rather than noise. The code field is a plain twelve-bit tile index: across a full one-player and two-player game only 21 distinct codes ever appear, none at or above 0x1000, so the high nibble carries nothing (mocodes.test.ts). The two position words are packed: above bit 6 is the coordinate - 17 distinct x values in multiples of eight, 119 y values moving smoothly - and the low seven bits are an attribute, taking only 5 and 10 distinct values across a whole game. motionObjectEntryWrite preserves those seven bits while it overwrites the position, so they live on the object record rather than being part of the coordinate. That is where the size of a sprite has to come from. What is left is deciding which of those bits is which, and a renderer.' },
  { name: 'Sound', state: 'none', note: 'YM2413 and OKI6295 writes are seen and ignored. Nothing is audible. The sample data is now in the port as oki.bin, 262,144 bytes from 136082-1007 and -1008; what is missing is the two chips.' },
  { name: 'Input', state: 'part', note: 'every bit measured; one player station of three is on the keyboard' },
  { name: 'Timing', state: 'part', note: 'the game clock runs 1.4x slow, down from 7.6x. A round now plays through to its score screen.' },
];

/** What is known about each of the 906 routines. Every routine is in exactly
 *  one class and the classes sum to 906, which is the point of the page. */
const KNOWLEDGE = [
  { label: 'Matched against the frozen chip — silicon agrees, snapshot by snapshot', n: 904, colour: C.done },
  { label: 'Incomparable, with the reason on record — both halves of the protection probe', n: 2, colour: '#2d4f6b' },
];

const TOTAL = 906;

const SETTLED = [
  ['Source you would choose to edit', 'Done, and every part of it is asserted rather than ratcheted. names.txt reads five zeros on one line: no routine still named for its address, none opaque, none named only by a suffix on another routine’s, none without a stated purpose, and no parameter that says only which register or stack slot it arrived in — 4,419 of 4,419. Every one of those five is an equality in the test, because at the bar a no-worse-than check would quietly accept a regeneration that lost a name, and losing one is exactly what a regeneration does when a curated name stops applying. That is not hypothetical: the parameter assertion went red at 24 the first time a full regeneration ran under it, and every one of the 24 was a name some pass had derived from a body that a later pass rewrote — real in the working tree and unfindable by a regeneration. All 24 were read and written down, and a second regeneration reproduces the zeros exactly. Roughly a thousand parameters fell to four instruments that each prove a fact about execution order rather than guess a meaning: dead on arrival, killed on every path, killed where no branch can skip it, and preserved — saved and restored and never touched, which is a different fact and gets a different name. Each learned something the hard way. A move.w writes only the low word and leaves the caller’s upper half, which cost 23 of the first 111. A movea sign-extends, so movea.w is a full kill where move.w is not. And the disassembler prints movem.l d2-d7, so searching it for d3 finds nothing — which meant a register whose only mention was that prologue was reported as untouched by nothing at all. The rest was reading, several hundred routines one at a time, each recorded with the instructions it was read from, because a wrong name is worse than an address: 0x9080 was confidently called creditCompare and drains a ring buffer with nothing to do with credits. Three candidate rules were measured and refused rather than shipped, and the refusals are written down so nobody derives them again. Control flow is done bar one: 228 routines lifted to a labelled switch over a program counter at the start of the day and 1 of 1,182 still does — and the generated file is smaller than it started, 8.3 MB against 14 MB, because most of what those switches cost was duplication. The ten that fell were all one mistake: a loop with several ways out asked where the HEADER post-dominates, and a loop header post-dominates into its own body, because the back-edge means every path from it comes back. The node wanted is where the exits converge. The one that remains is the title screen, and it is the size budget working rather than failing — structured, that single routine costs 77,320 lines and would take the file from 8.3 MB to 12.5 MB.'],
  ['How far the two translations agree', 'They do not diverge any more, and that is a measured claim rather than a floor. The whole-game comparison runs all six input patterns to their own ends - 2,400 frames of attract, 3,600 with one player and with two, 3,000 with all three stations, 1,800 on the service switch, 4,800 idle, 19,200 frames in all - and both dispatchers are byte-identical over work RAM, the playfield and the palette at every one of them, in 83 seconds. The write comparison is stronger still: every write either makes, to its own full length, 62 million of them across the six patterns, same addresses, same values, same order. Both used to report a floor; neither does. The screens are the same picture on every pattern - 0 differing pixels of 80,640, where before only attract was ever checked. Four faults were fixed to get here and all four were the same shape, something one dispatcher did that the other did not. The lifted side charged an interrupted block cycles before running the handler, where the chip has not spent them yet, so it entered every handler ahead by that block. A move to the status register let an interrupt in without spilling the routine registers, so the handler saved stale values to the stack. The recompiled side - the oracle - stacked the address after a taken branch instead of the branch target, invisible until now because it pops that address and discards it. And the X bit state was the one piece of carried flag state that did not reach a block from its predecessors, so a block inherited the X of whatever sat before it in memory rather than of what ran, while shifts never wrote their condition codes to the machine at all. Nothing is left. All 2,125 exception frames stack an identical return address and status register, X included, and the test asserts that rather than holding a floor - so the equivalence suite has no floor in it at all. The last two faults were the same shape as the four above, a flag carried further than it is true for. X does not outlive a call: a jsr cleared the flag state and not the X state, so the block after it re-applied the caller’s X over whatever the callee left. And uncertainty has to propagate: a block whose predecessors disagree keeps whatever the previous block in memory left, deliberately, so a branch can still be answered - but it handed that fabricated state on as fact, and a successor with one predecessor believed it. What a block hands on is now what it knows.'],
];

const REMAINING = [
  ['Motion objects', 'A video layer the port ignores. The captured display list holds 735,711 non-zero bytes across a run, so the board draws something the port does not — but the playfield already carries terrain, castles, walls and ships, so the first job is establishing what is actually on that list.'],
  ['Audio', 'Both chips are written to correctly and neither is modelled. Needs YM2413 FM and OKI6295 ADPCM synthesised.'],
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
            <div style={{ fontSize: 40, fontWeight: 600, lineHeight: 1, color: C.done }}>906</div>
            <div style={{ color: C.dim, fontSize: 13, marginTop: 4 }}>routines, run and decompiled</div>
          </div>
          <div style={{ width: 1, alignSelf: 'stretch', background: C.line }} />
          <div>
            <div style={{ fontSize: 40, fontWeight: 600, lineHeight: 1, color: C.done }}>904</div>
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
          What is known about the {TOTAL} routines
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

        {/* settled - listing a finished job under "remaining work" is the
            same stale claim this page exists to prevent */}
        <h2 style={{ fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.faint, margin: '0 0 16px' }}>
          Settled — asserted, not ratcheted
        </h2>
        <ol style={{ margin: 0, paddingLeft: 22, marginBottom: 40 }}>
          {SETTLED.map(([title, body]) => (
            <li key={title} style={{ marginBottom: 13 }}>
              <strong style={{ fontSize: 14.5, color: C.done }}>{title}</strong>
              <div style={{ color: C.dim, fontSize: 13.5 }}>{body}</div>
            </li>
          ))}
        </ol>

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
          instruction anywhere in the map · 904 of 906 routines matched against
          a frozen 68000 across 24,097 snapshots, every capture run freezing the
          identical machine, and two sessions hours apart froze byte-identical
          machines · 589 of the original 593 routines have a silicon verdict for
          every piece they were split into, and the other four name which
          weaker claim they carry rather than reading as unknown ·
          every byte of the 1 MiB image and both board regions
          carries one verdict — code in a routine, or data with recorded
          evidence · 1,916 interrupted runs identical to undisturbed ones ·
          the two translations run 19,200 frames of the game — every input
          pattern to its own end — with work RAM, the playfield and the palette
          byte-identical at every frame, 62 million writes identical in address,
          value and order, and the same 80,640 pixels on screen.
          <br /><br />
          Discovery went dry on 29 July 2026, at 907 routines, of which one
          later proved never to have existed - an entry that fell inside an
          instruction, truncating the routine before it: three
          consecutive sweeps of the protocol in romlab/SWEEP.md found nothing —
          no program counter outside the map across 10,558 addresses the real
          chip executed, and no missing routine in the port under any input
          pattern, including games played to their full length on all three
          stations. The ledger of each sweep is romlab/SWEEPLOG.md. A new input
          pattern resets the count, which is the honest way for it to end.
        </div>

      </div>
    </div>
  );
}

export default Progress;
