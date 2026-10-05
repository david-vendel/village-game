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
// in reach, or his store full, a woodcutter plants a sapling somewhere free
// near home (PLANT_NEAR; further out only if there is no room there), while
// fewer than SAPLINGS_TENDED are growing round about.
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
import { dropOnGround, GROUND_PILE_Y } from './piles';
import { room, type Load } from './resources';
import { cellKey, landUse, type LandUse } from './grid';
import { groundPoint, streetDist, streetOf, streetPoint, streetRange, type Vec, streetAt } from './streets';
import { currentJob, type JobTicket, type Workplace } from './worker';
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
export const SAPLINGS_TENDED = 20;
/**
 * Where a woodcutter plants, near home: up to `along` px either side of his
 * hut, `behind` px behind the road (or in the woods in front); `reach`
 * is how far round home his saplings count towards SAPLINGS_TENDED.
 */
export const PLANT_NEAR = { along: 300, behind: [140, 450], reach: 600 } as const;

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

/**
 * Land that gets cleared by hand: a site being built (a building or a road
 * piece), whose builders fell what stands on it, or a farm's field, whose
 * farmers do.
 */
const clearedByHand = (world: World, u: LandUse): boolean =>
  u.kind === 'field' || (u.kind === 'building' && world.buildings.some((b) => b.id === u.buildingId && b.status === 'constructing' && b.site));

/**
 * Trees are cut down wherever the land is taken (a building, a field, a road):
 * nothing grows on top of anything. A grown tree in the way of nothing but
 * sites being built and fields stands until it is felled there
 * (treesInTheWay, treesOnFields).
 */
export function clearLand(world: World): void {
  world.trees = world.trees.filter((t) => {
    const uses = inWayOf(world, treePoint(world, t));
    return !uses.length || (t.state === 'grown' && uses.every((u) => clearedByHand(world, u)));
  });
}

/**
 * The cells of the road a crossroads being built will open (world.ts sets
 * this: the street is planned there), as cell keys; null for any other building.
 */
let roadToOpen: (world: World, b: Building) => Set<string> | null = () => null;
export function setRoadToOpen(fn: typeof roadToOpen): void {
  roadToOpen = fn;
}

/**
 * The grown trees standing on site b's land: its builders fell them before
 * building there. A crossroads clears the road of the street it opens, too.
 */
export function treesInTheWay(world: World, b: Building): Tree[] {
  if (!b.site || b.status !== 'constructing') return [];
  const mine = (u: LandUse) => u.kind === 'building' && u.buildingId === b.id;
  const road = b.type === 'intersection' ? roadToOpen(world, b) : null;
  /** On the coming road, or its verges (treeRoom). */
  const onRoad = (p: Vec) => {
    if (!road) return false;
    for (let c = Math.floor((p.x - CELL_W) / CELL_W); c <= Math.floor((p.x + CELL_W) / CELL_W); c++) {
      for (let row = Math.floor((p.y - CELL_W) / CELL_W); row <= Math.floor((p.y + CELL_W) / CELL_W); row++) if (road.has(cellKey(c, row))) return true;
    }
    return false;
  };
  return world.trees.filter((t) => {
    if (t.state !== 'grown') return false;
    const p = treePoint(world, t);
    return usesNear(world, p, TRUNK_ROOM, mine).length > 0 || onRoad(p);
  });
}

/** The grown trees standing on farm b's fields: its farmers fell them, and sow no field under one. */
export function treesOnFields(world: World, b: Building): Tree[] {
  const mine = (u: LandUse) => u.kind === 'field' && u.buildingId === b.id;
  return world.trees.filter((t) => t.state === 'grown' && usesNear(world, treePoint(world, t), TRUNK_ROOM, mine).length);
}

/** Whether a tree from `trees` stands on the land within TRUNK_ROOM of grid cell (c, row). */
export function treeOnCell(world: World, trees: Tree[], c: number, row: number): boolean {
  return trees.some((t) => {
    const p = treePoint(world, t);
    return Math.floor((p.x - TRUNK_ROOM) / CELL_W) <= c && c <= Math.floor((p.x + TRUNK_ROOM) / CELL_W) && Math.floor((p.y - TRUNK_ROOM) / CELL_W) <= row && row <= Math.floor((p.y + TRUNK_ROOM) / CELL_W);
  });
}

/**
 * A farm's work (farm.ts) with the clearing of its fields: after the harvest,
 * before any sowing, a farmer fells a tree standing on them and carries the
 * log to the road by it, for serfs. `blocked` says whether a plot (by index)
 * has a tree on it: nobody sows there.
 */
export function clearingFields(world: World, b: Building, farm: Workplace, blocked: (trees: Tree[], plot: number) => boolean): Workplace {
  const x = b.x;
  const trees = () => treesOnFields(world, b);
  const standing = (id: number) => trees().find((t) => t.id === id);
  return {
    ...farm,
    nextJob(w, taken) {
      const felling = new Set([...treesBeingFelled(world), ...taken.filter((j) => j.action === 'chop').map((j) => j.target)]);
      const work = taken.filter((j) => j.action !== 'chop');
      const next = farm.nextJob(w, work);
      if (next?.job.action === 'harvest') return next;
      const here = trees();
      let best: Tree | null = null;
      for (const t of here) {
        if (!felling.has(t.id) && (!best || Math.abs(chopSpot(t, x).dx - w.dx) < Math.abs(chopSpot(best, x).dx - w.dx))) best = t;
      }
      if (best) return { job: { action: 'chop', target: best.id, slot: Math.round(chopSpot(best, x).dx) }, ...chopSpot(best, x) };
      // sow only where no tree stands
      const skip: JobTicket[] = [];
      for (let n = next; n; n = farm.nextJob(w, [...work, ...skip])) {
        if (!blocked(here, n.job.target)) return n;
        skip.push(n.job);
      }
      return null;
    },
    jobSpot(job) {
      if (job.action !== 'chop') return farm.jobSpot?.(job) ?? null;
      const t = standing(job.target);
      return t ? chopSpot(t, x) : null;
    },
    begin(job) {
      if (job.action !== 'chop') return blocked(trees(), job.target) ? null : farm.begin(job);
      return standing(job.target) ? CHOP_TIME : null;
    },
    finish(job) {
      return job.action === 'chop' ? fell(world, job.target, true) : farm.finish(job);
    },
    dropSpot(job, load) {
      // down at the edge of the road, in front of where the tree stood
      if (job.action === 'chop') return { dx: (job.slot ?? 0), y: GROUND_PILE_Y };
      return farm.dropSpot(job, load);
    },
    deliver(load, job) {
      if (job.action === 'chop') dropOnGround(world, x + (job.slot ?? 0), load);
      else farm.deliver(load, job);
    },
  };
}

/** Where someone stands to fell tree t, as dx from world x and a depth y: beside the trunk, a step nearer the viewer. */
export const chopSpot = (t: Tree, x: number) => ({ dx: t.x + CHOP_SPOT.dx - x, y: yAt(behindRoad(t.y) - 5) });

/** The trees someone in the village is on their way to fell, or felling: nobody else goes for them. */
export function treesBeingFelled(world: World): Set<number> {
  const out = new Set<number>();
  for (const p of world.people) {
    const job = p.job && currentJob(p.job.worker);
    if (job?.action === 'chop') out.add(job.target);
  }
  return out;
}

/**
 * The grown tree nearest world x (the walk out to it, along the streets then
 * across) within WOOD_REACH, not one of `skip`; null if none stands.
 */
export function nearestTree(world: World, x: number, skip: Set<number>): Tree | null {
  const walk = (t: Tree) => streetDist(world, x, t.x) + Math.abs(behindRoad(t.y) - behindRoad(STAND_Y));
  let best: Tree | null = null;
  for (const t of world.trees) {
    if (t.state !== 'grown' || skip.has(t.id) || walk(t) > WOOD_REACH) continue;
    if (!best || walk(t) < walk(best)) best = t;
  }
  return best;
}

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
  if (x < min || x > max || !streetAt(world, s) || streetAt(world, s).gone) return false;
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
  /**
   * A place picked at random to plant a sapling: free land, clear of trees and
   * of saplings about to go in. Near home (PLANT_NEAR) if there is room there,
   * else anywhere in his reach.
   */
  const plantJob = (taken: JobTicket[]): JobTicket | null => {
    const planting = taken.filter((j) => j.action === 'plant');
    const growing = world.trees.filter((t) => t.state === 'growing' && walk(x, t.x, behindRoad(t.y)) <= PLANT_NEAR.reach).length;
    if (growing + planting.length >= SAPLINGS_TENDED) return null;
    for (let tries = 0; tries < 48; tries++) {
      const near = tries < 32;
      const tx = Math.round(x + (rand() * 2 - 1) * (near ? PLANT_NEAR.along : WOOD_REACH));
      const band = near ? (rand() < 0.75 ? PLANT_NEAR.behind : WOODS.front) : rand() < 0.75 ? WOODS.behind : WOODS.front;
      const d = Math.round(band[0] + rand() * (band[1] - band[0]));
      const street = streetAt(world, streetOf(tx));
      const { min, max } = streetRange(world, streetOf(tx));
      if (!street || street.gone || tx < min || tx > max || walk(x, tx, d) > WOOD_REACH) continue;
      const p = streetPoint(world, tx, d);
      if (!treeRoom(world, p)) continue;
      const crowds = (j: JobTicket) => {
        const q = streetPoint(world, j.target, j.slot ?? 0);
        return Math.hypot(q.x - p.x, q.y - p.y) < TREE_GAP;
      };
      if (!planting.some(crowds)) return { action: 'plant', target: tx, slot: d };
    }
    return null;
  };
  return {
    door,
    nextJob(w, taken) {
      // loads on their way count against the room in the store
      const loads = taken.filter((j) => j.action !== 'plant').length;
      const full = room(b.stock, capacity, resource) <= loads * PILE_UNIT + 1e-9;
      // with the store full a woodcutter plants, and a stonecutter waits
      if (full) {
        const job = action === 'chop' ? plantJob(taken) : null;
        const at = job && spot(job);
        return job && at ? { job, ...at } : null;
      }
      const here = x + w.dx;
      let job: JobTicket | null = null;
      if (action === 'chop') {
        const busy = new Set([...treesBeingFelled(world), ...taken.filter((j) => j.action !== 'plant').map((j) => j.target)]);
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
