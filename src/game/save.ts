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
// Changing the save format: bump SAVE_VERSION and update SavedWorld and the
// validator below. Saves are not migrated: one from an older (or newer) version
// is refused, kept aside, and a new village starts (app/persistence.ts).

import { BUILDING_TYPES, BUILDINGS, ROLES, type BuildingType, type Role } from './buildings';
import { createFarm, repairFarm, type FarmState, type FieldPlot } from './farm';
import { farmFieldSpots, syncFarmFields } from './land';
import { FIELD_ROWS, type FieldZone } from './layout';
import { BUILDERS_PER_SITE, createSite, workSpots, type Site } from './site';
import { transportHub } from './transport';
import { employees, openings, type Animal, type Job, type Person, type Stroll } from './people';
import { RESOURCES, stockOf, type Load, type Resource, type Stock } from './resources';
import type { Worker, WorkerTask } from './worker';
import { clearLand, type Tree } from './nature';
import type { Pile } from './piles';
import { cellKey, cellName, cellsOf, footprintOf } from './grid';
import { streetOf } from './streets';
import { createWorld, goneStreet, layStreet, MERGES, type Building, type Rider, type World } from './world';

export const SAVE_VERSION = 19;


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
    branches: world.streets.slice(1).map((s) => (s.gone ? -1 : s.from!)),
  };
  return { version: SAVE_VERSION, world: JSON.parse(JSON.stringify(saved)) as SavedWorld };
}

/** Rebuild a world from save data (any older version). Never throws. */
export function loadWorld(data: unknown): LoadResult {
  try {
    const root = obj(data, 'save');
    const version = int(root.version, 'version');
    if (version > SAVE_VERSION) return { ok: false, error: `save is version ${version}, this game reads up to ${SAVE_VERSION}` };
    // an older save is not carried over: the village starts afresh
    if (version < SAVE_VERSION) return { ok: false, error: `save is version ${version}, from an older game (this one reads ${SAVE_VERSION})` };
    return { ok: true, world: build(savedWorld(root.world)) };
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
  // it, and joins the streets it meets where crossroads were made for it (so those go on their plots first)
  const plotOf = (b: Building) => world.plots.find((p) => p.x === b.x);
  const seat = () => {
    for (const b of world.buildings) {
      const plot = b.type === 'intersection' ? plotOf(b) : undefined;
      if (plot && plot.buildingId === null) plot.buildingId = b.id;
    }
  };
  const layBranch = (b: Building) => {
    if (!plotOf(b)) throw new SaveError(`crossroads ${b.id}: no plot at ${b.x}`);
    seat();
    layStreet(world, b);
  };
  for (const id of branches) {
    if (id === -1) {
      goneStreet(world);
      continue;
    }
    const b = world.buildings.find((x) => x.id === id);
    if (!b || b.type !== 'intersection' || b.status === 'constructing') throw new SaveError(`a street branches off at ${id}, which is no finished crossroads`);
    if (world.streets.some((st) => st.from === id)) throw new SaveError(`two streets branch off at crossroads ${id}`);
    layBranch(b);
  }
  // (a finished crossroads always leads somewhere)
  for (const b of world.buildings) {
    if (b.type === 'intersection' && b.status !== 'constructing' && !b.junction && !world.streets.some((st) => st.from === b.id)) layBranch(b);
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
  const taken = new Set<string>();
  for (const b of world.buildings) {
    const street = world.streets[streetOf(b.x)];
    if (!street || street.gone) throw new SaveError(`building ${b.id}: no street at ${b.x}`);
    if (ids.has(b.id)) throw new SaveError(`duplicate building id ${b.id}`);
    ids.add(b.id);
    // two buildings in one place is a broken save (one that grew since it was saved may lean on a neighbour)
    const f = footprintOf(b);
    const mid = f && cellsOf(world, { ...f, i0: Math.floor((f.i0 + f.i1) / 2), i1: Math.floor((f.i0 + f.i1) / 2), j1: f.j0 })[0];
    if (mid && taken.has(cellKey(mid.c, mid.r))) throw new SaveError(`building ${b.id}: stands where another does, at ${cellName(mid.c, mid.r)}`);
    if (mid) taken.add(cellKey(mid.c, mid.r));
    if (b.type !== 'intersection') continue;
    const plot = plotOf(b);
    if (!plot) throw new SaveError(`crossroads ${b.id}: no plot at ${b.x}`);
    if (plot.buildingId !== null && plot.buildingId !== b.id) throw new SaveError(`crossroads ${b.id}: plot at ${b.x} already taken`);
    plot.buildingId = b.id;
  }
  // what lies on the ground lies on a street that is there
  world.piles = world.piles.filter((p) => p.amount > 1e-9 && !!world.streets[streetOf(p.x)] && !world.streets[streetOf(p.x)].gone);
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
    x: num(b.x, `${path}.x`),
    progress: Math.min(1, Math.max(0, num(b.progress, `${path}.progress`))),
    status: oneOf(b.status, ['constructing', 'done', 'demolishing'] as const, `${path}.status`),
    completedAt: b.completedAt === null ? null : num(b.completedAt, `${path}.completedAt`),
    stock: stock(b.stock, `${path}.stock`),
  };
  if (b.upgraded !== undefined && bool(b.upgraded, `${path}.upgraded`)) out.upgraded = true;
  if (b.size !== undefined && MERGES[out.type]) out.size = oneOf(b.size, [2, 3] as const, `${path}.size`);
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
