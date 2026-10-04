// The woods and the quarries behind the street, and the huts that work them.
//
// Trees stand anywhere on the land with room (treeRoom): in clumps behind the
// streets and out in front, never on a road, a building, a field or a quarry,
// nor crowding each other. Each has its place on the map, kept as a world x
// along a street and a depth y across it. A sapling grows for TREE_GROW
// seconds into a grown tree; a woodcutter walks out to a grown tree and fells
// it, leaving a stump that rots away after STUMP_TIME. New saplings sprout on
// their own now and then, mostly near grown trees. Land taken by a building, a
// field or a road is cleared of trees (clearLand), but for grown trees on the
// land of a site being built: its builders fell those first (site.ts), and the
// logs go into the building or onto the ground for serfs. With no grown tree
// in reach, a woodcutter walks out and plants a sapling somewhere free round
// about (while fewer than SAPLINGS_TENDED are growing in his reach).
//
// The quarries (QUARRIES) are rocky hills that come down to the tree line:
// a stonecutter walks to the face and cuts blocks out of it, as many as
// wanted.
//
// Both huts are workplaces (worker.ts) for their one worker, the same way:
// walk out to a tree (or the quarry face), work it, carry the log (or block)
// back and put it down in its place in the hut's store, from where serfs
// carry it to a warehouse (transport.ts, BuildingDef.ships). With the store
// full they wait by the door. The rest of the day is the generic routine.

import { storageOf } from './buildings';
import { putAway, storeSpot } from './economy';
import { behindRoad, CELL_W, CHOP_SPOT, QUARRIES, QUARRY_SPOTS, QUARRY_Y, STAND_Y, STONECUTTER_DOOR, PILE_UNIT, WOODCUTTER_DOOR, yAt } from './layout';
import { room, type Load } from './resources';
import { cellKey, landUse, type LandUse } from './grid';
import { groundPoint, streetDist, streetOf, streetPoint, streetRange, type Vec } from './streets';
import type { JobTicket, Workplace } from './worker';
import type { Building, World } from './world';

export interface Tree {
  id: number;
  /** Where the trunk stands: world x along a street, and depth y across it (layout.ts behindRoad). */
  x: number;
  y: number;
  state: 'growing' | 'grown' | 'stump';
  /** Seconds since it sprouted (growing), or since it was felled (stump). */
  age: number;
}

/** Seconds from sapling to a tree worth felling. */
export const TREE_GROW = 240;
/** Seconds a stump takes to rot away, leaving room for a new tree. */
export const STUMP_TIME = 180;
/** On average, seconds between new saplings sprouting. */
export const SPROUT_EVERY = 12;
/** Closest two trunks stand (px). */
export const TREE_GAP = 44;
/** Most trees the woods hold. */
export const MAX_TREES = 110;
/** How far from the hut a woodcutter goes for a tree (px). */
export const WOOD_REACH = 900;
/** Seconds to fell a tree, and to cut a block of stone. */
export const CHOP_TIME = 10;
export const CUT_TIME = 12;
/** Seconds to plant a sapling. */
export const PLANT_TIME = 6;
/** A woodcutter with nothing to fell plants saplings while fewer than this are growing in his reach. */
export const SAPLINGS_TENDED = 8;

/** Grown fraction 0..1 (a stump counts as grown: it is what is left of one). */
export function treeGrowth(t: Tree): number {
  return t.state === 'growing' ? Math.min(1, t.age / TREE_GROW) : 1;
}

/** How much room (map px) a trunk keeps from a road, a building, a field or the rocks. */
const TRUNK_ROOM = 10;

/** Where tree t stands on the map. */
export const treePoint = (world: World, t: Tree): Vec => groundPoint(world, t.x, t.y);

/** What takes the land within r of map point p (grid.ts), where `which` matches it. */
function usesNear(world: World, p: Vec, r: number, which: (u: LandUse) => boolean = () => true): LandUse[] {
  const land = landUse(world);
  const out: LandUse[] = [];
  for (let c = Math.floor((p.x - r) / CELL_W); c <= Math.floor((p.x + r) / CELL_W); c++) {
    for (let row = Math.floor((p.y - r) / CELL_W); row <= Math.floor((p.y + r) / CELL_W); row++) {
      const u = land.get(cellKey(c, row));
      if (u && which(u)) out.push(u);
    }
  }
  return out;
}

/** What a tree at map point p would be in the way of: land taken within TRUNK_ROOM, and a road's verges. */
const inWayOf = (world: World, p: Vec) => [...usesNear(world, p, TRUNK_ROOM), ...usesNear(world, p, CELL_W, (u) => u.kind === 'road')];

/**
 * Whether a tree can stand at map point p: not on land anything takes (grid.ts:
 * a road or its verges, a building or a crossroads being built, a farm's
 * field, a quarry's land), and (unless `crowd` is false) not crowding another tree.
 */
export function treeRoom(world: World, p: Vec, crowd = true, not?: Tree): boolean {
  if (inWayOf(world, p).length) return false;
  if (crowd) {
    for (const t of world.trees) {
      if (t === not) continue;
      const q = treePoint(world, t);
      if (Math.hypot(q.x - p.x, q.y - p.y) < TREE_GAP) return false;
    }
  }
  return true;
}

/** A site being built (a building or a road piece) on this land, whose builders clear it of trees. */
const clearedBy = (world: World, u: LandUse): Building | undefined =>
  u.kind === 'building' ? world.buildings.find((b) => b.id === u.buildingId && b.status === 'constructing' && b.site) : undefined;

/**
 * Trees are cut down wherever the land is taken (a building, a field, a road):
 * nothing grows on top of anything. A grown tree in the way of nothing but
 * sites being built stands until their builders fell it (treesInTheWay).
 */
export function clearLand(world: World): void {
  world.trees = world.trees.filter((t) => {
    const uses = inWayOf(world, treePoint(world, t));
    return !uses.length || (t.state === 'grown' && uses.every((u) => clearedBy(world, u)));
  });
}

/** The grown trees standing on site b's land: its builders fell them before building there. */
export function treesInTheWay(world: World, b: Building): Tree[] {
  if (!b.site || b.status !== 'constructing') return [];
  const mine = (u: LandUse) => u.kind === 'building' && u.buildingId === b.id;
  return world.trees.filter((t) => t.state === 'grown' && usesNear(world, treePoint(world, t), TRUNK_ROOM, mine).length);
}

/** Where someone stands to fell tree t, as dx from world x and a depth y: beside the trunk, a step nearer the viewer. */
export const chopSpot = (t: Tree, x: number) => ({ dx: t.x + CHOP_SPOT.dx - x, y: yAt(behindRoad(t.y) - 5) });

/**
 * Fell grown tree `id`, leaving a stump, or (`uproot`: clearing land to build
 * on) nothing. Its log, or null if it no longer stands.
 */
export function fell(world: World, id: number, uproot = false): Load | null {
  const t = world.trees.find((o) => o.id === id && o.state === 'grown');
  if (!t) return null;
  if (uproot) world.trees = world.trees.filter((o) => o !== t);
  else {
    t.state = 'stump';
    t.age = 0;
  }
  return { resource: 'wood', amount: PILE_UNIT };
}

/**
 * How far behind (or, negative, in front of) a street woods grow: in front
 * only as far as where the street is looked at from (a depth y stands for no
 * more; layout.ts behindRoad), beyond its fields.
 */
const WOODS = { behind: [140, 900], front: [-320, -200] } as const;

/** A new tree d map px behind street x's road at world x, if there is room for it there. */
function sprout(world: World, x: number, d: number, grown: boolean, rand: () => number): boolean {
  const s = streetOf(x);
  const { min, max } = streetRange(world, s);
  if (x < min || x > max || !world.streets[s] || world.streets[s].gone) return false;
  if (d < WOODS.front[0]) return false;
  const p = streetPoint(world, x, d);
  if (!treeRoom(world, p)) return false;
  const young = !grown || rand() < 0.2;
  world.trees.push({ id: world.nextId++, x, y: yAt(d), state: young ? 'growing' : 'grown', age: young && grown ? rand() * TREE_GROW : 0 });
  return true;
}

/** Plant a sapling at world x, d map px behind its street's road, if there is room there still. */
export function plantSapling(world: World, x: number, d: number): boolean {
  return sprout(world, x, d, false, () => 0);
}

/**
 * Woods along street i: clumps of trees here and there, most behind it, some
 * out in front (beyond the land the view looks across), most of them grown.
 */
export function plantWoods(world: World, street: number, rand: () => number): void {
  const { min, max } = streetRange(world, street);
  const clumps = Math.round((max - min) / 450);
  for (let c = 0; c < clumps; c++) {
    const cx = min + rand() * (max - min);
    const band = rand() < 0.75 ? WOODS.behind : WOODS.front;
    const cd = band[0] + rand() * (band[1] - band[0]);
    const n = 3 + Math.floor(rand() * 7);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = rand() * 120;
      sprout(world, cx + Math.cos(a) * r, cd + Math.sin(a) * r, true, rand);
    }
  }
}

/**
 * Trees grow, stumps rot, and now and then a sapling sprouts: mostly near a
 * grown tree (woods spread), sometimes anywhere along a street with room.
 */
export function updateForest(world: World, dt: number, rand: () => number): void {
  for (const t of world.trees) {
    t.age += dt;
    if (t.state === 'growing' && t.age >= TREE_GROW) t.state = 'grown';
  }
  world.trees = world.trees.filter((t) => t.state !== 'stump' || t.age < STUMP_TIME);
  const live = world.streets.filter((s) => !s.gone);
  if (world.trees.length >= MAX_TREES * live.length || rand() >= dt / SPROUT_EVERY) return;
  const grown = world.trees.filter((t) => t.state === 'grown');
  if (grown.length && rand() < 0.75) {
    // a seed falls near a grown tree
    const parent = grown[Math.floor(rand() * grown.length)];
    const a = rand() * Math.PI * 2;
    const r = TREE_GAP + rand() * 70;
    sprout(world, parent.x + Math.cos(a) * r, behindRoad(parent.y) + Math.sin(a) * r, false, rand);
  } else {
    const s = live[Math.floor(rand() * live.length)].index;
    const { min, max } = streetRange(world, s);
    const band = rand() < 0.75 ? WOODS.behind : WOODS.front;
    sprout(world, min + rand() * (max - min), band[0] + rand() * (band[1] - band[0]), false, rand);
  }
}

/** The quarry nearest world x (along the streets). */
function nearestQuarry(world: World, x: number): number {
  let best = 0;
  QUARRIES.forEach((q, i) => {
    if (streetDist(world, x, q.x) < streetDist(world, x, QUARRIES[best].x)) best = i;
  });
  return best;
}

/** What a hut gathers, and how: its store, the job's name and how long it takes. */
const GATHER = {
  woodcutter: { resource: 'wood', action: 'chop', seconds: CHOP_TIME, door: WOODCUTTER_DOOR },
  stonecutter: { resource: 'stone', action: 'cut', seconds: CUT_TIME, door: STONECUTTER_DOOR },
} as const;

export type GatherHut = keyof typeof GATHER;

export function isGatherHut(type: Building['type']): type is GatherHut {
  return type in GATHER;
}

/** The woodcutter's or stonecutter's hut as a workplace for its worker (`rand` picks where saplings go). */
export function gatherWorkplace(world: World, b: Building & { type: GatherHut }, rand: () => number): Workplace {
  const x = b.x;
  const { resource, action, seconds, door } = GATHER[b.type];
  const capacity = storageOf(b);
  const tree = (id: number) => world.trees.find((t) => t.id === id && t.state === 'grown');
  /** The walk from world x `from` (on the road) out to world x `tx`, d behind its road: along the streets, then across. */
  const walk = (from: number, tx: number, d: number) => streetDist(world, from, tx) + Math.abs(d - behindRoad(STAND_Y));
  const spot = (job: JobTicket) => {
    // planting: the target is the world x, the slot the depth behind the road
    if (job.action === 'plant') return { dx: job.target + CHOP_SPOT.dx - x, y: yAt((job.slot ?? 0) - 5) };
    if (action === 'chop') {
      const t = tree(job.target);
      return t ? chopSpot(t, x) : null;
    }
    const q = QUARRIES[job.target];
    return q ? { dx: q.x + (QUARRY_SPOTS[job.slot ?? 0] ?? 0) - x, y: QUARRY_Y + 3 } : null;
  };
  /** A place picked at random in reach to plant a sapling: free land, clear of trees and of saplings about to go in. */
  const plantJob = (taken: JobTicket[]): JobTicket | null => {
    const planting = taken.filter((j) => j.action === 'plant');
    const growing = world.trees.filter((t) => t.state === 'growing' && walk(x, t.x, behindRoad(t.y)) <= WOOD_REACH).length;
    if (growing + planting.length >= SAPLINGS_TENDED) return null;
    for (let tries = 0; tries < 24; tries++) {
      const tx = Math.round(x + (rand() * 2 - 1) * WOOD_REACH);
      const band = rand() < 0.75 ? WOODS.behind : WOODS.front;
      const d = Math.round(band[0] + rand() * (band[1] - band[0]));
      const street = world.streets[streetOf(tx)];
      const { min, max } = streetRange(world, streetOf(tx));
      if (!street || street.gone || tx < min || tx > max || walk(x, tx, d) > WOOD_REACH) continue;
      const p = streetPoint(world, tx, d);
      if (!treeRoom(world, p)) continue;
      const near = (j: JobTicket) => {
        const q = streetPoint(world, j.target, j.slot ?? 0);
        return Math.hypot(q.x - p.x, q.y - p.y) < TREE_GAP;
      };
      if (!planting.some(near)) return { action: 'plant', target: tx, slot: d };
    }
    return null;
  };
  return {
    door,
    nextJob(w, taken) {
      // loads on their way count against the room in the store
      if (room(b.stock, capacity, resource) <= taken.length * PILE_UNIT + 1e-9) return null;
      const here = x + w.dx;
      let job: JobTicket | null = null;
      if (action === 'chop') {
        const busy = new Set(taken.map((j) => j.target));
        let best: Tree | null = null;
        const to = (from: number, t: Tree) => walk(from, t.x, behindRoad(t.y));
        for (const t of world.trees) {
          if (t.state !== 'grown' || busy.has(t.id) || to(x, t) > WOOD_REACH) continue;
          if (!best || to(here, t) < to(here, best)) best = t;
        }
        // nothing to fell: plant a sapling somewhere round about
        job = best ? { action, target: best.id } : plantJob(taken);
      } else {
        const q = nearestQuarry(world, x);
        const used = new Set(taken.filter((j) => j.target === q).map((j) => j.slot));
        const free = QUARRY_SPOTS.findIndex((_, k) => !used.has(k));
        if (free >= 0) job = { action, target: q, slot: free };
      }
      const at = job && spot(job);
      return job && at ? { job, ...at } : null;
    },
    jobSpot: spot,
    begin(job) {
      if (job.action === 'plant') return PLANT_TIME;
      return spot(job) ? seconds : null;
    },
    finish(job): Load | null {
      if (job.action === 'plant') {
        plantSapling(world, job.target, job.slot ?? 0);
        return null;
      }
      if (action === 'chop') return fell(world, job.target);
      return { resource, amount: PILE_UNIT };
    },
    dropSpot(_job, load) {
      return storeSpot(world, b, load.resource, x, false, load.amount);
    },
    deliver(load) {
      const n = Math.min(load.amount, room(b.stock, capacity, load.resource));
      b.stock[load.resource] += n;
      // no room left after all: the rest goes to a warehouse
      if (n < load.amount) putAway(world, { resource: load.resource, amount: load.amount - n }, x);
    },
  };
}
