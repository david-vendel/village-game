import { stockOf } from './resources';
import { plotX } from './streets';
import { describe, expect, it } from 'vitest';
import { BUILDINGS, BUILDING_TYPES } from './buildings';
import {
  closeMenu,
  confirmMenu,
  constructionStage,
  createWorld,
  HOUSE_RESIDENTS,
  moveMenu,
  openMenu,
  placeAt,
  placeBuilding,
  buildingAt,
  RIDER_MAX_SPEED,
  setConstructionEnabled,
  update,
  WORLD_WIDTH,
  type World,
} from './world';

const idle = { left: false, right: false };

function emptyWorld(): World {
  return createWorld({ village: false });
}

function runFor(world: World, seconds: number, input = idle): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) update(world, dt, input);
}

describe('building registry', () => {
  it('every building is whole blocks of three cells wide', () => {
    for (const t of BUILDING_TYPES) expect(BUILDINGS[t].width % 75).toBe(0);
  });
});

describe('placement', () => {
  it('places a building on whole cells where the rider wants it', () => {
    const w = emptyWorld();
    const b = placeBuilding(w, 412.5, 'mill', { free: true });
    expect(b).not.toBeNull();
    expect(buildingAt(w, w.plots[0].x)).toBe(b);
    expect(b!.x % 25).toBe(0); // 6 cells wide: its middle on a cell edge
    expect(b!.status).toBe('constructing');
  });

  it('refuses to place over another building or off the streets', () => {
    const w = emptyWorld();
    placeBuilding(w, 412.5, 'house', { free: true });
    expect(placeBuilding(w, 412.5, 'farm', { free: true })).toBeNull();
    expect(placeBuilding(w, 999999, 'farm', { free: true })).toBeNull();
    expect(w.buildings).toHaveLength(1);
  });

  it('starting village is pre-built and finished', () => {
    const w = createWorld();
    expect(w.buildings.length).toBeGreaterThan(3);
    expect(w.buildings.every((b) => b.status === 'done')).toBe(true);
    // every one of them found room (none on a place kept for a crossroads)
    for (const t of ['house', 'well', 'tavern', 'warehouse', 'farm', 'chapel'] as const) expect(w.buildings.some((b) => b.type === t), t).toBe(true);
    expect(w.events).toHaveLength(0);
  });

  it('plots stay inside the world', () => {
    const w = emptyWorld();
    for (const p of w.plots) expect(p.x + 100).toBeLessThan(WORLD_WIDTH);
  });
});

describe('build menu', () => {
  it('builds at an empty plot, and offers what can be done to a building', () => {
    const w = emptyWorld();
    placeBuilding(w, 2912.5, 'warehouse', { instant: true, free: true })!.stock = stockOf({ wood: 300, stone: 300 });
    w.rider.x = w.plots[8].x - 25; // a cell 3n + 1, where a building starts
    expect(openMenu(w)).toBe(true);
    moveMenu(w, 2);
    const b = confirmMenu(w);
    expect(b?.type).toBe(BUILDING_TYPES[2]);
    expect(w.menu).toBeNull();
    expect(openMenu(w)).toBe(true); // plot now occupied: its building's menu
    expect(w.menu?.kind).toBe('building');
  });

  it('opens on any cell of a block of three, the building starting at its cell 3n + 1', () => {
    const w = emptyWorld();
    w.rider.x = w.plots[4].x + 20; // the block's last cell
    expect(openMenu(w)).toBe(true);
    expect(w.menu?.kind).toBe('build');
    expect(placeAt(w, 'farm', w.rider.x)).toBe(w.plots[4].x - 25 + (BUILDINGS.farm.width - 25) / 2);
  });

  it('selection wraps and is remembered after cancelling', () => {
    const w = emptyWorld();
    w.rider.x = w.plots[4].x - 25; // where a crossroads can go (the last entry)
    openMenu(w);
    moveMenu(w, -1);
    expect(w.menu!.selection).toBe(BUILDING_TYPES.length - 1);
    closeMenu(w);
    openMenu(w);
    expect(w.menu!.selection).toBe(BUILDING_TYPES.length - 1);
  });

  it('rider cannot move while the menu is open', () => {
    const w = emptyWorld();
    w.rider.x = w.plots[0].x - 25;
    openMenu(w);
    const x = w.rider.x;
    runFor(w, 1, { left: false, right: true });
    expect(w.rider.x).toBe(x);
  });
});

describe('construction', () => {
  it('is built by its builders over buildTime of labour, and completes with an event', () => {
    const w = createWorld(); // villagers to hire
    const b = placeBuilding(w, 2162.5, 'well', { free: true })!; // materials already on site
    w.events.length = 0;
    // builders walk over from the street, then two of them share the labour
    const done = () => b.status === 'done';
    for (let t = 0; t < 120 && !done(); t += 1 / 30) update(w, 1 / 30, { left: false, right: false });
    expect(done()).toBe(true);
    expect(b.progress).toBe(1);
    expect(w.events).toContainEqual({ kind: 'completed', buildingId: b.id });
  });

  it('nothing gets built without anyone to build it', () => {
    const w = emptyWorld();
    const b = placeBuilding(w, 412.5, 'well', { free: true })!;
    runFor(w, BUILDINGS.well.buildTime * 2);
    expect(b.progress).toBe(0);
  });

  it('with construction disabled buildings appear finished instantly', () => {
    const w = emptyWorld();
    setConstructionEnabled(w, false);
    const b = placeBuilding(w, 787.5, 'chapel', { free: true })!;
    expect(b.status).toBe('done');
  });

  it('disabling construction finishes buildings in progress', () => {
    const w = emptyWorld();
    const b = placeBuilding(w, 787.5, 'chapel', { free: true })!;
    runFor(w, 1);
    setConstructionEnabled(w, false);
    expect(b.status).toBe('done');
  });

  it('a finished house brings three people out of work, merged into a neighbour or not', () => {
    const w = emptyWorld();
    const seekers = () => w.people.filter((p) => p.seeker).length;
    const a = placeBuilding(w, 1000, 'house', { free: true })!;
    expect(seekers()).toBe(0); // nobody moves in before it is built
    setConstructionEnabled(w, false);
    runFor(w, 1);
    expect(seekers()).toBe(1); // they come out of the door one by one
    runFor(w, 4);
    expect(seekers()).toBe(HOUSE_RESIDENTS);
    placeBuilding(w, a.x + 75, 'house', { free: true });
    expect(w.buildings).toHaveLength(1);
    runFor(w, 5);
    expect(seekers()).toBe(2 * HOUSE_RESIDENTS);
    expect(new Set(w.people.map((p) => p.name)).size).toBe(w.people.length);
  });

  it("a house's people are backup hands: they build when no builder is free and take any lasting job, a woodcutter's too", () => {
    const w = emptyWorld();
    setConstructionEnabled(w, false);
    placeBuilding(w, 1000, 'house', { free: true });
    runFor(w, 5);
    setConstructionEnabled(w, true);
    const site = placeBuilding(w, 1750, 'chapel', { free: true })!;
    update(w, 0.1, idle);
    const helping = w.people.filter((p) => p.job?.buildingId === site.id);
    expect(helping.length).toBeGreaterThan(0);
    expect(helping.every((p) => p.seeker && p.job!.role === 'builder')).toBe(true); // still looking: building is no profession for them
    setConstructionEnabled(w, false);
    const hut = placeBuilding(w, 2500, 'woodcutter', { free: true })!;
    update(w, 0.1, idle);
    const cutter = w.people.find((p) => p.job?.buildingId === hut.id)!;
    expect(cutter.profession).toBe('woodcutter');
    expect(cutter.seeker).toBeUndefined();
  });

  it('stages advance in order', () => {
    const order = ['staking', 'foundation', 'frame', 'walls', 'roof', 'done'];
    let last = 0;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const { stage, t } = constructionStage(p);
      const idx = order.indexOf(stage);
      expect(idx).toBeGreaterThanOrEqual(last);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
      last = idx;
    }
    expect(constructionStage(1).stage).toBe('done');
  });
});

describe('rider', () => {
  it('accelerates to max speed, faces travel direction, stops when released', () => {
    const w = emptyWorld();
    runFor(w, 2, { left: true, right: false });
    expect(w.rider.vx).toBe(-RIDER_MAX_SPEED);
    expect(w.rider.facing).toBe(-1);
    runFor(w, 1);
    expect(w.rider.vx).toBe(0);
  });

  it('is clamped to the world', () => {
    const w = emptyWorld();
    runFor(w, 60, { left: true, right: false });
    expect(w.rider.x).toBeGreaterThanOrEqual(0);
  });
});

describe('streets', () => {
  it('builders reach a site two streets away, turning at each crossroads only once', () => {
    const w = createWorld();
    w.buildings.find((b) => b.type === 'warehouse')!.stock.wood = 300;
    placeBuilding(w, 2087.5, 'intersection', { instant: true }); // cell 83, on the road grid
    placeBuilding(w, plotX(1, 47), 'intersection', { instant: true }); // 27 cells up the new street
    const h = placeBuilding(w, plotX(2, 42) - 25, 'house')!;
    runFor(w, 90, { left: false, right: false });
    expect(h.status).toBe('done');
  });
});
