// The farm's meshes (src/render/build3d/geometry.ts): closed, facing outwards
// (one-sided rendering shows nothing else), merged by material, the right size.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bounds } from '../src/render/build3d/elements';
import { farm } from '../src/render/build3d/farm';
import { elementGeometry, mergedByMaterial } from '../src/render/build3d/geometry';

const els = farm();

/** Share of an element's triangles whose normal points away from the element's middle. */
function outward(g: THREE.BufferGeometry, centre: THREE.Vector3): number {
  const p = g.attributes.position as THREE.BufferAttribute;
  let ok = 0;
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    const mid = a.clone().add(b).add(c).divideScalar(3);
    if (n.dot(mid.sub(centre)) > 0) ok++;
  }
  return ok / (p.count / 3);
}

describe('farm geometry', () => {
  it('faces every piece outwards', () => {
    for (const e of els) {
      const g = elementGeometry(e);
      const [lo, hi] = bounds(e);
      // the middle of the bounds, in three.js axes (x, z, -y)
      const centre = new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2, -(lo[1] + hi[1]) / 2);
      if (e.shape === 'roof') {
        // a chevron, not convex: check the outer slopes face up, by the normals the renderer uses
        const n = g.attributes.normal as THREE.BufferAttribute;
        const p = g.attributes.position as THREE.BufferAttribute;
        let up = 0;
        let top = 0;
        for (let i = 0; i < p.count; i++) if (p.getY(i) > hi[2] - 0.5) (top++, n.getY(i) > 0 && up++);
        expect(up / top, e.id).toBeGreaterThan(0.9);
      } else {
        expect(outward(g, centre), e.id).toBeGreaterThan(0.95);
      }
    }
  });

  it('merges the finished farm into one mesh per material', () => {
    const merged = mergedByMaterial(els, { variant: 'default', parts: [] });
    expect([...merged.keys()].sort()).toEqual(['boards', 'clay-stone', 'daub', 'fieldstone', 'oak', 'planks', 'shingles', 'thatch', 'window'].sort());
    let tris = 0;
    for (const g of merged.values()) {
      expect(g.attributes.color).toBeDefined();
      tris += g.attributes.position.count / 3;
    }
    expect(tris).toBeLessThan(60_000);
    // 10 m wide along x (three.js axes keep x), give or take the eaves
    const box = new THREE.Box3();
    for (const g of merged.values()) {
      g.computeBoundingBox();
      box.union(g.boundingBox!);
    }
    expect(box.max.x - box.min.x).toBeGreaterThan(9.8);
    expect(box.max.x - box.min.x).toBeLessThan(11.5);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.05); // fieldstones settle a little into the ground
  });

  it('shows stages and the Large farm by what it merges', () => {
    const frame = mergedByMaterial(els, { variant: 'default', stage: 'frame', parts: [] });
    expect(frame.has('thatch')).toBe(false);
    expect(frame.has('oak')).toBe(true);
    const large = mergedByMaterial(els, { variant: 'upgraded', parts: ['doorOpen'] });
    expect(large.has('doorway')).toBe(true);
  });
});
