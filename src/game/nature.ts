// The woods and the quarries behind the street, and the huts that work them.
//
// Trees stand along the tree line (TREE_Y), each at its own world x. A
// sapling grows for TREE_GROW seconds into a grown tree; a woodcutter fells
// grown trees, leaving a stump that rots away after STUMP_TIME. New saplings
// sprout on their own now and then, wherever there is room.
//
// Every street has woods along it; where a road runs off at a crossroads the
// trees are cut down for it, and none grow there again (onRoad).
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
import { CHOP_SPOT, PILE_UNIT, QUARRIES, QUARRY_SPOTS, QUARRY_W, QUARRY_Y, STONECUTTER_DOOR, STREET_LENGTH, WOODCUTTER_DOOR } from './layout';
import { room, type Load } from './resources';
import { crossings, SIDE_ROAD_HALF, streetDist, streetStart } from './streets';
import type { JobTicket, Workplace } from './worker';
import type { Building, World } from './world';

export interface Tree {
  id: number;
  /** World x of the trunk. */
  x: number;
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

/** Whether world x is inside a quarry (no trees grow there). */
function inQuarry(x: number): boolean {
  return QUARRIES.some((q) => Math.abs(x - q.x) < QUARRY_W / 2 + 20);
}

function roomFor(trees: readonly Tree[], x: number): boolean {
  return !inQuarry(x) && trees.every((t) => Math.abs(t.x - x) >= TREE_GAP);
}

/** Grown fraction 0..1 (a stump counts as grown: it is what is left of one). */
export function treeGrowth(t: Tree): number {
  return t.state === 'growing' ? Math.min(1, t.age / TREE_GROW) : 1;
}

/** Trees keep this far (px) from the middle of a road running off at a crossroads. */
const ROAD_CLEAR = SIDE_ROAD_HALF + 28;

/** Whether world x is where a road runs off at a crossroads (built or being built), so no tree stands there. */
export function onRoad(world: World, x: number): boolean {
  const near = (at: number) => Math.abs(at - x) < ROAD_CLEAR;
  return crossings(world).some((c) => near(c.x)) || world.buildings.some((b) => b.type === 'intersection' && near(world.plots[b.plotIndex].x));
}

/** Cut the trees down where a road runs off at world x (they leave stumps, which rot away). */
export function clearRoad(world: World, x: number): void {
  for (const t of world.trees) {
    if (t.state !== 'stump' && Math.abs(t.x - x) < ROAD_CLEAR) {
      t.state = 'stump';
      t.age = 0;
    }
  }
}

/** The woods at the start: an uneven line of trees along a street (starting at world x x0), most of them grown. */
export function createForest(width: number, rand: () => number, nextId: () => number, x0 = 0): Tree[] {
  const trees: Tree[] = [];
  for (let x = x0 + 60; x < x0 + width - 60; x += 70) {
    if (rand() < 0.3) continue;
    const tx = x + rand() * 40;
    if (!roomFor(trees, tx)) continue;
    const young = rand() < 0.2;
    trees.push({ id: nextId(), x: tx, state: young ? 'growing' : 'grown', age: young ? rand() * TREE_GROW : 0 });
  }
  return trees;
}

/** Trees grow, stumps rot, and now and then a sapling sprouts somewhere with room, along any street. */
export function updateForest(world: World, dt: number, rand: () => number): void {
  for (const t of world.trees) {
    t.age += dt;
    if (t.state === 'growing' && t.age >= TREE_GROW) t.state = 'grown';
  }
  world.trees = world.trees.filter((t) => t.state !== 'stump' || t.age < STUMP_TIME);
  const streets = world.streets.length;
  if (world.trees.length < MAX_TREES * streets && rand() < dt / SPROUT_EVERY) {
    const x = 60 + rand() * (STREET_LENGTH - 120) + (streets > 1 ? streetStart(Math.floor(rand() * streets)) : 0);
    if (roomFor(world.trees, x) && !onRoad(world, x)) world.trees.push({ id: world.nextId++, x, state: 'growing', age: 0 });
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
  const x = world.plots[b.plotIndex].x;
  const { resource, action, seconds, door } = GATHER[b.type];
  const capacity = BUILDINGS[b.type].storage;
  const tree = (id: number) => world.trees.find((t) => t.id === id && t.state === 'grown');
  const spot = (job: JobTicket) => {
    if (action === 'chop') {
      const t = tree(job.target);
      return t ? { dx: t.x + CHOP_SPOT.dx - x, y: CHOP_SPOT.y } : null;
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
        for (const t of world.trees) {
          if (t.state !== 'grown' || busy.has(t.id) || streetDist(world, x, t.x) > WOOD_REACH) continue;
          if (!best || streetDist(world, here, t.x) < streetDist(world, here, best.x)) best = t;
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
