// Construction sites. A building placed with construction on starts as a site:
// its cost (BuildingDef.cost) must be brought over from a warehouse, a load at
// a time, and then built with. The site hires idle villagers as builders (day
// labour: no lunch break, let go at nightfall, hired again in the morning).
//
// Materials always lie somewhere: a builder takes a load off a warehouse's
// stack, carries it to the site and lays it on the site's pile (siteSlot),
// each log and block in its own place. To build, a builder takes a load off
// that pile, carries it to a spot along the front of the building, puts it in
// place there and works it in.
//
// A builder's next job, in order: build, if the materials put in place allow
// more progress than is done; else carry a load from the pile to the
// building; else fetch a load of whatever is still needed from the nearest
// warehouse that has it; else wait at the site. Progress can never run ahead
// of the materials: with half the cost in place, the building gets at most
// half built.

import { BUILDINGS } from './buildings';
import { takeOut, warehouseSpot, warehouseWith } from './economy';
import { pileItems, siteSlot, STAND_Y, type Spot } from './layout';
import { employees } from './people';
import { RESOURCES, stockOf, total, type Amounts, type Load, type Resource, type Stock } from './resources';
import { currentJob, delivering, type JobTicket, type Workplace } from './worker';
import type { Building, World } from './world';

/** Builders a site employs at once. */
export const BUILDERS_PER_SITE = 5;
/** How much one builder carries per trip. */
export const LOAD_SIZE = 10;
/** Seconds of labour per build job; a building needs its buildTime of labour in all. */
export const BUILD_CHUNK = 2;
/** Seconds to load up at the warehouse. */
const LOADING_TIME = 1.5;
/** Seconds to lift a load off the site's pile. */
const PICK_UP_TIME = 0.8;

/** A building under construction: where its materials have got to. */
export interface Site {
  /** Brought to the site's pile so far. */
  delivered: Stock;
  /** Taken off the pile by builders (in their arms on the way, or in place). */
  taken: Stock;
  /** Put in place at the building, to be built in. */
  placed: Stock;
}

/** A new site; `ready` materials (a free building's) lie on its pile already. */
export function createSite(ready: Amounts = {}): Site {
  return { delivered: stockOf(ready), taken: stockOf(), placed: stockOf() };
}

const FRONT: Spot = { dx: 0, y: STAND_Y };
type Material = 'wood' | 'stone';
const MATERIALS: readonly Material[] = ['wood', 'stone'];
const fetchAction = (r: Resource) => `fetch-${r}`;
const takeAction = (r: Resource) => `take-${r}`;
const fetchedResource = (action: string) => RESOURCES.find((r) => action === fetchAction(r)) ?? null;
const takenResource = (action: string) => MATERIALS.find((r) => action === takeAction(r)) ?? null;

/** What lies on the site's pile: delivered, and not yet taken off it. */
function pile(b: Building): Stock {
  const out = stockOf();
  if (b.site) for (const r of RESOURCES) out[r] = Math.max(0, b.site.delivered[r] - b.site.taken[r]);
  return out;
}

/** Where a builder stands at item i of the site's pile of r. */
function pileSpot(b: Building, r: Material, i: number): Spot {
  return { dx: siteSlot(BUILDINGS[b.type].width, r, i).dx, y: STAND_Y };
}

/** Spots along the front of the building where builders put materials in place and work. */
function workSpots(b: Building): number[] {
  const w = BUILDINGS[b.type].width;
  const n = Math.max(2, Math.floor(w / 45));
  return Array.from({ length: n }, (_, k) => -w / 2 + ((k + 0.5) * w) / n);
}

/**
 * Materials the site still needs fetched from a warehouse: its cost, less what
 * is delivered, carried by its builders, or about to be picked up by one.
 */
export function stillNeeded(world: World, b: Building): Amounts {
  if (!b.site) return {};
  const { carried, fetching } = underway(world, b);
  const need: Amounts = {};
  for (const r of RESOURCES) {
    const n = lacking(b, r) - carried[r] - fetching[r] * LOAD_SIZE;
    if (n > 0) need[r] = n;
  }
  return need;
}

/** Materials the site will still take out of a warehouse: its cost, less what is delivered or being carried. */
export function owed(world: World, b: Building): Amounts {
  if (!b.site) return {};
  const { carried } = underway(world, b);
  const out: Amounts = {};
  for (const r of RESOURCES) {
    const n = lacking(b, r) - carried[r];
    if (n > 0) out[r] = n;
  }
  return out;
}

/** Cost not yet delivered. */
function lacking(b: Building, r: Resource): number {
  return (BUILDINGS[b.type].cost[r] ?? 0) - (b.site?.delivered[r] ?? 0);
}

/** Materials on their way from warehouses: carried by the site's builders, and builders heading out to fetch. */
function underway(world: World, b: Building): { carried: Stock; fetching: Stock } {
  const carried = stockOf();
  const fetching = stockOf();
  for (const p of employees(world, b)) {
    const w = p.job!.worker;
    if (w.carrying && fetchedResource(delivering(w)?.action ?? '')) carried[w.carrying.resource] += w.carrying.amount;
    const r = fetchedResource(currentJob(w)?.action ?? '');
    if (r) fetching[r] += 1;
  }
  return { carried, fetching };
}

/** Materials lying on the site's pile, for display. */
export function onSite(b: Building): Amounts {
  if (!b.site) return {};
  const p = pile(b);
  const out: Amounts = {};
  for (const r of RESOURCES) if (p[r] > 0.01) out[r] = p[r];
  return out;
}

/** How far the materials put in place allow the building to get (0..1). */
export function materialsAllow(b: Building): number {
  const cost = total(BUILDINGS[b.type].cost);
  return !b.site || cost <= 0 ? 1 : Math.min(1, total(b.site.placed) / cost);
}

/** A construction site as a workplace for its builders. */
export function siteWorkplace(world: World, b: Building, buildSpeed: number): Workplace {
  const site = b.site!;
  const x = world.plots[b.plotIndex].x;
  const cost = BUILDINGS[b.type].cost;
  const step = (BUILD_CHUNK * buildSpeed) / BUILDINGS[b.type].buildTime;
  const spots = workSpots(b);
  const warehouse = (id: number) => world.buildings.find((o) => o.id === id && o.type === 'warehouse' && o.status === 'done');
  return {
    dayLabour: true,
    door: FRONT,
    nextJob(w, taken: JobTicket[]) {
      /** The free work spot nearest the worker, not one in `busy`. */
      const spotFor = (busy: Set<number>) => {
        let best = -1;
        spots.forEach((dx, i) => {
          if (!busy.has(i) && (best < 0 || Math.abs(dx - w.dx) < Math.abs(spots[best] - w.dx))) best = i;
        });
        return best;
      };
      const builds = taken.filter((j) => j.action === 'build');
      if (b.progress + builds.length * step < materialsAllow(b) - 1e-9) {
        const slot = spotFor(new Set(builds.map((j) => j.target)));
        if (slot >= 0) return { job: { action: 'build', target: slot }, dx: spots[slot], y: FRONT.y };
      }
      // carry a load from the pile to the building: the material least in place first
      const onPile = pile(b);
      const takers = (r: Material) => taken.filter((j) => j.action === takeAction(r)).length;
      const share = (r: Material) => site.placed[r] / (cost[r] ?? 1);
      for (const r of [...MATERIALS].sort((p, q) => share(p) - share(q))) {
        const left = onPile[r] - takers(r) * LOAD_SIZE;
        if (left <= 1e-9) continue;
        const busy = new Set(taken.filter((j) => j.action === 'build' || takenResource(j.action)).map((j) => j.target));
        const slot = Math.max(0, spotFor(busy));
        return { job: { action: takeAction(r), target: slot }, ...pileSpot(b, r, pileItems(left) - 1) };
      }
      const need = stillNeeded(world, b);
      for (const r of RESOURCES) {
        if (!need[r]) continue;
        const wh = warehouseWith(world, r, x + w.dx);
        if (wh) return { job: { action: fetchAction(r), target: wh.id }, ...warehouseSpot(world, wh, r, x, true) };
      }
      return null; // nothing to build with, and nothing to fetch: wait
    },
    jobSpot(job) {
      const t = takenResource(job.action);
      if (t) return pileSpot(b, t, pileItems(pile(b)[t]) - 1);
      const r = fetchedResource(job.action);
      const wh = r && warehouse(job.target);
      return r && wh ? warehouseSpot(world, wh, r, x, true) : null;
    },
    begin(job) {
      if (job.action === 'build') return b.progress < materialsAllow(b) ? BUILD_CHUNK : null;
      const t = takenResource(job.action);
      if (t) return pile(b)[t] > 1e-9 ? PICK_UP_TIME : null;
      const r = fetchedResource(job.action);
      const wh = warehouse(job.target);
      return r && wh && wh.stock[r] > 0 ? LOADING_TIME : null;
    },
    finish(job): Load | null {
      if (job.action === 'build') {
        b.progress = Math.min(materialsAllow(b), b.progress + step);
        return null;
      }
      const t = takenResource(job.action);
      if (t) {
        const amount = Math.min(LOAD_SIZE, pile(b)[t]);
        site.taken[t] += amount;
        return amount > 0 ? { resource: t, amount } : null;
      }
      const r = fetchedResource(job.action);
      const wh = warehouse(job.target);
      if (!r || !wh) return null;
      // never take more than the site still lacks, after what the others are bringing
      const { carried, fetching } = underway(world, b);
      const lacks = lacking(b, r) - carried[r] - (fetching[r] - 1) * LOAD_SIZE;
      const amount = takeOut(wh, r, Math.min(LOAD_SIZE, Math.max(0, lacks)));
      return amount > 0 ? { resource: r, amount } : null;
    },
    dropSpot(job, load) {
      // a load off the pile goes to the work spot the builder will build at
      if (takenResource(job.action)) return { dx: spots[job.target] ?? 0, y: FRONT.y };
      const r = load.resource === 'stone' ? 'stone' : 'wood';
      return pileSpot(b, r, pileItems(pile(b)[r] + load.amount) - 1);
    },
    deliver(load, job) {
      if (takenResource(job.action)) site.placed[load.resource] += load.amount;
      else site.delivered[load.resource] += load.amount;
    },
  };
}
