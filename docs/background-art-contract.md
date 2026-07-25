# Background And Portrait Art Contract

This document converts the lore/anti-story direction in
[`lore-anti-story.md`](lore-anti-story.md) into production-facing rules for
background images, unit-select portrait backdrops, prompts, review, and runtime
integration.

For each multi-image background set, first define a hidden-scenario brief in
[`background-set-briefs.md`](background-set-briefs.md). Do not generate a set
from generic medieval locations alone.

Use the accepted generated main-menu background as the style anchor:

- `frontend/public/assets/ui/main-menu/background-scene-v1.png`

The target is refined video-game background art in the accepted main-menu style:
pixel-art scenic illustration with disciplined clusters, visible game-art
rendering, clear silhouettes, atmospheric depth, and a slightly "boring" game
background usefulness. It is not generic fantasy splash art, not matte-painting
concept art, not grimdark, and not a literal chessboard world. The art should be
beautiful and acceptable at first glance, with the surreal pressure embedded in
details.

## Asset Families

### World / Battle Backgrounds

Broad scene art used behind menus, the play board surface, loading states, or
other atmospheric routes.

Purpose:

- establish place, weather, silence, and medieval material
- give the board page something meaningful behind the tactical surface
- carry the "anti-story" without explaining it

Examples:

- sunlit Carcassonne-like farmland with an old road and no visible villagers
- snowed-in village edge with a road disappearing into weather
- chapel garden with graves and spring flowers
- river town, bridge, or causeway with no readable faces
- keep courtyard, ruined wall, or watchtower after activity has passed
- high meadow or mountain road with one tiny pawn/meeple-like figure

### Unit Portrait Backdrops

Environmental archetype images used behind unit portraits or unit selection.
These are not biographies and must not imply named characters.

Purpose:

- give each role symbolic material and place
- provide more art opportunities without overdefining the pieces
- let unit identity come from environment, silhouette, and function

Initial archetype set:

| Piece | Environmental archetype |
|---|---|
| Pawn | field edge, muddy road, low village wall, tilled earth, distant roofs |
| Knight | forest road, stable yard, mountain pass, snow track |
| Bishop | chapel wall, cloister garden, graveyard with spring flowers, candlelit stone |
| Rook | gatehouse, tower wall, quarry, fortress parapet |
| Queen | court garden, bannered hall, balcony, ceremonial ruins |
| King | keep courtyard, throne shadow, war table, hill fortress |

The backdrop should suggest role, not personality. "Pawn equals road/field" is
correct. "This pawn is a farmer named X" is wrong.

Portrait backdrops do not need to be geographically continuous with the
world/page background in the same set. They should share art language, theme,
material, and anti-story constraints, but they may be discontinuous fragments:
different roads, courtyards, chapels, weather, or distances. This is preferred
when it helps the project imply a larger universe without fulfilling that
promise as literal story or map continuity.

They should also echo the set's hidden scenario through role-specific residues:
labor without worker, travel without traveler, ritual without congregation,
defense without battle, court without court, command without commander. The
specific residue changes per set; the important rule is that each portrait has a
purpose-shaped absence, not merely a generic archetype location.

## Visual Rules

Do:

- Use the existing main-menu scenic background as the style and quality anchor.
- Preserve the video-game art read: refined pixel/scenic game background,
  intentionally usable behind UI, not a loose painterly concept illustration.
- Keep scenes mostly realistic and passable at first glance.
- Let the uncanny material live in subtle details, absence, scale tension, and
  unresolved composition.
- Include recurring small life-forms as a motif: pawn-like, meeple-like, or
  human silhouettes compressed toward that simplification.
- Make those figures distant, low-detail, faceless, and poorly contextualized.
- Use medieval material culture: roads, stone, wood, chapels, walls, fields,
  towers, bridges, grave markers, bells, soot, snow, mud, grass, water.
- Allow bright, peaceful, warm, or beautiful scenes. Darkness is not the brand.
- Let hardship exist as ordinary residue beside good things.
- Keep the art behind gameplay readable and lower-contrast where needed so
  pieces, overlays, and UI remain clear.

Avoid:

- readable faces; noses are allowed as minimal sculptural hints
- eyes, mouths, expressions, portrait faces, saint faces, or masks with features
- overt chessboards, checkered floors, game tables, dice, cards, or meta-game
  props in scenic backgrounds
- glowing runes, portals, crystals, spell effects, fantasy magic systems
- cute fairy-tale whimsy
- grimdark gore or horror framing
- heroic fantasy poster composition
- modern objects
- named-character storytelling
- overly clean Disney medieval treatment
- scenes that explain what the player "is"

## Composition Rules

World backgrounds:

- May vary camera, weather, season, palette, and scale according to artistic
  quality.
- Should leave safe negative space or low-detail regions where UI/board layers
  may sit.
- Should not show active battle. War appears as residue.
- Should not require the board to physically belong to the scene. The background
  is an atmospheric/semantic layer, not a literal diorama explanation.

Portrait backdrops:

- Keep the unit readable first.
- Avoid strong face-like details behind the unit.
- Use shallow depth, soft detail, or compositional quiet behind the unit.
- Keep the role environment recognizable but not busy.
- Match the same broad art language across piece types, even when palette and
  location vary.
- Do not force continuity with the world background. A portrait can feel like a
  separate memory shard from the same anti-story rather than another angle on
  the same village.

## Prompt Contract

A useful generation prompt should include:

- grounded medieval environment
- refined pixel-art / video-game scenic background matching the accepted
  main-menu image
- mostly empty scene
- faceless pawn/meeple-like tiny figure if desired
- no readable faces
- no overt magic
- no chessboard motif
- reference to the accepted main-menu background style if the tool supports
  image/style references
- intended use: world background or portrait backdrop

Example world prompt:

```text
Refined pixel-art video game background matching the accepted moonlit main-menu
scene's game-art discipline, medieval countryside road near a small walled
village, old stone and wood, warm late afternoon light, mostly empty, one tiny
faceless pawn-like meeple figure far from the road in a field, beautiful and
ordinary at first glance, subtle dreamlike unease, no readable faces, no
chessboard, no magic effects, no modern objects, no active battle.
```

Example portrait backdrop prompt:

```text
Unit portrait background for a chess bishop archetype, grounded medieval chapel
garden with old stone wall, small grave markers and spring flowers, soft depth
of field, refined pixel-art video game background matching the accepted menu
background style, quiet and mostly empty, no readable faces, no explicit story,
no glowing magic, no chessboard motif.
```

## Runtime Contract

When these assets are wired into the app:

- Store production images under `frontend/public/assets/backgrounds/` or a more
  specific route-owned subfolder.
- Keep filenames semantic and stable, e.g.
  `world-road-village-v1.png`, `portrait-bishop-chapel-v1.png`.
- Use manifest data for semantic role, safe crop, focal area, and intended route.
- Do not bake live UI text into the images.
- Do not add CSS effects that change the meaning of the art.
- For board pages, background art sits behind the board/view pane and must not
  reduce tactical readability.
- For unit portraits, the backdrop is a supporting layer behind the transparent
  unit sprite or render.

Suggested manifest shape:

```json
{
  "id": "portrait-bishop-chapel-v1",
  "kind": "portrait-backdrop",
  "piece": "bishop",
  "src": "/assets/backgrounds/portraits/bishop-chapel-v1.png",
  "styleAnchor": "/assets/ui/main-menu/background-scene-v1.png",
  "safeArea": { "x": 0.18, "y": 0.12, "w": 0.64, "h": 0.76 },
  "notes": "Chapel stone, grave flowers, no readable faces."
}
```

## Review Checklist

Before accepting a background:

- It matches the main-menu background quality and art language.
- It reads as video-game background art, not concept-art mood painting.
- It is attractive before it is strange.
- It contains no readable faces.
- Any figure is pawn/meeple-like or otherwise faceless and simplified.
- It avoids overt chessboard motifs and explicit magic.
- It does not imply a named character biography.
- It can sit behind UI or unit art without harming readability.
- Its strangeness is subtle enough that the image still passes as a normal
  medieval scene at first glance.
- It contributes one quiet clue to the anti-story rather than trying to explain
  the whole world.
