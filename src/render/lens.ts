// The lens the village is drawn with: drawing only, the game's distances stay
// as they are (game/layout.ts: yAt, behindRoad).
//
// The game's camera stands close (EYE_DIST in front of the building line) with
// a very wide view, and a wide lens stretches depth: a square of streets seen
// from the side looks deep. Moving the camera back would cure that but moves
// the game's own ground (the road band, the fields, where builders walk), so
// instead the picture shortens depth beyond the street being looked at, as a
// longer lens would. The street's own band (its road, lots and fields) is
// drawn exactly as before; behind it, distances are drawn shorter and
// shorter, towards `lens` of their length, blending in smoothly from the
// band's edge (no kink in a road running away).
//
// Distances here are from the camera (map px), as plane.ts's z.

import { EYE_DIST, HORIZON_Y, STREET_BAND_HALF, yAt } from '../game/layout';
import { GROUND_REF_Y } from './ground';

const SPAN = GROUND_REF_Y - HORIZON_Y;
/** Distance from the camera of the street line (the middle of the road): game/layout.ts LINE_DIST. */
export const LINE_DIST = (EYE_DIST * SPAN) / (yAt(0) - HORIZON_Y);
/** Where the lens starts shortening depth: the far edge of the street's band. */
const Z0 = LINE_DIST + STREET_BAND_HALF;
/** How long far depth is drawn, in the end (1 = as the camera sees it): the panel's "far depth". */
let lens = 0.35;
/** How quickly the shortening sets in behind the band (map px): the panel's "depth ease". */
let ease = 250;
export const DEFAULT_EASE = 250;

/** Set how far behind the street's band (map px) the shortening takes hold. */
export function setLensEase(v: number): void {
  ease = Math.max(10, v);
}

export const DEFAULT_LENS = 0.35;

/** Set how long far depth is drawn (0.2 … 1; 1 is the camera's own perspective). */
export function setLens(v: number): void {
  lens = Math.min(1, Math.max(0.05, v));
}

export function lensStrength(): number {
  return lens;
}

/** A distance from the camera as the picture draws it. */
export function lensZ(z: number): number {
  if (z <= Z0) return z;
  const t = z - Z0;
  // slope 1 at Z0 (no kink), tending to `lens` far off
  return Z0 + lens * t + (1 - lens) * ease * (1 - Math.exp(-t / ease));
}

/** The real distance a drawn one stands for (lensZ inverted). */
export function unlensZ(zz: number): number {
  if (zz <= Z0) return zz;
  let lo = zz;
  let hi = Z0 + (zz - Z0) / lens + ease;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (lensZ(mid) < zz) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Screen y of ground d map px behind the street line (game/layout.ts yAt, through the lens). */
export const yAtLens = (d: number) => yAt(lensZ(d + LINE_DIST) - LINE_DIST);

/** Map px behind the street line of ground drawn at screen y (yAtLens inverted). */
export const behindRoadLens = (y: number) => unlensZ((EYE_DIST * SPAN) / (y - HORIZON_Y)) - LINE_DIST;
