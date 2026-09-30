// Pure game state + update logic. No DOM, no canvas — unit-tested in world.test.ts.

import { BUILDINGS, BUILDING_TYPES, type BuildingType } from './buildings';
import { createFarm, updateFarm, type FarmState } from './farm';
import { farmFieldSpots, syncFarmFields } from './land';

export const WORLD_WIDTH = 6400;
export const PLOT_WIDTH = 200;
export const PLOT_SPACING = 250;
export const FIRST_PLOT_X = 420;
/** How close (px) the rider's x must be to a plot centre to interact with it. */
export const INTERACT_RANGE = 90;

export const RIDER_MAX_SPEED = 240; // px/s
export const RIDER_ACCEL = 600; // px/s²
export const RIDER_DECEL = 740; // px/s²

/** Live-tunable knobs (the tuning panel edits these; defaults are the constants above). */
export interface WorldParams {
  riderMaxSpeed: number; // px/s
  riderAccel: number; // px/s²
  riderDecel: number; // px/s²
  /** Construction speed multiplier: 2 builds twice as fast. */
  buildSpeed: number;
}

export const DEFAULT_PARAMS: WorldParams = {
  riderMaxSpeed: RIDER_MAX_SPEED,
  riderAccel: RIDER_ACCEL,
  riderDecel: RIDER_DECEL,
  buildSpeed: 1,
};

export interface Plot {
  index: number;
  /** Centre x in world px. */
  x: number;
  buildingId: number | null;
}

export type BuildingStatus = 'constructing' | 'done';

export interface Building {
  id: number;
  type: BuildingType;
  plotIndex: number;
  /** 0..1 construction progress. */
  progress: number;
  status: BuildingStatus;
  /** World time (s) at which the building was completed; used for the completion effect. */
  completedAt: number | null;
  /** Fields, farmer and grain store — farms only, once finished. */
  farm?: FarmState;
}

export interface Rider {
  x: number;
  vx: number;
  facing: 1 | -1;
  /** Accumulated gait phase — advances with distance travelled. */
  gait: number;
}

export interface Villager {
  id: number;
  x: number;
  dir: 1 | -1;
  speed: number;
  /** Seconds remaining standing still. */
  idle: number;
  kind: 'peasant' | 'woman' | 'monk' | 'chicken';
  seed: number;
}

export interface BuildMenu {
  plotIndex: number;
  selection: number;
}

export interface GameEvent {
  kind: 'placed' | 'completed';
  buildingId: number;
}

export interface World {
  time: number;
  plots: Plot[];
  buildings: Building[];
  rider: Rider;
  villagers: Villager[];
  constructionEnabled: boolean;
  params: WorldParams;
  menu: BuildMenu | null;
  /** Last chosen menu entry, so repeat-building the same type is quick. */
  lastSelection: number;
  nextId: number;
  rngState: number;
  /** Events produced during the last update/action; drained by the caller. */
  events: GameEvent[];
}

export interface MoveInput {
  left: boolean;
  right: boolean;
}

/** Deterministic RNG (mulberry32) stored in world state so tests are reproducible. */
export function rand(world: World): number {
  let t = (world.rngState = (world.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const STARTING_VILLAGE: Array<[number, BuildingType]> = [
  [2, 'house'],
  [3, 'well'],
  [4, 'tavern'],
  [6, 'house'],
  [8, 'farm'],
  [11, 'chapel'],
  [13, 'blacksmith'],
  [16, 'house'],
];

export interface CreateWorldOptions {
  seed?: number;
  /** Pre-build the starting village (default true). */
  village?: boolean;
}

export function createWorld(opts: CreateWorldOptions = {}): World {
  const plots: Plot[] = [];
  for (let i = 0, x = FIRST_PLOT_X; x < WORLD_WIDTH - 200; i++, x += PLOT_SPACING) {
    plots.push({ index: i, x, buildingId: null });
  }
  const world: World = {
    time: 0,
    plots,
    buildings: [],
    rider: { x: FIRST_PLOT_X + 5 * PLOT_SPACING + PLOT_SPACING / 2, vx: 0, facing: 1, gait: 0 },
    villagers: [],
    constructionEnabled: true,
    params: { ...DEFAULT_PARAMS },
    menu: null,
    lastSelection: 0,
    nextId: 1,
    rngState: opts.seed ?? 1337,
    events: [],
  };

  if (opts.village ?? true) {
    for (const [plotIndex, type] of STARTING_VILLAGE) {
      const b = placeBuilding(world, plotIndex, type, { instant: true });
      if (!b) continue;
      b.completedAt = -100; // no completion effect for the starting village
      if (b.farm) b.farm = createFarm({ established: true, spots: farmFieldSpots(world, b) });
    }
    world.events.length = 0;
    const kinds: Villager['kind'][] = ['peasant', 'woman', 'monk', 'peasant', 'chicken', 'chicken', 'woman'];
    for (const kind of kinds) {
      world.villagers.push({
        id: world.nextId++,
        x: FIRST_PLOT_X + rand(world) * 16 * PLOT_SPACING,
        dir: rand(world) < 0.5 ? -1 : 1,
        speed: kind === 'chicken' ? 22 + rand(world) * 14 : 26 + rand(world) * 18,
        idle: rand(world) * 3,
        kind,
        seed: Math.floor(rand(world) * 1e6),
      });
    }
  }
  return world;
}

export function getBuilding(world: World, id: number | null): Building | undefined {
  if (id == null) return undefined;
  return world.buildings.find((b) => b.id === id);
}

/** Plot whose centre is closest to x and within INTERACT_RANGE, else null. */
export function plotAt(world: World, x: number): Plot | null {
  let best: Plot | null = null;
  let bestD = INTERACT_RANGE;
  for (const p of world.plots) {
    const d = Math.abs(p.x - x);
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export function placeBuilding(
  world: World,
  plotIndex: number,
  type: BuildingType,
  opts: { instant?: boolean } = {},
): Building | null {
  const plot = world.plots[plotIndex];
  if (!plot || plot.buildingId !== null) return null;
  const instant = opts.instant ?? !world.constructionEnabled;
  const b: Building = {
    id: world.nextId++,
    type,
    plotIndex,
    progress: instant ? 1 : 0,
    status: instant ? 'done' : 'constructing',
    completedAt: instant ? world.time : null,
  };
  world.buildings.push(b);
  if (instant && type === 'farm') b.farm = createFarm({ spots: farmFieldSpots(world, b) });
  // the new footprint may cover land neighbouring farms were using
  syncFarmFields(world);
  plot.buildingId = b.id;
  world.events.push({ kind: 'placed', buildingId: b.id });
  if (instant) world.events.push({ kind: 'completed', buildingId: b.id });
  return b;
}

/**
 * Toggle the construction phase. Turning it off finishes every building
 * currently under construction immediately.
 */
export function setConstructionEnabled(world: World, enabled: boolean): void {
  world.constructionEnabled = enabled;
  if (!enabled) {
    for (const b of world.buildings) {
      if (b.status === 'constructing') complete(world, b);
    }
  }
}

function complete(world: World, b: Building): void {
  b.progress = 1;
  b.status = 'done';
  b.completedAt = world.time;
  if (b.type === 'farm') b.farm = createFarm({ spots: farmFieldSpots(world, b) });
  world.events.push({ kind: 'completed', buildingId: b.id });
}

// --- Build menu ------------------------------------------------------------

/** Open the build menu if the rider stands at an empty plot. Returns whether it opened. */
export function openMenu(world: World): boolean {
  const plot = plotAt(world, world.rider.x);
  if (!plot || plot.buildingId !== null) return false;
  world.menu = { plotIndex: plot.index, selection: world.lastSelection };
  world.rider.vx = 0;
  return true;
}

export function moveMenu(world: World, delta: number): void {
  if (!world.menu) return;
  const n = BUILDING_TYPES.length;
  world.menu.selection = (((world.menu.selection + delta) % n) + n) % n;
}

export function selectMenu(world: World, index: number): void {
  if (!world.menu || index < 0 || index >= BUILDING_TYPES.length) return;
  world.menu.selection = index;
}

export function confirmMenu(world: World): Building | null {
  if (!world.menu) return null;
  const { plotIndex, selection } = world.menu;
  closeMenu(world);
  return placeBuilding(world, plotIndex, BUILDING_TYPES[selection]);
}

export function closeMenu(world: World): void {
  if (world.menu) world.lastSelection = world.menu.selection;
  world.menu = null;
}

// --- Update ----------------------------------------------------------------

export function update(world: World, dt: number, input: MoveInput): void {
  world.time += dt;
  updateRider(world, dt, world.menu ? { left: false, right: false } : input);
  updateConstruction(world, dt);
  for (const b of world.buildings) if (b.farm) updateFarm(b.farm, dt);
  updateVillagers(world, dt);
}

function updateRider(world: World, dt: number, input: MoveInput): void {
  const r = world.rider;
  const p = world.params;
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) {
    r.facing = dir as 1 | -1;
    r.vx += dir * p.riderAccel * dt;
    r.vx = Math.max(-p.riderMaxSpeed, Math.min(p.riderMaxSpeed, r.vx));
  } else {
    const dv = p.riderDecel * dt;
    r.vx = Math.abs(r.vx) <= dv ? 0 : r.vx - Math.sign(r.vx) * dv;
  }
  r.x += r.vx * dt;
  const min = 120;
  const max = WORLD_WIDTH - 120;
  if (r.x < min || r.x > max) {
    r.x = Math.max(min, Math.min(max, r.x));
    r.vx = 0;
  }
  r.gait += Math.abs(r.vx) * dt;
}

function updateConstruction(world: World, dt: number): void {
  for (const b of world.buildings) {
    if (b.status !== 'constructing') continue;
    b.progress += (dt * world.params.buildSpeed) / BUILDINGS[b.type].buildTime;
    if (b.progress >= 1) complete(world, b);
  }
}

function updateVillagers(world: World, dt: number): void {
  const minX = FIRST_PLOT_X - 150;
  const maxX = WORLD_WIDTH - 300;
  for (const v of world.villagers) {
    if (v.idle > 0) {
      v.idle -= dt;
      if (v.idle <= 0 && rand(world) < 0.4) v.dir = (v.dir * -1) as 1 | -1;
      continue;
    }
    v.x += v.dir * v.speed * dt;
    if (v.x < minX || v.x > maxX) {
      v.x = Math.max(minX, Math.min(maxX, v.x));
      v.dir = (v.dir * -1) as 1 | -1;
    }
    if (rand(world) < dt * (v.kind === 'chicken' ? 0.5 : 0.12)) v.idle = 1 + rand(world) * 4;
  }
}

// --- Construction stages ---------------------------------------------------

export type ConstructionStage = 'staking' | 'foundation' | 'frame' | 'walls' | 'roof' | 'done';

export const STAGE_BOUNDS: Array<[ConstructionStage, number]> = [
  ['staking', 0.12],
  ['foundation', 0.28],
  ['frame', 0.5],
  ['walls', 0.78],
  ['roof', 1],
];


/** Which stage a progress value falls in, and 0..1 progress within that stage. */
export function constructionStage(progress: number): { stage: ConstructionStage; t: number } {
  if (progress >= 1) return { stage: 'done', t: 1 };
  let start = 0;
  for (const [stage, end] of STAGE_BOUNDS) {
    if (progress < end) return { stage, t: (progress - start) / (end - start) };
    start = end;
  }
  return { stage: 'done', t: 1 };
}
