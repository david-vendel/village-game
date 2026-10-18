import { describe, expect, it } from 'vitest';
import { BUILDING_TYPES } from '../src/game/buildings';
import { BUILD_CATEGORIES, buildBarLayout } from '../src/render/ui';

describe('build bar', () => {
  it('puts every building type in exactly one category', () => {
    for (const t of BUILDING_TYPES) expect(BUILD_CATEGORIES.filter((c) => c.types.includes(t)).map((c) => c.name)).toHaveLength(1);
  });

  it("shows a category's buildings above the categories, all on screen", () => {
    for (const [w, h] of [[1280, 720], [640, 360]]) {
      const closed = buildBarLayout(w, h, null);
      expect(closed.cards).toHaveLength(0);
      BUILD_CATEGORIES.forEach((c, i) => {
        const L = buildBarLayout(w, h, i);
        expect(L.types).toEqual(c.types);
        for (const r of [...L.categories, L.cancel, ...L.cards, L.info!, L.build!]) {
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.x + r.w).toBeLessThanOrEqual(w);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.y + r.h).toBeLessThanOrEqual(h);
        }
        for (const r of L.cards) expect(r.y + r.h).toBeLessThanOrEqual(L.categories[0].y);
      });
    }
  });
});
