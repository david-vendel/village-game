// Save games: World ⇄ plain, versioned, JSON-safe data. Pure, like the rest of
// src/game; where the data is kept (IndexedDB) is up to src/app/persistence.ts.
//
// What is saved is the simulation's own state: time, buildings (with their
// stores and farm fields), people (with their jobs and where they are in their
// working day), animals, the village stockpile, rider, RNG and id counter.
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

import { BUILDING_TYPES, BUILDINGS, ROLES, type BuildingType } from './buildings';
import { COLLECT_EVERY, STARTING_STOCK } from './economy';
import { createFarm, repairFarm, type FarmState, type FieldPlot } from './farm';
import { farmFieldSpots, syncFarmFields } from './land';
import { FIELD_ROWS, type FieldZone } from './layout';
import { employees, nameFor, type Animal, type Job, type Look, type Person, type Stroll } from './people';
import { RESOURCES, type Resource, type Stock } from './resources';
import type { Worker, WorkerTask } from './worker';
import { createWorld, type Building, type Rider, type World } from './world';

export const SAVE_VERSION = 7;

/** The persisted part of the world. */
export type SavedWorld = Pick<
  World,
  | 'time'
  | 'dayClock'
  | 'buildings'
  | 'rider'
  | 'people'
  | 'animals'
  | 'stock'
  | 'constructionEnabled'
  | 'lastSelection'
  | 'nextId'
  | 'rngState'
>;

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
      if (farm) farm.grainUse = COLLECT_EVERY;
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
      b.collectIn = typeof farm?.grainUse === 'number' ? farm.grainUse : COLLECT_EVERY;
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
    w.stock = { ...STARTING_STOCK };
    w.nextId = nextId;
    return world;
  },
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
    stock: world.stock,
    constructionEnabled: world.constructionEnabled,
    lastSelection: world.lastSelection,
    nextId: world.nextId,
    rngState: world.rngState,
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
  Object.assign(world, saved);
  const ids = new Set<number>();
  for (const b of world.buildings) {
    const plot = world.plots[b.plotIndex];
    if (!plot) throw new SaveError(`building ${b.id}: no plot ${b.plotIndex}`);
    if (plot.buildingId !== null) throw new SaveError(`building ${b.id}: plot ${b.plotIndex} already taken`);
    if (ids.has(b.id)) throw new SaveError(`duplicate building id ${b.id}`);
    ids.add(b.id);
    plot.buildingId = b.id;
  }
  const maxId = Math.max(0, ...[...world.buildings, ...world.people, ...world.animals].map((x) => x.id));
  world.nextId = Math.max(world.nextId, maxId + 1);
  // a job must be at a finished building that offers it; otherwise the person is out of work
  for (const p of world.people) {
    const b = p.job && world.buildings.find((x) => x.id === p.job!.buildingId);
    if (p.job && (!b || b.status !== 'done' || !BUILDINGS[b.type].jobs[p.job.role])) p.job = null;
  }
  // farm state belongs to finished farms only
  for (const b of world.buildings) {
    if (b.type !== 'farm' || b.status !== 'done') delete b.farm;
    else if (!b.farm) b.farm = createFarm({ spots: farmFieldSpots(world, b) });
  }
  // re-lay fields under the current land rules (crops carry over), and make
  // sure what was loaded obeys the farm's rules
  syncFarmFields(world);
  for (const b of world.buildings) if (b.farm) repairFarm(b.farm, employees(world, b).map((p) => p.job!.worker));
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
    stock: stock(w.stock, 'stock'),
    constructionEnabled: bool(w.constructionEnabled, 'constructionEnabled'),
    lastSelection: oneOf(w.lastSelection, BUILDING_TYPES.map((_, i) => i), 'lastSelection'),
    nextId: int(w.nextId, 'nextId'),
    rngState: int(w.rngState, 'rngState'),
  };
}

function building(v: unknown, path: string): Building {
  const b = obj(v, path);
  const out: Building = {
    id: int(b.id, `${path}.id`),
    type: oneOf<BuildingType>(b.type, BUILDING_TYPES, `${path}.type`),
    plotIndex: int(b.plotIndex, `${path}.plotIndex`),
    progress: Math.min(1, Math.max(0, num(b.progress, `${path}.progress`))),
    status: oneOf(b.status, ['constructing', 'done'] as const, `${path}.status`),
    completedAt: b.completedAt === null ? null : num(b.completedAt, `${path}.completedAt`),
    stock: stock(b.stock, `${path}.stock`),
    collectIn: num(b.collectIn, `${path}.collectIn`),
  };
  if (b.farm !== undefined) out.farm = farm(b.farm, `${path}.farm`);
  return out;
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
  return { x: num(s.x, `${path}.x`), dir: dir(s.dir, `${path}.dir`), speed: num(s.speed, `${path}.speed`), idle: num(s.idle, `${path}.idle`) };
}

function person(v: unknown, path: string): Person {
  const p = obj(v, path);
  return {
    id: int(p.id, `${path}.id`),
    name: str(p.name, `${path}.name`),
    look: oneOf(p.look, ['peasant', 'woman', 'monk'] as const, `${path}.look`),
    seed: num(p.seed, `${path}.seed`),
    job: p.job === null ? null : job(p.job, `${path}.job`),
    stroll: stroll(p.stroll, `${path}.stroll`),
  };
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
    carrying: w.carrying === null ? null : oneOf<Resource>(w.carrying, RESOURCES, `${path}.carrying`),
    task: task(w.task, `${path}.task`),
    stride: num(w.stride, `${path}.stride`),
    lunchDay: int(w.lunchDay, `${path}.lunchDay`),
  };
}

/** A job ticket; whether its target still exists is checked by the workplace on load (repairFarm). */
function ticket(v: unknown, path: string) {
  const j = obj(v, path);
  return { action: str(j.action, `${path}.action`), target: int(j.target, `${path}.target`) };
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
        job: then === 'job' ? ticket(t.job, `${path}.job`) : null,
      };
    }
    case 'job':
      return { kind: 'job', job: ticket(t.job, `${path}.job`), t: num(t.t, `${path}.t`), duration: num(t.duration, `${path}.duration`) };
    case 'enter':
    case 'exit':
      return { kind: t.kind as 'enter' | 'exit', t: num(t.t, `${path}.t`) };
    case 'home':
      return { kind: 'home', activity: oneOf(t.activity, ['lunch', 'sleep'] as const, `${path}.activity`), left: num(t.left, `${path}.left`) };
  }
}
