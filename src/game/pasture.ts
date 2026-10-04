// Pasture: the free green land behind a horse farm, where its horses graze.
// It spreads from the row of cells right behind the farm across every free
// cell it can reach (grid.ts): roads, buildings, the quarries, the farms'
// fields and land kept for a crossroads bound it, and so do the lines of the
// road grid, built on yet or not (onRoadLine): it never runs past the square
// of the grid the farm is in. Building there takes from it. Two
// horse farms share land by distance: a cell is the nearer one's.

import { cellKey, footprintOf, keptLand, landUse, onRoadLine, streetCell, type Land } from './grid';
import { streetOf, streetAt } from './streets';
import type { Building, World } from './world';

/** Pasture cells a horse keeps (livestock.ts herdRoom). */
export const PASTURE_CELLS_PER_HORSE = 8;
/** Most cells a farm's pasture spreads over (a whole square of the road grid holds fewer). */
export const PASTURE_MAX = 800;

const known = new WeakMap<Land, Map<number, string[]>>();

/** The cells of b's pasture (keys, grid.ts cellKey), or none if it is not a finished horse farm. */
export function pastureCells(world: World, b: Building): string[] {
  const land = landUse(world);
  let all = known.get(land);
  if (!all) {
    all = pastures(world, land);
    known.set(land, all);
  }
  return all.get(b.id) ?? [];
}

function pastures(world: World, land: Land): Map<number, string[]> {
  const kept = keptLand(world);
  const free = (key: string) => {
    const [c, r] = key.split(',').map(Number);
    return !land.has(key) && !kept.has(key) && !onRoadLine(c, r);
  };
  /** cell → the farm whose pasture it is, and how far it is from that farm's back */
  const claims = new Map<string, { id: number; d: number }>();
  const farms = world.buildings.filter((b) => b.type === 'horsefarm' && b.status === 'done');
  for (const b of farms) {
    const f = footprintOf(b);
    const s = streetAt(world, streetOf(b.x));
    if (!f || !s) continue;
    // out from the row of cells behind the farm, nearest first
    const queue: Array<{ c: number; r: number; d: number }> = [];
    const seen = new Set<string>();
    for (let i = f.i0; i <= f.i1; i++) {
      const c = streetCell(s, i, f.j1 + 1);
      const key = cellKey(c.c, c.r);
      if (free(key) && !seen.has(key)) {
        seen.add(key);
        queue.push({ ...c, d: 0 });
      }
    }
    for (let k = 0; k < queue.length && seen.size <= PASTURE_MAX; k++) {
      const { c, r, d } = queue[k];
      const key = cellKey(c, r);
      const had = claims.get(key);
      if (!had || d < had.d || (d === had.d && b.id < had.id)) claims.set(key, { id: b.id, d });
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = cellKey(c + dc, r + dr);
        if (seen.has(n) || !free(n) || seen.size >= PASTURE_MAX) continue;
        seen.add(n);
        queue.push({ c: c + dc, r: r + dr, d: d + 1 });
      }
    }
  }
  const out = new Map<number, string[]>();
  for (const [key, { id }] of claims) out.set(id, [...(out.get(id) ?? []), key]);
  return out;
}
