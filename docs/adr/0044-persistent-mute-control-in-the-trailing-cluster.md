---
status: "accepted"
date: 2026-06-28
deciders: Nelson, Claude
---

# ADR-0044: The mute control is a persistent member of the trailing cluster, not floating chrome

Refines [ADR-0036](0036-trailing-account-settings-cluster-is-icon-only.md) (the
trailing cluster is the one place icon-only header controls live) and
[ADR-0042](0042-title-bar-is-an-invariant-screens-add-slots.md) (the title bar is an
invariant; the trailing edge is the account/settings cluster). Builds on
[ADR-0002](0002-nine-slice-border-image-for-pixel-art-chrome.md) /
[ADR-0032](0032-no-bland-html-css-every-surface-is-kit.md) (kit frames).

## Context and Problem Statement

The background-music mute toggle (`bgm.js`'s kit-framed `.bgm-control`) shipped as a
**floating button docked bottom-right of `document.body`** — and was then `display:none`'d
on the very screens the player spends the most time on: the main menu, Skirmish, and the
Studio. So the one control that mutes the soundtrack was inconsistently placed and absent
exactly where you'd reach for it; the only reliable way to mute was to open
**Settings → Audio**. The owner asked that mute "just be a persistent top-right title bar
member" — promoting it to the always-visible chrome instead of burying it in Settings or
floating it where it's half the time hidden.

ADR-0042 made the title bar an invariant whose trailing edge is the cluster, and ADR-0036
made that cluster the **single** sanctioned home for icon-only header controls — but it
also requires that "a genuinely novel … control may **not** join this cluster label-free
— it needs … its own recorded justification." A mute toggle is exactly such a new member.
This ADR is that justification.

## Decision Drivers

- A mute control is a global, app-level affordance (like the gear), not screen-specific
  context — so it belongs on the persistent invariant chrome, reachable identically on
  every route, not in a per-screen `actionsSlot` (ADR-0042) and not in a floating layer
  that each screen can suppress.
- ADR-0036 forbids new icon-only cluster members without a recorded justification + the
  three mitigations (accessible name, kit frame, unambiguous action).
- Single source of truth: there must be exactly **one** mute control and one mute state,
  not a title-bar copy fighting a floating original (`bgmPrefs.js` exists precisely so the
  mute key/events can't desync; a second UI must not reintroduce drift).

## Considered Options

- **Keep the floating bottom-right button** (status quo). Rejected: not persistent (hidden
  on menu/Skirmish/Studio), not top-right, and competes with the cluster as a second
  trailing affordance.
- **Build a new React mute button in the cluster and leave `bgm.js`'s control on `body`.**
  Rejected: two controls, two render paths for one state — the exact desync ADR-`bgmPrefs`
  guards against — and it would duplicate `bgm.js`'s cross-tab / retry / now-playing logic.
- **Re-home the existing `bgm.js` control into a cluster slot** (chosen).

## Decision Outcome

**The trailing cluster gains a third persistent, icon-only member: the BGM mute control,
laid out as the cluster's LEADING item — `[mute] [gear] [avatar]` — so the established
"settings + user" pair (ADR-0036) stays intact on the far corner.** It is the *same*
`bgm.js` button, not a copy: `HeaderAccountCluster` renders a boxless `.cluster-bgm-slot`
(`display: contents`), and `bgm.js` mounts its control into that slot instead of `body`.
Because `initBgm()` runs before React mounts the bar, the button is created **detached**
and a `MutationObserver` places it the instant the slot appears — so it never flashes at
the old docked position, and there is still exactly one control driving one mute state.

The floating presentation is retired: `.bgm-control`'s `position: fixed` + the per-screen
`display:none` hide rules + the bottom-right responsive offsets are all deleted. The
control now sizes to match the gear/avatar (52px, 10px `mode-button` border-image).

This member satisfies ADR-0036's three requirements:

1. **Accessible name + tooltip** — `bgm.js`'s `renderControl` already sets both `aria-label`
   and `title`, and they track state ("Mute background music (♪ …)" / "Background music
   muted — click to unmute" / "Playing in another tab — click to play here" / "unavailable
   — click to retry").
2. **Kit frame** — the `mode-button` 9-slice (ADR-0002/0032), with the `-active` frame
   marking "playing" and the icon dimming when muted/silent; matched in size to the gear.
3. **Unambiguous action** — a single toggle over the soundtrack; the music glyph + tooltip
   + the near-universal mute convention carry the meaning (the same position-and-convention
   argument ADR-0036 made for the gear).

Scope note: this control governs the **background music** specifically (the existing
`bgm.js` mute state, shared with Settings → Audio → Background Music), not a master/all-audio
mute. It remains in sync with the Settings toggles via the existing mute key/event.

**Clarification (2026-06-29): "persistent" includes the no-soundtrack case.** The first
implementation still `display:none`'d the control once `/api/bgm` settled with zero tracks
— so it vanished in any environment without a configured soundtrack (notably local dev
without `BGM_DEV_TRACKS=1`, and an empty library). That contradicted this ADR's own thesis:
a persistent cluster member must keep the cluster's roster identical on every route and in
every environment, not blink out when the playlist happens to be empty. The control now
**always renders**; with no tracks it shows **dimmed/inert** (the muted frame, `aria-label`
/ `title` "Background music — no soundtrack configured") and clicking is a no-op. `renderControl`
in `bgm.js` no longer hides it; only the icon/label state varies.

### Consequences

- **Good:** mute is reachable in the same top-right spot on every route (menu, Skirmish,
  Studio included); one control, one state, no duplicated logic; the cluster gains a useful
  global member under a recorded justification rather than silently.
- **Good:** all cross-tab ownership, autoplay-arming, retry, and now-playing behaviour is
  preserved untouched — only the mount point and the frame's size/position changed.
- **Cost:** a vanilla-JS button is re-parented into a React-rendered slot. Mitigated by the
  boxless `display:contents` slot (no React children → React never reconciles the foreign
  node) and the persistent single-mount cluster; this mirrors the existing manual-DOM
  pattern (`onCenterNode`/`onActionsNode` refs, `bgm.js` previously appending to `body`).
- **Cost:** the control now appears on screens that previously hid it — intended (that's
  "persistent"), and it rides the same cold-reveal/opacity as the rest of the bar.

## More Information

- **Refines:** [ADR-0036](0036-trailing-account-settings-cluster-is-icon-only.md) (adds a
  third sanctioned cluster member), [ADR-0042](0042-title-bar-is-an-invariant-screens-add-slots.md)
  (the persistent trailing edge). **Builds on:**
  [ADR-0002](0002-nine-slice-border-image-for-pixel-art-chrome.md) /
  [ADR-0032](0032-no-bland-html-css-every-surface-is-kit.md).
- **Components:** `frontend/src/bgm.js` (`mountControl` → `.cluster-bgm-slot`),
  `frontend/src/ui/shared/HeaderAccountCluster.tsx` (renders the slot). **Classes:**
  `.cluster-bgm-slot` (boxless), `.bgm-control` (now a static cluster button) in
  `frontend/src/style.css`.
