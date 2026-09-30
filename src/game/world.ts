// Pure game state + update logic. No DOM, no canvas — unit-tested in world.test.ts.
// The world holds the street's plots and buildings, the people and animals,
// and the rider, and runs each part's update in turn.
// What is specific to one kind of thing lives in its own module: farm.ts
// (fields), people.ts (villagers, hiring), worker.ts (the working day),
// economy.ts (warehouses, costs), site.ts (construction by builders),
// land.ts (who uses which land).
//
// Nobody and nothing ever jumps: people walk everywhere from where they
// stand (hired, let go, or done for the day), and goods only move in
// someone's arms, from the place they lie to the place they will lie.

import { BUILDINGS, BUILDING_TYPES, type BuildingType } from './buildings';
import { timeOfDay } from './daynight';
import { buildShortfall, putAway, takeFromWarehouses, WAREHOUSE_START } from './economy';
import { createFarm, DEFAULT_WORK, farmWorkplace, updateCrops, type FarmState } from './farm';
import { farmFieldSpots, syncFarmFields } from './land';
import { PLOT_SPACING } from './layout';
import { millWorkplace } from './mill';
import { employees, laneY, nameFor, openings, release, staffBuildings, updateStrolls, type Animal, type Look, type Person } from './people';
import { BUILDERS_PER_SITE, createSite, siteWorkplace, type Site } from './site';
import { RESOURCES, stockOf, type Stock } from './resources';
import { serfPositions, transportHub, transportWorkplace } from './transport';
import { createWorker, currentJob, offDuty, updateWorker, type Worker, type Workplace } from './worker';

export const WORLD_WIDTH = 6400;
export const PLOT_WIDTH = 200;
export { PLOT_SPACING };
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
  /** How fast the time of day runs: 2 makes days half as long (see daynight.ts). */
  timeSpeed: number;
  /** Hours of the 24 the sun spends below the horizon, 0..12. */
  nightHours: number;
  /** Farm work time per grid cell of plot width (s): sowing and harvesting. */
  sowPerCell: number;
  harvestPerCell: number;
}

export const DEFAULT_PARAMS: WorldParams = {
  riderMaxSpeed: RIDER_MAX_SPEED,
  riderAccel: RIDER_ACCEL,
  riderDecel: RIDER_DECEL,
  buildSpeed: 1,
  timeSpeed: 1,
  nightHours: 8,
  ...DEFAULT_WORK,
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
  /** The building's own store (capacities in its BuildingDef). */
  stock: Stock;
  /** While under construction: the materials brought so far (site.ts). */
  site?: Site;
  /** Fields — farms only, once finished. */
  farm?: FarmState;
}

export interface Rider {
  x: number;
  vx: number;
  facing: 1 | -1;
  /** Accumulated gait phase — advances with distance travelled. */
  gait: number;
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
  /** Every villager, employed or not (people.ts). */
  people: Person[];
  animals: Animal[];
  constructionEnabled: boolean;
  params: WorldParams;
  menu: BuildMenu | null;
  /** Last chosen menu entry, so repeat-building the same type is quick. */
  lastSelection: number;
  nextId: number;
  rngState: number;
  /** Time-of-day clock (s): runs at params.timeSpeed. See daynight.ts. */
  dayClock: number;
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
  [5, 'warehouse'],
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
    people: [],
    animals: [],
    constructionEnabled: true,
    params: { ...DEFAULT_PARAMS },
    menu: null,
    lastSelection: 0,
    nextId: 1,
    rngState: opts.seed ?? 1337,
    dayClock: 0,
    events: [],
  };

  if (opts.village ?? true) {
    for (const [plotIndex, type] of STARTING_VILLAGE) {
      const b = placeBuilding(world, plotIndex, type, { instant: true, free: true });
      if (!b) continue;
      b.completedAt = -100; // no completion effect for the starting village
      if (type === 'warehouse') b.stock = { ...WAREHOUSE_START };
    }
    world.events.length = 0;
    // six workers with a fixed profession for life (one farmer, five builders),
    // two townsfolk who never work, and five out of work, looking for a job
    const kinds: Array<Look | 'chicken'> = ['peasant', 'woman', 'monk', 'peasant', 'chicken', 'chicken', 'peasant', 'peasant', 'peasant', 'peasant'];
    const seekers = 5;
    let peasants = 0;
    for (const kind of [...kinds, ...Array<Look>(seekers).fill('peasant')]) {
      const id = world.nextId++;
      const stroll = {
        x: FIRST_PLOT_X + rand(world) * 16 * PLOT_SPACING,
        y: laneY(id),
        dir: (rand(world) < 0.5 ? -1 : 1) as 1 | -1,
        speed: kind === 'chicken' ? 22 + rand(world) * 14 : 26 + rand(world) * 18,
        idle: rand(world) * 3,
      };
      const seed = Math.floor(rand(world) * 1e6);
      if (kind === 'chicken') world.animals.push({ id, kind, seed, stroll });
      else {
        const n = kind === 'peasant' ? peasants++ : -1;
        const work = n < 0 ? {} : n === 0 ? { profession: 'farmer' as const } : n < 6 ? { profession: 'builder' as const } : { seeker: true as const };
        world.people.push({ id, name: nameFor(kind, seed, new Set(world.people.map((p) => p.name))), look: kind, seed, job: null, stroll, ...work });
      }
    }
    staff(world);
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
  /**
   * instant: skip construction (materials are taken from the warehouses at
   * once); free: needs nothing from the warehouses (the starting village).
   */
  opts: { instant?: boolean; free?: boolean } = {},
): Building | null {
  const plot = world.plots[plotIndex];
  if (!plot || plot.buildingId !== null) return null;
  // the warehouses must hold its materials, beyond what other sites are owed
  if (!opts.free && Object.keys(buildShortfall(world, type)).length) return null;
  const instant = opts.instant ?? !world.constructionEnabled;
  if (instant && !opts.free) takeFromWarehouses(world, BUILDINGS[type].cost, plot.x);
  const b: Building = {
    id: world.nextId++,
    type,
    plotIndex,
    progress: instant ? 1 : 0,
    status: instant ? 'done' : 'constructing',
    completedAt: instant ? world.time : null,
    stock: stockOf(),
  };
  // builders bring the materials and build it (a free one has its materials on site already)
  if (!instant) b.site = createSite(type, opts.free ? BUILDINGS[type].cost : {});
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
 * currently under construction immediately, taking whatever materials it
 * still lacks from the warehouses.
 */
export function setConstructionEnabled(world: World, enabled: boolean): void {
  world.constructionEnabled = enabled;
  if (!enabled) {
    for (const b of world.buildings) {
      if (b.status !== 'constructing') continue;
      const lacks = { ...BUILDINGS[b.type].cost };
      for (const r of RESOURCES) lacks[r] = Math.max(0, (lacks[r] ?? 0) - (b.site?.delivered[r] ?? 0));
      takeFromWarehouses(world, lacks, world.plots[b.plotIndex].x);
      complete(world, b);
    }
  }
}

function complete(world: World, b: Building): void {
  b.progress = 1;
  b.status = 'done';
  b.completedAt = world.time;
  delete b.site;
  // the builders are done here and walk off from where they stand (nobody
  // carries anything by then: every load was put in place before the last
  // of the work, unless construction was just switched off, which is instant)
  for (const p of employees(world, b)) {
    const load = p.job!.worker.carrying;
    if (load) putAway(world, load, world.plots[b.plotIndex].x + p.job!.worker.dx);
    release(world, p);
  }
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
  world.dayClock += dt * world.params.timeSpeed;
  updateRider(world, dt, world.menu ? { left: false, right: false } : input);
  staff(world);
  for (const b of world.buildings) if (b.farm) updateCrops(b.farm, dt);
  updateWorkers(world, dt);
  // a site whose builders have done all the work is finished
  for (const b of world.buildings) if (b.status === 'constructing' && b.progress >= 1) complete(world, b);
  updateStrolls(world, dt, () => rand(world));
}

/** A building as a workplace for the people it employs; null if it has no work to give. */
export function workplaceOf(world: World, b: Building): Workplace | null {
  if (b.site) return siteWorkplace(world, b, world.params.buildSpeed);
  if (b.farm) return farmWorkplace(b.farm, b.stock, world.params);
  if (b.type === 'mill' && b.status === 'done') return millWorkplace(b.stock);
  if (b === transportHub(world)) return transportWorkplace(world, b);
  return null;
}

/** Hire for open jobs; construction sites and errands only hire while it's light enough to work. */
function staff(world: World): void {
  const dayLabour = timeOfDay(world).daylight;
  const hub = transportHub(world);
  const openingsOf = (b: Building) => (b === hub ? (dayLabour ? { serf: serfPositions(world) } : {}) : openings(b, BUILDERS_PER_SITE, dayLabour));
  staffBuildings(world, (b, _role, who) => newWorker(world, b, who), openingsOf);
}

/** A new hand walks over from exactly where they are on the street. */
function newWorker(world: World, b: Building, who: Person): Worker {
  const place = workplaceOf(world, b)!;
  const w = createWorker(place);
  w.dx = who.stroll.x - world.plots[b.plotIndex].x;
  w.y = who.stroll.y;
  w.facing = w.dx > 0 ? -1 : 1;
  w.task = { kind: 'idle', wait: 0.2 };
  return w;
}

function updateWorkers(world: World, dt: number): void {
  const now = timeOfDay(world);
  for (const b of world.buildings) {
    const place = workplaceOf(world, b);
    if (!place) continue;
    const people = employees(world, b);
    const staffers = people.map((p) => p.job!.worker);
    for (const p of people) {
      const w = p.job!.worker;
      // day labourers are let go at nightfall, once they've finished the job in
      // hand and delivered what they carry (they're hired again in the morning)
      if (place.dayLabour && offDuty(w, now, place) && !w.carrying && w.task.kind !== 'job') {
        release(world, p);
        continue;
      }
      const taken = staffers.filter((o) => o !== w).flatMap((o) => currentJob(o) ?? []);
      // errand work: with nothing to carry and no errand waiting, they are let go where they stand
      if (place.temporary && w.task.kind === 'idle' && !w.carrying && !place.nextJob(w, taken)) {
        release(world, p);
        continue;
      }
      updateWorker(w, place, dt, now, taken);
    }
  }
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
