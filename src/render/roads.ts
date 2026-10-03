// How much of a street's road is there to see: its stretch (streets.ts
// streetRange), and the road pieces being laid at its ends growing out of it
// as the builders work, a block (three cells) each when done.

import { CELL_W } from '../game/layout';
import { streetOf, streetRange } from '../game/streets';
import type { World } from '../game/world';

export function roadShown(world: World, street: number): { min: number; max: number } {
  const { min, max } = streetRange(world, street);
  let [lo, hi] = [min, max];
  for (const b of world.buildings) {
    if (b.type !== 'road' || b.status === 'done' || streetOf(b.x) !== street) continue;
    const laid = 3 * CELL_W * b.progress;
    if (Math.abs(b.x - max) < Math.abs(b.x - min)) hi = Math.max(hi, max + laid);
    else lo = Math.min(lo, min - laid);
  }
  return { min: lo, max: hi };
}
