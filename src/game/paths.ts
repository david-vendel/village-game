// Finding the way on foot. The village is a plane (streets.ts), cut into the
// land grid's cells (grid.ts), and people walk across it the fastest way:
// through no building (save the one they set out from or are going to: a
// yard, a site), round it instead, and quicker on the road than on grass,
// slower through a farm's fields (TERRAIN_SPEED).
//
// The way is searched cell by cell (A*, eight ways from each cell, never
// cutting a building's corner), then drawn tight: a run of cells becomes one
// straight line wherever walking it straight is clear and no slower.

import { CELL_W } from './layout';
import { cellKey, cellOf, landUse, type Land } from './grid';
import type { Vec } from './streets';
import type { World } from './world';

/** How fast people walk on each kind of ground, as a share of their speed on grass. */
export const TERRAIN_SPEED = { road: 1.2, grass: 1, field: 0.8 } as const;

/** Walking speed (a share of the speed on grass) in a cell; 0: a building in the way. `open`: buildings that may be walked into. */
function speedIn(land: Land, c: number, r: number, open: ReadonlySet<number>): number {
  const u = land.get(cellKey(c, r));
  if (!u) return TERRAIN_SPEED.grass;
  switch (u.kind) {
    case 'road':
      return TERRAIN_SPEED.road;
    case 'field':
      return TERRAIN_SPEED.field;
    case 'building':
      return open.has(u.buildingId) ? TERRAIN_SPEED.grass : 0;
    default:
      return TERRAIN_SPEED.grass;
  }
}

/** How fast someone standing at map point p walks (a share of their speed on grass). */
export function terrainSpeed(world: World, p: Vec): number {
  const { c, r } = cellOf(p);
  const u = landUse(world).get(cellKey(c, r));
  return u?.kind === 'road' ? TERRAIN_SPEED.road : u?.kind === 'field' ? TERRAIN_SPEED.field : TERRAIN_SPEED.grass;
}

/** The building whose land map point p is on, if any. */
function buildingAt(land: Land, p: Vec): number | null {
  const { c, r } = cellOf(p);
  const u = land.get(cellKey(c, r));
  return u?.kind === 'building' ? u.buildingId : null;
}

/** Seconds per px (at speed 1 on grass) to walk the straight line a→b, or Infinity if a building stands in the way. */
function lineCost(land: Land, a: Vec, b: Vec, open: ReadonlySet<number>): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-9) return 0;
  const n = Math.max(1, Math.ceil(len / (CELL_W / 5)));
  let cost = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const { c, r } = cellOf({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const v = speedIn(land, c, r, open);
    if (v === 0) return Infinity;
    cost += len / n / v;
  }
  return cost;
}

/** A binary heap of cell indices by priority. */
class Heap {
  private items: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: number, key: number): void {
    const a = this.items;
    const k = this.keys;
    let i = a.length;
    a.push(item);
    k.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const k = this.keys;
    const top = a[0];
    const lastA = a.pop()!;
    const lastK = k.pop()!;
    if (a.length) {
      a[0] = lastA;
      k[0] = lastK;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}

const STEPS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Cell by cell from a to b within `margin` cells around them: the cells' centres, or null if there is no way. */
function searchCells(land: Land, a: Vec, b: Vec, open: ReadonlySet<number>, margin: number): Vec[] | null {
  const ca = cellOf(a);
  const cb = cellOf(b);
  const c0 = Math.min(ca.c, cb.c) - margin;
  const r0 = Math.min(ca.r, cb.r) - margin;
  const w = Math.abs(ca.c - cb.c) + 2 * margin + 1;
  const h = Math.abs(ca.r - cb.r) + 2 * margin + 1;
  const n = w * h;
  const speed = new Float32Array(n);
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) speed[j * w + i] = speedIn(land, c0 + i, r0 + j, open);
  const at = (c: number, r: number) => (r - r0) * w + (c - c0);
  const start = at(ca.c, ca.r);
  const goal = at(cb.c, cb.r);
  // the ends are always open: someone already standing there, or the spot they must reach
  speed[start] ||= TERRAIN_SPEED.grass;
  speed[goal] ||= TERRAIN_SPEED.grass;
  const cost = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  // the fastest anyone goes is on the road: the estimate never overshoots
  const guess = (i: number) => (Math.hypot((i % w) - (goal % w), Math.floor(i / w) - Math.floor(goal / w)) * CELL_W) / TERRAIN_SPEED.road;
  const heap = new Heap();
  cost[start] = 0;
  heap.push(start, guess(start));
  while (heap.size) {
    const i = heap.pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === goal) break;
    const ci = i % w;
    const ri = Math.floor(i / w);
    for (const [dc, dr, len] of STEPS) {
      const c = ci + dc;
      const r = ri + dr;
      if (c < 0 || r < 0 || c >= w || r >= h) continue;
      const j = r * w + c;
      if (!speed[j] || done[j]) continue;
      // a diagonal step may not cut a building's corner
      if (dc && dr && (!speed[ri * w + c] || !speed[r * w + ci])) continue;
      const step = (len * CELL_W * (1 / speed[i] + 1 / speed[j])) / 2;
      if (cost[i] + step < cost[j]) {
        cost[j] = cost[i] + step;
        from[j] = i;
        heap.push(j, cost[j] + guess(j));
      }
    }
  }
  if (!done[goal]) return null;
  const cells: Vec[] = [];
  for (let i = goal; i !== -1; i = from[i]) cells.push({ x: (c0 + (i % w) + 0.5) * CELL_W, y: (r0 + Math.floor(i / w) + 0.5) * CELL_W });
  return cells.reverse();
}

/**
 * The fastest way on foot from map point a to b: the points to walk to in
 * turn, ending at b. Straight there when nothing is in the way and that is
 * fastest; if there is no way at all, straight there regardless.
 */
export function findPath(world: World, a: Vec, b: Vec): Vec[] {
  const land = landUse(world);
  // the building they set out from and the one they are going to may be walked into
  const open = new Set([buildingAt(land, a), buildingAt(land, b)].filter((x): x is number => x !== null));
  let cells: Vec[] | null = null;
  for (const margin of [8, 40]) {
    cells = searchCells(land, a, b, open, margin);
    if (cells) break;
  }
  if (!cells) return [b];
  // from the exact start, through the cells' centres, to the exact end
  const pts = [a, ...cells.slice(1, -1), b];
  // the time along the cells to each point, to compare shortcuts with
  const along = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + lineCost(land, pts[i - 1], pts[i], open));
  // pull it tight: from each corner, straight on to the furthest point that is clear and no slower
  const out: Vec[] = [];
  for (let i = 0; i < pts.length - 1; ) {
    let j = i + 1;
    // look on while shortcuts keep working (a few misses in a row end the look)
    for (let k = i + 2, misses = 0; k < pts.length && misses < 4; k++) {
      if (lineCost(land, pts[i], pts[k], open) <= along[k] - along[i] + 1e-6) {
        j = k;
        misses = 0;
      } else misses++;
    }
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/** How long (s per px at speed 1 on grass) a way takes to walk from a: for tests and comparisons. */
export function pathTime(world: World, a: Vec, path: Vec[]): number {
  const land = landUse(world);
  const open = new Set([buildingAt(land, a), buildingAt(land, path[path.length - 1])].filter((x): x is number => x !== null));
  let t = 0;
  let p = a;
  for (const q of path) {
    t += lineCost(land, p, q, open);
    p = q;
  }
  return t;
}
