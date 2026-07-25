# UI Chrome Vocabulary

Shared, exact terms for describing UI chrome — to each other *and* to the image
model in forge prompts. Vague words ("notch", "J", "make it match") let the model
invent; precise, consistent terms make it reproduce. Two axes: **fidelity** (the
look) and **anatomy** (the parts). Grounded in the accepted concept's measured
numbers so the target is concrete, not a feeling.

Decision that requires this: [ADR-0014](adr/0014-ui-chrome-low-fidelity-aesthetic.md).

## Fidelity / aesthetic axis (the look)

The accepted concept reads as **low-fidelity, pixellated, indie** *at the element
level*, even though the full scene has many colors (gradients + lighting across
the whole image). Measured:

- Whole concept screen: ~58,800 unique colors (scene-wide gradients — not the target).
- **One isolated element** (a settings-row corner): **≈ 286 colors** — this is the target.
- A too-smooth forged atom of the same corner: **≈ 8,167 colors** — REJECT (~28× too high).

Terms to use:

- **low-fi / indie / pixellated** — chunky, limited detail, hand-crafted feel; NOT
  a smooth painterly render.
- **limited element palette** — an individual element uses on the order of a *few
  hundred* colors (concept corner ≈ 286), not thousands.
- **chunky / stepped edges** — edges step in visible blocks; anti-aliasing is
  minimal. **Do NOT request "soft anti-aliased" or "do not binarize"** — that is
  the exact instruction that produced the smooth 8,167-color reject. This line is
  the main reason this doc exists.
- **native footprint** — author / size the element at roughly its real on-screen
  pixel size, not 10–20× larger. High native density reads as over-smooth. (Repo
  rule, from the tile pipeline: native footprint, no fractional downscale of pixel art.)

## Anatomy axis (the parts — frames / rows)

- **rail** — the thin border line of a frame.
- **fill** — the interior area (e.g. navy for a settings row).
- **corner** — where two rails meet.
- **notch** — the small stepped, inward accent in the rail at a corner (a short
  inward jog/step, not a smooth round corner and not a plain right angle). Its
  *exact* form is element-specific — always feed the model a **close-up crop of
  the concept's actual notch** as the img2img reference; don't describe it from
  memory.
- **edge** — the straight rail segment between corners. Must be uniform so it
  tiles cleanly as a 9-slice.

## Using this in a forge prompt

Every chrome forge prompt should state, explicitly:

1. **Fidelity** — "low-fi / pixellated / indie; limited element palette (a few
   hundred colors); chunky stepped edges; native footprint." Never "soft anti-aliased."
2. **Anatomy** — name the parts (rail / fill / corner / notch / edge) and what
   each should do.
3. **Reference** — attach a close-up of the exact concept detail being reproduced.

Then verify the result against the concept in `/artwork-compare` (single-asset
`img:` panes) before onboarding.
