// Farm simulation. Each finished farm has field plots behind the farmstead
// and in front of the road, a farmer, and a grain store (0–5 sheaves).
//
// The farmer works one plot at a time: walk out → sow → walk back to the
// farm (the plot then grows on its own clock) — or, once a plot is ripe and
// there is room in the store, walk out → harvest → carry the sheaf back and
// stack it in front of the house.

import { BASE_Y, VIEW_H } from './layout';

export type FieldZone = 'back' | 'front';
export type PlotState = 'fallow' | 'growing' | 'ripe';

export interface FieldPlot {
  zone: FieldZone;
  /** Centre x relative to the farm's centre. */
  dx: number;
  width: number;
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

// Geometry (world units). The back field lies behind the farmstead; the front
// field lies between the road and the viewer.
// Seen from a low angle, the back field is a shallow strip; the front field is
// closer to the viewer, so it takes up more of the screen.
export const BACK_FIELD = { front: BASE_Y - 3, back: BASE_Y - 30 };
export const FRONT_FIELD = { top: 512, bottom: VIEW_H - 14 };
/** Where the farmer stands in each zone while working a plot. */
export const WORK_Y: Record<FieldZone, number> = {
  back: BASE_Y - 15,
  front: (FRONT_FIELD.top + FRONT_FIELD.bottom) / 2 + 8,
};
/** The farmyard: the farmer's home spot, by the door. */
export const HOME = { dx: -24, y: BASE_Y + 3 };
/** The grain store, between the house and the street. */
export const STORE = { dx: -86, y: BASE_Y + 3 };

/** Back plots flank the farmstead so the farmer stays in view while working them. */
export const BACK_DX = [-180, -118, 118, 180];
/**
 * The front field spans the same width as the back one. Being closer to the
 * viewer, its plots look bigger, so fewer of them fit across.
 */
export const FRONT_DX = [-168, -84, 0, 84, 168];
export const PLOT_W: Record<FieldZone, number> = { back: 60, front: 84 };

export function createFarm(opts: { established?: boolean } = {}): FarmState {
  const plots: FieldPlot[] = [
    ...BACK_DX.map((dx): FieldPlot => ({ zone: 'back', dx, width: PLOT_W.back, state: 'fallow', age: 0 })),
    ...FRONT_DX.map((dx): FieldPlot => ({ zone: 'front', dx, width: PLOT_W.front, state: 'fallow', age: 0 })),
  ];
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
