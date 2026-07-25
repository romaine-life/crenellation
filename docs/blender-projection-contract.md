# Blender Projection Contract

This is the render contract for Blender-authored board and unit assets.

## Decision

New Blender work should target a true-isometric projection unless a task explicitly says it is preserving the older accepted tile art.

Use:

- Camera yaw / azimuth: `45 deg`
- Camera elevation / pitch above the board plane: `35.264 deg`
- Resulting screen-space tile edge angle: `30 deg`
- Camera type: orthographic
- Camera behavior: fixed camera; rotate the unit/object for directional sprites

Do **not** use the older `44.1 deg` Blender elevation for new unit renders. That value was used before we had a projection contract and does not match the intended true-isometric tile plane.

## Why The Numbers Differ

`35.264 deg` is a 3D camera elevation. It describes where Blender's camera is above the board.

`30 deg` is the visible 2D angle of the rendered tile edge after projection. It is the flat-image result the player sees.

See `docs/projection-angle-reference.md` for the diagram.

## Blender Camera Setup

For a camera looking from the `+X / -Y / +Z` quadrant toward the board target:

```py
BOARD_TARGET = Vector((0, 0, target_z))
BOARD_DISTANCE = 5.0
BOARD_ELEVATION_DEGREES = 35.264389682754654

elev = math.radians(BOARD_ELEVATION_DEGREES)
horizontal = math.cos(elev) * BOARD_DISTANCE
comp = horizontal / math.sqrt(2)

cam.location = (
    BOARD_TARGET.x + comp,
    BOARD_TARGET.y - comp,
    BOARD_TARGET.z + math.sin(elev) * BOARD_DISTANCE,
)
cam.rotation_euler = (BOARD_TARGET - cam.location).to_track_quat("-Z", "Y").to_euler()
cam.data.type = "ORTHO"
```

The exact distance is not important for orthographic rendering as long as the camera target and elevation are stable. `ortho_scale` controls framing.

## Calibration Requirement

Every Blender unit pass must include a calibration proof before its sprites are accepted.

1. Put the board tile plane in the Blender scene.
2. Render a tile-only proof from the production camera.
3. Verify the rendered tile edge is `30 deg` in screen space.
4. Render the unit on the tile from the same camera.
5. Export transparent unit-only sprites from the same camera.
6. Measure and record the unit contact footprint and anchor.
7. Check the in-game Unit Studio proof against the Blender tile proof.

If the Blender tile proof and in-game tile proof disagree, fix the camera or runtime projection before accepting the unit.

## Directional Sprites

The camera stays fixed. Directional sprites are produced by rotating the unit around the vertical axis.

The direction names are game-facing labels, not camera positions. Keep the direction table explicit in the render script and do not add per-piece aesthetic yaw offsets unless a calibration proof documents why.

## Legacy Current-Tile Compatibility

The existing accepted PNG tiles currently use a `96x54px` top diamond, which has a screen-space edge angle of about `29.36 deg`. Matching that exact legacy tile requires a Blender elevation of about `34.23 deg`.

That is allowed only for preservation work. New projection-calibrated Blender assets should use the true-isometric contract above.
