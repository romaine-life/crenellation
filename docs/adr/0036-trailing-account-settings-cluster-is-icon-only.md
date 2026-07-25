---
status: "accepted"
date: 2026-06-28
deciders: Nelson, Claude
---

# ADR-0036: The trailing account / settings cluster is icon-only — a bounded exception to ADR-0023

[ADR-0023](0023-app-title-bar-layout-and-controls.md) made title-bar controls
**always labeled, never bare icons** — and specifically called out the **gear**
as a non-universal icon that needs a label (NN/g). But the signed-in chrome puts
an **unlabeled avatar** on the trailing edge (the canonical account-menu trigger),
and the "settings + user" cluster pairs that avatar with a **gear**. Both are
icon-only, so the cluster directly tensions with ADR-0023. This ADR records that
deviation as a **deliberate, bounded exception** with mitigations — rather than
leaving shipped chrome silently contradicting an accepted ADR.

## Context and Problem Statement

The main-menu account control is an avatar that opens a small menu (the standard
GitHub / Google / Slack / Figma account-menu pattern; shipped in #192). An avatar
trigger is **inherently unlabeled** — labeling it is non-idiomatic. Separately, the
owner moved **Settings** out of the rail into the trailing edge so the top-right
reads as one "settings + user" unit — a gear beside the avatar, matched as a pair.

That makes **two** icon-only header controls, which ADR-0023 forbids. ADR-0023's
reasoning is sound in general (most icons aren't self-evident; the gear in
particular isn't), so the fix is not to wave it away but to scope a **narrow,
justified exception** for this one cluster, with the usability floor (ADR-0006 #1)
met by other means.

## Decision Outcome

**The trailing-edge account / settings cluster — the avatar account-menu trigger
and the Settings gear — is icon-only. This is the ONLY place icon-only header
controls are allowed. ADR-0023's labeled-control rule holds for every other
control on every bar.**

### Why the exception is justified (not a refutation of ADR-0023)

- **The avatar is an identity object, not an ambiguous action glyph.** The
  universal convention is an *unlabeled* avatar that opens an account menu (the
  same convention basis as the account-menu pattern itself). A text label on an
  avatar is the non-idiomatic option.
- **The gear is the harder case — ADR-0023 is right that a free-floating gear
  isn't universal.** The exception is deliberately narrow: a gear in the **fixed
  top-right corner, paired with the account avatar**, is the canonical
  "account + settings" cluster — among the most established corner conventions in
  software. The position + pairing carry the meaning the bare glyph alone would
  not.
- **Bounded scope.** The exception is *only* this identity/settings cluster.
  In-game and editor action controls (Save, Sign In, End Turn, …) stay labeled per
  ADR-0023. There is no general license for bare icons.

### Requirements (the mitigations that keep the usability floor)

Every icon-only control in this cluster MUST:

1. Carry both an `aria-label` **and** a hover `title` tooltip — the accessible name
   is always present, and hover disambiguates for sighted users (the
   ADR-0023/ADR-0006 clarity floor, met by tooltip + convention instead of a
   visible label).
2. Ride the kit frame — the gear/avatar use the `mode-button` 9-slice
   (`.cluster-icon-button`), matched in size so the pair reads as one unit
   ([ADR-0002](0002-nine-slice-border-image-for-pixel-art-chrome.md) /
   [ADR-0032](0032-no-bland-html-css-every-surface-is-kit.md)).
3. Resolve to an unambiguous destination/action — the gear opens a screen titled
   **Settings**; the avatar opens a named account menu.

A genuinely novel or ambiguous control may **not** join this cluster label-free —
it needs a label (ADR-0023) or its own recorded justification. Signed-out, the
account slot is the labeled **Sign In** control (ADR-0023 unchanged); only the
gear is icon-only there.

### Consequences

- **Good:** the "settings + user" cluster matches the universal convention and
  stays minimal; ADR-0023's rule remains intact everywhere else; the deviation is
  discoverable and governed instead of an undocumented contradiction.
- **Cost:** the gear leans on convention + tooltip rather than a visible label —
  an accepted, mitigated trade for this specific corner cluster, not a precedent
  for header icons generally.

## More Information

- **Refines:** [ADR-0023](0023-app-title-bar-layout-and-controls.md) (labeled
  controls / never bare icons) — this is its single scoped exception. Builds on
  [ADR-0006](0006-ui-decision-criteria.md) (usability floor),
  [ADR-0002](0002-nine-slice-border-image-for-pixel-art-chrome.md) /
  [ADR-0032](0032-no-bland-html-css-every-surface-is-kit.md) (kit frames).
- **Related:** [ADR-0035](0035-semantic-ui-icons-carry-a-private-anti-story-anchor.md)
  (the door glyph inside the avatar menu).
- **Consumers:** `frontend/src/ui/MainMenu.tsx` (the cluster),
  `frontend/src/ui/shared/AccountMenu.tsx` (the avatar trigger); classes
  `.header-account-cluster` / `.cluster-icon-button` in `frontend/src/style.css`.
