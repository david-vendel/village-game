// Farm: the farm-specific part of a farm building. It owns the fields: their
// plots, crops and growth, and which land they lie on (from the land grid, see
// land.ts; plots fill free cells around the farmstead and change when a
// neighbour builds). It is also a workplace (worker.ts): farmers sow fallow
// plots and harvest ripe ones, and stack each sheaf in its own place in the
// farm's store (the building's stock, see SHEAF_SLOTS), from where serfs
// carry them to a warehouse (transport.ts). A field grows wheat (a sheaf of
// grain) or meadow grass (a bale of hay): each sowing the farmer picks the
// crop the store is shorter of, counting what is already growing. Everything
// else about a farmer's day is the generic worker routine.
import { BUILDINGS } from './buildings';
import { CELL_W, FIELD_ROWS, HAY_SLOTS, HOME, SHEAF_SLOTS, STAND_Y, workY, type FieldZone, type Spot } from './layout';
import { room, type Load, type Stock } from './resources';
import { currentJob, retarget, type JobTicket, type Worker, type Workplace } from './worker';

export type { FieldZone };
export type PlotState = 'fallow' | 'growing' | 'ripe';
/** What a field grows: wheat, harvested as a sheaf of grain, or meadow grass, as a bale of hay. */
export type Crop = 'grain' | 'hay';
export const CROPS: readonly Crop[] = ['grain', 'hay'];

/** Where a field plot lies: zone, row in it (0 = far; see FIELD_ROWS), centre x relative to the farm's centre, width. */
export interface FieldSpot {
  zone: FieldZone;
  row: number;
  dx: number;
  width: number;
}

export interface FieldPlot extends FieldSpot {
  /**
   * Broken in as a field: the farmer has worked it at least once. Until then it
   * is plain grass. Borrowed land goes back to grass after each harvest.
   */
  tilled: boolean;
  state: PlotState;
  /** What it grows (or last grew). */
  crop: Crop;
  /** Seconds since sowing (only meaningful while growing / ripe). */
  age: number;
}

export type FarmAction = 'sow' | 'harvest';

/** Where the farmer stands to put down or pick up sheaf number i of the store (0 = first stacked). */
export function sheafSpot(i: number): Spot {
  return { dx: SHEAF_SLOTS[Math.max(0, Math.min(i, SHEAF_SLOTS.length - 1))].dx, y: STAND_Y };
}

export interface FarmState {
  plots: FieldPlot[];
}

export const GROW_TIME = 150; // s from sowing to ripe
/**
 * How long work takes, per grid cell of plot width (s), so a plot's work time
 * is in proportion to its size. Live-tunable: the world passes its params in.
 */
export interface FarmWork {
  sowPerCell: number;
  harvestPerCell: number;
}
export const DEFAULT_WORK: FarmWork = { sowPerCell: 2, harvestPerCell: 3 };

/**
 * Fields for a farm with nothing around it (menu previews): a block of cells
 * either side of the farmstead behind the road, and a row of them in front.
 */
export function openFieldSpots(): FieldSpot[] {
  const spots: FieldSpot[] = [];
  for (const zone of ['back', 'front'] as const) {
    FIELD_ROWS[zone].forEach((_, row) => {
      const cells = zone === 'back' ? [-5, -4, -3, 2, 3, 4] : [-4, -3, -2, -1, 0, 1, 2, 3];
      for (const c of cells) spots.push({ zone, row, dx: (c + 0.5) * CELL_W, width: CELL_W });
    });
  }
  return spots;
}

/** Width (px) two plots of the same zone share. */
function overlap(a: FieldSpot, b: FieldSpot): number {
  if (a.zone !== b.zone || a.row !== b.row) return 0;
  return Math.max(0, Math.min(a.dx + a.width / 2, b.dx + b.width / 2) - Math.max(a.dx - a.width / 2, b.dx - b.width / 2));
}

/**
 * Re-lay the fields on new land. Each new plot keeps the crop of the old plot
 * it overlaps most, so a plot trimmed by a neighbour's new building keeps
 * growing on the land that is left; plots on new land start fallow. A farmer
 * heading to or working a plot that is gone walks home.
 */
export function setFieldSpots(farm: FarmState, spots: FieldSpot[], workers: Worker[] = []): void {
  const taken = new Set<FieldPlot>();
  /** old plot → the new plot that carries on its crop */
  const successor = new Map<FieldPlot, FieldPlot>();
  const plots = spots.map((s): FieldPlot => {
    let from: FieldPlot | null = null;
    for (const p of farm.plots) {
      if (!taken.has(p) && overlap(p, s) > 0 && (!from || overlap(p, s) > overlap(from, s))) from = p;
    }
    const plot: FieldPlot = { ...s, tilled: from?.tilled ?? false, state: from?.state ?? 'fallow', crop: from?.crop ?? 'grain', age: from?.age ?? 0 };
    if (from) {
      taken.add(from);
      successor.set(from, plot);
    }
    return plot;
  });
  // farmers' jobs follow their plots; a job whose plot is gone is dropped
  for (const w of workers) {
    const job = currentJob(w);
    if (!job) continue;
    const next = successor.get(farm.plots[job.target]);
    if (!next) retarget(w, { door: HOME }, null);
    else retarget(w, { door: HOME }, { ...job, target: plots.indexOf(next) }, { dx: next.dx, y: workY(next.zone, next.row) });
  }
  farm.plots = plots;
}

/** Whether a plot needs this job: sowing bare land, or harvesting a ripe crop. */
function jobFits(p: FieldPlot | undefined, action: string): p is FieldPlot {
  if (!p) return false;
  return action === 'sow' ? p.state === 'fallow' : action === 'harvest' && p.state === 'ripe';
}

/**
 * Enforce the farm's invariants on state from outside the simulation (e.g. a
 * loaded save): only tilled land holds a crop, and no farmer is set on a job
 * its plot no longer needs.
 */
export function repairFarm(farm: FarmState, workers: Worker[]): void {
  for (const p of farm.plots) {
    if (!p.tilled && p.state !== 'fallow') {
      p.state = 'fallow';
      p.age = 0;
    }
  }
  for (const w of workers) {
    const job = currentJob(w);
    if (job && !jobFits(farm.plots[job.target], job.action)) w.task = { kind: 'idle', wait: 0.3 };
  }
}

/** A new farm: just the farmstead. Its fields appear as the farmer first works them. */
export function createFarm(opts: { spots?: FieldSpot[] } = {}): FarmState {
  return { plots: (opts.spots ?? openFieldSpots()).map((s): FieldPlot => ({ ...s, tilled: false, state: 'fallow', crop: 'grain', age: 0 })) };
}

/** Plot growth 0..1. */
export function growth(p: FieldPlot): number {
  if (p.state === 'fallow') return 0;
  return Math.min(1, p.age / GROW_TIME);
}

/** Crops grow on their own clock, day and night. */
export function updateCrops(farm: FarmState, dt: number): void {
  for (const p of farm.plots) {
    if (p.state !== 'growing') continue;
    p.age += dt;
    if (p.age >= GROW_TIME) p.state = 'ripe';
  }
}

/**
 * The farm as a workplace. Next job: harvest a ripe plot while the store has
 * room, else sow a fallow one, the farm's own land before borrowed land;
 * nearest first. Work takes time in proportion to the plot's width.
 */
export function farmWorkplace(farm: FarmState, stock: Stock, work: FarmWork = DEFAULT_WORK, winter = false, plough = 1): Workplace {
  const capacity = BUILDINGS.farm.storage;
  return {
    door: HOME,
    nextJob(w: Worker, taken: JobTicket[]) {
      const busy = new Set(taken.map((j) => j.target));
      const dist = (p: FieldPlot) => Math.hypot(p.dx - w.dx, workY(p.zone, p.row) - w.y);
      const pick = (state: PlotState, where: (p: FieldPlot) => boolean = () => true) => {
        let best = -1;
        farm.plots.forEach((p, i) => {
          if (p.state === state && where(p) && !busy.has(i) && (best < 0 || dist(p) < dist(farm.plots[best]))) best = i;
        });
        return best;
      };
      const at = (i: number, action: FarmAction) => {
        const p = farm.plots[i];
        return { job: { action, target: i }, dx: p.dx, y: workY(p.zone, p.row) };
      };
      // a ripe field whose crop the store has room for; what is already being harvested counts against it
      const incoming = (c: Crop) => taken.filter((j) => j.action === 'harvest' && farm.plots[j.target]?.crop === c).length;
      const ripe = pick('ripe', (p) => room(stock, capacity, p.crop) > incoming(p.crop));
      if (ripe >= 0) return at(ripe, 'harvest');
      // nobody sows in winter (ripe fields are still brought in)
      const fallow = winter ? -1 : pick('fallow');
      return fallow >= 0 ? at(fallow, 'sow') : null;
    },
    begin(job) {
      const p = farm.plots[job.target];
      if (!jobFits(p, job.action)) return null;
      p.tilled = true; // first work on a plot turns grass into a field
      const perCell = job.action === 'sow' ? work.sowPerCell : work.harvestPerCell;
      // a plough horse makes it quicker
      return ((p.width / CELL_W) * perCell) / plough;
    },
    finish(job): Load | null {
      const p = farm.plots[job.target];
      if (!p) return null;
      p.age = 0;
      if (job.action === 'sow') {
        p.state = 'growing';
        p.crop = cropToSow(farm, stock, capacity);
        return null;
      }
      p.state = 'fallow';
      return { resource: p.crop, amount: 1 }; // a sheaf, or a bale
    },
    dropSpot(_job, load) {
      if (load.resource === 'hay') return { dx: HAY_SLOTS[Math.max(0, Math.min(stock.hay, HAY_SLOTS.length - 1))].dx, y: STAND_Y };
      return sheafSpot(stock.grain);
    },
    deliver(load) {
      stock[load.resource] = Math.min(capacity[load.resource] ?? 0, stock[load.resource] + load.amount);
    },
  };
}

/** The crop the farm is shorter of: what is stored and growing of each, against what its store holds. */
export function cropToSow(farm: FarmState, stock: Stock, capacity: Partial<Record<Crop, number>>): Crop {
  const share = (c: Crop) => (stock[c] + farm.plots.filter((p) => p.state !== 'fallow' && p.crop === c).length) / Math.max(1, capacity[c] ?? 0);
  return share('hay') < share('grain') ? 'hay' : 'grain';
}

/** A static farm for menu previews: its own land all ripe. */
export function demoFarm(): FarmState {
  const farm = createFarm();
  for (const p of farm.plots) {
    p.tilled = true;
    p.state = 'ripe';
    p.age = GROW_TIME;
  }
  return farm;
}
