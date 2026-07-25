# Architecture & Design Decision Records (ADRs)

This folder is the authoritative record of significant decisions — architecture,
UI, art direction, tooling — made for Chess Tactics. Each file captures one
decision: its context, the options weighed, what we chose, and why.

## Conventions

We follow [MADR](https://adr.github.io/madr/) (Markdown Any Decision Records).

- **One decision per file**, named `NNNN-short-title-with-dashes.md` with a
  consecutive number.
- **Records are immutable.** Don't edit an accepted decision to change it. If the
  decision changes, write a *new* ADR that **supersedes** the old one, set the
  old one's status to `superseded by ADR-NNNN`, and link them.
- **Status:** `proposed | accepted | rejected | deprecated | superseded by ADR-NNNN`.
- Copy [`0000-adr-template.md`](0000-adr-template.md) to start a new one, and add
  a row to [`decision-log.md`](decision-log.md).

## Relationship to the contract docs

We keep two layers, and they are **one system**, not two:

- **ADRs (this folder) are authoritative for _decisions_** — the why, the when,
  the alternatives rejected. This is where a decision is made and recorded.
- **The living contract docs** (`ui-art-direction.md`, `ui-kit-standard.md`, the
  `*-contract.md` family) are the consolidated **current-state** view — "what are
  the rules right now." They are *derived*: every rule should trace to an ADR and
  cite it, and they never introduce a rule that isn't backed by a decision here.

So: decide and record in an ADR → reflect the outcome in the relevant contract,
citing the ADR. When the two ever disagree, the ADR wins.

## Migration

We are **not** converting every historical decision at once. New decisions get an
ADR from now on; standing decisions already written into the contracts get
back-filled into ADRs as they are next touched or questioned. During migration,
some older contract rules won't yet be ADR-backed — that's expected, as long as
the flow stays one-directional (anything new or touched becomes an ADR).
