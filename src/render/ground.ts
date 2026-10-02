// Ground perspective: one-point perspective for everything lying flat on the
// land (fields, the land grid, the farmer walking them). Lines running into the
// scene converge on a vanishing point in the middle of the view, so as the
// camera moves the ground at the screen edges fans out and swings with it.
// It is the camera's true perspective along the street being looked at
// (plane.ts projects the rest of the village the same way).
//
// Depth is the world y of a point on the ground. At GROUND_REF_Y (the line
// buildings stand on) the ground is drawn at true width, so buildings, plot
// markers and the store need no correction; nearer the viewer it widens,
// further away it narrows, converging at HORIZON_Y.
//
// Everything drawn on the land must go through groundX so it lines up exactly.

import { BASE_Y, EYE_DIST, HORIZON_Y } from '../game/layout';

/** World y of the horizon, where lines on the ground meet: the far edge of the village's plane (game/layout.ts). */
export { HORIZON_Y };
/** Depth drawn at true width. */
export const GROUND_REF_Y = BASE_Y;
const SPAN = GROUND_REF_Y - HORIZON_Y;

// --- The drawing camera ----------------------------------------------------------------
// The game measures depth as world y, the way its own camera (EYE_DIST in front of the
// building line) sees the street: game/layout.ts turns it into distance on the ground and
// back (yAt, behindRoad), and the simulation never sees anything else. The picture can be
// drawn through a camera standing further back (a longer lens: a wide one stretches depth):
// every depth is turned into its distance on the ground, the camera moved back, and
// projected again. The building line keeps its place and true width, and the horizon
// stays put; in front of it the land is drawn shallower, behind it less steep.

/** The drawing camera's distance from the building line (map px): the panel's "camera". EYE_DIST is the game's own. */
let cameraDist = EYE_DIST;

export function setCameraDistance(d: number): void {
  cameraDist = Math.max(EYE_DIST * 0.5, d);
}

export function cameraDistance(): number {
  return cameraDist;
}

/**
 * The drawing camera's height above the ground (world units): the panel's "camera height". The
 * game's own camera stands SPAN up (the horizon at HORIZON_Y). Higher looks down more steeply:
 * the horizon (and the backdrop with it) moves up the screen, the street you ride along is less
 * foreshortened. The building line keeps its place and true width.
 */
let eyeHeight = SPAN;
export const GAME_EYE_HEIGHT = SPAN;

export function setCameraHeight(h: number): void {
  eyeHeight = Math.min(SPAN * 4, Math.max(SPAN * 0.5, h));
}

export function cameraHeight(): number {
  return eyeHeight;
}

/** Screen y (world units) of the drawn horizon. */
export function viewHorizon(): number {
  return GROUND_REF_Y - eyeHeight;
}

/** How far the drawn horizon is above the game's (HORIZON_Y): the backdrop and the sky move by it. */
export function horizonShift(): number {
  return viewHorizon() - HORIZON_Y;
}

/** Distance on the ground from the game's camera of depth y (world y): what the game means by y. */
const gameDist = (y: number) => (EYE_DIST * SPAN) / (y - HORIZON_Y);

/** How much wider than true the ground is drawn at depth y (through the drawing camera). */
export function depthScale(y: number): number {
  return cameraDist / (gameDist(y) + cameraDist - EYE_DIST);
}

/** Screen y (in world units) at which ground at depth y is drawn. */
export function viewY(y: number): number {
  return viewHorizon() + eyeHeight * depthScale(y);
}

/** The depth (world y) drawn at screen y: viewY undone. */
export function unviewY(screenY: number): number {
  const scale = (screenY - viewHorizon()) / eyeHeight;
  const dist = cameraDist / scale - (cameraDist - EYE_DIST);
  return HORIZON_Y + (EYE_DIST * SPAN) / dist;
}

/**
 * How much bigger (> 1) or smaller things at depth y are drawn than the game's own camera
 * would: art made for that camera (people, the rider, piles, crops) is scaled by it.
 */
export function viewRatio(y: number): number {
  return depthScale(y) / ((y - HORIZON_Y) / SPAN);
}

/**
 * Screen x of a ground point. `x` and `vpX` are in the same (camera-relative)
 * units: `x` where the point would be drawn without perspective, `vpX` the
 * vanishing point, normally the middle of the view.
 */
export function groundX(x: number, y: number, vpX: number): number {
  return vpX + (x - vpX) * depthScale(y);
}

/**
 * Lay out a repeating ground pattern at depth y: calls `fn` for every tile of
 * width `tile` (world units) that can be on screen, with its tile index, its
 * screen x (left edge) and the depth scale (to size things by). Tiles are
 * anchored in the world, so the pattern scrolls at the speed its depth implies.
 */
export function groundTiles(
  camX: number,
  viewW: number,
  y: number,
  tile: number,
  fn: (i: number, sx: number, scale: number) => void,
): void {
  const vpX = viewW / 2;
  const s = depthScale(y);
  // world x at the screen edges, at this depth
  const left = camX + vpX - vpX / s;
  const right = camX + vpX + (viewW - vpX) / s;
  for (let i = Math.floor(left / tile) - 2; i <= Math.ceil(right / tile) + 1; i++) {
    fn(i, groundX(i * tile - camX, y, vpX), s);
  }
}
