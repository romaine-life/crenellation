import {
  TILE_CANVAS_HEIGHT,
  TILE_STEP_X,
  TILE_STEP_Y,
  TILE_TOP_HEIGHT,
  TILE_TOP_WIDTH,
  TRUE_ISOMETRIC_SCREEN_EDGE_DEGREES,
} from './projectionContract';

export const TILE_TEMPLATE = {
  topWidth: TILE_TOP_WIDTH,
  topHeight: TILE_TOP_HEIGHT,
  sideHeight: TILE_CANVAS_HEIGHT - TILE_TOP_HEIGHT,
  stepX: TILE_STEP_X,
  stepY: TILE_STEP_Y,
  originX: 438,
  originY: 62,
  selectionOffsetX: -TILE_STEP_X,
  selectionOffsetY: -TILE_STEP_Y,
};

export const TILE_EDGE_ANGLE_DEGREES = TRUE_ISOMETRIC_SCREEN_EDGE_DEGREES;
