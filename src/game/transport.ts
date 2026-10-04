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
// nothing else to do and none of what they need (workshop.ts).
//
// - collect: what lies on the ground by the road (piles.ts) is picked up, a
//   load at a time, and taken where it is needed, else to a warehouse.
// - draw: what is drawn by hand without end (BuildingDef.drawn: a well's
//   water). Whoever comes for water and finds no bucket waiting draws one
//   (WELL_DRAW_SECONDS) and takes it; a serf with no errand to run fills the
//   store of a well close by (WELL_REACH), bucket by bucket.
//
// What someone is on their way to pick up is theirs (reserved): an errand
// runner's load, and a builder's (site.ts), at a store or on a pile. Nobody
// else plans to take it (Free), and room at a store is held for loads on
// their way there. Reservations are not kept anywhere: they are read off the
// tickets of those on their way, so one ends with its errand. Spoilage and
// spending at once (an upgrade's cost with construction off) take what is
// there regardless; whoever then comes finds nothing and goes on to the next.
//
// Errands are planned onto a board (World.errands, saved), and planned anew
// once it is BOARD_SECONDS old, or when it has run empty (at most every
// BOARD_RETRY seconds). A serf takes the nearest one waiting; one taken by
// someone, or gone stale in the meantime (its load gone, the room filled),
// comes off.
//
// Serfs are the village's peasants with no trade (Person.profession 'serf'), hired by the
// transport hub (the oldest warehouse) for as long as there are errands:
// after each errand a serf takes another if one is waiting, and otherwise is
// let go where they stand and strolls again. A serf who is not carrying
// anything is hired away for a lasting job (the mill's miller) before any
// more errands (people.ts). Like builders, serfs work day and night.

import { WELL_DRAW_SECONDS } from './balance';
import { BUILDINGS, needsOf, storageOf } from './buildings';
import { isStore, putAway, storeSpot, tripLoad, warehouses } from './economy';
import { STAND_Y, type Spot } from './layout';
import { employees } from './people';
import { dropOnGround, GROUND_LOAD, pileById, pileSpot, takeFromPile, type Pile } from './piles';
import { RESOURCES, room, type Load, type Resource } from './resources';
import { streetDist } from './streets';
import { currentJob, delivering, type JobTicket, type Workplace } from './worker';
import type { Building, World } from './world';
import { CART_LOAD, carts } from './carts';
import { builderFetch, LOAD_SIZE } from './site';
import { stillAsked } from './castle';
import { marketWants } from './market';

/** Most serfs the village hires at once. */
export const SERFS_MAX = 5;
/** Seconds to lift a load off a store. */
const PICK_UP_TIME = 0.25;
/** How far (px along the streets) a serf with nothing to do goes to fill a well. */
export const WELL_REACH = 300;
/** Seconds the errand board is used before it is planned anew. */
export const BOARD_SECONDS = 1;
/** Seconds an empty board waits before it is planned anew. */
const BOARD_RETRY = 0.25;

/** Where an errand picks its load up: a building's store, or a pile on the ground. */
type Source = Building | Pile;

/** An errand: its ticket (target: the building or pile picked up from, to: the building delivered to). */
export interface Errand {
  job: JobTicket;
  from: Source;
  r: Resource;
}

const shipAction = (r: Resource) => `ship-${r}`;
export const supplyAction = (r: Resource) => `supply-${r}`;
const collectAction = (r: Resource) => `collect-${r}`;
export const drawAction = (r: Resource) => `draw-${r}`;
/** The resource an errand moves, if the action is an errand. */
export function errandResource(action: string): Resource | null {
  return RESOURCES.find((r) => action === shipAction(r) || action === supplyAction(r) || action === collectAction(r) || action === drawAction(r)) ?? null;
}
const isDraw = (action: string) => action.startsWith('draw-');
/** Whether r can be drawn at b by hand (a finished well's water). */
const drawnAt = (b: Building, r: Resource) => b.status === 'done' && BUILDINGS[b.type].drawn?.resource === r;

const isPile = (s: Source): s is Pile => 'resource' in s;
const xOf = (_world: World, s: Source) => (isPile(s) ? s.x : s.x);
const done = (world: World, id: number | undefined) => world.buildings.find((b) => b.id === id && b.status === 'done');
/** What an errand picks up from: the pile for a collect, else a finished building. */
const sourceOf = (world: World, job: JobTicket): Source | undefined => (errandResource(job.action) && job.action.startsWith('collect-') ? pileById(world, job.target) : done(world, job.target));
/** How much of r there is at a source. */
const amountAt = (s: Source, r: Resource) => (isPile(s) ? (s.resource === r ? s.amount : 0) : s.stock[r]);
/** How much of r one person carries from a source at a time. */
const loadAt = (s: Source, r: Resource) => (isPile(s) ? GROUND_LOAD : tripLoad(s, r));
/** Where someone stands to pick up r at a source, relative to fromX. */
const pickSpot = (world: World, s: Source, r: Resource, fromX: number) => (isPile(s) ? pileSpot(s, fromX) : storeSpot(world, s, r, fromX, true));
/** Where someone stands to draw at b, relative to fromX. */
const drawSpot = (b: Building, fromX: number): Spot => {
  const at = BUILDINGS[b.type].drawn!.at;
  return { dx: b.x + at.dx - fromX, y: at.y };
};
/** Where an errand's load is picked up (or drawn), relative to fromX. */
export const errandSpot = (world: World, e: Errand, fromX: number): Spot => (isDraw(e.job.action) && !isPile(e.from) ? drawSpot(e.from, fromX) : pickSpot(world, e.from, e.r, fromX));

/**
 * What a building wants brought now: what it needs (BuildingDef.needs, a
 * house's by its level), the reeve's house what the castle still asks for,
 * the market the village's surplus for the merchant.
 */
export function wantsOf(world: World, b: Building): Resource[] {
  if (b.type === 'reeve') return Object.keys(stillAsked(world)) as Resource[];
  if (b.type === 'market') return marketWants(world);
  return needsOf(b);
}

/** The warehouse that employs the village's serfs: the oldest finished one. */
export function transportHub(world: World): Building | null {
  return warehouses(world).find((b) => b.type === 'warehouse') ?? null;
}

/** An errand (or a builder's fetch) someone is on: r from a source to a building, the amount on its way, and whether it is still to be picked up there. */
interface Underway {
  r: Resource;
  from: number;
  to?: number;
  amount: number;
  /** On the way to pick it up (not to draw it): it is reserved at the source. */
  claims: boolean;
}

/** Errands being run by anyone (serfs, workshop workers), and builders on their way to fetch. */
function underway(world: World): Underway[] {
  const out: Underway[] = [];
  for (const p of world.people) {
    const w = p.job?.worker;
    if (!w) continue;
    const pending = currentJob(w);
    const fetching = pending && builderFetch(pending.action);
    if (pending && fetching) {
      out.push({ r: fetching, from: pending.target, amount: LOAD_SIZE, claims: true });
      continue;
    }
    const r = pending && errandResource(pending.action);
    const from = pending && sourceOf(world, pending);
    if (pending && r && from) out.push({ r, from: from.id, to: pending.to, amount: loadAt(from, r) * (pending.cart ? CART_LOAD : 1), claims: !isDraw(pending.action) });
    const carried = delivering(w);
    const cr = carried && errandResource(carried.action);
    if (carried && cr && w.carrying) out.push({ r: cr, from: carried.target, to: carried.to, amount: w.carrying.amount, claims: false });
  }
  return out;
}

/** What of r in b's store is still free once those on their way have picked theirs up (drawing takes none of it). */
const unclaimed = (runs: Runs, b: Source, r: Resource) => amountAt(b, r) - (runs.claimed.get(`${b.id}|${r}`) ?? 0);
/** Room left in b's store for r once what is on its way (shipped or supplied) has arrived. */
const roomLeft = (runs: Runs, b: Building, r: Resource) => room(b.stock, storageOf(b), r) - (runs.coming.get(`${b.id}|${r}`) ?? 0);

/**
 * The errands underway, tallied once: how much of each thing at each place is
 * reserved by someone on their way to pick it up (drawing reserves none), and
 * how much is on its way to each place; and what each building wants, as
 * asked once. Planning an errand adds to it (note).
 */
interface Runs {
  claimed: Map<string, number>;
  coming: Map<string, number>;
  wants: Map<number, Resource[]>;
}

function tally(world: World): Runs {
  const runs: Runs = { claimed: new Map(), coming: new Map(), wants: new Map() };
  for (const u of underway(world)) note(runs, u);
  return runs;
}

function note(runs: Runs, u: Underway): void {
  const add = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + u.amount);
  if (u.claims) add(runs.claimed, `${u.from}|${u.r}`);
  if (u.to !== undefined) add(runs.coming, `${u.to}|${u.r}`);
}

/** How much of r at a store or pile nobody is on their way to pick up: free for anyone else to take. */
export type Free = (s: Source, r: Resource) => number;
/** What is free at each store and pile now (see Free), tallied once: ask it of as many as needed. */
export function freeNow(world: World): Free {
  const runs = tally(world);
  return (s, r) => Math.max(0, unclaimed(runs, s, r));
}

/** What b wants, asked once for the whole plan. */
function wanted(world: World, runs: Runs, b: Building): Resource[] {
  let w = runs.wants.get(b.id);
  if (!w) {
    w = wantsOf(world, b);
    runs.wants.set(b.id, w);
  }
  return w;
}

/** The nearest place to x with some of r free to take, or to draw: a building that makes it or a warehouse; at equal distance the maker. */
function nearestSource(world: World, runs: Runs, r: Resource, x: number, not: Building): Building | null {
  // (what lies on the ground is collected by serfs, not fetched from)
  const places = world.buildings.filter(
    (b) => b !== not && b.status === 'done' && (isStore(b) || BUILDINGS[b.type].ships?.includes(r)) && (unclaimed(runs, b, r) > 1e-9 || drawnAt(b, r)),
  );
  const d = (b: Building) => streetDist(world, x, xOf(world, b));
  return places.sort((a, b) => d(a) - d(b) || Number(isStore(a)) - Number(isStore(b)))[0] ?? null;
}

/** The errand bringing b some of r, if it has room for it and it can be had somewhere. */
function supplyErrand(world: World, runs: Runs, b: Building, r: Resource): (Errand & { from: Building }) | null {
  if (roomLeft(runs, b, r) <= 1e-9) return null;
  const from = nearestSource(world, runs, r, xOf(world, b), b);
  if (!from) return null;
  // no bucket waiting at the well: draw one
  const action = drawnAt(from, r) && unclaimed(runs, from, r) <= 1e-9 ? drawAction(r) : supplyAction(r);
  return { job: { action, target: from.id, to: b.id }, from, r };
}

/** A well within WELL_REACH of x with room in its store, for a serf with nothing else to do to fill. */
function wellToFill(world: World, x: number): Errand | null {
  const runs = tally(world);
  const near = world.buildings
    .filter((b) => b.status === 'done' && BUILDINGS[b.type].drawn && streetDist(world, x, b.x) <= WELL_REACH)
    .filter((b) => roomLeft(runs, b, BUILDINGS[b.type].drawn!.resource) > 1e-9)
    .sort((a, b) => streetDist(world, x, a.x) - streetDist(world, x, b.x))[0];
  if (!near) return null;
  const r = BUILDINGS[near.type].drawn!.resource;
  return { job: { action: drawAction(r), target: near.id, to: near.id }, from: near, r };
}

/** Carts out with serfs now. */
function cartsInUse(world: World): number {
  return world.people.filter((p) => {
    const w = p.job?.worker;
    return !!w && (!!currentJob(w)?.cart || (!!w.carrying && !!delivering(w)?.cart));
  }).length;
}

/** How far through drawing a bucket someone at well b is (0..1), or null if nobody is drawing there. */
export function drawingAt(world: World, b: Building): number | null {
  for (const p of world.people) {
    const t = p.job?.worker.task;
    if (t?.kind === 'job' && t.job.target === b.id && isDraw(t.job.action)) return Math.min(1, t.t / Math.max(t.duration, 1e-6));
  }
  return null;
}

/** An errand to fetch something b needs, for b's own worker. */
export function fetchFor(world: World, b: Building, r: Resource): (Errand & { from: Building }) | null {
  return supplyErrand(world, tally(world), b, r);
}

/** Where what b makes goes: the nearest building that needs it and has room, else the nearest warehouse with room. */
function shipTo(world: World, runs: Runs, b: Source, r: Resource): Building | null {
  const d = (o: Building) => streetDist(world, xOf(world, b), xOf(world, o));
  const byDistance = (list: Building[]) => list.sort((a, c) => d(a) - d(c))[0] ?? null;
  const users = world.buildings.filter((o) => o !== b && o.status === 'done' && wanted(world, runs, o).includes(r) && roomLeft(runs, o, r) > 1e-9);
  return byDistance(users) ?? byDistance(warehouses(world).filter((w) => roomLeft(runs, w, r) > 1e-9));
}

/** Errands waiting for someone to run them, planned from scratch. */
function planErrands(world: World): Errand[] {
  const runs = tally(world);
  const out: Errand[] = [];
  // each errand planned claims its load and the room it fills, like one being run
  const plan = (e: Errand) => {
    out.push(e);
    const draw = isDraw(e.job.action);
    note(runs, { r: e.r, from: e.from.id, to: e.job.to, amount: draw ? loadAt(e.from, e.r) : Math.min(loadAt(e.from, e.r), unclaimed(runs, e.from, e.r)), claims: !draw });
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
  // what lies on the ground is taken where it is wanted, or put away
  for (const pile of world.piles) {
    while (unclaimed(runs, pile, pile.resource) > 1e-9) {
      const to = shipTo(world, runs, pile, pile.resource);
      if (!to) break;
      plan({ job: { action: collectAction(pile.resource), target: pile.id, to: to.id }, from: pile, r: pile.resource });
    }
  }
  // then what is still needed is fetched from wherever it can be had
  for (const b of finished) {
    for (const r of wanted(world, runs, b)) {
      const e = supplyErrand(world, runs, b, r);
      if (e) plan(e);
    }
  }
  return out;
}

/** The errand board (World.errands): errands planned at world time `at` and not yet taken, as tickets. */
export interface ErrandBoard {
  at: number;
  jobs: JobTicket[];
}

/** A board that has never been planned: it is planned the first time it is looked at. */
export const unplannedBoard = (): ErrandBoard => ({ at: -BOARD_SECONDS, jobs: [] });

/** The board's tickets, planned anew if it is old (or empty for a while). */
function board(world: World): ErrandBoard {
  const b = world.errands;
  const age = world.time - b.at;
  if (age >= 0 && age < BOARD_SECONDS && (b.jobs.length > 0 || age < BOARD_RETRY)) return b;
  world.errands = { at: world.time, jobs: planErrands(world).map((e) => e.job) };
  return world.errands;
}

/**
 * The errands on the board still waiting, given those being run now: each
 * one's load still free to take (counting the ones before it), and room for
 * it where it goes. The rest (taken by someone, or gone stale) come off.
 */
function waiting(world: World): Errand[] {
  const b = board(world);
  const runs = tally(world);
  const out: Errand[] = [];
  b.jobs = b.jobs.filter((job) => {
    const r = errandResource(job.action);
    const from = sourceOf(world, job);
    const to = done(world, job.to);
    const draw = isDraw(job.action);
    if (!r || !from || !to || (!draw && unclaimed(runs, from, r) <= 1e-9) || roomLeft(runs, to, r) <= 1e-9) return false;
    note(runs, { r, from: from.id, to: to.id, amount: draw ? loadAt(from, r) : Math.min(loadAt(from, r), unclaimed(runs, from, r)), claims: !draw });
    out.push({ job, from, r });
    return true;
  });
  return out;
}

/** The waiting errand nearest x (a serf takes it by setting off: their ticket reserves its load). */
function nearestErrand(world: World, x: number): Errand | null {
  const far = (e: Errand) => streetDist(world, x, xOf(world, e.from));
  let best: Errand | null = null;
  for (const e of waiting(world)) if (!best || far(e) < far(best)) best = e;
  return best;
}

/** Serf jobs the hub offers now: one per errand serfs are running or that is waiting, up to SERFS_MAX. */
export function serfPositions(world: World): number {
  const hub = transportHub(world);
  const serfs = hub ? employees(world, hub).map((p) => p.job!.worker) : [];
  const running = serfs.filter((w) => currentJob(w) || delivering(w)).length;
  return Math.min(SERFS_MAX, running + waiting(world).length);
}

/**
 * How anyone runs an errand, for a workplace centred on x: where to pick the
 * load up, picking it up, and where it goes down. Workplaces that run errands
 * pass their errand tickets on to these.
 */
export function errandWork(world: World, x: number): Pick<Workplace, 'jobSpot' | 'begin' | 'finish' | 'dropSpot' | 'deliver'> {
  /**
   * Where a load from this errand goes: its destination, else any warehouse
   * with room, else back where it came from (what came off the ground is put
   * down on the ground here, by the workplace, instead).
   */
  const destination = (job: JobTicket, r: Resource): Building | null => {
    const to = done(world, job.to);
    if (to && room(to.stock, storageOf(to), r) > 0) return to;
    return warehouses(world).find((w) => room(w.stock, storageOf(w), r) > 0) ?? done(world, job.target) ?? null;
  };
  return {
    jobSpot(job): Spot | null {
      const r = errandResource(job.action);
      const from = sourceOf(world, job);
      if (r && from && isDraw(job.action) && !isPile(from)) return drawSpot(from, x);
      return r && from && amountAt(from, r) > 0 ? pickSpot(world, from, r, x) : null;
    },
    begin(job) {
      const r = errandResource(job.action);
      const from = sourceOf(world, job);
      if (r && from && isDraw(job.action)) return WELL_DRAW_SECONDS;
      return r && from && amountAt(from, r) > 1e-9 ? PICK_UP_TIME : null;
    },
    finish(job): Load | null {
      const r = errandResource(job.action);
      const from = sourceOf(world, job);
      if (!r || !from) return null;
      // drawn: a bucket from the well itself, its store untouched
      if (isDraw(job.action)) return { resource: r, amount: loadAt(from, r) };
      const to = done(world, job.to);
      // a supply takes only what the store it goes to has room for
      const fits = job.action === supplyAction(r) && to ? room(to.stock, storageOf(to), r) : Infinity;
      // a serf with a cart takes several
      const n = Math.min(loadAt(from, r) * (job.cart ? CART_LOAD : 1), amountAt(from, r), fits);
      if (n <= 0) return null;
      if (isPile(from)) takeFromPile(world, from, n);
      else from.stock[r] -= n;
      return { resource: r, amount: n };
    },
    dropSpot(job, load) {
      const to = destination(job, load.resource);
      return to ? storeSpot(world, to, load.resource, x, false, load.amount) : { dx: 0, y: STAND_Y };
    },
    deliver(load, job) {
      const to = destination(job, load.resource);
      const n = to ? Math.min(load.amount, room(to.stock, storageOf(to), load.resource)) : 0;
      if (to) to.stock[load.resource] += n;
      // it filled up at the last moment: the rest goes to a warehouse with room, else down on the ground here
      const rest = load.amount - n - (n < load.amount ? putAway(world, { resource: load.resource, amount: load.amount - n }, x) : 0);
      if (rest > 1e-9) dropOnGround(world, x, { resource: load.resource, amount: rest });
    },
  };
}

/** The transport hub as a workplace for its serfs. */
export function transportWorkplace(world: World, hub: Building): Workplace {
  const x = xOf(world, hub);
  return {
    dayLabour: true,
    allHours: true,
    temporary: true,
    door: { dx: 0, y: STAND_Y },
    nextJob(w) {
      // an errand if there is one; with none, fill a well close by
      const next = nearestErrand(world, x + w.dx) ?? wellToFill(world, x + w.dx);
      if (!next) return null;
      // a cart for it if one is free in a stable (carts.ts), not for drawing water
      const job = !isDraw(next.job.action) && cartsInUse(world) < carts(world) ? { ...next.job, cart: true as const } : next.job;
      return { job, ...errandSpot(world, next, x) };
    },
    ...errandWork(world, x),
  };
}
