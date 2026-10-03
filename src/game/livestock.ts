// The animal farms (chickens, cows, sheep, horses): each keeps a herd, every
// animal in it female or male, with an age in years (one game day is a year:
// ageHerds). A new farm starts with a grown pair. Through its life an animal
// is young (ANIMALS.adult, balance.ts), then productive (until
// productiveUntil): only then do females give eggs or milk, adults give wool,
// and a productive pair breeds. At the end of its lifespan its keeper
// butchers it for meat. Animals drink (ANIMAL_WATER, SUMMER_DRINK times as
// much in summer) from the farm's store, brought from the well; thirsty, they
// give nothing and don't breed.
//
// The keeper's work (a Workplace, worker.ts): butcher an animal whose time
// has come; else, while feeding is worth it (the herd can grow, or there is
// something to give and room for it), take the feed (hay, the hens' grain)
// off the store, carry it to the trough and feed the herd there. Every
// ANIMALS.feedsPerBirth feeds a productive pair has a young one (female and
// male in turn); and what the animals give for the feed is carried to its
// place in the store. With no feed left the keeper fetches some
// (transport.ts), unless someone is bringing it already.

import { ANIMAL_WATER, ANIMALS, SUMMER_DRINK } from './balance';
import { BUILDINGS, storageOf, type BuildingDef } from './buildings';
import { isSummer, timeOfDay } from './daynight';
import { putAway, storeSpot } from './economy';
import { LIVESTOCK_FEED } from './layout';
import { pastureCells, PASTURE_CELLS_PER_HORSE } from './pasture';
import { dropOnGround } from './piles';
import { room, type Load, type Resource } from './resources';
import { errandResource, errandSpot, errandWork, fetchFor } from './transport';
import type { JobTicket, Workplace } from './worker';
import type { Building, World } from './world';

export type AnimalKind = 'chicken' | 'cow' | 'sheep' | 'horse';
export type Sex = 'female' | 'male';

/** One animal: its sex, and its age in years. */
export interface Beast {
  sex: Sex;
  age: number;
}

/** A farm's animals, the feeds given towards the next young one, and how many have been born (for their sexes). */
export interface Herd {
  animals: Beast[];
  fed: number;
  born: number;
  /** Water drunk and not yet taken from the store (buckets). */
  thirst?: number;
}

/** What an animal farm keeps (BuildingDef.livestock). */
export interface Livestock {
  animal: AnimalKind;
  /** What the herd eats, brought to the store and fed at the trough. */
  feed: Resource;
  /** What productive females give per feed (eggs, milk), `per` of it. */
  gives?: Resource;
  per?: number;
  /** What any productive adult gives instead, when there is more room for it (the sheep's wool). */
  or?: Resource;
}

/** Seconds to feed the herd at the trough, and to butcher an animal. */
const FEED_SECONDS = 5;
const BUTCHER_SECONDS = 6;
/** Seconds to halter a grown horse to lead it away. */
const HALTER_SECONDS = 3;
/** Seconds to lift the feed off the store. */
const PICK_UP_TIME = 0.4;

export const isAdult = (kind: AnimalKind, a: Beast) => a.age >= ANIMALS[kind].adult;
/** Grown and not yet past it: gives, and breeds. */
export const isProductive = (kind: AnimalKind, a: Beast) => isAdult(kind, a) && a.age < ANIMALS[kind].productiveUntil;
const isDue = (kind: AnimalKind, a: Beast) => a.age >= ANIMALS[kind].lifespan;

const livestockOf = (b: Building): Livestock | undefined => BUILDINGS[b.type].livestock;

/** A finished animal farm's herd: a grown pair to start with. */
export function herdOf(b: Building): Herd {
  const kind = livestockOf(b)!.animal;
  return (b.herd ??= {
    animals: [
      { sex: 'female', age: ANIMALS[kind].adult },
      { sex: 'male', age: ANIMALS[kind].adult },
    ],
    fed: 0,
    born: 0,
  });
}

/** How many animals the farm keeps at most: horses also need pasture (pasture.ts). */
export function herdRoom(world: World, b: Building): number {
  const kind = livestockOf(b)!.animal;
  const max = ANIMALS[kind].max;
  return kind === 'horse' ? Math.min(max, Math.floor(pastureCells(world, b).length / PASTURE_CELLS_PER_HORSE)) : max;
}

/** Every animal on every finished farm grows a year older each game day. */
export function ageHerds(world: World, dt: number): void {
  const years = (dt * timeOfDay(world).hoursPerSecond) / 24;
  const summer = isSummer(world);
  for (const b of world.buildings) {
    const kept = livestockOf(b);
    if (b.status !== 'done' || !kept) continue;
    const h = herdOf(b);
    for (const a of h.animals) a.age += years;
    // they drink, more in the summer heat, a bucket at a time from the store
    h.thirst = Math.min(2, (h.thirst ?? 0) + h.animals.length * ANIMAL_WATER[kept.animal] * (summer ? SUMMER_DRINK : 1) * years);
    while (h.thirst >= 1 && b.stock.water >= 1) {
      b.stock.water -= 1;
      h.thirst -= 1;
    }
  }
}

/** Animals owed a whole bucket and none in the store are thirsty: they give nothing and don't breed. */
export const thirsty = (b: Building): boolean => (herdOf(b).thirst ?? 0) >= 1 && b.stock.water < 1;

/** An animal farm as a workplace for its keeper. */
export function livestockWorkplace(world: World, b: Building, def: Livestock): Workplace {
  const x = b.x;
  const capacity = storageOf(b);
  const kind = def.animal;
  const { feed } = def;
  const errand = errandWork(world, x);
  const isErrand = (job: JobTicket) => errandResource(job.action) !== null;
  const meat = ANIMALS[kind].meat;
  const trough = { dx: LIVESTOCK_FEED.dx, y: LIVESTOCK_FEED.y };

  const due = () => herdOf(b).animals.findIndex((a) => isDue(kind, a));
  const canBreed = () => {
    if (thirsty(b)) return false;
    const h = herdOf(b);
    const has = (sex: Sex) => h.animals.some((a) => a.sex === sex && isProductive(kind, a));
    return has('female') && has('male') && h.animals.length < herdRoom(world, b);
  };
  /** What a feed gives now, if anything: by productive females (eggs, milk) or any productive adult (wool), where there is room. */
  const yieldOf = (): Load | null => {
    if (thirsty(b)) return null;
    const h = herdOf(b);
    const per = def.per ?? 1;
    const options: Resource[] = [];
    if (def.gives && h.animals.some((a) => a.sex === 'female' && isProductive(kind, a))) options.push(def.gives);
    if (def.or && h.animals.some((a) => isProductive(kind, a))) options.push(def.or);
    const fits = options.filter((r) => room(b.stock, capacity, r) >= per - 1e-9);
    if (!fits.length) return null;
    const r = fits.reduce((best, r) => (room(b.stock, capacity, r) > room(b.stock, capacity, best) ? r : best));
    return { resource: r, amount: per };
  };
  const worthFeeding = () => canBreed() || yieldOf() !== null;
  const canButcher = () => due() >= 0 && room(b.stock, capacity, 'meat') >= meat - 1e-9;
  /** A grown horse the farm can spare (beyond a productive mare and stallion, and not past it), if it has room to tether one. */
  const spare = (): number => {
    if (kind !== 'horse' || room(b.stock, capacity, 'horse') < 1) return -1;
    const h = herdOf(b).animals;
    const keep = new Set<Beast>();
    for (const sex of ['female', 'male'] as const) {
      const one = h.find((a) => a.sex === sex && isProductive(kind, a));
      if (one) keep.add(one);
    }
    return h.findIndex((a) => !keep.has(a) && isAdult(kind, a) && !isDue(kind, a));
  };

  return {
    door: BUILDINGS[b.type].door!,
    nextJob() {
      if (canButcher()) return { job: { action: 'butcher', target: 0 }, ...trough };
      if (spare() >= 0) return { job: { action: 'halter', target: 0 }, ...trough };
      if (!worthFeeding()) return null;
      if (b.stock[feed] >= 1 - 1e-9) return { job: { action: 'feed', target: 0 }, ...storeSpot(world, b, feed, x, true) };
      // no feed left: go and get some, if nobody is bringing it already
      const fetch = fetchFor(world, b, feed);
      return fetch ? { job: fetch.job, ...errandSpot(world, fetch, x) } : null;
    },
    jobSpot(job) {
      if (isErrand(job)) return errand.jobSpot!(job);
      if (job.action === 'butcher' || job.action === 'halter') return trough;
      return b.stock[feed] >= 1 - 1e-9 ? storeSpot(world, b, feed, x, true) : null;
    },
    begin(job) {
      if (isErrand(job)) return errand.begin(job);
      if (job.action === 'butcher') return canButcher() ? BUTCHER_SECONDS : null;
      if (job.action === 'halter') return spare() >= 0 ? HALTER_SECONDS : null;
      return b.stock[feed] >= 1 - 1e-9 && worthFeeding() ? PICK_UP_TIME : null;
    },
    finish(job, carried): Load | null {
      if (isErrand(job)) return errand.finish(job);
      if (job.action === 'butcher') {
        const i = due();
        if (i < 0) return null;
        herdOf(b).animals.splice(i, 1);
        // the hide and the tallow are left by the paddock, for serfs to take to the tannery and the chandler
        dropOnGround(world, x + trough.dx + 8, { resource: 'hides', amount: 1 });
        dropOnGround(world, x + trough.dx + 8, { resource: 'tallow', amount: 1 });
        return { resource: 'meat', amount: meat };
      }
      if (job.action === 'halter') {
        const i = spare();
        if (i < 0) return null;
        herdOf(b).animals.splice(i, 1);
        return { resource: 'horse', amount: 1 };
      }
      // fed at the trough: the young that are due are born, and what the animals give is carried back
      if (carried) {
        if (carried.resource !== feed) return carried;
        const h = herdOf(b);
        h.fed += carried.amount;
        while (h.fed >= ANIMALS[kind].feedsPerBirth - 1e-9 && canBreed()) {
          h.fed -= ANIMALS[kind].feedsPerBirth;
          h.animals.push({ sex: h.born % 2 === 0 ? 'female' : 'male', age: 0 });
          h.born++;
        }
        return yieldOf();
      }
      // the feed taken off the store, to carry to the trough
      if (b.stock[feed] < 1 - 1e-9) return null;
      b.stock[feed] -= 1;
      return { resource: feed, amount: 1 };
    },
    workOn(job, load) {
      return !isErrand(job) && job.action === 'feed' && load.resource === feed ? { seconds: FEED_SECONDS, indoors: false } : null;
    },
    dropSpot(job, load) {
      if (isErrand(job)) return errand.dropSpot(job, load);
      return load.resource === feed && job.action === 'feed' ? trough : storeSpot(world, b, load.resource, x, false, load.amount);
    },
    deliver(load, job) {
      if (isErrand(job)) return errand.deliver(load, job);
      const n = Math.min(load.amount, room(b.stock, capacity, load.resource));
      b.stock[load.resource] += n;
      // no room left after all: to a warehouse, else down on the ground
      const rest = load.amount - n - (n < load.amount ? putAway(world, { resource: load.resource, amount: load.amount - n }, x) : 0);
      if (rest > 1e-9) dropOnGround(world, x, { resource: load.resource, amount: rest });
    },
  };
}

/** The goods an animal farm keeps right of its door, in order: what it gives, then meat. */
export function goodsOf(def: BuildingDef): Resource[] {
  const l = def.livestock;
  const all: Array<Resource | undefined> = l ? [l.gives, l.or, 'horse', 'meat'] : [];
  return all.filter((r): r is Resource => !!r && !!def.storage[r]);
}
