// The woods and the quarries behind the street, and the huts that work them.
//
// Trees stand anywhere on the land with room (treeRoom): in clumps behind the
// streets and out in front, never on a road, a building, a field or a quarry,
// nor crowding each other. Each has its place on the map, kept as a world x
// along a street and a depth y across it. A sapling grows for TREE_GROW
// seconds into a grown tree; a woodcutter walks out to a grown tree and fells
// it, leaving a stump that rots away after STUMP_TIME. New saplings sprout on
// their own now and then, mostly near grown trees. Land taken by a building, a
// field or a road is cleared of trees (clearLand).
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

import { BUILDINGS } from './buildings';
import { putAway, storeSpot } from './economy';
import { behindRoad, CELL_W, CHOP_SPOT, PILE_UNIT, QUARRIES, QUARRY_SPOTS, QUARRY_W, QUARRY_Y, STAND_Y, STONECUTTER_DOOR, WOODCUTTER_DOOR, yAt } from './layout';
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

/** Whether world x is inside a quarry's stretch of the main street's tree line (old saves' woods). */
function inQuarry(x: number): boolean {
  return QUARRIES.some((q) => Math.abs(x - q.x) < QUARRY_W / 2 + 20);
}

/** Grown fraction 0..1 (a stump counts as grown: it is what is left of one). */
export function treeGrowth(t: Tree): number {
  return t.state === 'growing' ? Math.min(1, t.age / TREE_GROW) : 1;
}

/** How much room (map px) a trunk keeps from a road, a building, a field or the rocks. */
const TRUNK_ROOM = 10;

/** Where tree t stands on the map. */
export const treePoint = (world: World, t: Tree): Vec => groundPoint(world, t.x, t.y);

/**
 * Whether a tree can stand at map point p: not on land anything takes (grid.ts:
 * a road or its verges, a building or a crossroads being built, a farm's
 * field, a quarry's land), and (unless `crowd` is false) not crowding another tree.
 */
export function treeRoom(world: World, p: Vec, crowd = true, not?: Tree): boolean {
  const land = landUse(world);
  /** Whether land within r of p is taken by something `which` matches. */
  const taken = (r: number, which: (u: LandUse) => boolean) => {
    for (let c = Math.floor((p.x - r) / CELL_W); c <= Math.floor((p.x + r) / CELL_W); c++) {
      for (let row = Math.floor((p.y - r) / CELL_W); row <= Math.floor((p.y + r) / CELL_W); row++) {
        const u = land.get(cellKey(c, row));
        if (u && which(u)) return true;
      }
    }
    return false;
  };
  if (taken(TRUNK_ROOM, () => true) || taken(CELL_W, (u) => u.kind === 'road')) return false;
  if (crowd) {
    for (const t of world.trees) {
      if (t === not) continue;
      const q = treePoint(world, t);
      if (Math.hypot(q.x - p.x, q.y - p.y) < TREE_GAP) return false;
    }
  }
  return true;
}

/** Trees are cut down wherever the land is taken (a building, a field, a road): nothing grows on top of anything. */
export function clearLand(world: World): void {
  world.trees = world.trees.filter((t) => treeRoom(world, treePoint(world, t), false));
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

/** The woods at the start of old saves: an uneven line of trees along the main street's tree line (save.ts migrations). */
export function createForest(width: number, rand: () => number, nextId: () => number, x0 = 0): Array<Omit<Tree, 'y'>> {
  const trees: Array<Omit<Tree, 'y'>> = [];
  for (let x = x0 + 60; x < x0 + width - 60; x += 70) {
    if (rand() < 0.3) continue;
    const tx = x + rand() * 40;
    if (inQuarry(tx) || trees.some((t) => Math.abs(t.x - tx) < TREE_GAP)) continue;
    const young = rand() < 0.2;
    trees.push({ id: nextId(), x: tx, state: young ? 'growing' : 'grown', age: young ? rand() * TREE_GROW : 0 });
  }
  return trees;
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

/** The woodcutter's or stonecutter's hut as a workplace for its worker. */
export function gatherWorkplace(world: World, b: Building & { type: GatherHut }): Workplace {
  const x = b.x;
  const { resource, action, seconds, door } = GATHER[b.type];
  const capacity = BUILDINGS[b.type].storage;
  const tree = (id: number) => world.trees.find((t) => t.id === id && t.state === 'grown');
  const spot = (job: JobTicket) => {
    if (action === 'chop') {
      const t = tree(job.target);
      // beside the trunk, a step nearer the viewer
      return t ? { dx: t.x + CHOP_SPOT.dx - x, y: yAt(behindRoad(t.y) - 5) } : null;
    }
    const q = QUARRIES[job.target];
    return q ? { dx: q.x + (QUARRY_SPOTS[job.slot ?? 0] ?? 0) - x, y: QUARRY_Y + 3 } : null;
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
        /** The walk from world x `from` (on the road) out to tree t: along the streets, then across. */
        const walk = (from: number, t: Tree) => streetDist(world, from, t.x) + Math.abs(behindRoad(t.y) - behindRoad(STAND_Y));
        for (const t of world.trees) {
          if (t.state !== 'grown' || busy.has(t.id) || walk(x, t) > WOOD_REACH) continue;
          if (!best || walk(here, t) < walk(here, best)) best = t;
        }
        if (best) job = { action, target: best.id };
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
      return spot(job) ? seconds : null;
    },
    finish(job): Load | null {
      if (action === 'chop') {
        const t = tree(job.target);
        if (!t) return null;
        t.state = 'stump';
        t.age = 0;
      }
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
