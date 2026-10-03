import { describe, expect, it } from 'vitest';
import { FIREWOOD, HOUSEHOLD, SHELF_LIFE, SUMMER_DRINK } from './balance';
import { herdOf, thirsty } from './livestock';
import { DAY_LENGTH, season, timeOfDay } from './daynight';
import { householdOf, residentsOf, roomIn } from './households';
import { createWorld, placeBuilding, update, type World } from './world';

const tick = (w: World, seconds: number, each?: () => void) => {
  for (let t = 0; t < seconds; t += 1 / 30) {
    update(w, 1 / 30, { left: false, right: false });
    each?.();
  }
};
/** Seconds of play in a game day, at the world's time speed. */
const dayOf = (w: World) => 24 / timeOfDay(w).hoursPerSecond;
const houses = (w: World) => w.buildings.filter((b) => b.type === 'house');

describe('households', () => {
  it('everyone but the monks has a home, and no house holds more than it has room for', () => {
    const w = createWorld();
    tick(w, 1 / 30);
    for (const p of w.people) expect(p.home !== undefined, p.name).toBe(p.look !== 'monk');
    for (const b of houses(w)) expect(residentsOf(w, b).length).toBeLessThanOrEqual(roomIn(b));
  });

  it('a family eats bread and drinks water off its shelf', () => {
    const w = createWorld();
    // nothing more brought: no serfs, so what is on the shelves is all there is
    w.buildings = w.buildings.filter((b) => b.type !== 'warehouse');
    tick(w, 1 / 30);
    const house = houses(w).find((b) => residentsOf(w, b).length > 0)!;
    house.stock.bread = 2;
    house.stock.water = 2;
    tick(w, dayOf(w));
    expect(house.stock.bread).toBeLessThan(2);
    expect(house.stock.water).toBeLessThan(2);
  });

  it('wanting bread, water and firewood, a village loses its people one by one', () => {
    const w = createWorld();
    // no bread anywhere, no well, no yard to bring anything from
    w.buildings = w.buildings.filter((b) => b.type !== 'warehouse' && b.type !== 'well');
    for (const b of houses(w)) b.stock.bread = b.stock.water = b.stock.firewood = 0;
    const start = w.people.length;
    const counts: number[] = [];
    tick(w, dayOf(w) * 2, () => {
      const n = w.people.filter((p) => !p.leaving).length;
      if (counts[counts.length - 1] !== n) counts.push(n);
    });
    expect(counts[counts.length - 1]).toBeLessThan(start);
    // one at a time: never two from the count at once
    for (let i = 1; i < counts.length; i++) expect(counts[i - 1] - counts[i]).toBe(1);
  });

  it('those leaving walk off down the street with a sack, and are gone at its end', () => {
    const w = createWorld();
    w.buildings = w.buildings.filter((b) => b.type !== 'warehouse' && b.type !== 'well');
    let seen = false;
    let leaver: number | null = null;
    tick(w, dayOf(w) * 3, () => {
      const p = w.people.find((q) => q.leaving);
      if (p && leaver === null) leaver = p.id;
      if (p) seen = true;
    });
    expect(seen).toBe(true);
    expect(w.people.some((p) => p.id === leaver)).toBe(false);
  });

  it('a content household with room in its house gains a newcomer', () => {
    const w = createWorld();
    tick(w, 1 / 30);
    // a new house with one person moved in from elsewhere: room for two more
    const house = placeBuilding(w, 2662.5, 'house', { instant: true, free: true, settled: true })!;
    w.people.find((p) => p.home !== undefined)!.home = house.id;
    expect(residentsOf(w, house).length).toBe(1);
    const before = w.people.length;
    tick(w, dayOf(w) * (HOUSEHOLD.growDays + 0.3), () => {
      house.stock.bread = 2;
      house.stock.water = 2;
    });
    expect(householdOf(house).content).toBeGreaterThan(HOUSEHOLD.growAbove);
    expect(w.people.length).toBeGreaterThan(before);
  });
});

describe('winter', () => {
  /** The world clock moved on to the first winter. */
  const toWinter = (w: World) => {
    while (!season(w).winter) w.dayClock += DAY_LENGTH / 24;
  };

  it('is the last 3 days of every 12', () => {
    const w = createWorld();
    const winters: number[] = [];
    for (let d = 0; d < 24; d++) {
      w.dayClock = d * DAY_LENGTH + DAY_LENGTH / 2;
      if (season(w).winter) winters.push(season(w).dayOfYear);
    }
    expect([...new Set(winters)].sort((a, b) => a - b)).toEqual([10, 11, 12]);
  });

  it('nothing grows and nobody sows', () => {
    const w = createWorld();
    toWinter(w);
    const farm = w.buildings.find((b) => b.type === 'farm')!;
    const growing = farm.farm!.plots.filter((p) => p.state !== 'fallow').length;
    const ages = farm.farm!.plots.map((p) => p.age);
    tick(w, 60);
    expect(farm.farm!.plots.filter((p) => p.state !== 'fallow').length).toBeLessThanOrEqual(growing);
    expect(farm.farm!.plots.map((p) => p.age)).toEqual(ages);
  });
});

describe('spoilage', () => {
  it('fresh milk goes off within a day or so; flour keeps', () => {
    const w = createWorld();
    const yard = w.buildings.find((b) => b.type === 'warehouse')!;
    const cows = placeBuilding(w, 2587.5, 'cowfarm', { instant: true, free: true })!;
    cows.stock.milk = 4;
    yard.stock.flour = 4;
    tick(w, dayOf(w) * (SHELF_LIFE.milk! + 0.5), () => {
      cows.stock.hay = 0; // no more milk made
    });
    expect(cows.stock.milk).toBeLessThan(4);
    expect(yard.stock.flour).toBe(4);
  });
});

describe('the seasons', () => {
  const dayAt = (w: World, d: number) => {
    w.dayClock = (d - 1) * DAY_LENGTH + DAY_LENGTH / 2;
    return season(w).name;
  };

  it('spring, summer and autumn three days each, then winter', () => {
    const w = createWorld();
    expect([1, 3, 4, 6, 7, 9, 10, 12].map((d) => dayAt(w, d))).toEqual(['spring', 'spring', 'summer', 'summer', 'autumn', 'autumn', 'winter', 'winter']);
  });

  it('fires burn twice the firewood in winter', () => {
    const burnt = (day: number) => {
      const w = createWorld();
      dayAt(w, day);
      const farm = w.buildings.find((b) => b.type === 'farm')!;
      farm.stock.firewood = 3;
      tick(w, 30);
      return 3 - farm.stock.firewood;
    };
    const summer = burnt(5);
    const winter = burnt(11);
    expect(summer).toBeGreaterThan(0);
    expect(winter / summer).toBeCloseTo(2, 0);
  });

  it('animals drink twice the water in summer, and thirsty they give no milk', () => {
    const drunk = (day: number) => {
      const w = createWorld();
      dayAt(w, day);
      const cows = placeBuilding(w, 2587.5, 'cowfarm', { instant: true, free: true })!;
      tick(w, 1 / 30);
      const before = herdOf(cows).thirst ?? 0;
      cows.stock.water = 0;
      tick(w, 20, () => (cows.stock.water = 0));
      return (herdOf(cows).thirst ?? 0) - before;
    };
    expect(drunk(5) / drunk(2)).toBeCloseTo(SUMMER_DRINK, 1);

    const w = createWorld();
    const cows = placeBuilding(w, 2587.5, 'cowfarm', { instant: true, free: true })!;
    herdOf(cows).animals = [{ sex: 'female', age: 5 }];
    herdOf(cows).thirst = 1.5;
    tick(w, 60, () => {
      cows.stock.water = 0;
      cows.stock.hay = 3;
    });
    expect(thirsty(cows)).toBe(true);
    expect(cows.stock.milk).toBe(0);
  });
});

describe('firewood', () => {
  it('the sawmill splits logs into firewood, six a log, when the village is short of it', () => {
    const w = createWorld();
    const saw = placeBuilding(w, 2587.5, 'sawmill', { instant: true, free: true })!;
    saw.stock.wood = 1;
    // plenty of planks about, no firewood: it splits
    w.buildings.find((b) => b.type === 'warehouse')!.stock.planks = 20;
    tick(w, 40, () => (saw.stock.wood = Math.min(saw.stock.wood, 1)));
    expect(saw.stock.firewood + w.people.filter((p) => p.job?.worker.carrying?.resource === 'firewood').length).toBeGreaterThan(0);
    expect(FIREWOOD.perLog).toBe(6);
  });
});
