// Transport: goods carried between buildings, one errand per trip: pick up the
// top item(s) where they lie in one store, carry them, and put them down in
// their place in the other (storeSpot).
//
// Two kinds of errand (BuildingDef.ships / needs):
// - ship: what a building makes (a farm's sheaves, the mill's flour) goes from
//   its store straight to the nearest building that needs it and has room (the
//   bakery), and only otherwise to the nearest warehouse with room;
// - supply: what a building needs (the mill's grain) comes from the nearest
//   place that has it: a building that makes it (a farm's store) or a
//   warehouse; at equal distance, straight from the maker.
// Errands are run by serfs, and by a workshop's own worker when they have
// nothing else to do and none of what they need (workshop.ts). Everyone
// running errands is counted, so no two people go for the same load.
//
// Serfs are the village's out-of-work people (Person.seeker), hired by the
// transport hub (the oldest warehouse) for as long as there are errands:
// after each errand a serf takes another if one is waiting, and otherwise is
// let go where they stand and strolls again. A serf who is not carrying
// anything is hired away for a lasting job (the mill's miller) before any
// more errands (people.ts). Like builders, serfs work in daylight only.

import { BUILDINGS } from './buildings';
import { putAway, storeSpot, tripLoad, warehouses } from './economy';
import { STAND_Y, type Spot } from './layout';
import { employees } from './people';
import { RESOURCES, room, type Load, type Resource } from './resources';
import { currentJob, delivering, type JobTicket, type Workplace } from './worker';
import type { Building, World } from './world';

/** Most serfs the village hires at once. */
export const SERFS_MAX = 5;
/** Seconds to lift a load off a store. */
const PICK_UP_TIME = 0.25;

/** An errand: its ticket (target: the building picked up from, to: the one delivered to). */
export interface Errand {
  job: JobTicket;
  from: Building;
  r: Resource;
}

const shipAction = (r: Resource) => `ship-${r}`;
export const supplyAction = (r: Resource) => `supply-${r}`;
/** The resource an errand moves, if the action is an errand. */
export function errandResource(action: string): Resource | null {
  return RESOURCES.find((r) => action === shipAction(r) || action === supplyAction(r)) ?? null;
}

const xOf = (world: World, b: Building) => world.plots[b.plotIndex].x;
const done = (world: World, id: number | undefined) => world.buildings.find((b) => b.id === id && b.status === 'done');

/** The warehouse that employs the village's serfs: the oldest finished one. */
export function transportHub(world: World): Building | null {
  return warehouses(world)[0] ?? null;
}

/** An errand someone is on: on the way to pick up (amount: what they'll likely take), or carrying it (what they hold). */
interface Underway {
  job: JobTicket;
  amount: number;
  carrying: boolean;
}

/** Errands being run by anyone (serfs, workshop workers). */
function underway(world: World): Underway[] {
  const out: Underway[] = [];
  for (const p of world.people) {
    const w = p.job?.worker;
    if (!w) continue;
    const pending = currentJob(w);
    const r = pending && errandResource(pending.action);
    const from = pending && done(world, pending.target);
    if (pending && r && from) out.push({ job: pending, amount: tripLoad(from, r), carrying: false });
    const carried = delivering(w);
    if (carried && w.carrying && errandResource(carried.action)) out.push({ job: carried, amount: w.carrying.amount, carrying: true });
  }
  return out;
}

const sum = (list: Underway[]) => list.reduce((n, u) => n + u.amount, 0);
/** What of r in b's store is still free once those on their way have picked theirs up. */
const unclaimed = (runs: Underway[], b: Building, r: Resource) =>
  b.stock[r] - sum(runs.filter((u) => !u.carrying && u.job.target === b.id && errandResource(u.job.action) === r));
/** Room left in b's store for r once what is on its way (shipped or supplied) has arrived. */
const roomLeft = (runs: Underway[], b: Building, r: Resource) =>
  room(b.stock, BUILDINGS[b.type].storage, r) - sum(runs.filter((u) => u.job.to === b.id && errandResource(u.job.action) === r));

/** The nearest place to x with some of r free to take: a building that makes it or a warehouse; at equal distance the maker. */
function nearestSource(world: World, runs: Underway[], r: Resource, x: number, not: Building): Building | null {
  const places = world.buildings.filter(
    (b) => b !== not && b.status === 'done' && (b.type === 'warehouse' || BUILDINGS[b.type].ships?.includes(r)) && unclaimed(runs, b, r) > 1e-9,
  );
  const d = (b: Building) => Math.abs(xOf(world, b) - x);
  return places.sort((a, b) => d(a) - d(b) || Number(a.type === 'warehouse') - Number(b.type === 'warehouse'))[0] ?? null;
}

/** The errand bringing b some of r, if it has room for it and it can be had somewhere. */
function supplyErrand(world: World, runs: Underway[], b: Building, r: Resource): Errand | null {
  if (roomLeft(runs, b, r) <= 1e-9) return null;
  const from = nearestSource(world, runs, r, xOf(world, b), b);
  return from ? { job: { action: supplyAction(r), target: from.id, to: b.id }, from, r } : null;
}

/** An errand to fetch something b needs, for b's own worker. */
export function fetchFor(world: World, b: Building, r: Resource): Errand | null {
  return supplyErrand(world, underway(world), b, r);
}

/** Where what b makes goes: the nearest building that needs it and has room, else the nearest warehouse with room. */
function shipTo(world: World, runs: Underway[], b: Building, r: Resource): Building | null {
  const d = (o: Building) => Math.abs(xOf(world, o) - xOf(world, b));
  const byDistance = (list: Building[]) => list.sort((a, c) => d(a) - d(c))[0] ?? null;
  const users = world.buildings.filter((o) => o !== b && o.status === 'done' && BUILDINGS[o.type].needs?.includes(r) && roomLeft(runs, o, r) > 1e-9);
  return byDistance(users) ?? byDistance(warehouses(world).filter((w) => roomLeft(runs, w, r) > 1e-9));
}

/** Errands waiting for someone to run them, nearest first to x. */
export function errands(world: World, x = 0): Errand[] {
  const runs = underway(world);
  const out: Errand[] = [];
  // each errand planned claims its load and the room it fills, like one being run
  const plan = (e: Errand) => {
    out.push(e);
    runs.push({ job: e.job, amount: Math.min(tripLoad(e.from, e.r), unclaimed(runs, e.from, e.r)), carrying: false });
  };
  const finished = world.buildings.filter((b) => b.status === 'done');
  // what makers have goes out first, so it is matched with who needs it
  for (const b of finished) {
    for (const r of BUILDINGS[b.type].ships ?? []) {
      if (unclaimed(runs, b, r) <= 1e-9) continue;
      const to = shipTo(world, runs, b, r);
      if (to) plan({ job: { action: shipAction(r), target: b.id, to: to.id }, from: b, r });
    }
  }
  // then what is still needed is fetched from wherever it can be had
  for (const b of finished) {
    for (const r of BUILDINGS[b.type].needs ?? []) {
      const e = supplyErrand(world, runs, b, r);
      if (e) plan(e);
    }
  }
  return out.sort((a, b) => Math.abs(xOf(world, a.from) - x) - Math.abs(xOf(world, b.from) - x));
}

/** Serf jobs the hub offers now: one per errand serfs are running or that is waiting, up to SERFS_MAX. */
export function serfPositions(world: World): number {
  const hub = transportHub(world);
  const serfs = hub ? employees(world, hub).map((p) => p.job!.worker) : [];
  const running = serfs.filter((w) => currentJob(w) || delivering(w)).length;
  return Math.min(SERFS_MAX, running + errands(world).length);
}

/**
 * How anyone runs an errand, for a workplace centred on x: where to pick the
 * load up, picking it up, and where it goes down. Workplaces that run errands
 * pass their errand tickets on to these.
 */
export function errandWork(world: World, x: number): Pick<Workplace, 'jobSpot' | 'begin' | 'finish' | 'dropSpot' | 'deliver'> {
  /** Where a load from this errand goes: its destination, else any warehouse with room, else back where it came from. */
  const destination = (job: JobTicket, r: Resource): Building | null => {
    const to = done(world, job.to);
    if (to && room(to.stock, BUILDINGS[to.type].storage, r) > 0) return to;
    return warehouses(world).find((w) => room(w.stock, BUILDINGS.warehouse.storage, r) > 0) ?? done(world, job.target) ?? null;
  };
  return {
    jobSpot(job): Spot | null {
      const r = errandResource(job.action);
      const from = done(world, job.target);
      return r && from && from.stock[r] > 0 ? storeSpot(world, from, r, x, true) : null;
    },
    begin(job) {
      const r = errandResource(job.action);
      const from = done(world, job.target);
      return r && from && from.stock[r] > 1e-9 ? PICK_UP_TIME : null;
    },
    finish(job): Load | null {
      const r = errandResource(job.action);
      const from = done(world, job.target);
      if (!r || !from) return null;
      const to = done(world, job.to);
      // a supply takes only what the store it goes to has room for
      const fits = job.action === supplyAction(r) && to ? room(to.stock, BUILDINGS[to.type].storage, r) : Infinity;
      const n = Math.min(tripLoad(from, r), from.stock[r], fits);
      if (n <= 0) return null;
      from.stock[r] -= n;
      return { resource: r, amount: n };
    },
    dropSpot(job, load) {
      const to = destination(job, load.resource);
      return to ? storeSpot(world, to, load.resource, x, false, load.amount) : { dx: 0, y: STAND_Y };
    },
    deliver(load, job) {
      const to = destination(job, load.resource);
      const n = to ? Math.min(load.amount, room(to.stock, BUILDINGS[to.type].storage, load.resource)) : 0;
      if (to) to.stock[load.resource] += n;
      // it filled up at the last moment: the rest goes to a warehouse with room
      if (n < load.amount) putAway(world, { resource: load.resource, amount: load.amount - n }, x);
    },
  };
}

/** The transport hub as a workplace for its serfs. */
export function transportWorkplace(world: World, hub: Building): Workplace {
  const x = xOf(world, hub);
  return {
    dayLabour: true,
    temporary: true,
    door: { dx: 0, y: STAND_Y },
    nextJob(w) {
      const next = errands(world, x + w.dx)[0];
      return next ? { job: next.job, ...storeSpot(world, next.from, next.r, x, true) } : null;
    },
    ...errandWork(world, x),
  };
}
