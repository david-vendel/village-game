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

import { type Recipe, storageOf } from './buildings';
import { putAway, storeSpot, villageStock } from './economy';
import { room, type Load, type Resource } from './resources';
import { errandResource, errandSpot, errandWork, fetchFor } from './transport';
import type { JobTicket, Workplace } from './worker';
import type { Building, World } from './world';

/** Seconds to lift a sack off the store. */
const PICK_UP_TIME = 0.4;

export function workshopWorkplace(world: World, b: Building, recipe: Recipe): Workplace {
  const x = b.x;
  const capacity = storageOf(b);
  const { from, to, batch, per, seconds, verb, door, at, also, boost, or, fire } = recipe;
  /** What a batch makes now: `to`, or `or` when the village is shorter of it (in batches' worth) and the store has room for it. */
  const output = (): { resource: Resource; per: number } => {
    if (!or) return { resource: to, per };
    const have = villageStock(world);
    const fitsOr = room(b.stock, capacity, or.resource) >= or.per * batch - 1e-9;
    const fitsTo = room(b.stock, capacity, to) >= per * batch - 1e-9;
    const shortOfOr = have[or.resource] + b.stock[or.resource] < ((have[to] + b.stock[to]) / per) * or.per;
    return fitsOr && (!fitsTo || shortOfOr) ? or : { resource: to, per };
  };
  const errand = errandWork(world, x);
  const isErrand = (job: JobTicket) => errandResource(job.action) !== null;
  /** How much of `from` the next batch takes: as much as is there, up to a batch, that what it makes has room for. */
  // only a whole batch is worked (two pails make a cheese)
  const nextBatch = () =>
    b.stock[from] < batch - 1e-9 ? 0 :
    // worked over a fire: none without firewood
    fire && b.stock.firewood < 1e-6 ? 0 :
    Math.min(batch, b.stock[from], also ? b.stock[also.resource] / also.amount : Infinity, Math.floor(room(b.stock, capacity, output().resource) / output().per + 1e-9));
  /** What a batch is made of: `amount` of each per one of `from`. */
  const inputs = [{ resource: from, amount: 1 }, ...(also ? [also] : []), ...(fire ? [{ resource: 'firewood' as Resource, amount: 1 }] : [])];
  return {
    door,
    nextJob() {
      if (nextBatch() > 1e-9) return { job: { action: verb, target: 0 }, ...storeSpot(world, b, from, x, true) };
      // nothing to work on: go and get what is missing, if nobody is bringing it already
      for (const i of inputs) {
        if (b.stock[i.resource] >= i.amount - 1e-9) continue;
        const fetch = fetchFor(world, b, i.resource);
        if (fetch) return { job: fetch.job, ...errandSpot(world, fetch, x) };
      }
      return null;
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
      if (carried && carried.resource === from && boost && b.stock[boost.resource] >= 1) {
        // salt to hand: it goes in, and the batch makes more
        b.stock[boost.resource] -= 1;
        const out = output();
        return { resource: out.resource, amount: carried.amount * out.per * boost.factor };
      }
      if (carried) {
        if (carried.resource !== from) return carried;
        const out = output();
        return { resource: out.resource, amount: carried.amount * out.per };
      }
      // outside: a sack taken off the store, to carry in
      const n = nextBatch();
      if (n <= 1e-9) return null;
      b.stock[from] -= n;
      // what goes in with it (the bakery's water, poured into the dough) is used up as the batch is taken
      if (also) b.stock[also.resource] -= n * also.amount;
      return { resource: from, amount: n };
    },
    workOn(job, load) {
      return !isErrand(job) && load.resource === from ? { seconds, indoors: !at } : null;
    },
    dropSpot(job, load) {
      if (isErrand(job)) return errand.dropSpot(job, load);
      return load.resource === from ? (at ?? door) : storeSpot(world, b, load.resource, x, false, load.amount);
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
