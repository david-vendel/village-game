// Transport: serfs carry goods between buildings. A farm's sheaves and the
// mill's flour go from their stores to a warehouse; grain goes from a
// warehouse to the mill (BuildingDef.ships / needs). Each errand is one trip:
// pick up the top item(s) where they lie in one store, carry them, and put
// them down in their place in the other (storeSpot).
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
interface Errand {
  job: JobTicket;
  from: Building;
  r: Resource;
}

const shipAction = (r: Resource) => `ship-${r}`;
const supplyAction = (r: Resource) => `supply-${r}`;
/** The resource an errand moves, if the action is an errand. */
export function errandResource(action: string): Resource | null {
  return RESOURCES.find((r) => action === shipAction(r) || action === supplyAction(r)) ?? null;
}

const xOf = (world: World, b: Building) => world.plots[b.plotIndex].x;

/** The warehouse that employs the village's serfs: the oldest finished one. */
export function transportHub(world: World): Building | null {
  return warehouses(world)[0] ?? null;
}

/** Errands already being run: pickups on the way (`pending`) and loads being carried (`carrying`). */
function underway(world: World): { pending: JobTicket[]; carrying: JobTicket[] } {
  const hub = transportHub(world);
  const serfs = hub ? employees(world, hub).map((p) => p.job!.worker) : [];
  return { pending: serfs.flatMap((w) => currentJob(w) ?? []), carrying: serfs.flatMap((w) => delivering(w) ?? []) };
}

/** Errands waiting for a serf, nearest first to x. */
export function errands(world: World, x = 0): Errand[] {
  const { pending, carrying } = underway(world);
  const count = (list: JobTicket[], action: string, key: 'target' | 'to', id: number) => list.filter((j) => j.action === action && j[key] === id).length;
  const nearestWarehouse = (near: number, ok: (w: Building) => boolean) =>
    warehouses(world)
      .filter(ok)
      .sort((a, b) => Math.abs(xOf(world, a) - near) - Math.abs(xOf(world, b) - near))[0] ?? null;
  const out: Errand[] = [];
  for (const b of world.buildings) {
    if (b.status !== 'done') continue;
    const def = BUILDINGS[b.type];
    for (const r of def.ships ?? []) {
      // what is left in the store once the serfs on their way have picked theirs up
      const left = b.stock[r] - count(pending, shipAction(r), 'target', b.id) * tripLoad(b, r);
      const to = left > 1e-9 ? nearestWarehouse(xOf(world, b), (w) => room(w.stock, BUILDINGS.warehouse.storage, r) > 0) : null;
      if (to) out.push({ job: { action: shipAction(r), target: b.id, to: to.id }, from: b, r });
    }
    for (const r of def.needs ?? []) {
      // room left once what is on its way has arrived
      const coming = (count(pending, supplyAction(r), 'to', b.id) + count(carrying, supplyAction(r), 'to', b.id)) * tripLoad(b, r);
      if (room(b.stock, BUILDINGS[b.type].storage, r) - coming <= 1e-9) continue;
      const from = nearestWarehouse(xOf(world, b), (w) => w.stock[r] - count(pending, supplyAction(r), 'target', w.id) * tripLoad(w, r) > 1e-9);
      if (from) out.push({ job: { action: supplyAction(r), target: from.id, to: b.id }, from, r });
    }
  }
  return out.sort((a, b) => Math.abs(xOf(world, a.from) - x) - Math.abs(xOf(world, b.from) - x));
}

/** Serf jobs the hub offers now: one per errand being run or waiting, up to SERFS_MAX. */
export function serfPositions(world: World): number {
  const { pending, carrying } = underway(world);
  return Math.min(SERFS_MAX, pending.length + carrying.length + errands(world).length);
}

/** The transport hub as a workplace for its serfs. */
export function transportWorkplace(world: World, hub: Building): Workplace {
  const x = xOf(world, hub);
  const building = (id: number | undefined) => world.buildings.find((b) => b.id === id && b.status === 'done');
  /** Where a load from this errand goes: its destination, else any warehouse with room, else back where it came from. */
  const destination = (job: JobTicket, r: Resource): Building | null => {
    const to = building(job.to);
    if (to && room(to.stock, BUILDINGS[to.type].storage, r) > 0) return to;
    return warehouses(world).find((w) => room(w.stock, BUILDINGS.warehouse.storage, r) > 0) ?? building(job.target) ?? null;
  };
  return {
    dayLabour: true,
    temporary: true,
    door: { dx: 0, y: STAND_Y },
    nextJob(w) {
      const next = errands(world, x + w.dx)[0];
      return next ? { job: next.job, ...storeSpot(world, next.from, next.r, x, true) } : null;
    },
    jobSpot(job): Spot | null {
      const r = errandResource(job.action);
      const from = building(job.target);
      return r && from && from.stock[r] > 0 ? storeSpot(world, from, r, x, true) : null;
    },
    begin(job) {
      const r = errandResource(job.action);
      const from = building(job.target);
      return r && from && from.stock[r] > 1e-9 ? PICK_UP_TIME : null;
    },
    finish(job): Load | null {
      const r = errandResource(job.action);
      const from = building(job.target);
      if (!r || !from) return null;
      const to = building(job.to);
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
