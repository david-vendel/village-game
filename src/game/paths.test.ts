import { describe, expect, it } from 'vitest';
import { cellKey, cellOf, footprintOf, landUse } from './grid';
import { CELL_W } from './layout';
import { findPath, pathTime, TERRAIN_SPEED, terrainSpeed } from './paths';
import { mapPoint, type Vec } from './streets';
import { createWorld, placeBuilding, type World } from './world';

function emptyWorld(): World {
  return createWorld({ village: false });
}

/** Every point along the way, a few px apart: what someone walking it passes over. */
function along(a: Vec, path: Vec[]): Vec[] {
  const out: Vec[] = [];
  let p = a;
  for (const q of path) {
    const n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 2);
    for (let i = 1; i <= n; i++) out.push({ x: p.x + ((q.x - p.x) * i) / n, y: p.y + ((q.y - p.y) * i) / n });
    p = q;
  }
  return out;
}

describe('paths', () => {
  it('walks straight across open land', () => {
    const w = emptyWorld();
    const a = { x: 1000, y: 300 };
    const b = { x: 1300, y: 420 };
    expect(findPath(w, a, b)).toEqual([b]);
  });

  it('goes round a building standing in the way, never through it', () => {
    const w = emptyWorld();
    const chapel = placeBuilding(w, 1500, 'chapel', { instant: true, free: true })!;
    const f = footprintOf(chapel)!;
    // from the land behind one end of the chapel to behind the other, at its middle depth
    const depth = ((f.j0 + f.j1 + 1) / 2) * CELL_W;
    const a = mapPoint(w, chapel.x - 150);
    const b = mapPoint(w, chapel.x + 150);
    a.y += depth;
    b.y += depth;
    const path = findPath(w, a, b);
    expect(path.length).toBeGreaterThan(1);
    const land = landUse(w);
    for (const p of along(a, path)) {
      const { c, r } = cellOf(p);
      expect(land.get(cellKey(c, r))?.kind, `${p.x},${p.y}`).not.toBe('building');
    }
  });

  it('walks into the building it is going to', () => {
    const w = emptyWorld();
    const yard = placeBuilding(w, 1500, 'warehouse', { instant: true, free: true })!;
    const inside = mapPoint(w, yard.x);
    inside.y += 3 * CELL_W;
    const path = findPath(w, mapPoint(w, yard.x - 300), inside);
    expect(path[path.length - 1]).toEqual(inside);
  });

  it('is quicker on the road, slower in fields', () => {
    const w = emptyWorld();
    expect(terrainSpeed(w, mapPoint(w, 1000))).toBe(TERRAIN_SPEED.road);
    expect(terrainSpeed(w, { x: 1000, y: 300 })).toBe(TERRAIN_SPEED.grass);
    // a long way between two points just off the road: along the road beats the grass beside it
    const a = { x: 1000, y: 3 * CELL_W };
    const b = { x: 2000, y: 3 * CELL_W };
    const path = findPath(w, a, b);
    expect(pathTime(w, a, path)).toBeLessThan(1000 / TERRAIN_SPEED.grass);
    expect(path.some((p) => p.y < 2 * CELL_W)).toBe(true);
    // a farm's fields are slow going
    placeBuilding(w, 3000, 'farm', { instant: true, free: true });
    const field = [...landUse(w)].find(([, u]) => u.kind === 'field')![0].split(',').map(Number);
    expect(terrainSpeed(w, { x: (field[0] + 0.5) * CELL_W, y: (field[1] + 0.5) * CELL_W })).toBe(TERRAIN_SPEED.field);
  });
});
