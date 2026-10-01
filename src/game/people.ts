// People and animals. Every villager is a person with a number (id), a name
// and a job — or none. The unemployed stroll the street; a finished building
// with open jobs hires the nearest of them, who then lives by the worker
// routine (worker.ts) at that building. Animals (chickens) just stroll.

import { BUILDINGS, ROLES, type Role } from './buildings';
import { ROAD_Y } from './layout';
import { streetDist, streetOf, streetRange } from './streets';
import type { Worker } from './worker';
import type { Building, World } from './world';

export type Look = 'peasant' | 'woman' | 'monk';

/** Wandering the street: where, which way, how fast, and how long to stand still. */
export interface Stroll {
  x: number;
  /** Depth (world y): on their lane of the street, or walking back to it. */
  y: number;
  dir: 1 | -1;
  speed: number;
  /** Seconds remaining standing still. */
  idle: number;
}

export interface Job {
  buildingId: number;
  role: Role;
  /** Where the worker is and what they're doing at the workplace. */
  worker: Worker;
}

export interface Person {
  id: number;
  name: string;
  look: Look;
  seed: number;
  /** null: between shifts, strolling the street. */
  job: Job | null;
  /** Their profession for life; people with one take jobs of that role only. */
  profession?: Role;
  /**
   * Out of work and looking: no profession yet. Runs errands as a serf while
   * there are any, and takes the first lasting job going (a miller, a
   * farmer), which then becomes their profession. Never a builder.
   */
  seeker?: true;
  stroll: Stroll;
}

export interface Animal {
  id: number;
  kind: 'chicken';
  seed: number;
  stroll: Stroll;
}

const NAMES: Record<Look, readonly string[]> = {
  peasant: ['Aldric', 'Bertram', 'Cedric', 'Edwin', 'Godric', 'Hugh', 'Osric', 'Wat', 'Piers', 'Hamon', 'Alan', 'Jocelin', 'Ralf', 'Simkin', 'Walter', 'Ivo'],
  woman: ['Agnes', 'Beatrice', 'Cecily', 'Edith', 'Isolde', 'Joan', 'Maud', 'Rohese', 'Alys', 'Emma'],
  monk: ['Brother Anselm', 'Brother Bede', 'Brother Cuthbert', 'Brother Dunstan'],
};

/** A name for a new villager, picked by seed, and not one already `taken` in the village. */
export function nameFor(look: Look, seed: number, taken: ReadonlySet<string> = new Set()): string {
  const list = NAMES[look];
  const start = Math.floor(Math.abs(seed)) % list.length;
  for (let i = 0; i < list.length; i++) {
    const name = list[(start + i) % list.length];
    if (!taken.has(name)) return name;
  }
  // every name of that kind is in use: number them
  for (let k = 2; ; k++) if (!taken.has(`${list[start]} ${k}`)) return `${list[start]} ${k}`;
}

/** The lane of the street someone strolls along: odd ids on the far side, even ids on the near side. */
export function laneY(id: number): number {
  return id % 2 === 1 ? ROAD_Y - 14 : ROAD_Y + 12;
}

/** The people working at a building. */
export function employees(world: World, b: Building): Person[] {
  return world.people.filter((p) => p.job?.buildingId === b.id);
}

/** The jobs a finished building gives: its own, or its upgrade's once upgraded. */
export function jobsOf(b: Building): Partial<Record<Role, number>> {
  const def = BUILDINGS[b.type];
  return b.upgraded && def.upgrade ? def.upgrade.jobs : def.jobs;
}

/**
 * Jobs a building offers now: its own once finished; builders while it's a
 * construction site (a finished building being upgraded offers both), or
 * while it is being pulled down.
 */
export function openings(b: Building, buildersPerSite: number, dayLabour: boolean): Partial<Record<Role, number>> {
  // one being pulled down needs only builders
  if (b.status === 'demolishing') return dayLabour ? { builder: buildersPerSite } : {};
  const own = b.status === 'done' ? jobsOf(b) : {};
  return b.site && dayLabour ? { ...own, builder: buildersPerSite } : own;
}

/** Where someone is along the street now (world x). */
function whereX(world: World, p: Person): number {
  const b = p.job && world.buildings.find((x) => x.id === p.job!.buildingId);
  return b ? b.x + p.job!.worker.dx : p.stroll.x;
}

/** A serf between errands: carrying nothing and not in the middle of picking something up. */
function betweenErrands(p: Person): boolean {
  const w = p.job?.role === 'serf' ? p.job.worker : null;
  return !!w && !w.carrying && w.task.kind !== 'job';
}

/**
 * Who may take a job of this role, best first: people of that profession who
 * are free; for a lasting job (not building, not errands) then seekers who
 * are free, then seekers running errands as serfs, between errands; for
 * errands, free seekers only.
 */
function candidates(world: World, role: Role): Person[][] {
  const free = (p: Person) => !p.job;
  if (role === 'serf') return [world.people.filter((p) => free(p) && p.seeker)];
  const pros = world.people.filter((p) => free(p) && p.profession === role);
  if (role === 'builder') return [pros];
  return [pros, world.people.filter((p) => free(p) && p.seeker), world.people.filter((p) => p.seeker && betweenErrands(p))];
}

/**
 * Fill every building's open jobs (`openingsOf`) with the nearest people who
 * may take them. Lasting jobs are filled before errands (ROLES ends with
 * serf), so a serf is hired away for one whenever they are between errands.
 */
export function staffBuildings(world: World, hire: (b: Building, role: Role, who: Person) => Worker, openingsOf: (b: Building) => Partial<Record<Role, number>>): void {
  for (const role of ROLES) {
    for (const b of world.buildings) {
      const open = (openingsOf(b)[role] ?? 0) - employees(world, b).filter((p) => p.job!.role === role).length;
      const x = b.x;
      for (let n = 0; n < open; n++) {
        const tier = candidates(world, role).find((list) => list.length);
        if (!tier) break; // nobody for this job: on to the next
        const who = tier.sort((a, c) => streetDist(world, whereX(world, a), x) - streetDist(world, whereX(world, c), x))[0];
        if (who.job) release(world, who); // a serf leaves their errands from where they stand
        if (role !== 'serf') {
          // a lasting job becomes a seeker's profession
          who.profession = role;
          delete who.seeker;
        }
        who.job = { buildingId: b.id, role, worker: hire(b, role, who) };
      }
    }
  }
}

/** Let someone go: they stay exactly where they stand, then walk back to their lane and stroll the street again. */
export function release(world: World, p: Person): void {
  const b = p.job && world.buildings.find((x) => x.id === p.job!.buildingId);
  if (b) {
    const w = p.job!.worker;
    p.stroll.x = b.x + w.dx;
    p.stroll.y = w.y;
    p.stroll.dir = w.facing;
  }
  p.stroll.idle = 0.5;
  p.job = null;
}

/** Unemployed people and animals wander the street they are on, stopping now and then. */
export function updateStrolls(world: World, dt: number, rand: () => number): void {
  const walkers: Array<{ s: Stroll; chicken: boolean; lane: number }> = [
    ...world.people.filter((p) => !p.job).map((p) => ({ s: p.stroll, chicken: false, lane: laneY(p.id) })),
    ...world.animals.map((a) => ({ s: a.stroll, chicken: true, lane: laneY(a.id) })),
  ];
  for (const { s, chicken, lane } of walkers) {
    if (s.idle > 0) {
      s.idle -= dt;
      if (s.idle <= 0 && rand() < 0.4 && s.y === lane) s.dir = (s.dir * -1) as 1 | -1;
      continue;
    }
    // off the street (just let go from work): walk back to their lane first
    if (s.y !== lane) {
      const d = lane - s.y;
      const step = s.speed * dt;
      s.y = Math.abs(d) <= step ? lane : s.y + Math.sign(d) * step;
      continue;
    }
    const { min: minX, max: maxX } = streetRange(world, streetOf(s.x));
    s.x += s.dir * s.speed * dt;
    if (s.x < minX || s.x > maxX) {
      s.x = Math.max(minX, Math.min(maxX, s.x));
      s.dir = (s.dir * -1) as 1 | -1;
    }
    if (rand() < dt * (chicken ? 0.5 : 0.12)) s.idle = 1 + rand() * 4;
  }
}
