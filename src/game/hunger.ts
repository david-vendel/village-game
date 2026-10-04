// Hunger: every villager carries some days of food in them (Person.food), used
// up a day a game day (HUNGER in balance.ts). Nobody is fed by magic: they
// walk to the food and eat it there.
//
// - At home (in for lunch or for the night), someone running low eats from
//   their home's pantry (PANTRY: loaves by the door, which serfs bring; a
//   workshop's own food will do too: the baker eats the bakery's bread).
// - Hungry (no food left in them): they go home to eat if it has food, else to
//   the nearest tavern, and eat its bread at the bench out front.
// - Starving (HUNGER.starving days on): they put down their work and eat
//   whatever food is nearest, anywhere: a storage yard, a workshop, another
//   family's shelf.
// - Long starving (HUNGER.leave days on), they leave the village.
//
// A worker sets off for a meal between jobs (worker.ts: walk then 'eat', then
// the 'meal' task); someone not at work goes on a `Visit` (people.ts), which is
// also how they go home to sleep at night. The food is reserved by whoever is
// on their way to it, read off their tickets and visits (like transport.ts),
// and taken when they sit down to eat. Nobody goes out for food at night:
// they eat at home, or wait for the morning.

import { FOODS, HUNGER } from './balance';
import { doorOf } from './buildings';
import { GAME_HOUR, timeOfDay } from './daynight';
import { storeSpot } from './economy';
import { leave } from './households';
import { forgetWay, type Person } from './people';
import { RESOURCES, type Resource } from './resources';
import { streetDist } from './streets';
import { goToMeal, mealOf, walkOnLand, WALK_SPEED_EMPTY, type JobTicket, type Meals, type Nav } from './worker';
import type { Building, World } from './world';

const FOOD: readonly Resource[] = RESOURCES.filter((r) => FOODS[r]);

/** Out of food: looking for a meal. */
export const hungry = (p: Person) => p.food <= 0;
/** Long out of food: eats anything, anywhere. */
export const starving = (p: Person) => p.food <= -HUNGER.starving;

/** The first food in b's store, if any. */
export function pantryFood(b: Building): Resource | null {
  return FOOD.find((r) => b.stock[r] >= 1) ?? null;
}

const eatAction = (r: Resource) => `eat-${r}`;
/** The food a meal's ticket is for. */
export function mealFood(job: JobTicket): Resource | null {
  const r = job.action.startsWith('eat-') ? (job.action.slice(4) as Resource) : null;
  return r && FOODS[r] ? r : null;
}

/** Someone eats an item of r: days of food in them, from none if they had gone without. */
function fill(p: Person, r: Resource): void {
  p.food = Math.max(p.food, 0) + (FOODS[r] ?? 0);
}

/** Food someone is on their way to eat, by building and food. */
function reserved(world: World): Map<string, number> {
  const out = new Map<string, number>();
  const add = (at: number, r: Resource | null | undefined) => r && out.set(`${at}|${r}`, (out.get(`${at}|${r}`) ?? 0) + 1);
  for (const p of world.people) {
    const t = p.job?.worker.task;
    if (t?.kind === 'walk' && t.then === 'eat' && t.job) add(t.job.target, mealFood(t.job));
    const v = p.visit;
    if (v?.why === 'eat' && v.left === undefined) add(v.at, v.food);
  }
  return out;
}

/**
 * Where p goes to eat, from world x, and what: their home, if it has food;
 * else a tavern's bread, the nearest; starving, the nearest food anywhere.
 */
export function mealFor(world: World, p: Person, x: number): { b: Building; r: Resource } | null {
  const taken = reserved(world);
  const free = (b: Building) => (b.status === 'done' ? FOOD.find((r) => b.stock[r] - (taken.get(`${b.id}|${r}`) ?? 0) >= 1) : undefined);
  const home = p.home === undefined ? undefined : world.buildings.find((b) => b.id === p.home);
  const atHome = home && free(home);
  if (home && atHome) return { b: home, r: atHome };
  const places = world.buildings.filter((b) => (starving(p) || b.type === 'tavern') && free(b));
  const d = (b: Building) => streetDist(world, x, b.x);
  const b = places.sort((a, c) => d(a) - d(c))[0];
  return b ? { b, r: free(b)! } : null;
}

/** Where p has a meal at b (dx from fromX): inside their own home, else where the food lies (a tavern's bench, a store). */
function mealSpot(world: World, p: Person, b: Building, r: Resource, fromX: number): { dx: number; y: number; indoors: boolean } {
  const door = doorOf(b.type, b.size ?? 1);
  if (b.id === p.home && door) return { dx: b.x + door.dx - fromX, y: door.y, indoors: true };
  return { ...storeSpot(world, b, r, fromX, true), indoors: false };
}

/** Sit down to eat r at b: the food is taken; how long the meal takes, or null if it is gone. */
function sit(b: Building | undefined, r: Resource | null): number | null {
  if (!b || !r || b.stock[r] < 1) return null;
  b.stock[r] -= 1;
  return HUNGER.mealHours * GAME_HOUR;
}

/** A worker's meals (worker.ts Meals): p, at work. */
export function mealsOf(world: World, p: Person): Meals {
  return {
    sit(job) {
      const b = world.buildings.find((o) => o.id === job.target);
      const seconds = sit(b, mealFood(job));
      return seconds === null ? null : { seconds, indoors: b!.id === p.home && !!doorOf(b!.type, b!.size ?? 1) };
    },
    eaten(job) {
      const r = mealFood(job);
      if (r) fill(p, r);
    },
  };
}

/**
 * A hungry worker sets off for a meal between jobs (a starving one also
 * instead of the job they were walking to), with empty hands, in their
 * working hours. `x`: their workplace's.
 */
export function sendToEat(world: World, p: Person, x: number, awake: boolean): void {
  const w = p.job?.worker;
  if (!w || !hungry(p) || !awake || w.carrying || mealOf(w)) return;
  const t = w.task;
  if (t.kind !== 'idle' && !(starving(p) && t.kind === 'walk' && t.then === 'job')) return;
  const meal = mealFor(world, p, x + w.dx);
  if (!meal) return;
  const at = mealSpot(world, p, meal.b, meal.r, x);
  goToMeal(w, at.dx, at.y, { action: eatAction(meal.r), target: meal.b.id });
}

/** Whether p is inside their home now: in for lunch or the night at their workplace, or home asleep. */
function inAtHome(p: Person): boolean {
  if (p.home === undefined) return false;
  if (p.job) return p.job.buildingId === p.home && p.job.worker.task.kind === 'home';
  return p.visit?.why === 'sleep' && p.visit.at === p.home && p.visit.left !== undefined;
}

/** Everyone's hunger for dt seconds: food used up, a bite at home when low, and the long starving leave. */
export function updateHunger(world: World, dt: number): void {
  const days = (dt * timeOfDay(world).hoursPerSecond) / 24;
  for (const p of [...world.people]) {
    if (p.leaving) continue;
    p.food -= days;
    if (p.food <= HUNGER.topUp && inAtHome(p)) {
      const home = world.buildings.find((b) => b.id === p.home)!;
      const r = pantryFood(home);
      if (r) {
        home.stock[r] -= 1;
        fill(p, r);
      }
    }
    if (p.food <= -HUNGER.leave) leave(world, p);
  }
}

/** Seconds' walk at most before someone heading somewhere gives up (the way is shut). */
const VISIT_GIVE_UP = 300;

/**
 * Those not at work: home for the night, out to eat when hungry (by day),
 * walking there, inside or eating, and back out to the street. `navAt`: the
 * way round the land from a building at world x (worker.ts Nav).
 */
export function updateVisits(world: World, dt: number, navAt: (x: number) => Nav): void {
  const now = timeOfDay(world);
  for (const p of world.people) {
    if (p.job || p.leaving) {
      delete p.visit;
      continue;
    }
    const s = p.stroll;
    if (!p.visit) {
      const home = p.home === undefined ? undefined : world.buildings.find((b) => b.id === p.home);
      const door = home && doorOf(home.type, home.size ?? 1);
      const meal = now.daylight && hungry(p) ? mealFor(world, p, s.x) : null;
      if (meal) {
        const at = mealSpot(world, p, meal.b, meal.r, meal.b.x);
        p.visit = { at: meal.b.id, why: 'eat', food: meal.r, dx: at.dx, y: at.y };
      } else if (!now.daylight && home && door) p.visit = { at: home.id, why: 'sleep', dx: door.dx, y: door.y };
      continue;
    }
    const v = p.visit;
    const b = world.buildings.find((o) => o.id === v.at && o.status === 'done');
    if (!b) {
      out(p);
      continue;
    }
    if (v.left === undefined) {
      // on the way
      v.walker ??= { dx: s.x - b.x, y: s.y, facing: s.dir, stride: 0 };
      const there = walkOnLand(v.walker, v.dx, v.y, WALK_SPEED_EMPTY * dt, navAt(b.x));
      v.t = (v.t ?? 0) + dt;
      s.x = b.x + (there ? v.dx : v.walker.dx);
      s.y = there ? v.y : v.walker.y;
      s.dir = v.walker.facing;
      s.idle = 0;
      if (!there) {
        if (v.t > VISIT_GIVE_UP) out(p);
        continue;
      }
      delete v.walker;
      delete v.t;
      if (v.why === 'sleep') {
        v.left = 0;
        continue;
      }
      const seconds = sit(b, v.food ?? null);
      if (seconds === null) {
        out(p); // the food went while they walked
        continue;
      }
      v.left = HUNGER.mealHours;
      const door = doorOf(b.type, b.size ?? 1);
      if (!(b.id === p.home && door)) {
        v.outdoors = true;
        s.idle = 1;
      }
      continue;
    }
    if (v.why === 'sleep') {
      if (now.daylight) out(p);
      continue;
    }
    // eating
    s.idle = 1;
    v.left -= dt * now.hoursPerSecond;
    if (v.left > 0) continue;
    if (v.food) fill(p, v.food);
    out(p);
  }
}

/** Back out on the street from a visit, from where they are (the door, the bench). */
function out(p: Person): void {
  delete p.visit;
  forgetWay(p.stroll);
  p.stroll.idle = 0.5;
}
