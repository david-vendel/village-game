// The 3D buildings' meshes (src/render/build3d/geometry.ts): every piece makes
// triangles, closed pieces face outwards (one-sided rendering shows nothing
// else), roof covering faces up, and a whole building merges into a dozen or
// so buffers of a size a frame can draw.

import { describe, expect, it } from 'vitest';
import { bounds, type Element } from '../src/render/build3d/elements';
import { elementSoup, mergeByMaterial, type Soup } from '../src/render/build3d/geometry';
import { modelOf, modelTypes } from '../src/render/build3d/index';

/** Share of a soup's triangles whose normal points away from a centre (three.js axes). */
function outward(s: Soup, c: [number, number, number]): number {
  let ok = 0;
  let all = 0;
  for (let i = 0; i < s.n; i += 3) {
    const p = (k: number) => [s.pos[(i + k) * 3], s.pos[(i + k) * 3 + 1], s.pos[(i + k) * 3 + 2]];
    const [a, b, d] = [p(0), p(1), p(2)];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const mid = [(a[0] + b[0] + d[0]) / 3 - c[0], (a[1] + b[1] + d[1]) / 3 - c[1], (a[2] + b[2] + d[2]) / 3 - c[2]];
    const area = Math.hypot(n[0], n[1], n[2]);
    if (area < 1e-9) continue; // a sliver where two corners meet
    all += area;
    if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] > 0) ok += area;
  }
  return ok / all;
}

/** An element's middle in three.js axes (x, z, −y). */
function middle(e: Element): [number, number, number] {
  const [lo, hi] = bounds(e);
  return [(lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2, -(lo[1] + hi[1]) / 2];
}

describe('3D geometry', () => {
  for (const type of modelTypes()) {
    const els = modelOf(type, 7).elements;

    it(`${type}: every piece makes finite triangles, closed ones facing out`, () => {
      for (const e of els) {
        const s = elementSoup(e);
        expect(s.n, e.id).toBeGreaterThan(0);
        expect(s.n % 3).toBe(0);
        for (let i = 0; i < s.n * 3; i++) expect(Number.isFinite(s.pos[i]) && Number.isFinite(s.nor[i]), e.id).toBe(true);
        if (['box', 'beam', 'stone', 'slab'].includes(e.shape) && Math.min(...e.size.filter((v) => v > 0)) > 0.01) expect(outward(s, middle(e)), `${type} ${e.id}`).toBeGreaterThan(0.95);
        if (e.shape === 'course') {
          // the outer surface faces up: most of the area faces up
          let up = 0;
          let all = 0;
          for (let i = 0; i < s.n; i += 3) {
            const p = (k: number) => [s.pos[(i + k) * 3], s.pos[(i + k) * 3 + 1], s.pos[(i + k) * 3 + 2]];
            const [a, b, d] = [p(0), p(1), p(2)];
            const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
            const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
            all += area;
            if (s.nor[i * 3 + 1] > 0.2) up += area;
          }
          expect(up / all, `${type} ${e.id}`).toBeGreaterThan(0.3);
        }
      }
    });

    it(`${type}: merges into a few buffers a frame can draw`, () => {
      const merged = mergeByMaterial(els);
      expect(merged.size).toBeLessThan(40);
      let verts = 0;
      for (const m of merged.values()) {
        verts += m.pos.length / 3;
        expect(m.ends[m.ends.length - 1]).toBe(m.pos.length / 3);
        expect(m.col.length).toBe(m.pos.length);
      }
      expect(verts / 3, `${type} triangles`).toBeLessThan(150_000);
    });
  }
});
