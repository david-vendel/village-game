// Spoilage: fresh goods go off (SHELF_LIFE in balance.ts, days). A store
// holding n of something that keeps L days loses about n / L of it a day, a
// whole item at a time, thrown away where it lies; so does a pile on the
// ground. Kept goods (flour, cheese one day, cloth) are not in SHELF_LIFE.

import { SHELF_LIFE } from './balance';
import { timeOfDay } from './daynight';
import { takeFromPile } from './piles';
import type { Resource } from './resources';
import type { World } from './world';

const fresh = Object.entries(SHELF_LIFE) as Array<[Resource, number]>;

/** Let dt seconds of spoiling happen everywhere. */
export function updateSpoilage(world: World, dt: number): void {
  const days = (dt * timeOfDay(world).hoursPerSecond) / 24;
  for (const b of world.buildings) {
    for (const [r, life] of fresh) {
      if (b.stock[r] < 1e-9) {
        if (b.spoiling?.[r]) delete b.spoiling[r];
        continue;
      }
      const s = (b.spoiling ??= {});
      s[r] = (s[r] ?? 0) + (b.stock[r] * days) / life;
      while (s[r]! >= 1 && b.stock[r] >= 1) {
        b.stock[r] -= 1;
        s[r]! -= 1;
      }
    }
  }
  for (const p of [...world.piles]) {
    const life = SHELF_LIFE[p.resource];
    if (!life) continue;
    p.spoiling = (p.spoiling ?? 0) + (p.amount * days) / life;
    if (p.spoiling >= 1) {
      p.spoiling -= 1;
      takeFromPile(world, p, 1);
    }
  }
}
