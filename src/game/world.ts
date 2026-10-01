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
import { FIRST_PLOT_X, PLOT_SPACING, STREET_LENGTH } from './layout';
import { clearLand, plantWoods, gatherWorkplace, isGatherHut, updateForest, type Tree } from './nature';
import { employees, laneY, nameFor, openings, release, staffBuildings, updateStrolls, type Animal, type Look, type Person } from './people';
import { builderPositions, builders, createSite, siteWork, siteWorkplace, upgrading, type Site } from './site';
import { RESOURCES, stockOf, type Stock } from './resources';
import { CROSS_PLOT, mainStreet, newStreet, onQuarryLand, STREET_BAND_HALF, STREET_END_RUN, plotPoint, plotX, PLOTS_PER_STREET, route, streetOf, streetRange, streetsAt, turnFacing, type Junction, type Street, type Vec } from './streets';
import { eatAtTaverns } from './tavern';
import { serfPositions, transportHub, transportWorkplace } from './transport';
import { createWorker, currentJob, offDuty, updateWorker, type Nav, type Worker, type Workplace } from './worker';
import { workshopWorkplace } from './workshop';

/** Length of each street (streets.ts). */
export const WORLD_WIDTH = STREET_LENGTH;
export const PLOT_WIDTH = 200;
export { FIRST_PLOT_X, PLOT_SPACING };
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

export interface Plot {
  index: number;
  /** The street it is on (streets.ts). */
  street: number;
  /** Centre x in world px. */
  x: number;
  /** What stands on it; a crossroads stands on a plot of each of its two streets. */
  buildingId: number | null;
  /** Past the end of its street (which ended short where it met another): no plot. */
  off?: true;
}

export type BuildingStatus = 'constructing' | 'done';

export interface Building {
  id: number;
  type: BuildingType;
  plotIndex: number;
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

export interface BuildMenu {
  plotIndex: number;
  selection: number;
}

export interface GameEvent {
  kind: 'placed' | 'completed' | 'upgraded';
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
  [16, 'house'],
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
    rider: { x: FIRST_PLOT_X + 5 * PLOT_SPACING + PLOT_SPACING / 2, vx: 0, facing: 1, gait: 0 },
    people: [],
    animals: [],
    trees: [],
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
  if (!plot || plot.off || plot.buildingId !== null) return null;
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
  plot.buildingId = b.id;
  if (instant && type === 'intersection') openStreet(world, b);
  // the new footprint may cover land neighbouring farms were using; trees standing on it are cut down
  syncFarmFields(world);
  clearLand(world);
  world.events.push({ kind: 'placed', buildingId: b.id });
  if (instant) world.events.push({ kind: 'completed', buildingId: b.id });
  return b;
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
    takeFromWarehouses(world, upgrade.cost, world.plots[b.plotIndex].x);
    b.site = createSite(b.type, upgrade.cost);
    complete(world, b);
  }
  return true;
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
      takeFromWarehouses(world, lacks, world.plots[b.plotIndex].x);
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
    if (load) putAway(world, load, world.plots[b.plotIndex].x + p.job!.worker.dx);
    release(world, p);
  }
  if (upgrade) {
    // the building's own workers carry on; it now gives the upgrade's jobs
    b.upgraded = true;
    world.events.push({ kind: 'upgraded', buildingId: b.id });
    return;
  }
  if (b.type === 'farm') b.farm = createFarm({ spots: farmFieldSpots(world, b) });
  if (b.type === 'intersection') {
    openStreet(world, b);
    syncFarmFields(world);
  }
  // nothing grows on the farm's fields
  if (b.type === 'farm') clearLand(world);
  world.events.push({ kind: 'completed', buildingId: b.id });
}

// --- Streets -------------------------------------------------------------------

/**
 * Lay out the street a finished crossroads opens (streets.ts): from its
 * crossroads plot, plot by plot both ways, up to a street's length. Where it
 * comes to a street crossing its way it joins it if that street's plot there
 * is free (a crossroads is made there, and it runs on across) and ends one
 * plot short of it otherwise; it ends one plot short of a street running along
 * the same line. Loading a save lays the streets out again this way, in order
 * (the crossroads made where streets met are saved, so they are found again).
 */
export function layStreet(world: World, b: Building): Street {
  const at = world.plots[b.plotIndex].x;
  const street = newStreet(world, b.id, at);
  const joins: Array<{ k: number; plot: Plot }> = [];
  for (const step of [-1, 1]) {
    for (let k = CROSS_PLOT + step; k >= 0 && k < PLOTS_PER_STREET; k += step) {
      const meet = streetsAt(world, street.dir, plotPoint(street, k));
      // it stops short of the rocks, and of a street along the same line
      if (meet.along || onQuarryLand(plotPoint(street, k), Math.max(STREET_BAND_HALF, STREET_END_RUN))) break;
      if (meet.crossing) {
        const plot = plotOf(world, meet.crossing.street, meet.crossing.k);
        const there = getBuilding(world, plot.buildingId);
        if (plot.buildingId !== null && !there?.junction) break;
        joins.push({ k, plot });
      }
      if (step < 0) street.lo = k;
      else street.hi = k;
    }
  }
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
  const b: Building = { id: world.nextId++, type: 'intersection', plotIndex: plot.index, progress: 1, status: 'done', completedAt: world.time, stock: stockOf(), junction: true };
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
  if (!plot || !b || b.type !== 'intersection' || b.status !== 'done') return null;
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
  updateStrolls(world, dt, () => rand(world));
}

/**
 * A building as a workplace for the people it employs in `role`; null if it
 * has no work to give. Builders work on its site (a building being upgraded
 * is a site for them, and its usual workplace for everyone else).
 */
export function workplaceOf(world: World, b: Building, role: Role): Workplace | null {
  if (b.site && (b.status !== 'done' || role === 'builder')) return siteWorkplace(world, b, world.params.buildSpeed);
  if (b.farm) return farmWorkplace(b.farm, b.stock, world.params);
  const recipe = BUILDINGS[b.type].makes;
  if (recipe && b.status === 'done') return workshopWorkplace(world, b, recipe);
  if (isGatherHut(b.type) && b.status === 'done') return gatherWorkplace(world, b as Building & { type: typeof b.type });
  if (b === transportHub(world)) return transportWorkplace(world, b);
  return null;
}

/** Hire for open jobs; construction sites and errands only hire while it's light enough to work. */
function staff(world: World): void {
  const dayLabour = timeOfDay(world).daylight;
  const hub = transportHub(world);
  const openingsOf = (b: Building) => (b === hub ? (dayLabour ? { serf: serfPositions(world) } : {}) : openings(b, builderPositions(world, b), dayLabour));
  staffBuildings(world, (b, role, who) => newWorker(world, b, role, who), openingsOf);
}

/** A new hand walks over from exactly where they are on the street. */
function newWorker(world: World, b: Building, role: Role, who: Person): Worker {
  const place = workplaceOf(world, b, role)!;
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
    const people = employees(world, b);
    if (!people.length) continue;
    const nav: Nav = { x: world.plots[b.plotIndex].x, route: (from, to) => route(world, from, to) };
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
  if (dir !== 0) {
    r.facing = dir as 1 | -1;
    r.vx += dir * p.riderAccel * dt;
    r.vx = Math.max(-p.riderMaxSpeed, Math.min(p.riderMaxSpeed, r.vx));
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
