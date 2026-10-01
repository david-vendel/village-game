import { stockOf } from './resources';
import { describe, expect, it } from 'vitest';
import { BUILDINGS, BUILDING_TYPES } from './buildings';
import {
  closeMenu,
  confirmMenu,
  constructionStage,
  createWorld,
  moveMenu,
  openMenu,
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
    w.rider.x = w.plots[8].x + 10;
    expect(openMenu(w)).toBe(true);
    moveMenu(w, 2);
    const b = confirmMenu(w);
    expect(b?.type).toBe(BUILDING_TYPES[2]);
    expect(w.menu).toBeNull();
    expect(openMenu(w)).toBe(true); // plot now occupied: its building's menu
    expect(w.menu?.kind).toBe('building');
  });

  it('opens anywhere along the street: there are no plots to ride to', () => {
    const w = emptyWorld();
    w.rider.x = (w.plots[0].x + w.plots[4].x) / 2;
    expect(openMenu(w)).toBe(true);
    expect(w.menu?.kind).toBe('build');
  });

  it('selection wraps and is remembered after cancelling', () => {
    const w = emptyWorld();
    w.rider.x = w.plots[0].x;
    openMenu(w);
    moveMenu(w, -1);
    expect(w.menu!.selection).toBe(BUILDING_TYPES.length - 1);
    closeMenu(w);
    openMenu(w);
    expect(w.menu!.selection).toBe(BUILDING_TYPES.length - 1);
  });

  it('rider cannot move while the menu is open', () => {
    const w = emptyWorld();
    w.rider.x = w.plots[0].x;
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
    const b = placeBuilding(w, 662.5, 'chapel', { free: true })!;
    expect(b.status).toBe('done');
  });

  it('disabling construction finishes buildings in progress', () => {
    const w = emptyWorld();
    const b = placeBuilding(w, 662.5, 'chapel', { free: true })!;
    runFor(w, 1);
    setConstructionEnabled(w, false);
    expect(b.status).toBe('done');
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
