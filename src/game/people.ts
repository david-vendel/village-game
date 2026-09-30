// People and animals. Every villager is a person with a number (id), a name
// and a job — or none. The unemployed stroll the street; a finished building
// with open jobs hires the nearest of them, who then lives by the worker
// routine (worker.ts) at that building. Animals (chickens) just stroll.

import { BUILDINGS, ROLES, type Role } from './buildings';
import { ROAD_Y } from './layout';
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
  /** Their profession for life; only people with one take jobs, and only of that role. */
  profession?: Role;
  stroll: Stroll;
}

export interface Animal {
  id: number;
  kind: 'chicken';
  seed: number;
  stroll: Stroll;
}

const NAMES: Record<Look, readonly string[]> = {
  peasant: ['Aldric', 'Bertram', 'Cedric', 'Edwin', 'Godric', 'Hugh', 'Osric', 'Wat', 'Piers', 'Hamon'],
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

/** Jobs a building offers now: its own once finished; builders while it's a construction site. */
export function openings(b: Building, buildersPerSite: number, dayLabour: boolean): Partial<Record<Role, number>> {
  if (b.status === 'done') return BUILDINGS[b.type].jobs;
  return b.site && dayLabour ? { builder: buildersPerSite } : {};
}

/**
 * Fill every building's open jobs with the nearest unemployed villagers.
 * `dayLabour`: whether construction sites hire now (only while it's light).
 */
export function staffBuildings(world: World, hire: (b: Building, role: Role, who: Person) => Worker, opts: { buildersPerSite: number; dayLabour: boolean }): void {
  for (const b of world.buildings) {
    const jobs = openings(b, opts.buildersPerSite, opts.dayLabour);
    for (const role of ROLES) {
      const open = (jobs[role] ?? 0) - employees(world, b).filter((p) => p.job!.role === role).length;
      for (let n = 0; n < open; n++) {
        const x = world.plots[b.plotIndex].x;
        // everyone keeps their profession: builders build, the farmer farms
        const free = world.people.filter((p) => !p.job && p.profession === role).sort((a, c) => Math.abs(a.stroll.x - x) - Math.abs(c.stroll.x - x));
        if (!free.length) return; // nobody left to hire
        free[0].job = { buildingId: b.id, role, worker: hire(b, role, free[0]) };
      }
    }
  }
}

/** Let someone go: they stay exactly where they stand, then walk back to their lane and stroll the street again. */
export function release(world: World, p: Person): void {
  const b = p.job && world.buildings.find((x) => x.id === p.job!.buildingId);
  if (b) {
    const w = p.job!.worker;
    p.stroll.x = world.plots[b.plotIndex].x + w.dx;
    p.stroll.y = w.y;
    p.stroll.dir = w.facing;
  }
  p.stroll.idle = 0.5;
  p.job = null;
}

/** Unemployed people and animals wander the street, stopping now and then. */
export function updateStrolls(world: World, dt: number, rand: () => number): void {
  const minX = world.plots[0].x - 150;
  const maxX = world.plots[world.plots.length - 1].x - 50;
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
    s.x += s.dir * s.speed * dt;
    if (s.x < minX || s.x > maxX) {
      s.x = Math.max(minX, Math.min(maxX, s.x));
      s.dir = (s.dir * -1) as 1 | -1;
    }
    if (rand() < dt * (chicken ? 0.5 : 0.12)) s.idle = 1 + rand() * 4;
  }
}
