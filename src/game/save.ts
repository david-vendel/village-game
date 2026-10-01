// Save games: World ⇄ plain, versioned, JSON-safe data. Pure, like the rest of
// src/game; where the data is kept (IndexedDB) is up to src/app/persistence.ts.
//
// What is saved is the simulation's own state: time, buildings (with their
// stores and farm fields), what lies on the ground (piles), people (with their jobs and where they are in their
// working day), animals, the village stockpile, rider, RNG and id counter, and
// which crossroads opened which street, in order (the streets' places and plots follow from it).
// What is not:
// - things derived from the rules: plots and their building links, field layout
//   (rebuilt on load, so a save survives changes to the street or field rules);
// - transient UI: the open build menu, pending events;
// - tuning knobs (`params`), which the URL owns.
//
// Changing the save format:
// 1. bump SAVE_VERSION;
// 2. add MIGRATIONS[old] that turns an old-version `world` into the new shape;
// 3. update SavedWorld and the validator below. Old saves then load through the
//    migration chain; a save newer than this code is refused, never overwritten.

import { BUILDING_TYPES, BUILDINGS, ROLES, type BuildingType, type Role } from './buildings';
import { createFarm, repairFarm, type FarmState, type FieldPlot } from './farm';
import { farmFieldSpots, syncFarmFields } from './land';
import { FIELD_ROWS, TREE_Y, type FieldZone } from './layout';
import { BUILDERS_PER_SITE, createSite, workSpots, type Site } from './site';
import { transportHub } from './transport';
import { employees, laneY, nameFor, openings, type Animal, type Job, type Look, type Person, type Stroll } from './people';
import { RESOURCES, stockOf, type Load, type Resource, type Stock } from './resources';
import type { Worker, WorkerTask } from './worker';
import { clearLand, createForest, type Tree } from './nature';
import type { Pile } from './piles';
import { streetOf } from './streets';
import { createWorld, layStreet, WORLD_WIDTH, type Building, type Rider, type World } from './world';

export const SAVE_VERSION = 16;

/** How often (s) the village used to collect goods from stores (until v9); old migrations need it. */
const OLD_COLLECT_EVERY = 30;

/** The persisted part of the world. */
export type SavedWorld = Pick<
  World,
  | 'time'
  | 'dayClock'
  | 'buildings'
  | 'rider'
  | 'people'
  | 'animals'
  | 'trees'
  | 'piles'
  | 'constructionEnabled'
  | 'lastSelection'
  | 'nextId'
  | 'rngState'
> & {
  /** The crossroads (building ids) each street after the main one branches off at, in the order they were opened. */
  branches: number[];
};

export interface SaveData {
  version: number;
  world: SavedWorld;
}

export type LoadResult = { ok: true; world: World } | { ok: false; error: string };

/** Migrations from version n to n + 1, applied to the raw `world` object. */
const MIGRATIONS: Record<number, (world: unknown) => unknown> = {
  // v2: field plots record whether they have been tilled; sown land has been.
  // (Migrations see unvalidated data, so they only touch what has the expected shape.)
  1: (world) => {
    const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
    const rec = (v: unknown) => (typeof v === 'object' && v !== null ? (v as Raw) : undefined);
    for (const b of list(rec(world)?.buildings)) {
      for (const p of list(rec(rec(b)?.farm)?.plots)) {
        const plot = rec(p);
        if (plot) plot.tilled = plot.state !== 'fallow';
      }
    }
    return world;
  },
  // v3: the time of day runs on its own clock; until now it followed world time
  2: (world) => {
    const w = typeof world === 'object' && world !== null ? (world as Raw) : undefined;
    if (w) w.dayClock = w.time;
    return world;
  },
  // v4: farms record when the village next takes a sheaf from the store
  3: (world) => {
    const rec = (v: unknown) => (typeof v === 'object' && v !== null ? (v as Raw) : undefined);
    const buildings = rec(world)?.buildings;
    for (const b of Array.isArray(buildings) ? buildings : []) {
      const farm = rec(rec(b)?.farm);
      if (farm) farm.grainUse = OLD_COLLECT_EVERY;
    }
    return world;
  },
  // v5: plots have a row (the front field got a second one); work records its duration
  4: (world) => {
    const rec = (v: unknown) => (typeof v === 'object' && v !== null ? (v as Raw) : undefined);
    const buildings = rec(world)?.buildings;
    for (const b of Array.isArray(buildings) ? buildings : []) {
      const farm = rec(rec(b)?.farm);
      if (!farm) continue;
      for (const p of Array.isArray(farm.plots) ? farm.plots : []) {
        const plot = rec(p);
        if (plot) plot.row = 0;
      }
      const task = rec(rec(farm.farmer)?.task);
      if (task?.kind === 'work') task.duration = 3;
    }
    return world;
  },
  // v6: lunch is an hour of eating once a day: the farmer remembers the day he last ate
  5: (world) => {
    const rec = (v: unknown) => (typeof v === 'object' && v !== null ? (v as Raw) : undefined);
    const buildings = rec(world)?.buildings;
    for (const b of Array.isArray(buildings) ? buildings : []) {
      const farmer = rec(rec(rec(b)?.farm)?.farmer);
      if (!farmer) continue;
      farmer.lunchDay = 0;
      const task = rec(farmer.task);
      if (task?.kind === 'home') task.left = task.activity === 'lunch' ? 1 : 0;
    }
    return world;
  },
  // v7: villagers become people (with names and jobs) and animals; the farmer
  // becomes a person employed at the farm, with the generic worker routine;
  // buildings get their own store (the farm's sheaves), and the village a stockpile
  6: (world) => {
    const rec = (v: unknown) => (typeof v === 'object' && v !== null ? (v as Raw) : undefined);
    const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
    const w = rec(world);
    if (!w) return world;
    let nextId = typeof w.nextId === 'number' ? w.nextId : 1;
    const people: unknown[] = [];
    const animals: unknown[] = [];
    for (const item of list(w.villagers)) {
      const v = rec(item);
      if (!v) continue;
      const stroll = { x: v.x, dir: v.dir, speed: v.speed, idle: v.idle };
      if (v.kind === 'chicken') animals.push({ id: v.id, kind: 'chicken', seed: v.seed, stroll });
      else people.push({ id: v.id, name: nameFor(v.kind as Look, Number(v.seed) || 0), look: v.kind, seed: v.seed, job: null, stroll });
    }
    const task = (t: Raw | undefined): unknown => {
      if (!t) return t;
      const job = { action: t.action, target: t.plot };
      if (t.kind === 'walk') {
        const then = t.then === 'work' ? 'job' : t.then === 'deposit' ? 'deliver' : t.then;
        return { kind: 'walk', toDx: t.toDx, toY: t.toY, then, job: then === 'job' ? job : null };
      }
      if (t.kind === 'work') return { kind: 'job', job, t: t.t, duration: t.duration };
      return t;
    };
    for (const item of list(w.buildings)) {
      const b = rec(item);
      if (!b) continue;
      const farm = rec(b.farm);
      b.stock = { wood: 0, stone: 0, grain: typeof farm?.storage === 'number' ? farm.storage : 0 };
      b.collectIn = typeof farm?.grainUse === 'number' ? farm.grainUse : OLD_COLLECT_EVERY;
      const f = rec(farm?.farmer);
      if (farm && f) {
        const id = nextId++;
        const seed = id * 7919;
        const worker = { dx: f.dx, y: f.y, facing: f.facing, carrying: f.carrying ? 'grain' : null, task: task(rec(f.task)), stride: f.stride, lunchDay: f.lunchDay };
        const stroll = { x: 0, dir: 1, speed: 30, idle: 0 };
        people.push({ id, name: nameFor('peasant', seed), look: 'peasant', seed, job: { buildingId: b.id, role: 'farmer', worker }, stroll });
      }
      if (farm) {
        delete farm.farmer;
        delete farm.storage;
        delete farm.grainUse;
      }
    }
    w.people = people;
    w.animals = animals;
    delete w.villagers;
    w.stock = { wood: 250, stone: 250, grain: 0 }; // the stockpile v7 started with
    w.nextId = nextId;
    return world;
  },
  // v8: the village's materials live in a warehouse (one is built for old saves,
  // holding the old stockpile); builders now carry materials to construction
  // sites (old sites were paid in full up front, so count as fully supplied);
  // what a worker carries is a load with an amount
  7: (world) => {
    const rec = (v: unknown) => (typeof v === 'object' && v !== null ? (v as Raw) : undefined);
    const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
    const w = rec(world);
    if (!w) return world;
    const buildings = list(w.buildings).map(rec).filter((b): b is Raw => !!b);
    for (const b of buildings) {
      if (b.status === 'constructing') {
        const cost = BUILDINGS[b.type as BuildingType]?.cost ?? {};
        b.site = { delivered: { wood: cost.wood ?? 0, stone: cost.stone ?? 0, grain: cost.grain ?? 0 } };
      }
    }
    for (const p of list(w.people)) {
      const worker = rec(rec(rec(p)?.job)?.worker);
      if (worker && typeof worker.carrying === 'string') worker.carrying = { resource: worker.carrying, amount: 1 };
    }
    const old = rec(w.stock) ?? {};
    if (!buildings.some((b) => b.type === 'warehouse')) {
      const taken = new Set(buildings.map((b) => b.plotIndex));
      const plotIndex = [5, 7, 9, 1, 10, 12, 14, 15, 0, 17, 18, 19, 20, 21, 22].find((i) => !taken.has(i));
      if (plotIndex !== undefined) {
        const cap = BUILDINGS.warehouse.storage;
        const amount = (r: 'wood' | 'stone' | 'grain') => Math.min(cap[r] ?? 0, typeof old[r] === 'number' ? (old[r] as number) : 0);
        const id = typeof w.nextId === 'number' ? w.nextId : 1;
        w.nextId = id + 1;
        (w.buildings as unknown[]).push({
          id,
          type: 'warehouse',
          plotIndex,
          progress: 1,
          status: 'done',
          completedAt: -100,
          stock: { wood: amount('wood'), stone: amount('stone'), grain: amount('grain') },
          collectIn: OLD_COLLECT_EVERY,
        });
      }
    }
    delete w.stock;
    return world;
  },
  // v9: things have places and people have depth. Strollers keep a y (their
  // lane); the invisible collection from stores is gone (collectIn); a site
  // records what builders took off its pile and put in place (until now the
  // pile was used up by progress); a delivery remembers the job its load
  // came from (builders only carried fetched materials, farmers sheaves).
  8: (world) => {
    const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
    const rec = (v: unknown) => (typeof v === 'object' && v !== null ? (v as Raw) : undefined);
    const w = rec(world);
    if (!w) return world;
    for (const who of [...list(w.people), ...list(w.animals)]) {
      const s = rec(rec(who)?.stroll);
      const id = rec(who)?.id;
      if (s && typeof id === 'number') s.y = laneY(id);
    }
    for (const b of list(w.buildings).map(rec)) {
      if (!b) continue;
      delete b.collectIn;
      const site = rec(b.site);
      const delivered = rec(site?.delivered);
      if (!site || !delivered) continue;
      const cost = BUILDINGS[b.type as BuildingType]?.cost ?? {};
      const progress = typeof b.progress === 'number' ? b.progress : 0;
      const used: Raw = {};
      for (const r of RESOURCES) used[r] = Math.min(typeof delivered[r] === 'number' ? (delivered[r] as number) : 0, progress * (cost[r] ?? 0));
      site.taken = { ...used };
      site.placed = { ...used };
    }
    for (const p of list(w.people)) {
      const worker = rec(rec(rec(p)?.job)?.worker);
      const task = rec(worker?.task);
      const load = rec(worker?.carrying);
      if (task?.kind === 'walk' && task.then === 'deliver' && !task.job) {
        task.job = load?.resource === 'grain' ? { action: 'harvest', target: 0 } : { action: `fetch-${String(load?.resource ?? 'wood')}`, target: 0 };
      }
    }
    return world;
  },
  // v10: flour; builders lay materials at work spots along the building
  // (site: pile + laid, instead of taken + placed); farmers no longer carry
  // sheaves to the warehouse (serfs do), so one on the way goes back to the
  // farm's store.
  9: (world) => {
    const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
    const rec = (v: unknown) => (typeof v === 'object' && v !== null ? (v as Raw) : undefined);
    const n = (v: unknown) => (typeof v === 'number' ? v : 0);
    const w = rec(world);
    if (!w) return world;
    for (const b of list(w.buildings).map(rec)) {
      if (!b) continue;
      const st = rec(b.stock);
      if (st) st.flour = 0;
      const site = rec(b.site);
      const delivered = rec(site?.delivered);
      if (!site || !delivered) continue;
      delivered.flour = 0;
      const cost = BUILDINGS[b.type as BuildingType]?.cost ?? {};
      const taken = rec(site.taken) ?? {};
      const placed = rec(site.placed) ?? {};
      const progress = n(b.progress);
      const pile: Raw = {};
      const laid: Raw = {};
      for (const r of RESOURCES) {
        pile[r] = Math.max(0, n(delivered[r]) - n(taken[r]));
        // put in place but not yet built in: it lies at the first work spot
        laid[r] = Math.max(0, n(placed[r]) - progress * (cost[r] ?? 0));
      }
      const spots = BUILDINGS[b.type as BuildingType] ? workSpots(b.type as BuildingType).length : 1;
      b.site = { delivered, pile, laid: [laid, ...Array.from({ length: spots - 1 }, () => ({ wood: 0, stone: 0, grain: 0, flour: 0 }))] };
    }
    for (const p of list(w.people)) {
      const worker = rec(rec(rec(p)?.job)?.worker);
      const task = rec(worker?.task);
      const job = rec(task?.job);
      if (!task || job?.action !== 'haul') continue;
      if (task.then === 'deliver') task.job = { action: 'harvest', target: 0 };
      else worker!.task = { kind: 'idle', wait: 0.3 };
    }
    return world;
  },
  // v11: bread, and the bakery (listed after the mill, so later menu entries move up one)
  10: (world) => {
    const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
    const rec = (v: unknown) => (typeof v === 'object' && v !== null ? (v as Raw) : undefined);
    const w = rec(world);
    if (!w) return world;
    const addBread = (s: unknown) => {
      const st = rec(s);
      if (st) st.bread = 0;
    };
    for (const b of list(w.buildings).map(rec)) {
      if (!b) continue;
      addBread(b.stock);
      const site = rec(b.site);
      addBread(site?.delivered);
      addBread(site?.pile);
      for (const l of list(site?.laid)) addBread(l);
    }
    const bakery = BUILDING_TYPES.indexOf('bakery');
    if (typeof w.lastSelection === 'number' && w.lastSelection >= bakery) w.lastSelection += 1;
    return world;
  },
  // v12: the woods behind the street are real trees, to be felled (nature.ts);
  // (the woodcutter's and stonecutter's huts come last in the menu, so nothing moves)
  11: (world) => {
    const rec = (v: unknown) => (typeof v === 'object' && v !== null ? (v as Raw) : undefined);
    const w = rec(world);
    if (!w) return world;
    let seed = typeof w.rngState === 'number' ? w.rngState : 1;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let id = typeof w.nextId === 'number' ? w.nextId : 1;
    w.trees = createForest(WORLD_WIDTH, rand, () => id++);
    w.nextId = id;
    return world;
  },
  // v13: crossroads open new streets (the crossroads comes last in the menu, so nothing moves)
  12: (world) => {
    const w = typeof world === 'object' && world !== null ? (world as Raw) : undefined;
    if (w) w.branches = [];
    return world;
  },
  // v14: trees stand anywhere on the land, each at its depth too; until now all stood on the tree line
  13: (world) => {
    const w = typeof world === 'object' && world !== null ? (world as Raw) : undefined;
    for (const t of Array.isArray(w?.trees) ? (w.trees as unknown[]) : []) {
      if (typeof t === 'object' && t !== null) (t as Raw).y = TREE_Y;
    }
    return world;
  },
  // v15: things can lie on the ground by the road (piles.ts); nothing did before
  14: (world) => {
    const w = typeof world === 'object' && world !== null ? (world as Raw) : undefined;
    if (w) w.piles = [];
    return world;
  },
  // v16: buildings can be being pulled down (status 'demolishing', with a demolition record); none were
  15: (world) => world,
};

/** Snapshot the world. The result shares nothing with the live world. */
export function saveWorld(world: World): SaveData {
  const saved: SavedWorld = {
    time: world.time,
    dayClock: world.dayClock,
    buildings: world.buildings,
    rider: world.rider,
    people: world.people,
    animals: world.animals,
    trees: world.trees,
    piles: world.piles,
    constructionEnabled: world.constructionEnabled,
    lastSelection: world.lastSelection,
    nextId: world.nextId,
    rngState: world.rngState,
    branches: world.streets.flatMap((s) => (s.from === null ? [] : [s.from])),
  };
  return { version: SAVE_VERSION, world: JSON.parse(JSON.stringify(saved)) as SavedWorld };
}

/** Rebuild a world from save data (any older version). Never throws. */
export function loadWorld(data: unknown): LoadResult {
  try {
    const root = obj(data, 'save');
    const version = int(root.version, 'version');
    if (version > SAVE_VERSION) return { ok: false, error: `save is version ${version}, this game reads up to ${SAVE_VERSION}` };
    if (version < 1) return { ok: false, error: `unknown save version ${version}` };
    let raw = root.world;
    for (let v = version; v < SAVE_VERSION; v++) {
      const migrate = MIGRATIONS[v];
      if (!migrate) return { ok: false, error: `no migration from version ${v}` };
      raw = migrate(raw);
    }
    return { ok: true, world: build(savedWorld(raw)) };
  } catch (e) {
    if (e instanceof SaveError) return { ok: false, error: e.message };
    throw e;
  }
}

function build(saved: SavedWorld): World {
  const world = createWorld({ village: false });
  const { branches, ...state } = saved;
  Object.assign(world, state);
  // the streets, in the order they were opened: each branches off at a finished crossroads on one before
  // it, and joins the streets it meets where crossroads were made for it (so buildings go on their plots first)
  const seat = () => {
    for (const b of world.buildings) {
      const plot = world.plots[b.plotIndex];
      if (plot && plot.buildingId === null) plot.buildingId = b.id;
    }
  };
  const layBranch = (b: Building) => {
    if (!world.plots[b.plotIndex]) throw new SaveError(`building ${b.id}: no plot ${b.plotIndex}`);
    seat();
    layStreet(world, b);
  };
  for (const id of branches) {
    const b = world.buildings.find((x) => x.id === id);
    if (!b || b.type !== 'intersection' || b.status !== 'done') throw new SaveError(`a street branches off at ${id}, which is no finished crossroads`);
    if (world.streets.some((st) => st.from === id)) throw new SaveError(`two streets branch off at crossroads ${id}`);
    layBranch(b);
  }
  // (a finished crossroads always leads somewhere)
  for (const b of world.buildings) {
    if (b.type === 'intersection' && b.status === 'done' && !b.junction && !world.streets.some((st) => st.from === b.id)) layBranch(b);
  }
  // a crossroads made where streets met, that no street met after all, is just a plot again
  world.buildings = world.buildings.filter((b) => !b.junction || world.junctions.some((j) => j.buildingId === b.id));
  for (const p of world.plots) p.buildingId = null;
  for (const j of world.junctions) {
    for (const x of [j.a, j.b]) {
      const plot = world.plots.find((p) => p.x === x);
      if (plot) plot.buildingId = j.buildingId;
    }
  }
  const ids = new Set<number>();
  for (const b of world.buildings) {
    const plot = world.plots[b.plotIndex];
    if (!plot) throw new SaveError(`building ${b.id}: no plot ${b.plotIndex}`);
    if (plot.buildingId !== null && plot.buildingId !== b.id) throw new SaveError(`building ${b.id}: plot ${b.plotIndex} already taken`);
    if (ids.has(b.id)) throw new SaveError(`duplicate building id ${b.id}`);
    ids.add(b.id);
    plot.buildingId = b.id;
  }
  // what lies on the ground lies on a street that is there
  world.piles = world.piles.filter((p) => p.amount > 1e-9 && !!world.streets[streetOf(p.x)]);
  const maxId = Math.max(0, ...[...world.buildings, ...world.people, ...world.animals, ...world.trees, ...world.piles].map((x) => x.id));
  world.nextId = Math.max(world.nextId, maxId + 1);
  // a construction site record belongs to buildings under construction, or
  // being upgraded, only; an upgrade only to buildings that have one
  for (const b of world.buildings) {
    const upgrade = BUILDINGS[b.type].upgrade;
    if (!upgrade || b.status === 'constructing') delete b.upgraded;
    if (b.status === 'done' && (!upgrade || b.upgraded)) delete b.site;
    else if (b.status === 'constructing') b.site ??= createSite(b.type);
    // one being pulled down has no site, and knows how far it has to go
    if (b.status === 'demolishing') {
      delete b.site;
      b.demolition ??= { work: BUILDINGS[b.type].buildTime / 2, from: Math.max(b.progress, 1e-3), left: stockOf() };
    } else delete b.demolition;
  }
  // a job must be at a building that offers it (its own jobs once finished,
  // builders while a site); otherwise the person is out of work
  for (const p of world.people) {
    const b = p.job && world.buildings.find((x) => x.id === p.job!.buildingId);
    const offered = b && (p.job?.role === 'serf' ? b === transportHub(world) && !!p.seeker : !!openings(b, BUILDERS_PER_SITE, true)[p.job!.role]);
    if (p.job && !offered) p.job = null;
  }
  // farm state belongs to finished farms only
  for (const b of world.buildings) {
    if (b.type !== 'farm' || b.status !== 'done') delete b.farm;
    else if (!b.farm) b.farm = createFarm({ spots: farmFieldSpots(world, b) });
  }
  // no tree stands on a road, a building, a field or a quarry
  clearLand(world);
  // re-lay fields under the current land rules (crops carry over), and make
  // sure what was loaded obeys the farm's rules
  syncFarmFields(world);
  for (const b of world.buildings) if (b.farm) repairFarm(b.farm, employees(world, b).filter((p) => p.job!.role === 'farmer').map((p) => p.job!.worker));
  return world;
}

// --- Validation ------------------------------------------------------------------
// Checks the shape of untrusted data (it comes from storage and may be corrupt or
// from an older build) and copies it field by field, so nothing unexpected gets in.

class SaveError extends Error {}

type Raw = Record<string, unknown>;

function obj(v: unknown, path: string): Raw {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SaveError(`${path}: expected an object`);
  return v as Raw;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new SaveError(`${path}: expected a list`);
  return v;
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SaveError(`${path}: expected a number`);
  return v;
}

function int(v: unknown, path: string): number {
  const n = num(v, path);
  if (!Number.isInteger(n)) throw new SaveError(`${path}: expected a whole number`);
  return n;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new SaveError(`${path}: expected text`);
  return v;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new SaveError(`${path}: expected true/false`);
  return v;
}

function oneOf<T extends string | number>(v: unknown, options: readonly T[], path: string): T {
  if (!options.includes(v as T)) throw new SaveError(`${path}: expected one of ${options.join(', ')}`);
  return v as T;
}

const dir = (v: unknown, path: string) => oneOf(v, [1, -1] as const, path);

function savedWorld(v: unknown): SavedWorld {
  const w = obj(v, 'world');
  return {
    time: num(w.time, 'time'),
    dayClock: num(w.dayClock, 'dayClock'),
    buildings: arr(w.buildings, 'buildings').map((b, i) => building(b, `buildings[${i}]`)),
    rider: rider(w.rider, 'rider'),
    people: arr(w.people, 'people').map((x, i) => person(x, `people[${i}]`)),
    animals: arr(w.animals, 'animals').map((x, i) => animal(x, `animals[${i}]`)),
    trees: arr(w.trees, 'trees').map((x, i) => tree(x, `trees[${i}]`)),
    piles: arr(w.piles, 'piles').map((x, i) => pile(x, `piles[${i}]`)),
    constructionEnabled: bool(w.constructionEnabled, 'constructionEnabled'),
    lastSelection: oneOf(w.lastSelection, BUILDING_TYPES.map((_, i) => i), 'lastSelection'),
    nextId: int(w.nextId, 'nextId'),
    rngState: int(w.rngState, 'rngState'),
    branches: arr(w.branches, 'branches').map((x, i) => int(x, `branches[${i}]`)),
  };
}

function building(v: unknown, path: string): Building {
  const b = obj(v, path);
  const out: Building = {
    id: int(b.id, `${path}.id`),
    type: oneOf<BuildingType>(b.type, BUILDING_TYPES, `${path}.type`),
    plotIndex: int(b.plotIndex, `${path}.plotIndex`),
    progress: Math.min(1, Math.max(0, num(b.progress, `${path}.progress`))),
    status: oneOf(b.status, ['constructing', 'done', 'demolishing'] as const, `${path}.status`),
    completedAt: b.completedAt === null ? null : num(b.completedAt, `${path}.completedAt`),
    stock: stock(b.stock, `${path}.stock`),
  };
  if (b.upgraded !== undefined && bool(b.upgraded, `${path}.upgraded`)) out.upgraded = true;
  if (b.junction !== undefined && bool(b.junction, `${path}.junction`) && out.type === 'intersection') out.junction = true;
  if (b.site !== undefined) out.site = site(b.site, `${path}.site`, out.type);
  if (b.farm !== undefined) out.farm = farm(b.farm, `${path}.farm`);
  if (b.demolition !== undefined) {
    const d = obj(b.demolition, `${path}.demolition`);
    out.demolition = { work: Math.max(0, num(d.work, `${path}.demolition.work`)), from: Math.min(1, Math.max(1e-3, num(d.from, `${path}.demolition.from`))), left: stock(d.left, `${path}.demolition.left`) };
  }
  return out;
}

function site(v: unknown, path: string, type: BuildingType): Site {
  const s = obj(v, path);
  const spots = workSpots(type).length;
  const laid = arr(s.laid, `${path}.laid`).map((x, i) => stock(x, `${path}.laid[${i}]`));
  // one stack per work spot of this building (the spots may have changed since)
  while (laid.length > spots) {
    const extra = laid.pop()!;
    for (const r of RESOURCES) laid[laid.length - 1][r] += extra[r];
  }
  while (laid.length < spots) laid.push(stock({ wood: 0, stone: 0, grain: 0, flour: 0, bread: 0 }, path));
  return { delivered: stock(s.delivered, `${path}.delivered`), pile: stock(s.pile, `${path}.pile`), laid };
}

function rider(v: unknown, path: string): Rider {
  const r = obj(v, path);
  return { x: num(r.x, `${path}.x`), vx: num(r.vx, `${path}.vx`), facing: dir(r.facing, `${path}.facing`), gait: num(r.gait, `${path}.gait`) };
}

function stock(v: unknown, path: string): Stock {
  const s = obj(v, path);
  const out = {} as Stock;
  for (const r of RESOURCES) out[r] = Math.max(0, num(s[r], `${path}.${r}`));
  return out;
}

function stroll(v: unknown, path: string): Stroll {
  const s = obj(v, path);
  return { x: num(s.x, `${path}.x`), y: num(s.y, `${path}.y`), dir: dir(s.dir, `${path}.dir`), speed: num(s.speed, `${path}.speed`), idle: num(s.idle, `${path}.idle`) };
}

/** Saved profession (or looking for one); older saves without one: whatever they work as, else builder (for peasants). */
function professionOf(p: Raw, path: string): { profession?: Role; seeker?: true } {
  if (p.seeker !== undefined) return bool(p.seeker, `${path}.seeker`) ? { seeker: true } : {};
  if (p.profession !== undefined) return { profession: oneOf(p.profession, ROLES, `${path}.profession`) };
  if (p.job) return { profession: oneOf(obj(p.job, `${path}.job`).role, ROLES, `${path}.job.role`) };
  return p.look === 'peasant' ? { profession: 'builder' } : {};
}

function person(v: unknown, path: string): Person {
  const p = obj(v, path);
  return {
    id: int(p.id, `${path}.id`),
    name: str(p.name, `${path}.name`),
    look: oneOf(p.look, ['peasant', 'woman', 'monk'] as const, `${path}.look`),
    seed: num(p.seed, `${path}.seed`),
    job: p.job === null ? null : job(p.job, `${path}.job`),
    ...professionOf(p, path),
    stroll: stroll(p.stroll, `${path}.stroll`),
  };
}

function tree(v: unknown, path: string): Tree {
  const t = obj(v, path);
  return { id: int(t.id, `${path}.id`), x: num(t.x, `${path}.x`), y: num(t.y, `${path}.y`), state: oneOf(t.state, ['growing', 'grown', 'stump'] as const, `${path}.state`), age: num(t.age, `${path}.age`) };
}

function pile(v: unknown, path: string): Pile {
  const p = obj(v, path);
  return { id: int(p.id, `${path}.id`), x: num(p.x, `${path}.x`), resource: oneOf<Resource>(p.resource, RESOURCES, `${path}.resource`), amount: Math.max(0, num(p.amount, `${path}.amount`)) };
}

function animal(v: unknown, path: string): Animal {
  const a = obj(v, path);
  return { id: int(a.id, `${path}.id`), kind: oneOf(a.kind, ['chicken'] as const, `${path}.kind`), seed: num(a.seed, `${path}.seed`), stroll: stroll(a.stroll, `${path}.stroll`) };
}

function job(v: unknown, path: string): Job {
  const j = obj(v, path);
  return { buildingId: int(j.buildingId, `${path}.buildingId`), role: oneOf(j.role, ROLES, `${path}.role`), worker: worker(j.worker, `${path}.worker`) };
}

function farm(v: unknown, path: string): FarmState {
  const f = obj(v, path);
  return { plots: arr(f.plots, `${path}.plots`).map((p, i) => fieldPlot(p, `${path}.plots[${i}]`)) };
}

function fieldPlot(v: unknown, path: string): FieldPlot {
  const p = obj(v, path);
  return {
    zone: oneOf(p.zone, ['back', 'front'] as const, `${path}.zone`),
    row: oneOf(p.row, FIELD_ROWS[p.zone as FieldZone].map((_, i) => i), `${path}.row`),
    dx: num(p.dx, `${path}.dx`),
    width: num(p.width, `${path}.width`),
    tilled: bool(p.tilled, `${path}.tilled`),
    state: oneOf(p.state, ['fallow', 'growing', 'ripe'] as const, `${path}.state`),
    age: num(p.age, `${path}.age`),
  };
}

function worker(v: unknown, path: string): Worker {
  const w = obj(v, path);
  return {
    dx: num(w.dx, `${path}.dx`),
    y: num(w.y, `${path}.y`),
    facing: dir(w.facing, `${path}.facing`),
    carrying: w.carrying === null ? null : load(w.carrying, `${path}.carrying`),
    task: task(w.task, `${path}.task`),
    stride: num(w.stride, `${path}.stride`),
    lunchDay: int(w.lunchDay, `${path}.lunchDay`),
  };
}

function load(v: unknown, path: string): Load {
  const l = obj(v, path);
  return { resource: oneOf<Resource>(l.resource, RESOURCES, `${path}.resource`), amount: Math.max(0, num(l.amount, `${path}.amount`)) };
}

/** A job ticket; whether its target still exists is checked by the workplace on load (repairFarm). */
function ticket(v: unknown, path: string) {
  const j = obj(v, path);
  return {
    action: str(j.action, `${path}.action`),
    target: int(j.target, `${path}.target`),
    ...(j.slot === undefined ? {} : { slot: int(j.slot, `${path}.slot`) }),
    ...(j.to === undefined ? {} : { to: int(j.to, `${path}.to`) }),
  };
}

function task(v: unknown, path: string): WorkerTask {
  const t = obj(v, path);
  switch (oneOf(t.kind, ['idle', 'walk', 'job', 'enter', 'home', 'exit'] as const, `${path}.kind`)) {
    case 'idle':
      return { kind: 'idle', wait: num(t.wait, `${path}.wait`) };
    case 'walk': {
      const then = oneOf(t.then, ['job', 'deliver', 'home'] as const, `${path}.then`);
      return {
        kind: 'walk',
        toDx: num(t.toDx, `${path}.toDx`),
        toY: num(t.toY, `${path}.toY`),
        then,
        job: then === 'home' ? null : ticket(t.job, `${path}.job`),
      };
    }
    case 'job':
      return {
        kind: 'job',
        job: ticket(t.job, `${path}.job`),
        t: num(t.t, `${path}.t`),
        duration: num(t.duration, `${path}.duration`),
        // (saves from before `carried` only worked on carried loads indoors)
        ...((t.carried === undefined ? t.indoors !== undefined && bool(t.indoors, `${path}.indoors`) : bool(t.carried, `${path}.carried`)) ? { carried: true as const } : {}),
        ...(t.indoors === undefined ? {} : bool(t.indoors, `${path}.indoors`) ? { indoors: true as const } : {}),
      };
    case 'enter':
      return {
        kind: 'enter',
        t: num(t.t, `${path}.t`),
        ...(t.job === undefined ? {} : { job: ticket(t.job, `${path}.job`), duration: num(t.duration, `${path}.duration`) }),
      };
    case 'exit':
      return { kind: 'exit', t: num(t.t, `${path}.t`), ...(t.job === undefined ? {} : { job: ticket(t.job, `${path}.job`) }) };
    case 'home':
      return { kind: 'home', activity: oneOf(t.activity, ['lunch', 'sleep'] as const, `${path}.activity`), left: num(t.left, `${path}.left`) };
  }
}
