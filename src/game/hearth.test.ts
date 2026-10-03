// What burns inside a building, and when (hearth.ts): smoke comes from a
// chimney only while a fire burns there.

import { describe, expect, it } from 'vitest';
import { DAY_LENGTH } from './daynight';
import { hearthOf } from './hearth';
import { type Building, createWorld, placeBuilding, type World } from './world';

/** Set the clock to a game hour (phase 0.28 at dayClock 0, daynight.ts). */
function at(world: World, hour: number): World {
  world.dayClock = ((((hour / 24 - 0.28) % 1) + 1) % 1) * DAY_LENGTH;
  return world;
}

function finished(world: World, type: Building['type']): Building {
  const b = placeBuilding(world, 412.5, type, { free: true })!;
  b.status = 'done';
  b.progress = 1;
  return b;
}

describe('hearths', () => {
  it("a house cooks at noon, sits by the fire with the lamps lit after dark, and sleeps with the fire out", () => {
    const w = createWorld({ village: false });
    const h = finished(w, 'house');
    expect(hearthOf(at(w, 12), h).hearth).toBe(1);
    expect(hearthOf(at(w, 12), h).light).toBe(0);
    const evening = hearthOf(at(w, 20.5), h);
    expect(evening.hearth).toBe(1);
    expect(evening.light).toBe(1);
    expect(evening.shutters).toBe(1);
    const night = hearthOf(at(w, 1), h);
    expect(night).toMatchObject({ hearth: 0, light: 0, shutters: 0 });
    expect(night.asleep).toBeGreaterThan(0);
  });

  it('a building nobody lives or works in stays cold and shut', () => {
    const w = createWorld({ village: false });
    const mill = finished(w, 'mill');
    expect(hearthOf(at(w, 12), mill)).toMatchObject({ hearth: 0, furnace: 0, light: 0, shutters: 0 });
  });

  it('the forge burns in working hours, the watch keeps its brazier at night', () => {
    const w = createWorld({ village: false });
    const smithy = finished(w, 'blacksmith');
    expect(hearthOf(at(w, 11), smithy).furnace).toBe(1);
    expect(hearthOf(at(w, 2), smithy).furnace).toBe(0);
    const w2 = createWorld({ village: false });
    const tower = finished(w2, 'watchtower');
    expect(hearthOf(at(w2, 2), tower).furnace).toBe(1);
    expect(hearthOf(at(w2, 12), tower).furnace).toBe(0);
  });

  it('nothing burns in a building still going up', () => {
    const w = createWorld({ village: false });
    const b = placeBuilding(w, 412.5, 'house', { free: true })!;
    expect(hearthOf(at(w, 12), b).hearth).toBe(0);
  });
});
