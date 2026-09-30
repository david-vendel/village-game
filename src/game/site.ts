// Construction sites. A building placed with construction on starts as a site:
// its cost (BuildingDef.cost) must be brought over from a warehouse, a load at
// a time, and then built with. The site hires idle villagers as builders (day
// labour: no lunch break, let go at nightfall, hired again in the morning).
//
// A builder's next job, in order: build, if the materials delivered so far
// allow more progress than is done; else fetch a load of whatever is still
// needed from the nearest warehouse that has it; else wait at the site.
// Progress can never run ahead of the materials: with half the cost
// delivered, the building gets at most half built.

import { BUILDINGS } from './buildings';
import { takeOut, warehouseWith } from './economy';
import { BASE_Y } from './layout';
import { employees } from './people';
import { RESOURCES, stockOf, total, type Amounts, type Load, type Resource, type Stock } from './resources';
import { currentJob, type JobTicket, type Workplace } from './worker';
import type { Building, World } from './world';

/** Builders a site employs at once. */
export const BUILDERS_PER_SITE = 2;
/** How much one builder carries per trip. */
export const LOAD_SIZE = 10;
/** Seconds of labour per build job; a building needs its buildTime of labour in all. */
export const BUILD_CHUNK = 2;
/** Seconds to load up at the warehouse. */
const LOADING_TIME = 1.5;

/** A building under construction: the materials brought to it so far. */
export interface Site {
  delivered: Stock;
}

export function createSite(delivered: Amounts = {}): Site {
  return { delivered: stockOf(delivered) };
}

const FRONT = { dx: 0, y: BASE_Y + 3 };
const fetchAction = (r: Resource) => `fetch-${r}`;
const fetchedResource = (action: string) => RESOURCES.find((r) => action === fetchAction(r)) ?? null;

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

/** Materials on their way: carried by the site's builders, and builders heading out to fetch. */
function underway(world: World, b: Building): { carried: Stock; fetching: Stock } {
  const carried = stockOf();
  const fetching = stockOf();
  for (const p of employees(world, b)) {
    const w = p.job!.worker;
    if (w.carrying) carried[w.carrying.resource] += w.carrying.amount;
    const r = fetchedResource(currentJob(w)?.action ?? '');
    if (r) fetching[r] += 1;
  }
  return { carried, fetching };
}

/** Materials lying on the site: delivered, and not yet built into it (in proportion to progress). */
export function onSite(b: Building): Amounts {
  if (!b.site) return {};
  const cost = BUILDINGS[b.type].cost;
  const out: Amounts = {};
  for (const r of RESOURCES) {
    const n = b.site.delivered[r] - b.progress * (cost[r] ?? 0);
    if (n > 0.01) out[r] = n;
  }
  return out;
}

/** How far the delivered materials allow the building to get (0..1). */
export function materialsAllow(b: Building): number {
  const cost = total(BUILDINGS[b.type].cost);
  return !b.site || cost <= 0 ? 1 : Math.min(1, total(b.site.delivered) / cost);
}

/** A construction site as a workplace for its builders. */
export function siteWorkplace(world: World, b: Building, buildSpeed: number): Workplace {
  const site = b.site!;
  const x = world.plots[b.plotIndex].x;
  const step = (BUILD_CHUNK * buildSpeed) / BUILDINGS[b.type].buildTime;
  return {
    dayLabour: true,
    door: FRONT,
    store: FRONT,
    nextJob(w, taken: JobTicket[]) {
      const building = taken.filter((j) => j.action === 'build').length;
      if (b.progress + building * step < materialsAllow(b) - 1e-9) {
        // builders spread out along the front of the site
        const slot = building % 2;
        return { job: { action: 'build', target: slot }, dx: slot ? 22 : -22, y: FRONT.y };
      }
      const need = stillNeeded(world, b);
      for (const r of RESOURCES) {
        if (!need[r]) continue;
        const wh = warehouseWith(world, r, x + w.dx);
        if (wh) return { job: { action: fetchAction(r), target: wh.id }, dx: world.plots[wh.plotIndex].x - x, y: FRONT.y };
      }
      return null; // nothing to build with, and nothing to fetch: wait
    },
    begin(job) {
      if (job.action === 'build') return b.progress < materialsAllow(b) ? BUILD_CHUNK : null;
      const r = fetchedResource(job.action);
      const wh = world.buildings.find((o) => o.id === job.target);
      return r && wh && wh.stock[r] > 0 ? LOADING_TIME : null;
    },
    finish(job): Load | null {
      if (job.action === 'build') {
        b.progress = Math.min(materialsAllow(b), b.progress + step);
        return null;
      }
      const r = fetchedResource(job.action);
      const wh = world.buildings.find((o) => o.id === job.target);
      if (!r || !wh) return null;
      // never take more than the site still lacks, after what the others are bringing
      const { carried, fetching } = underway(world, b);
      const lacks = lacking(b, r) - carried[r] - (fetching[r] - 1) * LOAD_SIZE;
      const amount = takeOut(wh, r, Math.min(LOAD_SIZE, Math.max(0, lacks)));
      return amount > 0 ? { resource: r, amount } : null;
    },
    deliver(load) {
      site.delivered[load.resource] += load.amount;
    },
  };
}
