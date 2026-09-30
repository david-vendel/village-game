import { describe, expect, it } from 'vitest';
import { BUILDINGS } from './buildings';
import type { TimeOfDay } from './daynight';
import { COLLECT_EVERY, STARTING_STOCK } from './economy';
import { createFarm, farmWorkplace, GROW_TIME, isBorrowed, updateCrops, type FieldPlot } from './farm';
import { HOME, STORE } from './layout';
import { employees } from './people';
import { stockOf } from './resources';
import { createWorker, LUNCH_AT, MIDDAY, updateWorker } from './worker';
import { createWorld, placeBuilding, update } from './world';

const CAPACITY = BUILDINGS.farm.storage.grain!;

/** A farm with one farmer, run on its own (no world), at a fixed time of day. */
function rig() {
  const farm = createFarm();
  const stock = stockOf();
  const place = farmWorkplace(farm, stock);
  const w = createWorker(place);
  const dt = 1 / 30;
  const step = (now: TimeOfDay) => {
    updateCrops(farm, dt);
    updateWorker(w, place, dt, now, []);
  };
  return {
    farm,
    stock,
    place,
    w,
    run(seconds: number, now = MIDDAY) {
      for (let t = 0; t < seconds; t += dt) step(now);
    },
    /** Run until `pred` holds; fails the test if it takes too long. */
    until(pred: () => boolean, max = 200, now = MIDDAY) {
      for (let t = 0; t < max; t += dt) {
        if (pred()) return;
        step(now);
      }
      throw new Error('condition never reached');
    },
  };
}

describe('farm', () => {
  it('a new farm is just the farmstead: grass all round and an empty store', () => {
    const r = rig();
    expect(r.farm.plots.some((p) => p.zone === 'back')).toBe(true);
    expect(r.farm.plots.some((p) => p.zone === 'front')).toBe(true);
    expect(r.farm.plots.every((p) => p.state === 'fallow' && !p.tilled)).toBe(true);
    expect(r.stock.grain).toBe(0);
  });

  it('a plot becomes a field when the farmer first works it', () => {
    const r = rig();
    r.until(() => r.w.task.kind === 'job');
    const t = r.w.task;
    expect(t.kind === 'job' && r.farm.plots[t.job.target].tilled).toBe(true);
    expect(r.farm.plots.filter((p) => p.tilled)).toHaveLength(1);
  });

  it('the farmer goes straight from one plot to the next', () => {
    const r = rig();
    r.until(() => r.farm.plots.some((p) => p.state === 'growing'));
    r.until(() => r.w.task.kind === 'walk');
    const t = r.w.task;
    expect(t.kind === 'walk' && t.then === 'job').toBe(true);
  });

  it('work takes time in proportion to the plot size', () => {
    const r = rig();
    const small = r.farm.plots.find((p) => p.width === 50)!;
    const big = r.farm.plots.find((p) => p.width === 75)!;
    const d = (p: FieldPlot) => r.place.begin({ action: 'sow', target: r.farm.plots.indexOf(p) })!;
    expect(d(big) / d(small)).toBeCloseTo(1.5);
  });

  it('crops ripen after GROW_TIME and are harvested into the store', () => {
    const r = rig();
    r.until(() => r.farm.plots.some((p) => p.state === 'ripe'), GROW_TIME + 60);
    r.until(() => r.stock.grain === 1);
    expect(r.w.carrying).toBeNull();
    expect(r.w.dx).toBeCloseTo(STORE.dx + 16);
    expect(r.farm.plots.some((p) => p.state === 'fallow')).toBe(true);
  });

  it('a full store stops the harvest, but not the sowing', () => {
    const r = rig();
    r.stock.grain = CAPACITY;
    for (const p of r.farm.plots) {
      p.tilled = true;
      p.state = 'ripe';
      p.age = GROW_TIME;
    }
    expect(r.place.nextJob(r.w, [])).toBeNull();
    r.farm.plots[0].state = 'fallow';
    expect(r.place.nextJob(r.w, [])!.job).toEqual({ action: 'sow', target: 0 });
  });

  it('prefers harvesting over sowing when the store has room', () => {
    const r = rig();
    r.farm.plots[3].tilled = true;
    r.farm.plots[3].state = 'ripe';
    expect(r.place.nextJob(r.w, [])!.job).toEqual({ action: 'harvest', target: 3 });
  });

  it('sows its own land first and borrowed land only once all of its own is in use', () => {
    const r = rig();
    const own = r.farm.plots.filter((p) => !isBorrowed(p));
    const borrowed = r.farm.plots.filter(isBorrowed);
    expect(borrowed.length).toBeGreaterThan(0);
    const sown = new Set<FieldPlot>();
    r.until(() => {
      for (const p of borrowed) {
        if (p.state === 'fallow' || sown.has(p)) continue;
        expect(own.every((o) => o.state !== 'fallow')).toBe(true);
        sown.add(p);
      }
      return sown.size === borrowed.length;
    }, GROW_TIME * 10);
  });
});

describe("a farmer's day", () => {
  it('goes home for lunch at 11:30, eats for an hour once inside, and only once a day', () => {
    const r = rig();
    r.until(() => r.w.task.kind === 'job');
    const now: TimeOfDay = { ...MIDDAY, hour: LUNCH_AT };
    r.until(() => r.w.task.kind === 'home', 60, now);
    expect(r.w.task).toMatchObject({ kind: 'home', activity: 'lunch' });
    expect(r.w.dx).toBeCloseTo(HOME.dx);
    const hour = 1 / now.hoursPerSecond;
    r.run(hour * 0.95, now);
    expect(r.w.task.kind).toBe('home');
    r.run(hour * 0.1, now);
    expect(r.w.task.kind).toBe('exit');
    // still lunchtime by the clock, but he has eaten today
    r.run(10, now);
    expect(['home', 'enter']).not.toContain(r.w.task.kind);
  });

  it('sleeps at night and comes out in the morning', () => {
    const r = rig();
    r.until(() => r.w.task.kind === 'home', 30, { ...MIDDAY, daylight: false, hour: 22 });
    expect(r.w.task).toMatchObject({ kind: 'home', activity: 'sleep' });
    r.run(1 / 30, { ...MIDDAY, hour: 7 });
    expect(r.w.task.kind).toBe('exit');
  });
});

describe('farms in the world', () => {
  const tick = (w: ReturnType<typeof createWorld>, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 30) update(w, 1 / 30, { left: false, right: false });
  };

  it('the starting village farm has hired a villager as its farmer', () => {
    const w = createWorld();
    const farm = w.buildings.find((b) => b.type === 'farm')!;
    const staff = employees(w, farm);
    expect(staff).toHaveLength(1);
    expect(staff[0].job!.role).toBe('farmer');
    expect(staff[0].name).toBeTruthy();
    expect(w.people.filter((p) => !p.job).length).toBe(w.people.length - 1);
  });

  it('a farm hires only once construction is finished, and only if someone is free', () => {
    const w = createWorld();
    const b = placeBuilding(w, 0, 'farm')!;
    expect(b.farm).toBeUndefined();
    expect(employees(w, b)).toHaveLength(0);
    tick(w, 13);
    expect(b.status).toBe('done');
    expect(employees(w, b)).toHaveLength(1);
    const empty = createWorld({ village: false });
    const lonely = placeBuilding(empty, 0, 'farm', { instant: true })!;
    tick(empty, 1);
    expect(employees(empty, lonely)).toHaveLength(0);
  });

  it('building costs wood and stone, and the village can run short', () => {
    const w = createWorld({ village: false });
    placeBuilding(w, 0, 'farm');
    expect(w.stock.wood).toBe(STARTING_STOCK.wood - BUILDINGS.farm.cost.wood!);
    expect(w.stock.stone).toBe(STARTING_STOCK.stone - BUILDINGS.farm.cost.stone!);
    w.stock.stone = 0;
    expect(placeBuilding(w, 1, 'chapel')).toBeNull();
    expect(w.plots[1].buildingId).toBeNull();
  });

  it('the village collects the harvest from the farm store into its stockpile', () => {
    const w = createWorld();
    const farm = w.buildings.find((b) => b.type === 'farm')!;
    farm.stock.grain = 3;
    farm.collectIn = 0.01;
    tick(w, 0.1);
    expect(farm.stock.grain).toBe(2);
    expect(w.stock.grain).toBe(1);
    expect(farm.collectIn).toBeGreaterThan(COLLECT_EVERY - 1);
  });
});
