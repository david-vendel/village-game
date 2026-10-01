import { describe, expect, it } from 'vitest';
import { loadWorld, SAVE_VERSION, saveWorld } from './save';
import { createWorld, placeBuilding, update, type World } from './world';

const idle = { left: false, right: false };

function run(world: World, seconds: number, input = idle): void {
  for (let t = 0; t < seconds; t += 1 / 30) update(world, 1 / 30, input);
}

/** Save, pass through JSON (as storage would), load. */
function roundTrip(world: World): World {
  const r = loadWorld(JSON.parse(JSON.stringify(saveWorld(world))));
  if (!r.ok) throw new Error(r.error);
  return r.world;
}

function busyWorld(): World {
  const w = createWorld();
  run(w, 20, { left: false, right: true });
  placeBuilding(w, 3412.5, 'farm', { free: true }); // under construction
  placeBuilding(w, 2662.5, 'mill', { instant: true, free: true });
  run(w, 5);
  w.events.length = 0;
  return w;
}

describe('save games', () => {
  it('a loaded world equals the saved one', () => {
    const w = busyWorld();
    expect(roundTrip(w)).toEqual(w);
  });

  it('a loaded world plays on exactly like the original', () => {
    const a = busyWorld();
    const b = roundTrip(a);
    run(a, 40, { left: true, right: false });
    run(b, 40, { left: true, right: false });
    expect(b).toEqual(a);
  });

  it('the snapshot is detached from the live world', () => {
    const w = busyWorld();
    const s = saveWorld(w);
    run(w, 5);
    expect(s.world.time).not.toBe(w.time);
    expect(s.world.buildings[0]).not.toBe(w.buildings[0]);
  });

  it('keeps crops, farmer and store of a farm', () => {
    const w = createWorld();
    run(w, 10);
    const farm = w.buildings.find((b) => b.farm)!;
    const back = roundTrip(w).buildings.find((b) => b.id === farm.id)!;
    expect(back.farm).toEqual(farm.farm);
  });

  it('does not save the open build menu or tuning knobs', () => {
    const w = createWorld();
    w.menu = { kind: 'build', x: 1000, selection: 2, fits: [] };
    w.params.riderMaxSpeed = 999;
    const back = roundTrip(w);
    expect(back.menu).toBeNull();
    expect(back.params.riderMaxSpeed).not.toBe(999);
  });

  it('refuses corrupt data with a reason instead of throwing', () => {
    const good = saveWorld(createWorld());
    const bad: unknown[] = [
      null,
      'hello',
      {},
      { version: SAVE_VERSION },
      { ...good, world: { ...good.world, time: 'late' } },
      { ...good, world: { ...good.world, buildings: [{ ...good.world.buildings[0], type: 'castle' }] } },
      { ...good, world: { ...good.world, buildings: [{ ...good.world.buildings[0], x: 999999 }] } },
      { ...good, world: { ...good.world, buildings: [good.world.buildings[0], { ...good.world.buildings[0], id: 500 }] } },
    ];
    for (const data of bad) {
      const r = loadWorld(data);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBeTruthy();
    }
  });

  it('refuses a save from a newer version of the game', () => {
    const r = loadWorld({ ...saveWorld(createWorld()), version: SAVE_VERSION + 1 });
    expect(r.ok).toBe(false);
  });

  it('keeps ids unique even if the saved counter is behind', () => {
    const s = saveWorld(createWorld());
    s.world.nextId = 1;
    const r = loadWorld(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = placeBuilding(r.world, 412.5, 'well')!;
    expect(r.world.buildings.filter((x) => x.id === b.id)).toHaveLength(1);
  });
});
