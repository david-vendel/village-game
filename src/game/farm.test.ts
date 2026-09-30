import { describe, expect, it } from 'vitest';
import {
  chooseJob,
  createFarm,
  GROW_TIME,
  STORAGE_MAX,
  updateFarm,
  type FarmState,
} from './farm';
import { HOME, STORE } from './layout';
import { createWorld, placeBuilding, update } from './world';

function run(farm: FarmState, seconds: number): void {
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) updateFarm(farm, dt);
}

/** Run until `pred` holds; fails the test if it takes too long. */
function runUntil(farm: FarmState, pred: () => boolean, max = 200): void {
  const dt = 1 / 30;
  for (let t = 0; t < max; t += dt) {
    if (pred()) return;
    updateFarm(farm, dt);
  }
  throw new Error('condition never reached');
}

describe('farm', () => {
  it('a new farm has fallow plots in front of and behind the road and an empty store', () => {
    const f = createFarm();
    expect(f.plots.some((p) => p.zone === 'back')).toBe(true);
    expect(f.plots.some((p) => p.zone === 'front')).toBe(true);
    expect(f.plots.every((p) => p.state === 'fallow')).toBe(true);
    expect(f.storage).toBe(0);
  });

  it('the farmer sows one plot, then returns home before sowing the next', () => {
    const f = createFarm();
    runUntil(f, () => f.plots.some((p) => p.state === 'growing'));
    expect(f.plots.filter((p) => p.state === 'growing')).toHaveLength(1);
    const t = f.farmer.task;
    expect(t.kind === 'walk' && t.then === 'home').toBe(true);
    runUntil(f, () => f.farmer.task.kind === 'idle');
    expect(f.farmer.dx).toBeCloseTo(HOME.dx);
    expect(f.farmer.y).toBeCloseTo(HOME.y);
  });

  it('each plot ages on its own clock', () => {
    const f = createFarm();
    runUntil(f, () => f.plots.filter((p) => p.state === 'growing').length === 2);
    const [a, b] = f.plots.filter((p) => p.state === 'growing');
    expect(a.age).toBeGreaterThan(b.age + 1);
  });

  it('crops ripen after GROW_TIME and are harvested into the store', () => {
    const f = createFarm();
    runUntil(f, () => f.plots.some((p) => p.state === 'ripe'), GROW_TIME + 20);
    runUntil(f, () => f.storage === 1);
    expect(f.farmer.carrying).toBe(false);
    expect(f.farmer.dx).toBeCloseTo(STORE.dx + 16);
    // the harvested plot is fallow again and will be re-sown
    expect(f.plots.some((p) => p.state === 'fallow')).toBe(true);
  });

  it('the store never exceeds its maximum and a full store stops harvesting', () => {
    const f = createFarm();
    f.storage = STORAGE_MAX;
    for (const p of f.plots) {
      p.state = 'ripe';
      p.age = GROW_TIME;
    }
    expect(chooseJob(f)).toBeNull();
    run(f, 60);
    expect(f.storage).toBe(STORAGE_MAX);
    expect(f.plots.every((p) => p.state === 'ripe')).toBe(true);
  });

  it('prefers harvesting over sowing when the store has room', () => {
    const f = createFarm();
    f.plots[3].state = 'ripe';
    expect(chooseJob(f)).toEqual({ plot: 3, action: 'harvest' });
  });

  it('long runs keep the store within 0..5', () => {
    const f = createFarm({ established: true });
    for (let i = 0; i < 20; i++) {
      run(f, 30);
      expect(f.storage).toBeGreaterThanOrEqual(0);
      expect(f.storage).toBeLessThanOrEqual(STORAGE_MAX);
    }
  });
});

describe('farms in the world', () => {
  it('a farm only starts farming once construction is finished', () => {
    const w = createWorld({ village: false });
    const b = placeBuilding(w, 0, 'farm')!;
    expect(b.farm).toBeUndefined();
    for (let t = 0; t < 13; t += 1 / 30) update(w, 1 / 30, { left: false, right: false });
    expect(b.status).toBe('done');
    expect(b.farm).toBeDefined();
  });

  it('the starting village farm is already established', () => {
    const w = createWorld();
    const farm = w.buildings.find((b) => b.type === 'farm')!;
    expect(farm.farm!.storage).toBeGreaterThan(0);
    expect(farm.farm!.plots.some((p) => p.state !== 'fallow')).toBe(true);
  });
});
