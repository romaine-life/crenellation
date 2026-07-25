---
status: "accepted"
date: 2026-06-25
deciders: Nelson, Claude
---

# ADR-0008: Brand lockup typography — app-header framing (screen name leads)

Refines [ADR-0003](0003-single-shared-brand-lockup.md) (which established the
single shared lockup). This records how the two text lines are sized and weighted.

## Context and Problem Statement

The lockup — `[shield] SETTINGS / CHESS TACTICS` — didn't read right. The brand
line "CHESS TACTICS" was set in the smallest type token in the system
(`--ds-text-2xs`), so it came across as a stray afterthought rather than part of
the mark, and the relationship between the two lines felt off.

## Decision Drivers

- Lockup convention: a mark + wordmark + a *deliberate* descriptor; don't let an
  element shrink into noise.
- Typographic hierarchy: contrast between levels must be clear and sit on an
  intentional scale — a near-invisible descriptor is a hierarchy failure.
- Stay consistent with the concept art and ADR-0003, which place the screen name
  prominently for orientation.

## Considered Options

- **(a) App-header framing:** screen name ("SETTINGS") leads; "CHESS TACTICS" is
  a real, legible descriptor beneath it.
- **(b) Brand-first framing:** "CHESS TACTICS" is the anchor wordmark; the screen
  name becomes a small eyebrow.

Both were mocked live, side by side, in `/artwork-compare` (ADR-0005) before deciding.

## Decision Outcome

Chosen: **(a) app-header framing.** Implementation: the screen name goes to
font-weight 600; the descriptor grows from `--ds-text-2xs` to `--ds-text-sm` with
`.14em` tracking, giving "CHESS TACTICS" deliberate presence.

(b) was rejected: making the brand the anchor diverges from the concept and from
ADR-0003's choice to keep the screen name prominent for orientation. The screen
title leading is the correct emphasis for an in-app header that doubles as a mark.

The title stays in the game's pixel font (not the concept mockup's smoother
display font) — that's the game's identity per `ui-art-direction.md`, and the
concept's font is treated as mockup rendering, not a production requirement.

### Consequences

- Good: the lockup reads as a balanced mark; the descriptor is legible and
  intentional; consistent across every screen via the shared `BrandLockup`
  (Settings, Skirmish, …).
- Cost: none notable — CSS-only, fits the standard title bar.

## More Information

- Lockups: brandkit.com, kettlefirecreative.com, keboto.org.
- Hierarchy/scale: Toptal typographic hierarchy, Material 3 typography, Figma.
- Component: `frontend/src/ui/shared/BrandLockup`; CSS: `.brand-lockup-copy` in `style.css`.
