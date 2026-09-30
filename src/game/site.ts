// Construction sites. A building placed with construction on starts as a site:
// its cost (BuildingDef.cost) must be brought over from a warehouse, a load at
// a time, and then built with. The site hires idle villagers as builders (day
// labour: no lunch break, let go at nightfall, hired again in the morning).
//
// Materials always lie somewhere. A builder takes a load off a warehouse's
// stack and carries it straight to a work spot along the front of the
// building, where it is laid down beside them (`laid`); they then build with
// what lies at that spot, using it up as the work goes on. Materials a site
// starts with (a free building's) lie on a pile at its side (siteSlot), and
// builders carry them from there to a work spot first.
//
// A builder's next job, in order: build at a spot where materials lie; else
// carry a load from the pile to a spot; else fetch a load of whatever is
// still needed from the nearest place that has it (a warehouse, or the
// woodcutter's or stonecutter's hut itself: economy.ts materialSource).
// A site hires only as many builders as it has work for (builderPositions),
// and a builder with nothing to do and nothing in hand is let go where they
// stand, rather than walking over to the site to wait there.
// Progress is the share of the cost built in, so it can never run ahead of
// the materials.
//
// An upgrade (BuildingDef.upgrade) is built the same way, as a site on the
// finished building: its builders work alongside the building's own workers.

import { BUILDINGS } from './buildings';
import { materialSource, storeSpot, takeOut } from './economy';
import { pileItems, siteSlot, SPOT_PILE_DX, STAND_Y, type Spot } from './layout';
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
/** Seconds to load up at a warehouse or hut. */
const LOADING_TIME = 0.4;
/** Seconds to lift a load off the site's pile. */
const PICK_UP_TIME = 0.25;

/** A building under construction: where its materials have got to. */
export interface Site {
  /** Everything brought to the site so far (to the pile or to a work spot). */
  delivered: Stock;
  /** Lying on the pile at the side of the site. */
  pile: Stock;
  /** Lying at each work spot (see workSpots), not yet built in. */
  laid: Stock[];
}

/** An upgrade being built on a finished building. */
export function upgrading(b: Building): boolean {
  return !!b.site && b.status === 'done';
}

/** What a site builds: the building itself, or (on a finished building) its upgrade. */
export function siteWork(b: Building): { cost: Amounts; buildTime: number } {
  const def = BUILDINGS[b.type];
  return b.status === 'done' && def.upgrade ? def.upgrade : def;
}

/** The builders working at a site (a building being upgraded has its own workers too). */
export function builders(world: World, b: Building) {
  return employees(world, b).filter((p) => p.job!.role === 'builder');
}

/** A new site for a building of this type; `ready` materials (a free building's) lie on its pile already. */
export function createSite(type: Building['type'], ready: Amounts = {}): Site {
  return { delivered: stockOf(ready), pile: stockOf(ready), laid: workSpots(type).map(() => stockOf()) };
}

const FRONT: Spot = { dx: 0, y: STAND_Y };
type Material = 'wood' | 'stone';
const MATERIALS: readonly Material[] = ['wood', 'stone'];
const fetchAction = (r: Resource) => `fetch-${r}`;
const takeAction = (r: Resource) => `take-${r}`;
const fetchedResource = (action: string) => RESOURCES.find((r) => action === fetchAction(r)) ?? null;
const takenResource = (action: string) => MATERIALS.find((r) => action === takeAction(r)) ?? null;

/** Where builders stand along the front of the building (dx), to lay materials down and build. */
export function workSpots(type: Building['type']): number[] {
  const w = BUILDINGS[type].width;
  const n = Math.max(3, Math.floor(w / 30));
  return Array.from({ length: n }, (_, k) => -w / 2 + ((k + 0.5) * w) / n);
}

/** Materials lying at the work spots, each at its place beside the spot (for display). */
export function laidOut(b: Building): Array<{ dx: number; amounts: Stock }> {
  if (!b.site) return [];
  const spots = workSpots(b.type);
  return b.site.laid.map((amounts, k) => ({ dx: (spots[k] ?? 0) + SPOT_PILE_DX, amounts }));
}

/** Where a builder stands at item i of the site's pile of r. */
function pileSpot(b: Building, r: Material, i: number): Spot {
  return { dx: siteSlot(BUILDINGS[b.type].width, r, i).dx, y: STAND_Y };
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
  return (siteWork(b).cost[r] ?? 0) - (b.site?.delivered[r] ?? 0);
}

/** Materials on their way from warehouses and huts: carried by the site's builders, and builders heading out to fetch. */
function underway(world: World, b: Building): { carried: Stock; fetching: Stock } {
  const carried = stockOf();
  const fetching = stockOf();
  for (const p of builders(world, b)) {
    const w = p.job!.worker;
    if (w.carrying && fetchedResource(delivering(w)?.action ?? '')) carried[w.carrying.resource] += w.carrying.amount;
    const r = fetchedResource(currentJob(w)?.action ?? '');
    if (r) fetching[r] += 1;
  }
  return { carried, fetching };
}

/**
 * Builders the site has work for now (up to BUILDERS_PER_SITE): those busy
 * there, and one for each job waiting: a spot with materials lying there to
 * build with, a load on the pile, a load still to fetch from somewhere that has it.
 */
export function builderPositions(world: World, b: Building): number {
  const site = b.site;
  if (!site) return 0;
  const busy = builders(world, b).map((p) => p.job!.worker).filter((w) => currentJob(w) || w.carrying);
  const taken = busy.flatMap((w) => currentJob(w) ?? []);
  const building = new Set(taken.filter((j) => j.action === 'build').map((j) => j.target));
  const loads = (n: number) => Math.max(0, Math.ceil(n / LOAD_SIZE - 1e-9));
  let waiting = site.laid.filter((s, k) => total(s) > 1e-9 && !building.has(k)).length;
  for (const r of MATERIALS) waiting += loads(site.pile[r] - taken.filter((j) => j.action === takeAction(r)).length * LOAD_SIZE);
  const need = stillNeeded(world, b);
  const x = world.plots[b.plotIndex].x;
  for (const r of RESOURCES) if (need[r] && materialSource(world, r, x)) waiting += loads(need[r]);
  return Math.min(BUILDERS_PER_SITE, busy.length + waiting);
}

/** Materials lying on the site's pile, for display. */
export function onSite(b: Building): Amounts {
  if (!b.site) return {};
  const out: Amounts = {};
  for (const r of RESOURCES) if (b.site.pile[r] > 0.01) out[r] = b.site.pile[r];
  return out;
}

/** How far the materials brought to the site allow the building to get (0..1). */
export function materialsAllow(b: Building): number {
  const cost = total(siteWork(b).cost);
  return !b.site || cost <= 0 ? 1 : Math.min(1, total(b.site.delivered) / cost);
}

/** A construction site as a workplace for its builders. */
export function siteWorkplace(world: World, b: Building, buildSpeed: number): Workplace {
  const site = b.site!;
  const x = world.plots[b.plotIndex].x;
  const work = siteWork(b);
  const costTotal = total(work.cost);
  /** Materials one build job works in. */
  const perJob = (BUILD_CHUNK * buildSpeed * costTotal) / work.buildTime;
  const spots = workSpots(b.type);
  /** Where a fetch job takes its load from: a warehouse or a hut's store. */
  const source = (id: number) => world.buildings.find((o) => o.id === id && o.status === 'done');
  const laidAt = (k: number) => total(site.laid[k] ?? {});
  return {
    dayLabour: true,
    // nothing to build with and nothing to fetch: let go, rather than wait at the site
    temporary: true,
    door: FRONT,
    nextJob(w, taken: JobTicket[]) {
      // build where materials lie and nobody else is building: the nearest such spot
      const building = new Set(taken.filter((j) => j.action === 'build').map((j) => j.target));
      let best = -1;
      spots.forEach((dx, k) => {
        if (laidAt(k) > 1e-9 && !building.has(k) && (best < 0 || Math.abs(dx - w.dx) < Math.abs(spots[best] - w.dx))) best = k;
      });
      if (best >= 0) return { job: { action: 'build', target: best }, dx: spots[best], y: FRONT.y };

      /** The spot to bring a load to: the one with least lying there and on its way (then nearest the worker). */
      const incoming = spots.map(() => 0);
      for (const j of taken) if (j.slot !== undefined && (fetchedResource(j.action) || takenResource(j.action))) incoming[j.slot] = (incoming[j.slot] ?? 0) + LOAD_SIZE;
      const target = () => {
        let k = 0;
        const load = (i: number) => laidAt(i) + incoming[i] + (building.has(i) ? LOAD_SIZE / 2 : 0);
        spots.forEach((dx, i) => {
          if (load(i) < load(k) - 1e-9 || (Math.abs(load(i) - load(k)) <= 1e-9 && Math.abs(dx - w.dx) < Math.abs(spots[k] - w.dx))) k = i;
        });
        return k;
      };

      // a load from the pile (a site's starting materials)
      for (const r of MATERIALS) {
        const left = site.pile[r] - taken.filter((j) => j.action === takeAction(r)).length * LOAD_SIZE;
        if (left > 1e-9) return { job: { action: takeAction(r), target: 0, slot: target() }, ...pileSpot(b, r, pileItems(left) - 1) };
      }
      const need = stillNeeded(world, b);
      for (const r of RESOURCES) {
        if (!need[r]) continue;
        const from = materialSource(world, r, x + w.dx);
        if (from) return { job: { action: fetchAction(r), target: from.id, slot: target() }, ...storeSpot(world, from, r, x, true) };
      }
      return null; // nothing to build with, and nothing to fetch
    },
    jobSpot(job) {
      const t = takenResource(job.action);
      if (t) return pileSpot(b, t, pileItems(site.pile[t]) - 1);
      const r = fetchedResource(job.action);
      const from = r && source(job.target);
      return r && from ? storeSpot(world, from, r, x, true) : null;
    },
    begin(job) {
      if (job.action === 'build') return laidAt(job.target) > 1e-9 ? BUILD_CHUNK : null;
      const t = takenResource(job.action);
      if (t) return site.pile[t] > 1e-9 ? PICK_UP_TIME : null;
      const r = fetchedResource(job.action);
      const from = source(job.target);
      return r && from && from.stock[r] > 0 ? LOADING_TIME : null;
    },
    finish(job): Load | null {
      if (job.action === 'build') {
        // work in what lies at this spot, a share of each material
        const here = site.laid[job.target];
        const have = laidAt(job.target);
        if (!here || have <= 0) return null;
        const use = Math.min(have, perJob);
        for (const r of RESOURCES) here[r] -= (here[r] * use) / have;
        b.progress = Math.min(1, b.progress + use / costTotal);
        // everything brought has been built in: done (no rounding left over)
        const left = total(site.pile) + site.laid.reduce((n, s) => n + total(s), 0);
        if (materialsAllow(b) >= 1 && left < 1e-6) b.progress = 1;
        return null;
      }
      const t = takenResource(job.action);
      if (t) {
        const amount = Math.min(LOAD_SIZE, site.pile[t]);
        site.pile[t] -= amount;
        return amount > 0 ? { resource: t, amount } : null;
      }
      const r = fetchedResource(job.action);
      const from = source(job.target);
      if (!r || !from) return null;
      // never take more than the site still lacks, after what the others are bringing
      const { carried, fetching } = underway(world, b);
      const lacks = lacking(b, r) - carried[r] - (fetching[r] - 1) * LOAD_SIZE;
      const amount = takeOut(from, r, Math.min(LOAD_SIZE, Math.max(0, lacks)));
      return amount > 0 ? { resource: r, amount } : null;
    },
    dropSpot(job) {
      // laid down at the work spot the builder will build from
      return { dx: spots[job.slot ?? 0] ?? 0, y: FRONT.y };
    },
    deliver(load, job) {
      const k = Math.max(0, Math.min(spots.length - 1, job.slot ?? 0));
      site.laid[k][load.resource] += load.amount;
      if (fetchedResource(job.action)) site.delivered[load.resource] += load.amount;
    },
  };
}
