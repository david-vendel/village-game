// The tavern's guests eat the bread serfs bring to it (BuildingDef.needs):
// a loaf every LOAF_HOURS game hours, day and night, while there is any.
// Worked out from the day clock alone, so there is nothing extra to save.

import { GAME_HOUR } from './daynight';
import type { World } from './world';

/** Game hours between loaves eaten at each tavern. */
export const LOAF_HOURS = 1;

/** Guests eat the loaves due since the day clock stood at `before`. */
export function eatAtTaverns(world: World, before: number): void {
  const meals = (clock: number) => Math.floor(clock / GAME_HOUR / LOAF_HOURS);
  const n = meals(world.dayClock) - meals(before);
  if (n <= 0) return;
  for (const b of world.buildings) {
    if (b.type === 'tavern' && b.status === 'done') b.stock.bread = Math.max(0, b.stock.bread - n);
  }
}
