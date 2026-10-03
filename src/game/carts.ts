// Horses at work. A stable keeps cart horses: each horse there with a harness
// is a cart, and a serf with a cart carries CART_LOAD items a trip instead of
// one (transport.ts). Horses eat hay, HORSE_HAY a day each; a stable out of
// hay lends no carts. A farm with a horse of its own ploughs: its sowing and
// harvesting go PLOUGH_SPEED times as fast (farm.ts).

import { HORSE_HAY } from './balance';
import { timeOfDay } from './daynight';
import type { World } from './world';

/** Items a serf with a cart carries a trip. */
export const CART_LOAD = 4;
/** How much faster a farm with a plough horse works. */
export const PLOUGH_SPEED = 1.6;

/** Carts the village has: stabled horses with harness, fed. */
export function carts(world: World): number {
  let n = 0;
  for (const b of world.buildings) {
    if (b.type !== 'stable' || b.status !== 'done' || b.stock.hay < 1e-9) continue;
    n += Math.floor(Math.min(b.stock.horse, b.stock.harness) + 1e-9);
  }
  return n;
}

/** Stabled horses eat their hay (a little at a time, so a stable's last bale lasts). */
export function feedStables(world: World, dt: number): void {
  const days = (dt * timeOfDay(world).hoursPerSecond) / 24;
  for (const b of world.buildings) {
    if (b.type !== 'stable' || b.status !== 'done') continue;
    b.stock.hay = Math.max(0, b.stock.hay - Math.floor(b.stock.horse + 1e-9) * HORSE_HAY * days);
  }
}
