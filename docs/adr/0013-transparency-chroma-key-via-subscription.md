---
status: "accepted"
date: 2026-06-26
deciders: Nelson, Claude
---

# ADR-0013: Generated-chrome transparency is chroma-key + despill via the subscription codex — native paid-API path rejected

Closes the "Still open: the transparency path" question in
[`kit-forge.md`](../kit-forge.md) and supports
[ADR-0011](0011-chrome-art-generated-not-extracted.md)/[ADR-0012](0012-nine-slice-frames-are-atom-assembled.md)
(generated atoms/glyphs need transparent backgrounds).

## Context and Problem Statement

Generated chrome (atoms, glyphs) needs a transparent background. How is that
produced? This was left undecided, and it was re-floated repeatedly.

Confirmed (web, June 2026):

- Native transparent output (`background: "transparent"`) is a capability of the
  **older GPT-Image-1.5** model. The newer flagship **GPT-Image-2 deliberately
  removed it** — an OpenAI staff member states "gpt-image-2 doesn't currently
  support transparent backgrounds," with no native fix offered and no committed
  timeline to restore it.
- The **built-in (subscription) codex image tool runs the GPT-Image-2-class
  flagship**, so it has no native transparency. Native is reachable only by
  pinning the older GPT-Image-1.5 via the **paid API** (`OPENAI_API_KEY`,
  per-image cost).
- Chroma-key + post-process is the **community-standard** way to get transparency
  out of the GPT-Image-2-class model; third-party "transparent" services do the
  same background removal at their gateway.

Constraint (Nelson): `OPENAI_API_KEY` stays unset. Per-image API cost is not
worth it when the subscription already covers the built-in codex.

## Decision Outcome

Transparency for generated chrome is produced by:

> generate on a flat **`#00ff00` chroma-key background** with the built-in
> (subscription) codex (img2img, method-verified via an `image_generation_call`
> in the rollout) → key to alpha locally with
> `~/.codex/skills/.system/imagegen/scripts/remove_chroma_key.py`.

The native paid-API path (gpt-image-1.5 `background=transparent`) is **rejected
on cost**. This is the method, not a placeholder workaround.

### Guardrails (mandatory, not optional)

- **Key color per palette.** `#00ff00` is the default and is safe for our chrome
  (steel/blue/navy/gold contain no pure green). Switch to `#ff00ff` (magenta)
  only if an asset's art uses green; never key blue for a blue subject.
- **Always verify alpha.** Corners transparent, subject opaque, no holes or key
  fringe. The verify step is a gate that must **fail loudly** — a color collision
  (art containing the key color → holes) cannot ship silently.

Proven 2026-06-26 (the settings row + a corner-atom proof-of-concept):
`image_generation_call` confirmed in the rollout, despilled corners alpha `0`,
subject opaque, visually clean.

### Consequences

- Good: works on the subscription with no per-image cost; the standard technique.
- Limit: chroma-key has an inherent color-collision risk, bounded by the
  per-palette key choice + the mandatory verify gate. Native alpha would remove
  the risk but is rejected on cost.
- Revisit if OpenAI restores native transparency to the flagship (developers have
  asked; no commitment), which would make native viable without the paid model.

## More Information

- OpenAI image-gen guide; [GPT Image 2 vs 1.5 (fal)](https://fal.ai/learn/tools/gpt-image-2-vs-gpt-image-1-5);
  [community thread](https://community.openai.com/t/having-trouble-getting-transparent-backgrounds-in-chatgpt-images/1380143).
- Despill flags + key-color rules: codex imagegen `SKILL.md`; `remove_chroma_key.py`.
