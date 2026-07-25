---
status: "accepted"
date: 2026-06-25
deciders: Nelson, Claude
---

# ADR-0001: Use ADRs for decisions; keep contracts as the derived current-state

## Context and Problem Statement

UI and art-direction decisions were being re-litigated session to session because
the *why* and the chronology weren't preserved — only living "contract" docs that
get edited in place, which loses the record of what was decided, when, and what
was rejected. We need a durable, conventional way to record decisions so they
stop being reinvented.

## Decision Drivers

- Stop re-deciding settled questions.
- Preserve rationale and rejected alternatives, not just the current rule.
- Follow an established industry convention, not a bespoke scheme.
- Avoid running two competing documentation systems.

## Considered Options

- An append-only "decision log" section inside the existing contract docs.
- Formal numbered ADRs (MADR) in `docs/adr/`, contracts kept as a derived view.
- A clean slate: delete the contracts and rebuild everything as ADR rollups.

## Decision Outcome

Chosen: **formal MADR-format ADRs in `docs/adr/`**, with the existing contract
docs retained as the consolidated *current-state* layer that cites the ADRs it
derives from. ADRs are authoritative; contracts are the readable rollup.

This is the widely-adopted convention (Nygard; adr.github.io; Microsoft; AWS) and
keeps a single decision system rather than two peers. The append-log-in-contract
option is lighter but non-standard and blurs decision-vs-current-state. The
clean-slate option throws away real captured rationale and leaves ADRs doing a
job they're bad at — answering "what are all the rules right now."

Migration is incremental: new decisions get an ADR now; standing decisions in the
contracts are back-filled as they're touched.

### Consequences

- Good: every decision has one immutable home with full context; "what are the
  rules now" still has a readable answer in the contracts.
- Cost: during migration, older contract rules aren't yet ADR-backed; discipline
  is required to keep the flow one-directional (new/touched → ADR).

## More Information

- MADR: https://adr.github.io/madr/
- Original ADRs (Nygard): https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- Consolidated current-state contracts: [`../ui-art-direction.md`](../ui-art-direction.md), [`../ui-kit-standard.md`](../ui-kit-standard.md)
