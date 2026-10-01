// A workshop (the mill, the bakery, and any building with a `makes` recipe)
// as a workplace (worker.ts) for its worker. The store (the building's stock)
// keeps each thing in its own place: what it needs on one side of the door,
// what it makes on the other (economy.ts storeSlots).
//
// The work, one batch at a time: take the top sack of what it needs from the
// store, carry it to where it is worked (the bakery's oven; else in through
// the door, like the miller, who works upstairs, seen from the street), and
// carry what was made to its place in the store.
// With nothing to make and none of what it needs, the worker fetches some
// themselves from the nearest place that has it (transport.ts), unless
// someone is already bringing it. Serfs bring the rest and take what is made
// away. The rest of the day is the generic worker routine.

import { BUILDINGS, type Recipe } from './buildings';
import { putAway, storeSpot } from './economy';
import { room, type Load } from './resources';
import { errandResource, errandWork, fetchFor } from './transport';
import type { JobTicket, Workplace } from './worker';
import type { Building, World } from './world';

/** Seconds to lift a sack off the store. */
const PICK_UP_TIME = 0.4;

export function workshopWorkplace(world: World, b: Building, recipe: Recipe): Workplace {
  const x = b.x;
  const capacity = BUILDINGS[b.type].storage;
  const { from, to, batch, per, seconds, verb, door, at } = recipe;
  const errand = errandWork(world, x);
  const isErrand = (job: JobTicket) => errandResource(job.action) !== null;
  /** How much of `from` the next batch takes: as much as is there, up to a batch, that what it makes has room for. */
  const nextBatch = () => Math.min(batch, b.stock[from], Math.floor(room(b.stock, capacity, to) / per + 1e-9));
  return {
    door,
    nextJob() {
      if (nextBatch() > 1e-9) return { job: { action: verb, target: 0 }, ...storeSpot(world, b, from, x, true) };
      // nothing to work on: go and get some, if nobody is bringing it already
      if (b.stock[from] > 1e-9) return null;
      const fetch = fetchFor(world, b, from);
      return fetch ? { job: fetch.job, ...storeSpot(world, fetch.from, from, x, true) } : null;
    },
    jobSpot(job) {
      return isErrand(job) ? errand.jobSpot!(job) : b.stock[from] > 1e-9 ? storeSpot(world, b, from, x, true) : null;
    },
    begin(job) {
      if (isErrand(job)) return errand.begin(job);
      return nextBatch() > 1e-9 ? PICK_UP_TIME : null;
    },
    finish(job, carried): Load | null {
      if (isErrand(job)) return errand.finish(job);
      // inside: what was carried in is made into what the workshop makes
      if (carried) return carried.resource === from ? { resource: to, amount: carried.amount * per } : carried;
      // outside: a sack taken off the store, to carry in
      const n = nextBatch();
      if (n <= 1e-9) return null;
      b.stock[from] -= n;
      return { resource: from, amount: n };
    },
    workOn(job, load) {
      return !isErrand(job) && load.resource === from ? { seconds, indoors: !at } : null;
    },
    dropSpot(job, load) {
      if (isErrand(job)) return errand.dropSpot(job, load);
      return load.resource === from ? (at ?? door) : storeSpot(world, b, to, x, false, load.amount);
    },
    deliver(load, job) {
      if (isErrand(job)) return errand.deliver(load, job);
      const n = Math.min(load.amount, room(b.stock, capacity, load.resource));
      b.stock[load.resource] += n;
      // no room left after all: the rest goes to a warehouse
      if (n < load.amount) putAway(world, { resource: load.resource, amount: load.amount - n }, x);
    },
  };
}
