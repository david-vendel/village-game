// The drawing lens (src/render/lens.ts): leaves the street's own band exactly
// as the game places it, shortens depth behind it smoothly, and can be undone.

import { describe, expect, it } from 'vitest';
import { STREET_BAND_HALF, yAt } from '../src/game/layout';
import { behindRoadLens, lensStrength, LINE_DIST, lensZ, unlensZ, yAtLens } from '../src/render/lens';

const Z0 = LINE_DIST + STREET_BAND_HALF;

describe('lens', () => {
  it("draws the street's band exactly where the game puts it", () => {
    for (let d = -100; d <= STREET_BAND_HALF; d += 5) expect(yAtLens(d)).toBeCloseTo(yAt(d), 9);
  });

  it('shortens depth behind the band, smoothly and towards the lens strength', () => {
    const slope = (z: number) => (lensZ(z + 0.01) - lensZ(z - 0.01)) / 0.02;
    expect(slope(Z0 + 0.02)).toBeCloseTo(1, 2); // no kink at the band's edge
    expect(slope(Z0 + 5000)).toBeCloseTo(lensStrength(), 2);
    let prev = -Infinity;
    for (let z = 0; z < 20000; z += 37) {
      expect(lensZ(z)).toBeGreaterThan(prev);
      prev = lensZ(z);
    }
    // a parallel street 27 cells behind is drawn nearer than the camera sees it
    expect(lensZ(LINE_DIST + 675)).toBeLessThan(LINE_DIST + 675);
  });

  it('can be undone (the land grid names the cell under the mouse)', () => {
    for (const z of [100, Z0, Z0 + 1, 900, 2500, 9000]) expect(unlensZ(lensZ(z))).toBeCloseTo(z, 4);
    for (const d of [0, 60, 300, 1500]) expect(behindRoadLens(yAtLens(d))).toBeCloseTo(d, 3);
  });
});
