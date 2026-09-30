// Farm simulation. Each finished farm has field plots behind the farmstead
// and in front of the road, a farmer, and a grain store (0–5 sheaves).
//
// Which land the fields cover comes from the land grid (see land.ts): plots
// fill free cells around the farmstead, and change when a neighbour builds.
//
// The farmer works one plot at a time: walk out → sow → walk back to the
// farm (the plot then grows on its own clock) — or, once a plot is ripe and
// there is room in the store, walk out → harvest → carry the sheaf back and
// stack it in front of the house.
import { BUILDINGS } from './buildings';
import { CELL_W, FIELD_REACH, HOME, PLOT_CELLS, STORE, WORK_Y, type FieldZone } from './layout';

export type { FieldZone };
export type PlotState = 'fallow' | 'growing' | 'ripe';

/** Where a field plot lies: zone, centre x relative to the farm's centre, width. */
export interface FieldSpot {
  zone: FieldZone;
  dx: number;
  width: number;
}

export interface FieldPlot extends FieldSpot {
  state: PlotState;
  /** Seconds since sowing (only meaningful while growing / ripe). */
  age: number;
}

export type FarmerAction = 'sow' | 'harvest';

export type FarmerTask =
  | { kind: 'idle'; wait: number }
  | { kind: 'walk'; toDx: number; toY: number; then: 'work' | 'deposit' | 'home'; plot: number; action: FarmerAction | null }
  | { kind: 'work'; action: FarmerAction; plot: number; t: number };

export interface Farmer {
  /** Position: x relative to the farm centre, y in world units. */
  dx: number;
  y: number;
  facing: 1 | -1;
  carrying: boolean;
  task: FarmerTask;
  /** Distance walked, drives the walk cycle. */
  stride: number;
}

export interface FarmState {
  plots: FieldPlot[];
  farmer: Farmer;
  /** Sheaves stacked in front of the house, 0..STORAGE_MAX. */
  storage: number;
}

export const STORAGE_MAX = 5;
export const GROW_TIME = 30; // s from sowing to ripe
export const SOW_TIME = 2.5;
export const HARVEST_TIME = 3;
export const FARMER_SPEED = 42; // px/s

/**
 * Cut the free land around a farm into field plots. `isFree(zone, c)` says
 * whether grid cell `c` (relative to the farm centre: it covers dx from
 * c·CELL_W to (c+1)·CELL_W) may be farmed. Each run of free cells is split
 * into plots working outward from the farm; a lone leftover cell joins the
 * plot next to it, and a run too short for a plot stays grass.
 */
export function fieldSpots(isFree: (zone: FieldZone, c: number) => boolean): FieldSpot[] {
  const reach = Math.floor(FIELD_REACH / CELL_W);
  const spots: FieldSpot[] = [];
  for (const zone of ['back', 'front'] as const) {
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
          spots.push({ zone, dx: (lo + ch.length / 2) * CELL_W, width: ch.length * CELL_W });
        }
        run = [];
      };
      for (const c of cells) {
        if (isFree(zone, c)) run.push(c);
        else flush();
      }
      flush();
    }
  }
  return spots;
}

/** Cells (relative to the centre) a building of this width covers: [-n, n). */
export function footprintHalfCells(width: number): number {
  return Math.ceil(width / 2 / CELL_W);
}

/** Fields of a farm with nothing built around it. */
export function openFieldSpots(): FieldSpot[] {
  const n = footprintHalfCells(BUILDINGS.farm.width);
  return fieldSpots((zone, c) => zone === 'front' || c < -n || c >= n);
}

const spotKey = (s: FieldSpot) => `${s.zone}:${s.dx}:${s.width}`;

/**
 * Re-lay the fields on new land. Plots that keep their exact spot keep their
 * crop; others start fallow. A farmer heading to or working a plot that is
 * gone walks home.
 */
export function setFieldSpots(farm: FarmState, spots: FieldSpot[]): void {
  const old = new Map(farm.plots.map((p) => [spotKey(p), p]));
  const plots = spots.map((s): FieldPlot => old.get(spotKey(s)) ?? { ...s, state: 'fallow', age: 0 });
  const f = farm.farmer;
  const t = f.task;
  if ((t.kind === 'walk' && t.then === 'work') || t.kind === 'work') {
    const next = plots.indexOf(farm.plots[t.plot]);
    if (next >= 0) t.plot = next;
    else walkTo(f, HOME.dx, HOME.y, 'home', -1, null);
  }
  farm.plots = plots;
}

export function createFarm(opts: { established?: boolean; spots?: FieldSpot[] } = {}): FarmState {
  const plots = (opts.spots ?? openFieldSpots()).map((s): FieldPlot => ({ ...s, state: 'fallow', age: 0 }));
  const farm: FarmState = {
    plots,
    farmer: { dx: HOME.dx, y: HOME.y, facing: 1, carrying: false, task: { kind: 'idle', wait: 0.5 }, stride: 0 },
    storage: 0,
  };
  if (opts.established) {
    // A farm that has been running for a while: a mix of crops at every stage.
    const ages = [4, GROW_TIME, 20, -1, GROW_TIME, 12, -1, 26];
    plots.forEach((p, i) => {
      const age = ages[i % ages.length];
      if (age < 0) return;
      p.age = age;
      p.state = age >= GROW_TIME ? 'ripe' : 'growing';
    });
    farm.storage = 2;
  }
  return farm;
}

/** Plot growth 0..1. */
export function growth(p: FieldPlot): number {
  if (p.state === 'fallow') return 0;
  return Math.min(1, p.age / GROW_TIME);
}

export function updateFarm(farm: FarmState, dt: number): void {
  for (const p of farm.plots) {
    if (p.state !== 'growing') continue;
    p.age += dt;
    if (p.age >= GROW_TIME) p.state = 'ripe';
  }
  updateFarmer(farm, dt);
}

function isReserved(farm: FarmState, plot: number): boolean {
  const t = farm.farmer.task;
  return (t.kind === 'walk' && t.then === 'work' && t.plot === plot) || (t.kind === 'work' && t.plot === plot);
}

/** Next job: harvest a ripe plot if the store has room, else sow a fallow one. Nearest first. */
export function chooseJob(farm: FarmState): { plot: number; action: FarmerAction } | null {
  const f = farm.farmer;
  const dist = (i: number) => {
    const p = farm.plots[i];
    return Math.hypot(p.dx - f.dx, WORK_Y[p.zone] - f.y);
  };
  const pick = (state: PlotState) => {
    let best = -1;
    farm.plots.forEach((p, i) => {
      if (p.state === state && !isReserved(farm, i) && (best < 0 || dist(i) < dist(best))) best = i;
    });
    return best;
  };
  if (farm.storage < STORAGE_MAX) {
    const ripe = pick('ripe');
    if (ripe >= 0) return { plot: ripe, action: 'harvest' };
  }
  const fallow = pick('fallow');
  if (fallow >= 0) return { plot: fallow, action: 'sow' };
  return null;
}

function walkTo(f: Farmer, toDx: number, toY: number, then: 'work' | 'deposit' | 'home', plot: number, action: FarmerAction | null): void {
  f.task = { kind: 'walk', toDx, toY, then, plot, action };
}

function updateFarmer(farm: FarmState, dt: number): void {
  const f = farm.farmer;
  const task = f.task;

  if (task.kind === 'idle') {
    task.wait -= dt;
    if (task.wait > 0) return;
    const job = chooseJob(farm);
    if (!job) {
      task.wait = 1; // nothing to do; check again shortly
      return;
    }
    const p = farm.plots[job.plot];
    walkTo(f, p.dx, WORK_Y[p.zone], 'work', job.plot, job.action);
    return;
  }

  if (task.kind === 'walk') {
    const ddx = task.toDx - f.dx;
    const ddy = task.toY - f.y;
    const d = Math.hypot(ddx, ddy);
    const step = FARMER_SPEED * dt;
    if (Math.abs(ddx) > 0.5) f.facing = ddx > 0 ? 1 : -1;
    if (d > step) {
      f.dx += (ddx / d) * step;
      f.y += (ddy / d) * step;
      f.stride += step;
      return;
    }
    f.dx = task.toDx;
    f.y = task.toY;
    f.stride += d;
    if (task.then === 'work' && task.action) {
      f.task = { kind: 'work', action: task.action, plot: task.plot, t: 0 };
    } else if (task.then === 'deposit') {
      farm.storage = Math.min(STORAGE_MAX, farm.storage + 1);
      f.carrying = false;
      f.task = { kind: 'idle', wait: 0.8 };
    } else {
      f.task = { kind: 'idle', wait: 0.8 };
    }
    return;
  }

  // working a plot
  task.t += dt;
  const p = farm.plots[task.plot];
  if (task.action === 'sow' && task.t >= SOW_TIME) {
    p.state = 'growing';
    p.age = 0;
    walkTo(f, HOME.dx, HOME.y, 'home', -1, null);
  } else if (task.action === 'harvest' && task.t >= HARVEST_TIME) {
    p.state = 'fallow';
    p.age = 0;
    f.carrying = true;
    walkTo(f, STORE.dx + 16, STORE.y, 'deposit', -1, null);
  }
}

/** A static farm for menu previews: everything ripe, store half full. */
export function demoFarm(): FarmState {
  const farm = createFarm();
  for (const p of farm.plots) {
    p.state = 'ripe';
    p.age = GROW_TIME;
  }
  farm.storage = 3;
  return farm;
}
