import { describe, expect, it } from 'vitest';
import { ANIMALS } from './balance';
import { timeOfDay } from './daynight';
import { herdOf, herdRoom } from './livestock';
import { pastureCells, PASTURE_CELLS_PER_HORSE } from './pasture';
import { ROAD_GRID } from './layout';
import { createWorld, placeBuilding, update, type Building, type World } from './world';

const tick = (w: World, seconds: number, each?: () => void) => {
  for (let t = 0; t < seconds; t += 1 / 30) {
    update(w, 1 / 30, { left: false, right: false });
    each?.();
  }
};

/** A new village with an animal farm of this type, finished, its store stocked with feed. */
function withFarm(type: Building['type'], feed: 'hay' | 'grain' = 'hay') {
  const w = createWorld();
  const b = placeBuilding(w, 2587.5, type, { instant: true, free: true })!;
  b.stock[feed] = 3;
  return { w, b };
}

describe('the farm grows grain and hay', () => {
  it('sows both crops, and harvests sheaves of grain and bales of hay', () => {
    const w = createWorld();
    const farm = w.buildings.find((b) => b.type === 'farm')!;
    const sown = new Set<string>();
    const harvested = new Set<string>();
    tick(w, 600, () => {
      for (const p of farm.farm!.plots) if (p.state !== 'fallow') sown.add(p.crop);
      for (const p of w.people) {
        const c = p.job?.worker.carrying;
        if (p.job?.role === 'farmer' && c) harvested.add(c.resource);
      }
    });
    expect([...sown].sort()).toEqual(['grain', 'hay']);
    expect([...harvested].sort()).toEqual(['grain', 'hay']);
  });
});

describe('animal farms', () => {
  it('a new farm starts with a grown pair, a female and a male', () => {
    const { b } = withFarm('cowfarm');
    const herd = herdOf(b);
    expect(herd.animals.map((a) => a.sex).sort()).toEqual(['female', 'male']);
    expect(herd.animals.every((a) => a.age >= ANIMALS.cow.adult)).toBe(true);
  });

  it('animals grow a year older every game day', () => {
    const { w, b } = withFarm('sheepfarm');
    const before = herdOf(b).animals[0].age;
    const seconds = 60;
    const years = (seconds * timeOfDay(w).hoursPerSecond) / 24;
    tick(w, seconds);
    expect(herdOf(b).animals[0].age - before).toBeCloseTo(years, 1);
  });

  // (a calf or a chick of the other sex in each herd: none grown is brought in while it grows up)
  it('only females give milk: a bull alone gives none, a cow two pails a feed', () => {
    const bull = withFarm('cowfarm');
    herdOf(bull.b).animals = [{ sex: 'male', age: 5 }, { sex: 'female', age: 0 }];
    tick(bull.w, 60);
    expect(bull.b.stock.milk).toBe(0);

    const cow = withFarm('cowfarm');
    herdOf(cow.b).animals = [{ sex: 'female', age: 5 }, { sex: 'male', age: 0 }];
    tick(cow.w, 60);
    expect(cow.b.stock.milk).toBeGreaterThanOrEqual(2);
    expect(cow.b.stock.milk % 2).toBe(0);
  });

  it('only hens lay, and only in their productive years', () => {
    const old = withFarm('chickenfarm', 'grain');
    herdOf(old.b).animals = [{ sex: 'female', age: ANIMALS.chicken.productiveUntil + 0.5 }, { sex: 'female', age: 0 }, { sex: 'male', age: 0 }];
    tick(old.w, 60);
    expect(old.b.stock.eggs).toBe(0);

    const young = withFarm('chickenfarm', 'grain');
    herdOf(young.b).animals = [{ sex: 'female', age: 1 }, { sex: 'male', age: 0 }];
    tick(young.w, 60);
    expect(young.b.stock.eggs).toBeGreaterThan(0);
  });

  it('a productive pair has young, female and male in turn', () => {
    const { w, b } = withFarm('sheepfarm');
    tick(w, 240, () => {
      b.stock.hay = 3; // plenty of feed
    });
    const young = herdOf(b).animals.slice(2);
    expect(young.length).toBeGreaterThanOrEqual(2);
    expect(young.slice(0, 2).map((a) => a.sex)).toEqual(['female', 'male']);
  });

  it('at the end of its life an animal is butchered for meat', () => {
    const { w, b } = withFarm('chickenfarm', 'grain');
    herdOf(b).animals = [
      { sex: 'female', age: ANIMALS.chicken.lifespan },
      { sex: 'female', age: 0 },
      { sex: 'male', age: 1 },
    ];
    tick(w, 60);
    expect(herdOf(b).animals.some((a) => a.age >= ANIMALS.chicken.lifespan)).toBe(false);
    expect(b.stock.meat).toBe(ANIMALS.chicken.meat);
  });

  it('a full herd has its oldest butchered, but never the youngest grown pair, so young ones keep coming', () => {
    const { w, b } = withFarm('chickenfarm', 'grain');
    const { max, productiveUntil } = ANIMALS.chicken;
    // full, and all but one pair past it
    herdOf(b).animals = [
      ...Array.from({ length: max - 2 }, (_, i) => ({ sex: i % 2 ? ('male' as const) : ('female' as const), age: productiveUntil + 1 + i * 0.1 })),
      { sex: 'female', age: 1 },
      { sex: 'male', age: 1 },
    ];
    tick(w, 120, () => {
      b.stock.grain = 3;
      b.stock.water = 3;
      b.stock.meat = 0; // (carried off)
    });
    const h = herdOf(b).animals;
    expect(h.filter((a) => a.age < 0.5).length).toBeGreaterThan(0);
    expect(h.some((a) => a.sex === 'female' && a.age > 1 && a.age < productiveUntil)).toBe(true);
    expect(h.some((a) => a.sex === 'male' && a.age > 1 && a.age < productiveUntil)).toBe(true);
  });

  it('a herd left with no female or male that will breed gets a grown one brought in', () => {
    const { w, b } = withFarm('cowfarm');
    herdOf(b).animals = [{ sex: 'male', age: ANIMALS.cow.adult }];
    tick(w, 1);
    expect(herdOf(b).animals.map((a) => a.sex).sort()).toEqual(['female', 'male']);
    // an empty one gets a pair
    herdOf(b).animals = [];
    tick(w, 1);
    expect(herdOf(b).animals.map((a) => a.sex).sort()).toEqual(['female', 'male']);
  });
});

describe('pasture', () => {
  it('a horse farm grazes the free land behind it, within its square of the road grid', () => {
    const { w, b } = withFarm('horsefarm');
    const cells = pastureCells(w, b).length;
    expect(cells).toBeGreaterThan(0);
    expect(cells).toBeLessThan(ROAD_GRID * ROAD_GRID);
    expect(herdRoom(w, b)).toBe(Math.min(ANIMALS.horse.max, Math.floor(cells / PASTURE_CELLS_PER_HORSE)));
  });

  it('building next to it takes from the pasture', () => {
    const w = createWorld();
    const b = placeBuilding(w, 2812.5, 'horsefarm', { instant: true, free: true })!;
    const before = pastureCells(w, b).length;
    expect(placeBuilding(w, 2962.5, 'house', { instant: true, free: true })).toBeTruthy();
    expect(pastureCells(w, b).length).toBeLessThan(before);
  });

  it('other animal farms have no pasture', () => {
    const { w, b } = withFarm('cowfarm');
    expect(pastureCells(w, b)).toEqual([]);
  });
});
