---
status: "accepted"
date: 2026-06-25
deciders: Nelson, Claude
---

# ADR-0003: One shared brand lockup; hero treatment only on the main menu

## Context and Problem Statement

The top-left branding differed on every screen — a big rook hero on the main
menu, a shield + "SETTINGS / CHESS TACTICS" on settings, the plain word "Studio"
elsewhere, "Chess Tactics" text on skirmish, nothing on some. The inconsistency
made the app feel disorganized and left it ambiguous whether branding was meant
to vary per screen.

## Decision Drivers

- Users orient by a consistent brand mark in a consistent place.
- Stop reinventing the top-left per screen.
- Match the accepted concept art (shield + SCREEN NAME · chess tactics).

## Considered Options

- A different brand treatment per screen (status quo).
- One identical lockup on every screen, including the main menu.
- One hero treatment on the main menu + one identical shared lockup everywhere else.

## Decision Outcome

Chosen: **hero on the main menu, one identical shared lockup everywhere else** —
same component, position, and size; only the screen-name word changes
(`[rook shield]  SCREEN NAME  ·  chess tactics`). Implemented as a single
`BrandLockup` component that every non-menu screen consumes.

This follows expert UX guidance: branding should be consistent across screens
(same mark, same spot, same size), varying only in scale — never a different logo
per page, which is exactly what created the "am I supposed to make this different
each time?" confusion.

### Consequences

- Good: consistent orientation; one source means the screens can't drift again.
- Cost: each screen must be migrated onto `BrandLockup` (in progress — Settings
  and Skirmish done; Studio and Campaign/Level editor remain).

## More Information

- UXPin (design consistency; brand consistency), MoldStud (consistent branding
  across app interfaces).
- Component: `frontend/src/ui/BrandLockup` (used by Settings, Skirmish).
- Consolidated current-state: [`../ui-art-direction.md`](../ui-art-direction.md).
