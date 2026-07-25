export const TRUE_ISOMETRIC_CAMERA_YAW_DEGREES = 45;
export const TRUE_ISOMETRIC_CAMERA_ELEVATION_DEGREES = 35.264389682754654;
export const TRUE_ISOMETRIC_SCREEN_EDGE_DEGREES = 30;

export const TILE_CANVAS_WIDTH = 96;
// Two heights, both correct — do not "fix" one to the other (see ADR-0039):
//  - TILE_CANVAS_HEIGHT (140) = the cube CONTENT height, apex of the top diamond down to
//    the bottom of the side faces. It exists only to derive `sideHeight` (= content − top).
//  - TILE_FRAME_HEIGHT (180) = the full sprite FRAME the art is authored/stored/rendered at.
//    The extra ~40px is headroom ABOVE the apex for protruding relief (standing grass, a
//    waterfall lip). The diamond's apex sits at y≈41 in the 180 frame; tiles anchor to the
//    equator, not the frame top, so the headroom never shifts the grid.
// Top and SIDE layers (ADR-0039) are both authored at the 180 frame so they overlay 1:1.
export const TILE_CANVAS_HEIGHT = 140;
export const TILE_FRAME_HEIGHT = 180;
export const TILE_TOP_WIDTH = TILE_CANVAS_WIDTH;
export const TILE_TOP_HEIGHT =
  TILE_TOP_WIDTH * Math.tan((TRUE_ISOMETRIC_SCREEN_EDGE_DEGREES * Math.PI) / 180);
export const TILE_STEP_X = TILE_TOP_WIDTH / 2;
export const TILE_STEP_Y = TILE_TOP_HEIGHT / 2;

export const LEGACY_TILE_TOP_HEIGHT = 54;
export const LEGACY_TILE_SCREEN_EDGE_DEGREES =
  Math.atan((LEGACY_TILE_TOP_HEIGHT / 2) / (TILE_TOP_WIDTH / 2)) * (180 / Math.PI);

