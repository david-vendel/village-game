// Pure game state + update logic. No DOM, no canvas — unit-tested in world.test.ts.
// The world holds the street's plots and buildings, the people and animals,
// and the rider, and runs each part's update in turn.
// What is specific to one kind of thing lives in its own module: farm.ts
// (fields), people.ts (villagers, hiring), worker.ts (the working day),
// economy.ts (warehouses, costs), workshop.ts (the mill's and bakery's work), transport.ts (errands), tavern.ts (guests eating), site.ts (construction by builders),
// land.ts (who uses which land), nature.ts (the woods and quarries, and the huts that work them),
// streets.ts (the street network: crossroads open new streets across the old).
//
// Nobody and nothing ever jumps: people walk everywhere from where they
// stand (hired, let go, or done for the day), and goods only move in
// someone's arms, from the place they lie to the place they will lie.

import { BUILDINGS, BUILDING_TYPES, type BuildingType, type Role } from './buildings';
import { timeOfDay } from './daynight';
import { buildShortfall, putAway, takeFromWarehouses, upgradeShortfall, WAREHOUSE_START } from './economy';
import { createFarm, DEFAULT_WORK, farmWorkplace, updateCrops, type FarmState } from './farm';
import { farmFieldSpots, syncFarmFields } from './land';
import { BLOCK, CELL_W, FIRST_PLOT_X, PLOT_SPACING, STREET_LENGTH } from './layout';
import { alongCell, blockStartX, footprintOf, onRoadGrid, roadBlocked, roadInWay, siteX, sizeOfBuilding, whyNotHere } from './grid';
import { clearLand, plantWoods, gatherWorkplace, isGatherHut, updateForest, type Tree } from './nature';
import { employees, laneY, nameFor, openings, release, staffBuildings, updateStrolls, type Animal, type Look, type Person } from './people';
import { builderPositions, builders, createSite, siteWork, siteWorkplace, upgrading, type Site } from './site';
import { demolitionWork, demolitionWorkplace, dropAll, materialsIn, tearDown, type Demolition } from './demolition';
import { dropOnGround, type Pile } from './piles';
import { RESOURCES, stockOf, type Stock } from './resources';
import { CROSS_PLOT, mainStreet, newStreet, plotPoint, plotX, PLOTS_PER_STREET, route, STREET_END_RUN, streetOf, streetRange, streetsAt, streetStart, turnFacing, type Junction, type Street, type Vec } from './streets';
import { eatAtTaverns } from './tavern';
import { serfPositions, transportHub, transportWorkplace } from './transport';
import { createWorker, currentJob, offDuty, updateWorker, type Nav, type Worker, type Workplace } from './worker';
import { workshopWorkplace } from './workshop';

/** Length of each street (streets.ts). */
export const WORLD_WIDTH = STREET_LENGTH;
export const PLOT_WIDTH = 200;
export { FIRST_PLOT_X, PLOT_SPACING };
/** How close (px) the rider's x must be to a crossroads to turn there. */
export const INTERACT_RANGE = 40;

export const RIDER_MAX_SPEED = 240; // px/s
export const RIDER_ACCEL = 600; // px/s²
export const RIDER_DECEL = 740; // px/s²
/** Sprinting, the horse gallops this many times as fast, and picks up speed this much quicker. */
export const SPRINT_SPEED = 1.75;
export const SPRINT_ACCEL = 1.3;

/** Live-tunable knobs (the tuning panel edits these; defaults are the constants above). */
export interface WorldParams {
  riderMaxSpeed: number; // px/s
  riderAccel: number; // px/s²
  riderDecel: number; // px/s²
  /** Construction speed multiplier: 2 builds twice as fast. */
  buildSpeed: number;
  /** Builders' walking speed multiplier, loaded and empty-handed. */
  builderWalk: number;
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
  builderWalk: 2,
  timeSpeed: 1,
  nightHours: 8,
  ...DEFAULT_WORK,
};

/**
 * A place along a street where a crossroads can be built (every PLOT_SPACING,
 * so streets keep to one grid and meet at a plot of each). Other buildings
 * stand anywhere they fit on the land grid (grid.ts).
 */
export interface Plot {
  index: number;
  /** The street it is on (streets.ts). */
  street: number;
  /** Centre x in world px. */
  x: number;
  /** The crossroads standing on it; a crossroads stands on a plot of each of its two streets. */
  buildingId: number | null;
  /** No plot: past the end of its street (which ended short where it met another). */
  off?: true;
}

/** Being built, standing, or being pulled down (demolition.ts). */
export type BuildingStatus = 'constructing' | 'done' | 'demolishing';

export interface Building {
  id: number;
  type: BuildingType;
  /** World x of the middle of its footprint (grid.ts): which street, and where along it. */
  x: number;
  /** A house merged with its neighbours: two or three small houses' width (mergeHouses). */
  size?: 2 | 3;
  /** 0..1 construction progress (of its upgrade, while one is being built). */
  progress: number;
  status: BuildingStatus;
  /** World time (s) at which the building was completed; used for the completion effect. */
  completedAt: number | null;
  /** The building's own store (capacities in its BuildingDef). */
  stock: Stock;
  /** While under construction or being upgraded: the materials brought so far (site.ts). */
  site?: Site;
  /** Upgraded (BuildingDef.upgrade): it gives the upgrade's jobs. */
  upgraded?: true;
  /** A crossroads made where a new street met an old one (not built from the menu). */
  junction?: true;
  /** While being pulled down: how far it has to go (demolition.ts). */
  demolition?: Demolition;
  /** Fields — farms only, once finished. */
  farm?: FarmState;
}

export interface Rider {
  x: number;
  vx: number;
  facing: 1 | -1;
  /** Accumulated gait phase — advances with distance travelled. */
  gait: number;
  /** World time of the last turn onto another street at a crossroads (not saved). */
  turnedAt?: number;
}

/** What can be done to a building from its menu: pulling down just the section the rider is at, of a merged one. */
export type BuildingOption = 'upgrade' | 'demolishSection' | 'demolish';

/** The menu open where the rider is: what to build there (at world x), or what to do with the building there. */
export type BuildMenu =
  /** fits: which of BUILDING_TYPES fit where the rider is, worked out once as the menu opens; only those can be chosen. */
  | { kind: 'build'; x: number; selection: number; fits: boolean[] }
  | { kind: 'building'; buildingId: number; options: BuildingOption[]; selection: number; x: number };

export interface GameEvent {
  kind: 'placed' | 'completed' | 'upgraded' | 'demolished';
  buildingId: number;
}

export interface World {
  time: number;
  /** The street network (streets.ts): the main street first, then each street in the order it was opened. */
  streets: Street[];
  /** Where streets meet (streets.ts); rebuilt with the streets. */
  junctions: Junction[];
  /** Every street's plots, street by street. */
  plots: Plot[];
  buildings: Building[];
  rider: Rider;
  /** Every villager, employed or not (people.ts). */
  people: Person[];
  animals: Animal[];
  /** The woods behind the street (nature.ts). */
  trees: Tree[];
  /** Things lying on the ground by the road, waiting to be carried off (piles.ts). */
  piles: Pile[];
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
  /** Galloping: the way being ridden was tapped twice and is held (app/controls.ts). */
  sprint?: boolean;
}

/** Deterministic RNG (mulberry32) stored in world state so tests are reproducible. */
export function rand(world: World): number {
  let t = (world.rngState = (world.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The starting village: where each building stands along the main street (world x), and what it is. */
const STARTING_VILLAGE: Array<[number, BuildingType]> = [
  [925, 'house'],
  [1000, 'house'],
  [1150, 'well'],
  [1300, 'tavern'],
  [1600, 'warehouse'],
  [1675, 'warehouse'],
  [1900, 'house'],
  [2350, 'farm'],
  [3100, 'chapel'],
  [4375, 'house'],
];

export interface CreateWorldOptions {
  seed?: number;
  /** Pre-build the starting village (default true). */
  village?: boolean;
}

export { PLOTS_PER_STREET };

/** Mark out the plots of a street: plot k of street i is plots[i × PLOTS_PER_STREET + k]; those past its ends are `off`. */
function layPlots(world: World, s: Street): void {
  for (let k = 0; k < PLOTS_PER_STREET; k++) {
    const plot: Plot = { index: world.plots.length, street: s.index, x: plotX(s.index, k), buildingId: null };
    if (k < s.lo || k > s.hi) plot.off = true;
    world.plots.push(plot);
  }
}

/** Plot k of street i. */
const plotOf = (world: World, street: number, k: number) => world.plots[street * PLOTS_PER_STREET + k];

export function createWorld(opts: CreateWorldOptions = {}): World {
  const world: World = {
    time: 0,
    streets: [mainStreet()],
    junctions: [],
    plots: [],
    buildings: [],
    rider: { x: 1800, vx: 0, facing: 1, gait: 0 },
    people: [],
    animals: [],
    trees: [],
    piles: [],
    constructionEnabled: true,
    params: { ...DEFAULT_PARAMS },
    menu: null,
    lastSelection: 0,
    nextId: 1,
    rngState: opts.seed ?? 1337,
    dayClock: 0,
    events: [],
  };
  layPlots(world, world.streets[0]);

  if (opts.village ?? true) {
    for (const [x, type] of STARTING_VILLAGE) {
      const b = placeBuilding(world, x, type, { instant: true, free: true });
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
        x: FIRST_PLOT_X + rand(world) * 4000,
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
    plantWoods(world, 0, () => rand(world));
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
    if (p.off) continue;
    const d = Math.abs(p.x - x);
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** The crossroads place (plot) nearest world x on its street, if one is there. */
function crossroadsPlot(world: World, x: number): Plot | null {
  const street = streetOf(x);
  const k = Math.round((x - plotX(street, 0)) / PLOT_SPACING);
  const plot = k >= 0 && k < PLOTS_PER_STREET ? world.plots[street * PLOTS_PER_STREET + k] : undefined;
  return plot && !plot.off && plot.street === street ? plot : null;
}

/** Where a building of this type goes when wanted at world x: starting at the cell 3n + 1 of x's block; a crossroads on that block's plot. */
export function placeAt(world: World, type: BuildingType, x: number): number | null {
  if (type !== 'intersection') return siteX(type, x);
  return crossroadsPlot(world, blockStartX(x) + CELL_W)?.x ?? null;
}

/** Why a building of this type can't be built where the rider wants it (world x), or null if it can. */
export function whyNotBuild(world: World, type: BuildingType, x: number): string | null {
  if (closing(world, streetOf(x))) return 'This street is being closed';
  const at = placeAt(world, type, x);
  if (at === null) return 'No room for a road here';
  if (type === 'intersection' && crossroadsPlot(world, at)?.buildingId != null) return 'There is a crossroads here already';
  if (type === 'intersection' && !onRoadGrid(world, at)) return 'Crossroads go only every 30 cells';
  const why = whyNotHere(world, type, at);
  if (why || type !== 'intersection') return why;
  // its road would run onto another road, and not meet it at a crossroads
  return planStreet(world, -1, at).clear ? null : 'Another road is too close';
}

export function placeBuilding(
  world: World,
  /** Where the rider wants it (world x): it goes on whole cells there (placeAt). */
  wantX: number,
  type: BuildingType,
  /**
   * instant: skip construction (materials are taken from the warehouses at
   * once); free: needs nothing from the warehouses (the starting village).
   */
  opts: { instant?: boolean; free?: boolean } = {},
): Building | null {
  const x = placeAt(world, type, wantX);
  if (x === null || whyNotBuild(world, type, wantX)) return null;
  // the warehouses must hold its materials, beyond what other sites are owed
  if (!opts.free && Object.keys(buildShortfall(world, type)).length) return null;
  const instant = opts.instant ?? !world.constructionEnabled;
  if (instant && !opts.free) takeFromWarehouses(world, BUILDINGS[type].cost, x);
  let b: Building = {
    id: world.nextId++,
    type,
    x,
    progress: instant ? 1 : 0,
    status: instant ? 'done' : 'constructing',
    completedAt: instant ? world.time : null,
    stock: stockOf(),
  };
  // builders bring the materials and build it (a free one has its materials on site already)
  if (!instant) b.site = createSite(type, opts.free ? BUILDINGS[type].cost : {});
  world.buildings.push(b);
  if (instant && type === 'farm') b.farm = createFarm({ spots: farmFieldSpots(world, b) });
  if (instant) b = mergeNeighbours(world, b);
  if (type === 'intersection') crossroadsPlot(world, x)!.buildingId = b.id;
  if (instant && type === 'intersection') openStreet(world, b);
  // the new footprint may cover land neighbouring farms were using; trees standing on it are cut down
  syncFarmFields(world);
  clearLand(world);
  world.events.push({ kind: 'placed', buildingId: b.id });
  if (instant) world.events.push({ kind: 'completed', buildingId: b.id });
  return b;
}

/**
 * The building the rider at world x is at: a crossroads within a lane of x,
 * else the one on this street whose footprint x is in front of.
 */
export function buildingAt(world: World, x: number): Building | undefined {
  const plot = crossroadsPlot(world, x);
  if (plot && plot.buildingId !== null && Math.abs(plot.x - x) <= 1.5 * CELL_W) return getBuilding(world, plot.buildingId);
  const street = streetOf(x);
  return world.buildings.find((b) => b.type !== 'intersection' && streetOf(b.x) === street && Math.abs(b.x - x) <= (sizeOfBuilding(b).w * CELL_W) / 2);
}

/** Whether a building can be upgraded now: finished, with an upgrade it hasn't had, and not already being upgraded. */
export function canUpgrade(b: Building): boolean {
  return b.status === 'done' && !!BUILDINGS[b.type].upgrade && !b.upgraded && !b.site;
}

/**
 * Start upgrading a building: builders bring the materials and build it on
 * while it keeps working (with construction off it is upgraded at once).
 * Returns whether it started; the warehouses must hold the materials.
 */
export function upgradeBuilding(world: World, b: Building): boolean {
  const upgrade = BUILDINGS[b.type].upgrade;
  if (!upgrade || !canUpgrade(b) || Object.keys(upgradeShortfall(world, b)).length) return false;
  if (world.constructionEnabled) {
    b.site = createSite(b.type);
    b.progress = 0;
  } else {
    takeFromWarehouses(world, upgrade.cost, b.x);
    b.site = createSite(b.type, upgrade.cost);
    complete(world, b);
  }
  return true;
}

/**
 * Whether a building can be offered for pulling down: anything not already
 * coming down, but a crossroads made where two streets met (it goes with the
 * street that made it). Whether it may be pulled down now: whyNotDemolish.
 */
export function canDemolish(b: Building): boolean {
  return b.status !== 'demolishing' && !b.junction;
}

/** The street a finished crossroads opened, if any. */
export function streetFrom(world: World, b: Building): Street | undefined {
  return b.type === 'intersection' ? world.streets.find((s) => !s.gone && s.from === b.id) : undefined;
}

/**
 * Why a building can't be pulled down now, or null if it can. A crossroads
 * takes the street it opened with it, so that street must have nothing on it
 * but the crossroads where it met other streets: no building, and no other
 * crossroads opening a street of its own.
 */
export function whyNotDemolish(world: World, b: Building): string | null {
  if (!canDemolish(b)) return 'It cannot be pulled down';
  const street = streetFrom(world, b);
  if (!street) return null;
  if (world.buildings.some((o) => o.type !== 'intersection' && streetOf(o.x) === street.index)) return 'Its street has buildings on it';
  const crossroads = world.plots.filter((p) => p.street === street.index && p.buildingId !== null && p.buildingId !== b.id).map((p) => getBuilding(world, p.buildingId));
  if (crossroads.some((o) => o && !o.junction)) return 'Another street branches off its street';
  return null;
}

/** Whether street i is closing: the crossroads that opened it is being pulled down (nothing new is built on it). */
const closing = (world: World, i: number) => {
  const from = world.streets[i]?.from;
  return from != null && getBuilding(world, from)?.status === 'demolishing';
};

/** What pulling a building down leaves lying: its materials (built in or brought to its site) and its store. */
export function demolitionYield(b: Building): Stock {
  const left = materialsIn(b);
  for (const r of RESOURCES) left[r] += b.stock[r];
  return left;
}

/**
 * Start pulling a building down: builders take it apart in half the time it
 * took to build (demolition.ts), its materials left on the ground in front of
 * it as it comes down, for serfs to carry off (piles.ts). What is in its store
 * is put out on the ground at once, and its workers put down whatever they
 * carry and are let go. With construction off it comes down at once.
 * Returns whether it started.
 */
export function demolish(world: World, b: Building): boolean {
  if (whyNotDemolish(world, b)) return false;
  const x = b.x;
  for (const p of employees(world, b)) {
    const w = p.job!.worker;
    if (w.carrying) dropOnGround(world, x + w.dx, w.carrying);
    release(world, p);
  }
  dropAll(world, x, b.stock);
  b.demolition = { work: demolitionWork(b), from: b.status === 'done' ? 1 : Math.max(b.progress, 1e-3), left: materialsIn(b) };
  b.stock = stockOf();
  b.progress = b.demolition.from;
  b.status = 'demolishing';
  delete b.site;
  delete b.farm;
  if (world.menu?.kind === 'building' && world.menu.buildingId === b.id) world.menu = null;
  // a farm's fields are gone with it
  syncFarmFields(world);
  if (!world.constructionEnabled) tearDown(world, b, Infinity);
  return true;
}

/** A building is down: its plot is free again. */
function pulledDown(world: World, b: Building): void {
  for (const p of employees(world, b)) release(world, p);
  const street = streetFrom(world, b);
  if (street) closeStreet(world, b, street);
  world.buildings = world.buildings.filter((o) => o !== b);
  for (const p of world.plots) if (p.buildingId === b.id) p.buildingId = null;
  // its land is free again for the neighbouring farms' fields
  syncFarmFields(world);
  world.events.push({ kind: 'demolished', buildingId: b.id });
}

/**
 * A crossroads is down, and the street it opened goes with it: the crossroads
 * where that street met others go too (their plots on the other streets are
 * free again), and whoever and whatever was on it is moved to where the
 * crossroads stood. The street keeps its place in the list (world x's are
 * worked out from it), as one that is gone: no road, no plots.
 */
function closeStreet(world: World, b: Building, street: Street): void {
  const own = world.junctions.find((j) => j.buildingId === b.id);
  const here = own ? (streetOf(own.a) === street.index ? own.b : own.a) : b.x;
  const on = (x: number) => streetOf(x) === street.index;
  const gone = world.junctions.filter((j) => on(j.a) || on(j.b));
  world.junctions = world.junctions.filter((j) => !gone.includes(j));
  for (const j of gone) {
    const jb = getBuilding(world, j.buildingId);
    if (jb?.junction && !world.junctions.some((o) => o.buildingId === jb.id)) {
      world.buildings = world.buildings.filter((o) => o !== jb);
      for (const p of world.plots) if (p.buildingId === jb.id) p.buildingId = null;
    }
  }
  for (const p of world.plots) {
    if (p.street !== street.index) continue;
    p.off = true;
    p.buildingId = null;
  }
  street.gone = true;
  street.lo = CROSS_PLOT;
  street.hi = CROSS_PLOT - 1;
  // everyone and everything on it comes back to the crossroads' spot
  if (on(world.rider.x)) world.rider.x = here;
  for (const who of [...world.people, ...world.animals]) if (on(who.stroll.x)) who.stroll.x = here;
  for (const pile of world.piles) if (on(pile.x)) pile.x = here;
  for (const p of world.people) {
    const at = p.job && getBuilding(world, p.job.buildingId);
    if (!at) continue;
    const x0 = at.x;
    const w = p.job!.worker;
    if (on(x0 + w.dx)) w.dx = here - x0;
    if (w.task.kind === 'walk' && on(x0 + w.task.toDx)) w.task.toDx = here - x0;
  }
  world.trees = world.trees.filter((t) => !on(t.x));
}

/** A street that is gone (save.ts): its place in the list, with no road and no plots. */
export function goneStreet(world: World): Street {
  const street: Street = { ...mainStreet(), index: world.streets.length, gone: true, lo: CROSS_PLOT, hi: CROSS_PLOT - 1 };
  world.streets.push(street);
  layPlots(world, street);
  return street;
}

/**
 * Toggle the construction phase. Turning it off finishes every building
 * currently under construction (or being upgraded) immediately, taking
 * whatever materials it still lacks from the warehouses.
 */
export function setConstructionEnabled(world: World, enabled: boolean): void {
  world.constructionEnabled = enabled;
  if (!enabled) {
    for (const b of world.buildings) {
      if (!b.site) continue;
      const lacks = { ...siteWork(b).cost };
      for (const r of RESOURCES) lacks[r] = Math.max(0, (lacks[r] ?? 0) - (b.site?.delivered[r] ?? 0));
      takeFromWarehouses(world, lacks, b.x);
      complete(world, b);
    }
  }
}

function complete(world: World, b: Building): void {
  const upgrade = upgrading(b);
  b.progress = 1;
  b.status = 'done';
  b.completedAt = world.time;
  delete b.site;
  // the builders are done here and walk off from where they stand (nobody
  // carries anything by then: every load was put in place before the last
  // of the work, unless construction was just switched off, which is instant)
  for (const p of builders(world, b)) {
    const load = p.job!.worker.carrying;
    if (load) putAway(world, load, b.x + p.job!.worker.dx);
    release(world, p);
  }
  if (upgrade) {
    // the building's own workers carry on; it now gives the upgrade's jobs (a farm, more fields)
    b.upgraded = true;
    if (b.farm) syncFarmFields(world);
    world.events.push({ kind: 'upgraded', buildingId: b.id });
    return;
  }
  if (b.type === 'farm') b.farm = createFarm({ spots: farmFieldSpots(world, b) });
  b = mergeNeighbours(world, b);
  if (b.type === 'intersection') {
    openStreet(world, b);
    syncFarmFields(world);
  }
  // nothing grows on the farm's fields
  if (b.type === 'farm') clearLand(world);
  world.events.push({ kind: 'completed', buildingId: b.id });
}

/** Buildings that grow by merging with their own kind beside them: up to three small ones in one (Building.size). */
export const MERGES: Partial<Record<BuildingType, true>> = { house: true, warehouse: true };
const MAX_SIZE = 3;

/** Workers at `from` now work at `to`, standing where they stood. */
function moveStaff(world: World, from: Building, to: Building): void {
  for (const p of employees(world, from)) {
    p.job!.buildingId = to.id;
    p.job!.worker.dx += from.x - to.x;
  }
}

/**
 * A small house or storage yard is finished: it is built onto a finished one
 * of its kind right beside it, the two one building of their widths together
 * (medium, then large), no wider than three small ones. The older takes in
 * the newer, with its store and its workers. Returns the building it is now
 * part of.
 */
export function mergeNeighbours(world: World, b: Building): Building {
  if (!MERGES[b.type]) return b;
  for (;;) {
    const fb = footprintOf(b)!;
    const o = world.buildings.find((o) => {
      if (o === b || o.type !== b.type || o.status !== 'done' || o.site || streetOf(o.x) !== streetOf(b.x)) return false;
      const fo = footprintOf(o)!;
      return (fo.i1 + 1 === fb.i0 || fb.i1 + 1 === fo.i0) && (o.size ?? 1) + (b.size ?? 1) <= MAX_SIZE;
    });
    if (!o) return b;
    const fo = footprintOf(o)!;
    const [keep, gone] = o.id < b.id ? [o, b] : [b, o];
    const size = ((o.size ?? 1) + (b.size ?? 1)) as 2 | 3;
    const oldX = keep.x;
    keep.x = streetStart(streetOf(b.x)) + (Math.min(fb.i0, fo.i0) + (size * BLOCK) / 2) * CELL_W;
    keep.size = size;
    keep.completedAt = world.time;
    for (const r of RESOURCES) keep.stock[r] += gone.stock[r];
    for (const p of employees(world, keep)) p.job!.worker.dx += oldX - keep.x;
    moveStaff(world, gone, keep);
    world.buildings = world.buildings.filter((x) => x !== gone);
    if (world.menu?.kind === 'building' && world.menu.buildingId === gone.id) world.menu = null;
    b = keep;
  }
}

/**
 * Pull down the section of three cells of a merged building that world x is
 * in: the section is split off as a small building of its own and pulled
 * down; what stands either side of it stands on, as one or two buildings
 * (a large house losing its middle is two small ones), each merging with one
 * of its kind beside it where they fit (mergeNeighbours). Its store is shared
 * out by width. Returns whether it started.
 */
export function demolishSection(world: World, b: Building, x: number): boolean {
  const size = b.size ?? 1;
  if (size < 2 || whyNotDemolish(world, b)) return false;
  const f = footprintOf(b)!;
  const start = streetStart(streetOf(b.x));
  const k = Math.max(0, Math.min(size - 1, Math.floor((alongCell(x) - f.i0) / BLOCK)));
  const xOf = (i0: number, n: number) => start + (i0 + (n * BLOCK) / 2) * CELL_W;
  const share = (n: number) => {
    const s = stockOf();
    for (const r of RESOURCES) s[r] = (b.stock[r] * n) / size;
    return s;
  };
  const fresh = (i0: number, n: number): Building => ({
    id: world.nextId++,
    type: b.type,
    x: xOf(i0, n),
    ...(n > 1 ? { size: n as 2 | 3 } : {}),
    progress: 1,
    status: 'done',
    completedAt: b.completedAt,
    stock: share(n),
  });
  const before = k;
  const after = size - k - 1;
  const section = fresh(f.i0 + k * BLOCK, 1);
  const later = before && after ? fresh(f.i0 + (k + 1) * BLOCK, after) : null;
  // b stands on (its workers too) as the part before the section, or else as the part after it
  const [i0, n] = before ? [f.i0, before] : [f.i0 + (k + 1) * BLOCK, after];
  const oldX = b.x;
  b.x = xOf(i0, n);
  b.stock = share(n);
  if (n > 1) b.size = n as 2 | 3;
  else delete b.size;
  for (const p of employees(world, b)) p.job!.worker.dx += oldX - b.x;
  world.buildings.push(section, ...(later ? [later] : []));
  world.menu = null;
  if (!demolish(world, section)) return false;
  // what stands on either side may now be built onto a small one of its kind beside it, as a new one would be
  mergeNeighbours(world, b);
  if (later) mergeNeighbours(world, later);
  return true;
}

// --- Streets -------------------------------------------------------------------

/**
 * Where the street a crossroads at world x would open runs (streets.ts): from
 * its crossroads plot, plot by plot both ways, up to a street's length. Where
 * it comes to a street crossing its way it joins it if that street's plot
 * there is free (a crossroads is made there, and it runs on across) and ends
 * one plot short of it otherwise; it ends one plot short of a street running
 * along the same line, and of the end of a road crossing its way past its last
 * plot. Its road runs on past its last plot (STREET_END_RUN), so it ends as
 * many plots shorter again as that needs to keep off any road it doesn't meet,
 * with a cell of grass between;
 * `clear` is false if even its crossroads plot is too close for that (it can't
 * be built there: whyNotBuild). Changes nothing.
 */
export function planStreet(world: World, from: number, at: number): { street: Street; joins: Array<{ k: number; plot: Plot }>; clear: boolean } {
  const street = newStreet(world, from, at);
  let joins: Array<{ k: number; plot: Plot }> = [];
  let clear = true;
  const stubInWay = (end: number, step: number) => {
    const t = plotX(street.index, end) - streetStart(street.index);
    // (a cell of grass short of it, so the end doesn't look like a turning)
    return roadInWay(world, street, t + step * 1.5 * CELL_W, t + step * (STREET_END_RUN + CELL_W));
  };
  for (const step of [-1, 1]) {
    for (let k = CROSS_PLOT + step; k >= 0 && k < PLOTS_PER_STREET; k += step) {
      const meet = streetsAt(world, street.dir, plotPoint(street, k));
      // it stops short of a street along the same line, and of a quarry or a building in its way (a quarry beside it is no matter)
      const t = plotX(street.index, k) - streetStart(street.index);
      if (meet.along || meet.blocked || roadBlocked(world, street, t - step * PLOT_SPACING, t + step * STREET_END_RUN)) break;
      if (meet.crossing) {
        const plot = plotOf(world, meet.crossing.street, meet.crossing.k);
        const there = getBuilding(world, plot.buildingId);
        if (plot.buildingId !== null && !there?.junction) break;
        joins.push({ k, plot });
      }
      if (step < 0) street.lo = k;
      else street.hi = k;
    }
    // back off, plot by plot, until the road past the end doesn't run onto a road it doesn't meet
    for (let end = step < 0 ? street.lo : street.hi; stubInWay(end, step); end = step < 0 ? ++street.lo : --street.hi) {
      if (end === CROSS_PLOT) {
        clear = false;
        break;
      }
    }
  }
  joins = joins.filter(({ k }) => k >= street.lo && k <= street.hi);
  return { street, joins, clear };
}

/**
 * Lay out the street a finished crossroads opens (planStreet). Loading a save
 * lays the streets out again this way, in order (the crossroads made where
 * streets met are saved, so they are found again).
 */
export function layStreet(world: World, b: Building): Street {
  const at = b.x;
  const { street, joins } = planStreet(world, b.id, at);
  world.streets.push(street);
  layPlots(world, street);
  plotOf(world, street.index, CROSS_PLOT).buildingId = b.id;
  world.junctions.push({ buildingId: b.id, a: at, b: plotX(street.index, CROSS_PLOT) });
  for (const { k, plot } of joins) {
    const j = getBuilding(world, plot.buildingId) ?? makeJunction(world, plot);
    plotOf(world, street.index, k).buildingId = j.id;
    world.junctions.push({ buildingId: j.id, a: plot.x, b: plotX(street.index, k) });
  }
  return street;
}

/** A crossroads where a new street met an old one at a free plot of it. */
function makeJunction(world: World, plot: Plot): Building {
  const b: Building = { id: world.nextId++, type: 'intersection', x: plot.x, progress: 1, status: 'done', completedAt: world.time, stock: stockOf(), junction: true };
  world.buildings.push(b);
  plot.buildingId = b.id;
  return b;
}

/** A crossroads is finished: its road runs off into a new street, with woods of its own. */
function openStreet(world: World, b: Building): void {
  const street = layStreet(world, b);
  // the new road is cut through the woods, and woods of its own grow along it
  clearLand(world);
  plantWoods(world, street.index, () => rand(world));
}

/**
 * The crossroads the rider is at: the street it turns onto, and the same
 * spot's x on that street.
 */
export function crossroadAt(world: World): { building: Building; street: number; x: number } | null {
  const plot = plotAt(world, world.rider.x);
  const b = getBuilding(world, plot?.buildingId ?? null);
  // (one being pulled down can still be turned at until it is down)
  if (!plot || !b || b.type !== 'intersection' || b.status === 'constructing') return null;
  const j = world.junctions.find((o) => o.buildingId === b.id);
  if (!j) return null;
  const to = j.a === plot.x ? j.b : j.a;
  return { building: b, street: streetOf(to), x: to };
}

/**
 * At a crossroads, turn onto the street crossing this one: `up` into the road
 * running away from the viewer, `down` into the one coming towards them.
 * Returns whether the rider turned.
 */
export function turnAtCrossroads(world: World, way: 'up' | 'down'): boolean {
  const c = world.menu ? null : crossroadAt(world);
  if (!c) return false;
  return turnOnto(world, c, turnFacing(world, streetOf(world.rider.x), c.street, way));
}

/**
 * At a crossroads, turn onto the crossing street if it runs along map
 * direction v (the view from above), heading that way. Returns whether the
 * rider turned.
 */
export function turnToward(world: World, v: Vec): boolean {
  const c = world.menu ? null : crossroadAt(world);
  if (!c) return false;
  const d = world.streets[c.street].dir;
  const along = d.x * v.x + d.y * v.y;
  const here = world.streets[streetOf(world.rider.x)].dir;
  // only when v points more along the crossing street than this one
  if (Math.abs(along) <= Math.abs(here.x * v.x + here.y * v.y)) return false;
  return turnOnto(world, c, along > 0 ? 1 : -1);
}

function turnOnto(world: World, c: { x: number }, facing: 1 | -1): boolean {
  const r = world.rider;
  r.x = c.x;
  r.facing = facing;
  r.vx = facing * Math.abs(r.vx) * 0.5;
  r.turnedAt = world.time;
  return true;
}

// --- Build menu ------------------------------------------------------------

/** Whether anything at all could be built in the block of three cells the rider is in (world x): buildings start at its cell 3n + 1. */
export const roomToBuild = (world: World, x: number) => BUILDING_TYPES.some((t) => !whyNotBuild(world, t, x));

/**
 * Open the menu where the rider is: on a building, upgrade it (when it can
 * be) or pull it down; anywhere else, what to build there, if anything fits
 * (the choice starts on the last one built, or else the first that fits).
 * Returns whether a menu opened.
 */
export function openMenu(world: World): boolean {
  const x = world.rider.x;
  const b = buildingAt(world, x);
  if (b) {
    if (!canDemolish(b)) return false;
    const options: BuildingOption[] = [...(canUpgrade(b) ? ['upgrade' as const] : []), ...((b.size ?? 1) > 1 ? ['demolishSection' as const] : []), 'demolish'];
    world.menu = { kind: 'building', buildingId: b.id, options, selection: 0, x };
  } else {
    const fits = BUILDING_TYPES.map((t) => !whyNotBuild(world, t, x));
    if (!fits.includes(true)) return false;
    world.menu = { kind: 'build', x, selection: fits[world.lastSelection] ? world.lastSelection : fits.indexOf(true), fits };
  }
  world.rider.vx = 0;
  return true;
}

const menuSize = (menu: BuildMenu) => (menu.kind === 'build' ? BUILDING_TYPES.length : menu.options.length);

/** Whether menu entry i can be chosen: in the build menu, only what fits. */
export const canChoose = (menu: BuildMenu, i: number) => menu.kind !== 'build' || !!menu.fits[i];

/** Move the selection by delta entries that can be chosen, round and round, jumping over the rest. */
export function moveMenu(world: World, delta: number): void {
  const menu = world.menu;
  if (!menu) return;
  const n = menuSize(menu);
  let i = menu.selection;
  for (let k = 0; k < Math.abs(delta); k++) {
    for (let step = 0; step < n; step++) {
      i = (((i + Math.sign(delta)) % n) + n) % n;
      if (canChoose(menu, i)) break;
    }
  }
  menu.selection = i;
}

export function selectMenu(world: World, index: number): void {
  if (!world.menu || index < 0 || index >= menuSize(world.menu) || !canChoose(world.menu, index)) return;
  world.menu.selection = index;
}

/** Build what is chosen in the build menu. */
export function confirmMenu(world: World): Building | null {
  if (world.menu?.kind !== 'build') return null;
  const { x, selection } = world.menu;
  closeMenu(world);
  return placeBuilding(world, x, BUILDING_TYPES[selection]);
}

export function closeMenu(world: World): void {
  if (world.menu?.kind === 'build') world.lastSelection = world.menu.selection;
  world.menu = null;
}

// --- Update ----------------------------------------------------------------

export function update(world: World, dt: number, input: MoveInput): void {
  world.time += dt;
  const clockBefore = world.dayClock;
  world.dayClock += dt * world.params.timeSpeed;
  eatAtTaverns(world, clockBefore);
  updateRider(world, dt, world.menu ? { left: false, right: false } : input);
  staff(world);
  for (const b of world.buildings) if (b.farm) updateCrops(b.farm, dt);
  updateForest(world, dt, () => rand(world));
  updateWorkers(world, dt);
  // a site whose builders have done all the work is finished
  for (const b of world.buildings) if (b.site && b.progress >= 1) complete(world, b);
  // and one being pulled down that is down is gone
  for (const b of [...world.buildings]) if (b.status === 'demolishing' && b.progress <= 1e-9) pulledDown(world, b);
  updateStrolls(world, dt, () => rand(world));
}

/**
 * A building as a workplace for the people it employs in `role`; null if it
 * has no work to give. Builders work on its site (a building being upgraded
 * is a site for them, and its usual workplace for everyone else).
 */
export function workplaceOf(world: World, b: Building, role: Role): Workplace | null {
  if (b.status === 'demolishing') return role === 'builder' ? demolitionWorkplace(world, b) : null;
  if (b.site && (b.status !== 'done' || role === 'builder')) return siteWorkplace(world, b, world.params.buildSpeed);
  if (b.farm) return farmWorkplace(b.farm, b.stock, world.params);
  const recipe = BUILDINGS[b.type].makes;
  if (recipe && b.status === 'done') return workshopWorkplace(world, b, recipe);
  if (isGatherHut(b.type) && b.status === 'done') return gatherWorkplace(world, b as Building & { type: typeof b.type });
  if (b === transportHub(world)) return transportWorkplace(world, b);
  return null;
}

/** Hire for open jobs; builders and serfs work day and night. */
function staff(world: World): void {
  const hub = transportHub(world);
  const openingsOf = (b: Building) => (b === hub ? { serf: serfPositions(world) } : openings(b, builderPositions(world, b), true));
  staffBuildings(world, (b, role, who) => newWorker(world, b, role, who), openingsOf);
}

/** A new hand walks over from exactly where they are on the street. */
function newWorker(world: World, b: Building, role: Role, who: Person): Worker {
  const place = workplaceOf(world, b, role)!;
  const w = createWorker(place);
  w.dx = who.stroll.x - b.x;
  w.y = who.stroll.y;
  w.facing = w.dx > 0 ? -1 : 1;
  w.task = { kind: 'idle', wait: 0.2 };
  return w;
}

function updateWorkers(world: World, dt: number): void {
  const now = timeOfDay(world);
  for (const b of world.buildings) {
    const people = employees(world, b);
    if (!people.length) continue;
    const nav: Nav = { x: b.x, route: (from, to) => route(world, from, to) };
    // each role at the building works at its own workplace, alongside the others in that role
    const places = new Map<Role, Workplace | null>();
    for (const p of people) {
      const role = p.job!.role;
      if (!places.has(role)) places.set(role, workplaceOf(world, b, role));
      const place = places.get(role);
      if (!place) continue;
      const staffers = people.filter((o) => o.job?.role === role).map((o) => o.job!.worker);
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
      updateWorker(w, place, dt, now, taken, nav);
    }
  }
}

function updateRider(world: World, dt: number, input: MoveInput): void {
  const r = world.rider;
  const p = world.params;
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const sprint = dir !== 0 && !!input.sprint;
  const top = p.riderMaxSpeed * (sprint ? SPRINT_SPEED : 1);
  if (dir !== 0) {
    r.vx += dir * p.riderAccel * (sprint ? SPRINT_ACCEL : 1) * dt;
    // past the top speed (the sprint let go of) it eases back down rather than stopping short
    if (Math.abs(r.vx) > top) r.vx = Math.sign(r.vx) * Math.max(top, Math.abs(r.vx) - p.riderDecel * dt);
  } else {
    const dv = p.riderDecel * dt;
    r.vx = Math.abs(r.vx) <= dv ? 0 : r.vx - Math.sign(r.vx) * dv;
  }
  // a street that isn't there (a broken save): back to the main street
  if (!world.streets[streetOf(r.x)]) r.x = world.plots[0].x;
  const { min, max } = streetRange(world, streetOf(r.x));
  r.x += r.vx * dt;
  if (r.x < min || r.x > max) {
    r.x = Math.max(min, Math.min(max, r.x));
    r.vx = 0;
  }
  // the horse faces the way it is going: braking, it still faces forward; standing, the way it is asked to go
  if (r.vx !== 0) r.facing = r.vx > 0 ? 1 : -1;
  else if (dir !== 0) r.facing = dir as 1 | -1;
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
