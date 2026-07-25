---
status: "accepted"
date: 2026-06-27
deciders: Nelson, Claude
---

# ADR-0023: App title-bar layout & controls — centered three-section bar, labeled controls (never bare icons)

Generalizes [ADR-0010](0010-settings-header-buttons.md) (settings header buttons +
centered content) to **every** screen's title bar, and adds a research-backed rule
for header controls. Builds on [ADR-0004](0004-standard-app-title-bar.md) (the shared
full-bleed bar), [ADR-0003](0003-single-shared-brand-lockup.md) /
[ADR-0008](0008-brand-lockup-typography.md) (the brand lockup),
[ADR-0002](0002-nine-slice-border-image-for-pixel-art-chrome.md) /
[ADR-0014](0014-ui-chrome-low-fidelity-aesthetic.md) (kit chrome), and the
[ADR-0006](0006-ui-decision-criteria.md) surface rubric.

## Context and Problem Statement

We standardized the title bar's frame and height (ADR-0004) and the brand lockup
(ADR-0003/0008). ADR-0010 then unified the *settings* header's buttons to bracket
frames and centered its content row — but only for settings. Other bars drifted: the
skirmish bar arranged its elements with no intentional rhythm and used **bare icon
buttons** (a hamburger that linked to the main menu, a gear for settings). We need one
rule for (a) how a title bar arranges its content and (b) how its controls look and
read — applied to every bar, not just settings.

## Decision Drivers

- One consistent, ADR-backed title-bar treatment on every screen; stop per-screen drift.
- Header controls must be unambiguous — the usability floor (ADR-0006 #1) is
  non-negotiable even on in-game surfaces.
- Honor the ADR-0006 surface split (in-game leans game-UI; menus lean product-UI)
  without sacrificing clarity.
- Stay on the kit (ADR-0002/0010/0014): controls are the gold 9-slice frame, not raw CSS.
- Don't invent redundant or semantically-mismatched controls.

## Considered Options

- Bare icon buttons (skirmish status quo).
- Text-only buttons everywhere (settings status quo).
- Labeled controls on the kit frame, with a centered three-section bar layout.

## Decision Outcome

Chosen: **a shared title-bar content standard**, applied to every screen's
`.app-titlebar`:

1. **Three-section layout, vertically centered.** Brand lockup (left) · contextual
   content (center) · controls (right), on one `align-content: center` row. Generalizes
   ADR-0010's centering from settings to all bars. The center section is screen-specific
   (skirmish: turn + objective status chips; settings: account; editors: title/stats).

2. **Controls are always labeled — never bare icons.** The research is unanimous: only
   *home / print / search* are universally recognized icons; the gear and hamburger are
   **not**, and navigation icons especially need labels (NN/g). Therefore:
   - **In-game bars** (skirmish, …) may use **icon + visible text label** (keeps game
     flavor; ADR-0006 in-game lean).
   - **Menu / chrome bars** (settings, studio, editors) use **text labels**.
   - Either way the visible text is the accessible name; any glyph is decorative
     (`aria-hidden`). Never ship an icon-only header control.

3. **Controls ride the kit gold `mode-button` 9-slice frame** (equal height by
   construction), per ADR-0010; the cyan variant marks a single primary action where one
   exists (e.g. Sign In).

4. **No redundant or mismatched controls.** A control that duplicates existing
   navigation or misuses a convention is dropped, not styled. Worked example: the
   skirmish **hamburger was removed** — it duplicated the brand lockup's home link
   (ADR-0003), and a hamburger means "open a menu," not "go to the main-menu screen"
   (NN/g). The genuine in-game equivalent is a Pause/Menu overlay (separate, future).

Rejected: **bare icon buttons** (fail the usability floor — ambiguous, per the research)
and **text-everywhere** (sands off the in-game game-UI flavor ADR-0006 protects).

### Consequences

- Good: header controls read unambiguously; one rule across all bars; on-kit and
  accessible by construction; the in-game/menu split stays principled (ADR-0006).
- Cost: labels are wider than bare icons (acceptable — bars are full-bleed with room);
  each screen migrates onto the standard (skirmish + settings done; studio + campaign
  editor follow).
- Note: decorative glyphs beside labels (e.g. the skirmish gear) still want an on-theme,
  standardized set if kept; regenerating that set is follow-up, not blocked here.

## Pros and Cons of the Options

### Bare icon buttons

- Good: most compact; maximal game flavor.
- Bad: ambiguous (gear/hamburger aren't universal icons); fails the usability floor;
  needs aria plumbing anyway.

### Text-only everywhere

- Good: clearest; already on settings; trivially accessible.
- Bad: wider; erodes the in-game surface's game-UI character (ADR-0006).

### Labeled controls + centered three-section bar (chosen)

- Good: clear *and* on-theme; one rule with two surface-appropriate flavors; accessible.
- Bad: per-screen migration; decorative glyphs still need standardizing if used.

## More Information

- Generalizes: [ADR-0010](0010-settings-header-buttons.md). Builds on:
  [ADR-0002](0002-nine-slice-border-image-for-pixel-art-chrome.md),
  [ADR-0003](0003-single-shared-brand-lockup.md),
  [ADR-0004](0004-standard-app-title-bar.md),
  [ADR-0006](0006-ui-decision-criteria.md),
  [ADR-0008](0008-brand-lockup-typography.md),
  [ADR-0014](0014-ui-chrome-low-fidelity-aesthetic.md).
- Research (icons need labels; gear/hamburger are not universal; navigation icons
  especially need labels):
  - NN/g — [Icon Usability](https://www.nngroup.com/articles/icon-usability/)
  - NN/g — [The Hamburger-Menu Icon Today: Is it Recognizable?](https://www.nngroup.com/articles/hamburger-menu-icon-recognizability/)
  - NN/g — [Hamburger Menus and Hidden Navigation Hurt UX Metrics](https://www.nngroup.com/articles/hamburger-menus/)
  - Game UI — [Justinmind: Game UI design](https://www.justinmind.com/ui-design/game)
  - Accessibility — [A11Y Collective: Icon usability & accessibility](https://www.a11y-collective.com/blog/icon-usability-and-accessibility/)
- Components: `src/ui/shared/BrandLockup`; classes `.app-titlebar` / `.skirmish-topbar` /
  `.settings-header-frame`; controls `.skirmish-header-button` / `.settings-header-button`
  on the kit `mode-button.png` frame.
- Consolidated current-state: [`../ui-art-direction.md`](../ui-art-direction.md).
