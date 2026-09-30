// People and animals. Every villager is a person with a number (id), a name
// and a job — or none. The unemployed stroll the street; a finished building
// with open jobs hires the nearest of them, who then lives by the worker
// routine (worker.ts) at that building. Animals (chickens) just stroll.

import { BUILDINGS, ROLES, type Role } from './buildings';
import type { Worker } from './worker';
import type { Building, World } from './world';

export type Look = 'peasant' | 'woman' | 'monk';

/** Wandering the street: where, which way, how fast, and how long to stand still. */
export interface Stroll {
  x: number;
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
  /** null: unemployed, strolling the street. */
  job: Job | null;
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

/** A name for a new villager, picked by seed. */
export function nameFor(look: Look, seed: number): string {
  const list = NAMES[look];
  return list[Math.floor(seed) % list.length];
}

/** The people working at a building. */
export function employees(world: World, b: Building): Person[] {
  return world.people.filter((p) => p.job?.buildingId === b.id);
}

/** Fill every finished building's open jobs with the nearest unemployed villagers. */
export function staffBuildings(world: World, hire: (b: Building, role: Role) => Worker): void {
  for (const b of world.buildings) {
    if (b.status !== 'done') continue;
    const jobs = BUILDINGS[b.type].jobs;
    for (const role of ROLES) {
      const open = (jobs[role] ?? 0) - employees(world, b).filter((p) => p.job!.role === role).length;
      for (let n = 0; n < open; n++) {
        const x = world.plots[b.plotIndex].x;
        const free = world.people.filter((p) => !p.job).sort((a, c) => Math.abs(a.stroll.x - x) - Math.abs(c.stroll.x - x));
        if (!free.length) return; // nobody left to hire
        free[0].job = { buildingId: b.id, role, worker: hire(b, role) };
      }
    }
  }
}

/** Unemployed people and animals wander the street, stopping now and then. */
export function updateStrolls(world: World, dt: number, rand: () => number): void {
  const minX = world.plots[0].x - 150;
  const maxX = world.plots[world.plots.length - 1].x - 50;
  const walkers: Array<{ s: Stroll; chicken: boolean }> = [
    ...world.people.filter((p) => !p.job).map((p) => ({ s: p.stroll, chicken: false })),
    ...world.animals.map((a) => ({ s: a.stroll, chicken: true })),
  ];
  for (const { s, chicken } of walkers) {
    if (s.idle > 0) {
      s.idle -= dt;
      if (s.idle <= 0 && rand() < 0.4) s.dir = (s.dir * -1) as 1 | -1;
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
