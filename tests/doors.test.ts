// Every building says where its door is (BuildingDef.door, or null for one
// nobody enters), and everything that shows or uses a door keeps to it: the
// workplaces people walk in and out of, the 3D models' `door` point, and the
// sprites the procedural art exports (the asset validator checks shipped ones).

import { describe, expect, it } from 'vitest';
import { BUILDING_TYPES, BUILDINGS, doorOf } from '../src/game/buildings';
import { HOME, STONECUTTER_DOOR, WOODCUTTER_DOOR } from '../src/game/layout';
import { points3d } from '../src/render/world3d';

const U = 20;

describe('doors', () => {
  it('every building type says where its door is, or that it has none', () => {
    for (const t of BUILDING_TYPES) expect(BUILDINGS[t], t).toHaveProperty('door');
  });

  it('the workplaces walk people through the door the building has', () => {
    for (const t of BUILDING_TYPES) {
      const m = BUILDINGS[t].makes;
      if (m) expect(m.door, t).toEqual(BUILDINGS[t].door);
    }
    expect(BUILDINGS.farm.door).toEqual(HOME);
    expect(BUILDINGS.woodcutter.door).toEqual(WOODCUTTER_DOOR);
    expect(BUILDINGS.stonecutter.door).toEqual(STONECUTTER_DOOR);
  });

  it('a merged house has its door in the middle of its front; a small one, its own', () => {
    expect(doorOf('house', 1)).toEqual(BUILDINGS.house.door);
    for (const size of [2, 3] as const) expect(Math.abs(doorOf('house', size)!.dx)).toBeLessThan(25);
  });

  it('3D models mark the door where the game has it', () => {
    for (const t of BUILDING_TYPES) {
      const pts = points3d(t);
      if (!pts) continue;
      const door = BUILDINGS[t].door;
      if (!door) continue;
      expect(pts.door, `${t}: a 3D model needs a door point`).toBeDefined();
      expect(pts.door[0] * U, t).toBeCloseTo(door.dx, 6);
    }
  });
});
