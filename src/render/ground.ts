// Ground perspective: one-point perspective for everything lying flat on the
// land (fields, the land grid, the farmer walking them). Lines running into the
// scene converge on a vanishing point in the middle of the view, so as the
// camera moves the ground at the screen edges fans out and swings with it.
//
// Depth is the world y of a point on the ground. At GROUND_REF_Y (the line
// buildings stand on) the ground is drawn at true width, so buildings, plot
// markers and the store need no correction; nearer the viewer it widens,
// further away it narrows, converging at HORIZON_Y.
//
// Everything drawn on the land must go through groundX so it lines up exactly.

import { BASE_Y } from '../game/layout';

/** World y where lines on the ground would meet. Lower (more negative) = flatter perspective. */
export const HORIZON_Y = -250;
/** Depth drawn at true width. */
export const GROUND_REF_Y = BASE_Y;

/** How much wider than true the ground is drawn at depth y. */
export function depthScale(y: number): number {
  return (y - HORIZON_Y) / (GROUND_REF_Y - HORIZON_Y);
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
