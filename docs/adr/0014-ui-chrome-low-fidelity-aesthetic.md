---
status: "accepted"
date: 2026-06-26
deciders: Nelson, Claude
---

# ADR-0014: UI chrome matches the concept's low-fidelity element aesthetic; forges specify shape + fidelity

Refines the generation method ([ADR-0011](0011-chrome-art-generated-not-extracted.md),
[ADR-0012](0012-nine-slice-frames-are-atom-assembled.md),
[ADR-0013](0013-transparency-chroma-key-via-subscription.md)) by fixing what the
generated art should *look like*, and how we describe it to the model.

## Context and Problem Statement

A forged settings-row corner atom came back wrong in two ways: it missed the
concept's notch, and it was "too high fidelity" — smooth and painterly, not the
game's low-fi indie look.

Measuring resolved a wrong assumption (mine): the concept screen has ~58,800
colors, which looked like "not pixel art." But that is the *whole scene*
(gradients + lighting). An **isolated element** is deliberately low-fidelity — a
settings-row corner is **≈ 286 colors**. The forged atom of the same corner was
**≈ 8,167 colors** — ~28× too high. So the concept's *elements* are chunky and
low-fi; the forge produced a smooth render.

Root cause was largely self-inflicted: the forge prompt asked for "soft
anti-aliased edges (do not binarize)" — steering directly *away* from the target
look — and used vague shape words ("notch"/"hook") that let the model invent.

## Decision Outcome

1. **UI chrome targets the concept's low-fidelity *element* aesthetic** — low-fi,
   pixellated, indie: a limited per-element palette (order of a few hundred
   colors, like the concept's ≈286), chunky/stepped edges, authored at native
   footprint. NOT a smooth, high-fidelity, painterly render.
2. **Forge prompts must specify both axes** — fidelity (the look) and anatomy
   (the parts) — using the shared terms in
   [`ui-chrome-vocabulary.md`](../ui-chrome-vocabulary.md), and must attach a
   close-up reference of the exact detail. **Never** request "soft anti-aliased"
   or "do not binarize" for chrome.
3. No new tool is needed — codex-class generation produced the concept's low-fi
   elements; the fix is prompt vocabulary + fidelity, not a different generator.

This corrects the smooth-render mistake and is settled: do not reintroduce "soft
anti-aliased" chrome or describe details in vague terms.

### Consequences

- Good: a concrete, measured fidelity target (≈ a few hundred colors/element) and
  a shared vocabulary the model can be held to; the look stops drifting smooth.
- The atom-painter (`forge-atom.mjs`) should bake the fidelity vocabulary into its
  prompt scaffold so callers can't omit it (action-point enforcement).
- Verify each result against the concept in `/artwork-compare` (single-asset `img:`
  panes, added for exactly this) before onboarding.

## More Information

- Vocabulary + measured numbers: [`../ui-chrome-vocabulary.md`](../ui-chrome-vocabulary.md).
- Method this refines: ADR-0011/0012/0013; tool: `frontend/scripts/forge-atom.mjs`.
