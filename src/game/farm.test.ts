import { describe, expect, it } from 'vitest';
import { BUILDINGS } from './buildings';
import type { TimeOfDay } from './daynight';
import { villageStock, WAREHOUSE_START } from './economy';
import { createFarm, DEFAULT_WORK, farmWorkplace, GROW_TIME, updateCrops } from './farm';
import { HOME, SHEAF_SLOTS } from './layout';
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

  it('each field is one cell, and working it takes the time per cell', () => {
    const r = rig();
    expect(r.farm.plots.every((p) => p.width === 25)).toBe(true);
    expect(r.place.begin({ action: 'sow', target: 0 })).toBeCloseTo(DEFAULT_WORK.sowPerCell);
  });

  it('crops ripen after GROW_TIME and are harvested into the store', () => {
    const r = rig();
    r.until(() => r.farm.plots.some((p) => p.state === 'ripe'), GROW_TIME + 60);
    r.until(() => r.stock.grain === 1);
    expect(r.w.carrying).toBeNull();
    // put down exactly where the first sheaf stands in the store
    expect(r.w.dx).toBeCloseTo(SHEAF_SLOTS[0].dx);
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

  it('a farm hires a farmer once finished: a free farmer, else someone looking for work (builders never farm)', () => {
    const w = createWorld();
    const b = placeBuilding(w, 412.5, 'farm')!;
    expect(b.farm).toBeUndefined();
    tick(w, 1);
    expect(employees(w, b).every((p) => p.job!.role === 'builder')).toBe(true);
    const done = placeBuilding(w, 787.5, 'farm', { instant: true, free: true })!;
    tick(w, 1);
    // the village's one farmer works the starting farm: a seeker takes the job, for life
    const [farmer] = employees(w, done);
    expect(farmer.job!.role).toBe('farmer');
    expect(farmer.profession).toBe('farmer');
    expect(farmer.seeker).toBeUndefined();
    const empty = createWorld({ village: false });
    const lonely = placeBuilding(empty, 412.5, 'farm', { instant: true, free: true })!;
    tick(empty, 1);
    expect(employees(empty, lonely)).toHaveLength(0);
  });

  it('serfs carry the sheaves from the farm store to the warehouse, then go back to strolling', () => {
    const w = createWorld();
    const farm = w.buildings.find((b) => b.type === 'farm')!;
    farm.stock.grain = 3;
    let pickedAt: number | null = null;
    for (let t = 0; t < 120 && villageStock(w).grain < 3; t += 1 / 30) {
      const before = farm.stock.grain;
      update(w, 1 / 30, { left: false, right: false });
      const serf = w.people.find((p) => p.job?.role === 'serf' && p.job.worker.carrying);
      if (farm.stock.grain < before && serf && pickedAt === null) pickedAt = w.buildings.find((b) => b.id === serf.job!.buildingId)!.x + serf.job!.worker.dx - farm.x;
    }
    // the top sheaf, taken from where it stood
    expect(pickedAt).toBeCloseTo(SHEAF_SLOTS[2].dx);
    expect(farm.stock.grain).toBe(0);
    expect(villageStock(w).grain).toBe(3);
    tick(w, 2);
    expect(w.people.filter((p) => p.job?.role === 'serf')).toHaveLength(0);
  });

  it('a finished mill takes a serf as its miller before any more errands', () => {
    const w = createWorld();
    w.buildings.find((b) => b.type === 'warehouse')!.stock.grain = 40;
    const mill = placeBuilding(w, 2587.5, 'mill', { instant: true, free: true })!;
    for (let t = 0; t < 200 && villageStock(w).flour === 0; t += 1 / 30) update(w, 1 / 30, { left: false, right: false });
    const [miller] = employees(w, mill);
    expect(miller.profession).toBe('miller');
    expect(villageStock(w).flour).toBeGreaterThan(0);
  });
});

describe('construction by builders', () => {
  const tick = (w: ReturnType<typeof createWorld>, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 30) update(w, 1 / 30, { left: false, right: false });
  };

  it('the village starts with a stocked warehouse and five idle builders', () => {
    const w = createWorld();
    expect(w.buildings.some((b) => b.type === 'warehouse' && b.status === 'done')).toBe(true);
    expect(villageStock(w)).toMatchObject({ wood: WAREHOUSE_START.wood, stone: WAREHOUSE_START.stone });
    expect(w.people.filter((p) => !p.job && p.profession === 'builder')).toHaveLength(5);
  });

  it('builders carry the materials from the warehouse and build with them', () => {
    const w = createWorld();
    const everyone = w.people.map((p) => p.id).sort();
    const well = placeBuilding(w, 2162.5, 'well')!;
    const cost = BUILDINGS.well.cost;
    // nothing is taken up front: builders fetch it
    expect(villageStock(w).stone).toBe(WAREHOUSE_START.stone);
    tick(w, 1);
    expect(employees(w, well).every((p) => p.job!.role === 'builder')).toBe(true);
    expect(employees(w, well).length).toBeGreaterThan(0);
    let carried = false;
    let aheadOfMaterials = false;
    for (let t = 0; t < 400 && well.status !== 'done'; t += 1 / 30) {
      update(w, 1 / 30, { left: false, right: false });
      carried ||= employees(w, well).some((p) => p.job!.worker.carrying?.resource === 'stone');
      const delivered = well.site ? well.site.delivered.wood + well.site.delivered.stone : 0;
      if (well.site && well.progress > delivered / (cost.wood! + cost.stone!) + 1e-9) aheadOfMaterials = true;
    }
    expect(well.status).toBe('done');
    expect(carried).toBe(true);
    expect(aheadOfMaterials).toBe(false);
    expect(villageStock(w)).toMatchObject({ wood: WAREHOUSE_START.wood - cost.wood!, stone: WAREHOUSE_START.stone - cost.stone! });
    // the builders go back to strolling; nobody appeared or vanished along the way
    expect(employees(w, well)).toHaveLength(0);
    expect(w.people.map((p) => p.id).sort()).toEqual(everyone);
  });

  it('a new building must be covered by what the warehouses hold beyond other sites', () => {
    const w = createWorld();
    // exactly what a farm costs, so the farm takes all the wood
    w.buildings.find((b) => b.type === 'warehouse')!.stock = stockOf(BUILDINGS.farm.cost);
    expect(placeBuilding(w, 2162.5, 'farm')).not.toBeNull();
    expect(placeBuilding(w, 2662.5, 'house')).toBeNull(); // the wood is promised to the farm
    expect(w.plots[36].buildingId).toBeNull();
  });

  it('empty-handed people walk faster than loaded ones', () => {
    const r = rig();
    r.w.task = { kind: 'walk', toDx: r.w.dx + 500, toY: r.w.y, then: 'home', job: null };
    const x0 = r.w.dx;
    r.run(0.5);
    const empty = Math.abs(r.w.dx - x0);
    r.w.carrying = { resource: 'grain', amount: 1 };
    r.w.task = { kind: 'walk', toDx: r.w.dx + 500, toY: r.w.y, then: 'deliver', job: null };
    const x1 = r.w.dx;
    r.run(0.5);
    expect(Math.abs(r.w.dx - x1)).toBeLessThan(empty);
  });
});
