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
  plotAt,
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
  it('every building fits inside a plot', () => {
    for (const t of BUILDING_TYPES) expect(BUILDINGS[t].width).toBeLessThanOrEqual(200);
  });
});

describe('placement', () => {
  it('places a building on an empty plot and marks the plot taken', () => {
    const w = emptyWorld();
    const b = placeBuilding(w, 0, 'mill');
    expect(b).not.toBeNull();
    expect(w.plots[0].buildingId).toBe(b!.id);
    expect(b!.status).toBe('constructing');
  });

  it('refuses to place on an occupied or missing plot', () => {
    const w = emptyWorld();
    placeBuilding(w, 0, 'house');
    expect(placeBuilding(w, 0, 'farm')).toBeNull();
    expect(placeBuilding(w, 9999, 'farm')).toBeNull();
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
  it('opens only at an empty plot and places the selected type', () => {
    const w = emptyWorld();
    w.rider.x = w.plots[2].x + 10;
    expect(openMenu(w)).toBe(true);
    moveMenu(w, 2);
    const b = confirmMenu(w);
    expect(b?.type).toBe(BUILDING_TYPES[2]);
    expect(w.menu).toBeNull();
    expect(openMenu(w)).toBe(false); // plot now occupied
  });

  it('does not open between plots', () => {
    const w = emptyWorld();
    w.rider.x = (w.plots[0].x + w.plots[1].x) / 2;
    expect(plotAt(w, w.rider.x)).toBeNull();
    expect(openMenu(w)).toBe(false);
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
  it('progresses over buildTime and completes with an event', () => {
    const w = emptyWorld();
    const b = placeBuilding(w, 0, 'well')!;
    w.events.length = 0;
    runFor(w, BUILDINGS.well.buildTime / 2);
    expect(b.progress).toBeGreaterThan(0.45);
    expect(b.status).toBe('constructing');
    runFor(w, BUILDINGS.well.buildTime / 2 + 0.1);
    expect(b.status).toBe('done');
    expect(b.progress).toBe(1);
    expect(w.events).toContainEqual({ kind: 'completed', buildingId: b.id });
  });

  it('with construction disabled buildings appear finished instantly', () => {
    const w = emptyWorld();
    setConstructionEnabled(w, false);
    const b = placeBuilding(w, 1, 'chapel')!;
    expect(b.status).toBe('done');
  });

  it('disabling construction finishes buildings in progress', () => {
    const w = emptyWorld();
    const b = placeBuilding(w, 1, 'chapel')!;
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
