import { describe, expect, it } from 'vitest';
import { HUNGER, PANTRY } from './balance';
import { BUILDINGS, PANTRIES, storageOf } from './buildings';
import { timeOfDay } from './daynight';
import { hungry, starving } from './hunger';
import { outdoors, type Person } from './people';
import { createWorld, placeBuilding, update, type Building, type World } from './world';

const tick = (w: World, seconds: number, each?: () => boolean | void) => {
  for (let t = 0; t < seconds; t += 1 / 30) {
    update(w, 1 / 30, { left: false, right: false });
    if (each?.()) return;
  }
};
const dayOf = (w: World) => 24 / timeOfDay(w).hoursPerSecond;
const of = (w: World, type: Building['type']) => w.buildings.filter((b) => b.type === type);
/** Everyone fed for days, but `who`, who has just run out. */
const onlyHungry = (w: World, who: Person) => {
  for (const p of w.people) p.food = 10;
  who.food = 0;
};

describe('hunger', () => {
  it('everyone carries some food to start with, and uses up a day of it in a day', () => {
    const w = createWorld();
    for (const p of w.people) expect(p.food).toBeGreaterThan(0);
    const p = w.people[0];
    p.food = 5;
    tick(w, dayOf(w) / 4);
    expect(p.food).toBeCloseTo(4.75, 1);
  });

  it('hungry, with no food at home, someone walks to the tavern and eats its bread there', () => {
    const w = createWorld();
    tick(w, 1 / 30);
    for (const b of w.buildings) b.stock.bread = 0;
    const tavern = of(w, 'tavern')[0];
    tavern.stock.bread = 2;
    // a townsperson out on the street, nothing at home
    const who = w.people.find((p) => !p.job && p.look !== 'monk' && p.profession !== 'serf')!;
    onlyHungry(w, who);
    let ateThere = false;
    tick(w, 60, () => {
      ateThere ||= who.visit?.why === 'eat' && who.visit.at === tavern.id && who.visit.left !== undefined;
      return !hungry(who);
    });
    expect(ateThere).toBe(true);
    expect(hungry(who)).toBe(false);
    expect(tavern.stock.bread).toBe(1);
  });

  it('with food at home, someone hungry eats there, inside, and not at the tavern', () => {
    const w = createWorld();
    tick(w, 1 / 30);
    const who = w.people.find((p) => !p.job && p.look !== 'monk' && p.profession !== 'serf')!;
    const home = w.buildings.find((b) => b.id === who.home)!;
    for (const b of w.buildings) b.stock.bread = 0;
    home.stock.bread = 1;
    of(w, 'tavern')[0].stock.bread = 2;
    onlyHungry(w, who);
    let inside = false;
    tick(w, 60, () => {
      inside ||= who.visit?.at === home.id && !outdoors(who);
      return !hungry(who);
    });
    expect(inside).toBe(true);
    expect(home.stock.bread).toBe(0);
    expect(of(w, 'tavern')[0].stock.bread).toBe(2);
  });

  it('a hungry worker leaves their work for the tavern between jobs, and goes back to it', () => {
    const w = createWorld();
    tick(w, 1 / 30);
    for (const b of w.buildings) b.stock.bread = 0;
    const tavern = of(w, 'tavern')[0];
    tavern.stock.bread = 1;
    const farmer = w.people.find((p) => p.profession === 'farmer')!;
    onlyHungry(w, farmer);
    let ate = false;
    tick(w, 90, () => {
      ate ||= farmer.job?.worker.task.kind === 'meal';
      return !hungry(farmer);
    });
    expect(ate).toBe(true);
    expect(tavern.stock.bread).toBe(0);
    expect(farmer.job?.role).toBe('farmer');
  });

  it('hungry, nobody takes food from a store; starving, they eat what is there', () => {
    const w = createWorld();
    // no storage yards (and so no serfs to move anything); the only food a storehouse's cheese
    w.buildings = w.buildings.filter((b) => b.type !== 'warehouse');
    for (const b of w.buildings) b.stock.bread = 0;
    const store = placeBuilding(w, 2587.5, 'storehouse', { instant: true, free: true })!;
    store.stock.cheese = 3;
    tick(w, 1 / 30);
    const who = w.people.find((p) => !p.job && p.look !== 'monk' && p.profession !== 'serf')!;
    onlyHungry(w, who);
    tick(w, 20);
    expect(hungry(who)).toBe(true);
    expect(store.stock.cheese).toBe(3);
    who.food = -HUNGER.starving;
    expect(starving(who)).toBe(true);
    tick(w, 180, () => !hungry(who));
    expect(hungry(who)).toBe(false);
    expect(store.stock.cheese).toBe(2);
  });

  it('long starving, someone leaves the village', () => {
    const w = createWorld();
    tick(w, 1 / 30);
    for (const b of w.buildings) b.stock.bread = 0;
    const who = w.people.find((p) => !p.job && p.look !== 'monk')!;
    onlyHungry(w, who);
    who.food = -HUNGER.leave + 0.01;
    tick(w, 20, () => !!who.leaving);
    expect(who.leaving).toBe(true);
  });

  it('at night, those who live in a house go in and sleep, and come out in the morning', () => {
    const w = createWorld();
    let asleep = 0;
    let night = false;
    tick(w, dayOf(w) * 1.2, () => {
      if (!timeOfDay(w).daylight) {
        night = true;
        asleep = Math.max(asleep, w.people.filter((p) => p.visit?.why === 'sleep' && !outdoors(p)).length);
      } else if (night) return true;
    });
    expect(asleep).toBeGreaterThan(3);
    tick(w, 5);
    expect(w.people.filter((p) => p.visit?.why === 'sleep').length).toBe(0);
  });

  it('a workshop people live in keeps a pantry of bread, which serfs bring', () => {
    expect(PANTRIES.has('mill')).toBe(true);
    expect(PANTRIES.has('bakery')).toBe(false); // the baker eats the bakery's own
    expect(storageOf({ type: 'mill' }).bread).toBe(PANTRY);
    expect(BUILDINGS.mill.needs).toContain('bread');
    const w = createWorld();
    const mill = placeBuilding(w, 2587.5, 'mill', { instant: true, free: true })!;
    // bread enough for every pantry in the village
    for (const yard of of(w, 'warehouse')) yard.stock.bread = 40;
    tick(w, 600, () => mill.stock.bread >= 1);
    expect(mill.stock.bread).toBeGreaterThanOrEqual(1);
  });
});
