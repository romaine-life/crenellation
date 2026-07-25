# Background Set Briefs

This document defines the production shape for background sets. It sits between
the thematic exposition in [`lore-anti-story.md`](lore-anti-story.md) and the
asset rules in [`background-art-contract.md`](background-art-contract.md).
Historical anchors that can drive these briefs live in
[`lore/historical-anchors/`](lore/historical-anchors/).

The important correction: a background set should not begin as "a medieval
place, but empty." That is too generic. Each set needs a hidden scenario: an
unstated event, preparation, absence, ritual, repair, journey, or social purpose
that gives the images something to imply. The final art must not explain the
scenario. It should show residues from it.

The set should feel like it wants to become a universe, then refuses to fulfill
that promise. The world background and portrait backdrops are thematically
entwined, but they do not need to be geographically continuous.

## Set Structure

Each background set contains:

- one world/page background
- six portrait archetype backdrops: pawn, knight, bishop, rook, queen, king

The world/page background establishes the broad atmosphere. The portrait
backdrops sample different residues of the hidden scenario through each role's
archetype. They should feel like memory shards from one anti-story, not camera
angles from one continuous mapped place.

## Required Brief

Every set must have this brief before image generation:

```text
Name:
Hidden scenario:
Emotional contradiction:
Visible residues:
Forbidden explanation:
World background:
Pawn echo:
Knight echo:
Bishop echo:
Rook echo:
Queen echo:
King echo:
Style notes:
```

### Field Definitions

**Name**

A short production name for the set. It should be evocative but not lore-heavy.

**Hidden scenario**

The private premise behind the set. This is not text that appears in the game.
It is the thing the art knows and withholds.

Good hidden scenarios:

- a village prepared for someone who never came
- a place was evacuated without panic
- a road was built to reach a destination that is gone
- a ritual was completed, but its meaning is lost
- a settlement maintains defenses against nothing visible

Bad hidden scenarios:

- a named king arrives at a named village
- a monster attacked last night
- the blue faction is at war with the red faction
- a magical curse has transformed the land

**Emotional contradiction**

The tension that keeps the scene from becoming one-note. The world should not be
only eerie, only cozy, only tragic, or only beautiful.

Examples:

- prepared and abandoned
- peaceful and socially emptied
- cared-for and purposeless
- defensive and unthreatened
- ceremonial and unexplained

**Visible residues**

Objects, arrangements, and environmental traces the art is allowed to show:
bundles, swept roads, cold hearths, covered tables, repaired gates, tied cloth,
stacked stones, candle soot, empty benches, old tools, worn tracks, road markers.

**Forbidden explanation**

Things the art must not show because they would resolve the scenario: arriving
processions, refugees, active battle, named rulers, readable symbols, crowds,
monsters, overt magic, explanatory signs, or readable faces.

**World background**

The broad scene for the page/battle background. It can be landscape, town edge,
road, keep, chapel, bridge, field, snow, river, or another environment, as long
as it supports the hidden scenario.

**Pawn echo**

The labor/road/field/low-wall residue of the hidden scenario.

**Knight echo**

The travel/departure/patrol/stable/road-bend residue of the hidden scenario.

**Bishop echo**

The ritual/chapel/grave/threshold/candle residue of the hidden scenario.

**Rook echo**

The wall/gate/repair/fortification/stone-mass residue of the hidden scenario.

**Queen echo**

The garden/court/preparation/gathering/ceremonial-space residue of the hidden
scenario.

**King echo**

The command/keep/table/authority/central-room residue of the hidden scenario.

**Style notes**

The rendering lane. By default, all sets use the accepted refined pixel-art
video-game background style from `background-art-contract.md`.

## Prompt Rule

Do not prompt a portrait as a generic location:

```text
Wrong: bishop chapel garden, quiet, medieval, no faces.
```

Prompt it as an unresolved purpose:

```text
Right: bishop portrait backdrop, chapel garden after an unexplained vigil;
burned-down candles, fresh flowers, empty benches, no congregation, no readable
symbols, no faces.
```

The purpose gives the image something to hold. The absence keeps it from turning
into story.

## Prompting Process Notes

This section should be updated whenever a generation pass teaches us something
about how to prompt these sets.

### 2026-06-23: Set-Level Brief + Per-Image Shot Direction

Use one prompt per image. Do not use one broad prompt and ask for six variations.
Each role needs its own residue, camera, environment, and visual rhythm.

However, every per-image prompt should inherit a shared set-level preamble:

- historical anchor
- hidden scenario
- emotional contradiction
- rendering style
- hard exclusions
- set-level variety rule

The set-level variety rule is important:

> Treat the set as a sequence of environmental panels from an unwritten comic.
> Do not repeat the same exterior moonlit stone-building composition. Vary
> interior/exterior, camera height, distance, enclosure, lighting, subject scale,
> and visual rhythm.

Failure mode observed:

- Prompts repeated "moonlit/dusk," "stone wall," "portrait-friendly,"
  "quiet central area," and "tiny pawn/meeple-like figure."
- The generator followed those repeated structures too faithfully.
- Result: attractive images, correct concepts, but they read like reshaped
  versions of one scene instead of an absent story across multiple panels.

Correction:

- Prompt environment-first, not portrait-plate-first.
- Remove "quiet central area for a transparent unit" unless the image is already
  accepted and being adapted for UI.
- Use distinctive shot design per image: low close-up, stable interior, chapel
  interior, high-angle ruin, arcade-framed garden, dim audit room.
- Replace "tiny pawn/meeple figure" with near-human obscured figures when life is
  needed.
- Use "sparse, not vacant": life can appear through labor, posture, animals,
  tools, weather, and maintenance, but the main event remains missing.

### Human Figure Rule

The small anonymous figure should not read as a surreal non-human unless a set
explicitly calls for that. That breaks immersion too early and makes the
surrealism meaningless.

Prefer:

- child-sized figure in oversized cloak
- farmer or laborer with face hidden by hood, hair, distance, turned head, or
  posture
- bored/slumped worker near tools
- person glancing over shoulder while performing labor
- hooded religious figure seen from behind
- traveler, servant, or rural worker with obscured features
- horse, livestock, or work animal as ordinary life residue

Avoid:

- alien or statue-like featureless silhouettes
- literal meeple bodies unless the set calls for game-piece intrusion
- figures posed like symbols
- readable faces

The bodies and limbs should be near-human and passable. The emptiness comes from
obscured identity and missing explanation, not from making the person obviously
non-human.

### Composition Rule

Portrait backdrops are allowed to break portrait-friendly composition during
concept generation. It is more important that each image works as an isolated
environmental panel than that it immediately fits a character-card crop.

Cropping and UI adaptation can come later.

## Current Sets

### Set 01: Old Road / Walled Village

**Status:** Exploratory visual direction exists. Not yet accepted as production
assets. The first proof established the correct rendering lane after the style
correction back toward refined pixel-art video-game backgrounds.

**Hidden scenario:** To be defined before production acceptance.

The current work has an environment theme but does not yet have a strong enough
hidden scenario. Future generation should revise this set through the full brief
format above rather than continuing to prompt it only as an old road and village.

Possible hidden-scenario candidates:

- The village was prepared for someone who never came.
- The road was built to reach a place that is gone.
- The village maintains a defense against nothing visible.

### Set 02 Candidate: Stone After Prayer

**Historical anchor:** [Dissolution of the Monasteries](lore/historical-anchors/dissolution-of-the-monasteries.md)

**Status:** Candidate for the next generated set.

**Hidden scenario:** a monastery has been emptied and partially stripped; the
surrounding village continues to use, pass, repair, and misremember the place.

**Emotional contradiction:** sacred and practical; emptied and still useful;
beautiful and dispossessed.

Use the dedicated historical-anchor note for the full visible residues,
forbidden explanations, and portrait echoes.

### Set 03 Candidate: After The Sanctuary

**Historical anchor:** [Destruction of Jerusalem and the Second Temple, 70 CE](lore/historical-anchors/jerusalem-second-temple-70-ce.md)

**Status:** Locked candidate.

**Hidden scenario:** the sacred center has been destroyed and the old ritual
world cannot continue in its previous form; survival moves into roads, rooms,
teaching, memory, and ordinary objects.

**Emotional contradiction:** shattered and continuous; sacred and administrative;
displaced and still living.

This set may also carry the Philip K. Dick / *VALIS* resonance of Rome as the
Empire that "never ended," but only as a hidden interpretive pressure. Do not
literalize PKD, the Black Iron Prison, stopped time, or gnostic imagery in the
art.

### Set 04 Candidate: The Farm Behind The Line

**Historical anchor:** [Lijssenthoek / Remy Farm, World War I](lore/historical-anchors/lijssenthoek-remy-farm-wwi.md)

**Status:** Locked candidate.

**Hidden scenario:** a rural farm, hamlet, and railway siding behind the Ypres
front have become a medical threshold: the wounded arrive, some are sent onward,
some remain, and the fields keep growing around the work.

**Emotional contradiction:** bright and sorrowful; useful and helpless; rural
and industrial; ordinary care beside mass injury.

This set should be visually brighter than the sanctuary set. It may use daylight,
overcast green fields, white linen, wet clay, pale farm walls, and lamp-lit
interiors. The war is never shown directly. No active combat, no centered guns,
no battlefield spectacle, and no heroic military tableau.

### Set 05 Candidate: The Summer That Failed

**Historical anchor:** [Year Without A Summer, 1816](lore/historical-anchors/year-without-a-summer-1816.md)

**Status:** Candidate for generated set.

**Hidden scenario:** summer has failed, but the village is still trying to
behave as if summer can be repaired. People protect plants, ration stores,
move along roads, shelter animals, and keep working under a season that has
become wrong.

**Emotional contradiction:** natural and unnatural; bright and cold; inevitable
and survivable; communal problem rather than human enemy.

This set should not frame humanity as its own adversary. The pressure comes from
climate, distance, and the strange fact that a disaster elsewhere made local
summer unreliable. The positive contrast is not victory over nature, but
adaptation: people survived, unevenly and imperfectly, because they solved the
problem as well as they could.

## Candidate Scenario Bank

These are not accepted sets yet. They are seeds for brainstorming.

### Prepared For Someone Who Never Came

Hidden scenario: a place made small preparations for an arrival, ceremony, or
return that never happened.

Emotional contradiction: prepared and abandoned; cared-for and hollow.

Visible residues: swept or marked road, repaired gate, placed candles, arranged
garden, ready stable, covered command table, bundles waiting near a threshold.

Forbidden explanation: no procession, no named visitor, no crowd, no heraldry,
no reason the preparation failed.

### Evacuated Without Panic

Hidden scenario: a place was emptied in an orderly way, without visible disaster.

Emotional contradiction: calm and missing; domestic and uninhabited.

Visible residues: shut doors, cold hearths, covered goods, road ruts,
unfinished chores, folded cloth, closed gate, covered altar.

Forbidden explanation: no refugees, no fire, no enemy, no plague cart, no sign
that explains why everyone left.

### Road To A Missing Destination

Hidden scenario: a road, causeway, or route was built to reach something that no
longer appears in the image.

Emotional contradiction: purposeful and pointless; ancient work with no visible
object.

Visible residues: old road markers, broken bridge, workers' stones, half-buried
causeway, roadside shrine, survey table, path disappearing into fog, water, or
woods.

Forbidden explanation: no visible destination, no map, no dramatic ruins that
explain the absence, no magical disappearance.

### Ritual With Lost Meaning

Hidden scenario: a ritual or communal act was completed, but the viewer cannot
know what it meant.

Emotional contradiction: ceremonial and unreadable; tender and empty.

Visible residues: candles burned low, flowers placed, cloth tied to branches,
stones arranged, benches empty, offerings weathering, grave markers tended.

Forbidden explanation: no worshippers, no deity image, no readable symbols, no
spell effects, no explicit supernatural cause.

### Defense Against Nothing Visible

Hidden scenario: a settlement keeps maintaining defense, warning, or refuge
systems, but the threat is never shown.

Emotional contradiction: defensive and peaceful; maintained and absurd.

Visible residues: repaired wall, stacked stones, empty watch platform, signal
fire site, blocked gate, refuge chapel, inner court prepared for shelter.

Forbidden explanation: no enemy, no battle, no soldiers in action, no monstrous
threat, no explanatory banners.
