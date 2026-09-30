// Farm: the farm-specific part of a farm building. It owns the fields: their
// plots, crops and growth, and which land they lie on (from the land grid, see
// land.ts; plots fill free cells around the farmstead and change when a
// neighbour builds). It is also a workplace (worker.ts): farmers sow fallow
// plots and harvest ripe ones, and carry the sheaves to the farm's store (the
// building's stock). Everything else about a farmer's day is the generic
// worker routine.
import { BUILDINGS } from './buildings';
import { CELL_W, FIELD_REACH, FIELD_ROWS, HOME, PLOT_CELLS, PLOT_SPACING, STORE, workY, type FieldZone } from './layout';
import { room, type Resource, type Stock } from './resources';
import { currentJob, retarget, type JobTicket, type Worker, type Workplace } from './worker';

export type { FieldZone };
export type PlotState = 'fallow' | 'growing' | 'ripe';

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
  /** Seconds since sowing (only meaningful while growing / ripe). */
  age: number;
}

export type FarmAction = 'sow' | 'harvest';

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
 * Cut the free land around a farm into field plots. `isFree(zone, c)` says
 * whether grid cell `c` (relative to the farm centre: it covers dx from
 * c·CELL_W to (c+1)·CELL_W) may be farmed. Each run of free cells is split
 * into plots working outward from the farm; a lone leftover cell joins the
 * plot next to it, and a run too short for a plot stays grass. In front of
 * the road plots never straddle the edge of the farm's own lot, so each is
 * either the farm's own land or borrowed from a neighbouring lot.
 */
export function fieldSpots(isFree: (zone: FieldZone, c: number) => boolean): FieldSpot[] {
  const lotCells = PLOT_SPACING / 2 / CELL_W;
  const spots: FieldSpot[] = [];
  for (const zone of ['back', 'front'] as const) {
    const reach = Math.floor(FIELD_REACH[zone] / CELL_W);
    for (const side of [-1, 1]) {
      // cells walking outward from the farm centre on this side
      const cells = Array.from({ length: reach }, (_, i) => (side > 0 ? i : -1 - i));
      let run: number[] = [];
      const flush = () => {
        const chunks: number[][] = [];
        for (let i = 0; i < run.length; i += PLOT_CELLS.max) chunks.push(run.slice(i, i + PLOT_CELLS.max));
        const last = chunks[chunks.length - 1];
        if (last && last.length < PLOT_CELLS.min) {
          chunks.pop();
          if (chunks.length) chunks[chunks.length - 1].push(...last);
        }
        for (const ch of chunks) {
          const lo = Math.min(...ch);
          const dx = (lo + ch.length / 2) * CELL_W;
          FIELD_ROWS[zone].forEach((_, row) => spots.push({ zone, row, dx, width: ch.length * CELL_W }));
        }
        run = [];
      };
      cells.forEach((c, i) => {
        if (zone === 'front' && i === lotCells) flush(); // leaving the farm's own lot
        if (isFree(zone, c)) run.push(c);
        else flush();
      });
      flush();
    }
  }
  return spots;
}

/** Cells (relative to the centre) a building of this width covers: [-n, n). */
export function footprintHalfCells(width: number): number {
  return Math.ceil(width / 2 / CELL_W);
}

/**
 * A plot in front of a neighbouring lot: farmed only once the farm's own land
 * is all in use. (Behind the road the fields stop at the next building.)
 */
export function isBorrowed(s: FieldSpot): boolean {
  return s.zone === 'front' && Math.abs(s.dx) > PLOT_SPACING / 2;
}

/** Fields of a farm with nothing built around it. */
export function openFieldSpots(): FieldSpot[] {
  const n = footprintHalfCells(BUILDINGS.farm.width);
  return fieldSpots((zone, c) => zone === 'front' || c < -n || c >= n);
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
    const plot: FieldPlot = { ...s, tilled: from?.tilled ?? false, state: from?.state ?? 'fallow', age: from?.age ?? 0 };
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
  return { plots: (opts.spots ?? openFieldSpots()).map((s): FieldPlot => ({ ...s, tilled: false, state: 'fallow', age: 0 })) };
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
export function farmWorkplace(farm: FarmState, stock: Stock, work: FarmWork = DEFAULT_WORK): Workplace {
  const capacity = BUILDINGS.farm.storage;
  return {
    door: HOME,
    store: STORE,
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
      // sheaves already on their way count against the room in the store
      const incoming = taken.filter((j) => j.action === 'harvest').length;
      if (room(stock, capacity, 'grain') > incoming) {
        const ripe = pick('ripe');
        if (ripe >= 0) return at(ripe, 'harvest');
      }
      const own = pick('fallow', (p) => !isBorrowed(p));
      const fallow = own >= 0 ? own : pick('fallow');
      return fallow >= 0 ? at(fallow, 'sow') : null;
    },
    begin(job) {
      const p = farm.plots[job.target];
      if (!jobFits(p, job.action)) return null;
      p.tilled = true; // first work on a plot turns grass into a field
      const perCell = job.action === 'sow' ? work.sowPerCell : work.harvestPerCell;
      return (p.width / CELL_W) * perCell;
    },
    finish(job): Resource | null {
      const p = farm.plots[job.target];
      if (!p) return null;
      p.age = 0;
      if (job.action === 'sow') {
        p.state = 'growing';
        return null;
      }
      p.state = 'fallow';
      if (isBorrowed(p)) p.tilled = false; // borrowed land goes back to grass
      return 'grain';
    },
    deliver(r) {
      stock[r] = Math.min(capacity[r] ?? 0, stock[r] + 1);
    },
  };
}

/** A static farm for menu previews: its own land all ripe. */
export function demoFarm(): FarmState {
  const farm = createFarm();
  for (const p of farm.plots) {
    p.tilled = !isBorrowed(p);
    p.state = 'ripe';
    p.age = GROW_TIME;
  }
  return farm;
}
