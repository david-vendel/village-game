// How much of a street's road is there to see: its stretch (streets.ts
// streetRange, which takes in each parcel of a road piece as soon as it is
// laid), and the parcel being laid at its end, growing out of it as the
// builder works it (roadwork.ts).

import { PLOT_SPACING } from '../game/layout';
import { builders } from '../game/site';
import { streetOf, streetRange } from '../game/streets';
import type { World } from '../game/world';

export function roadShown(world: World, street: number): { min: number; max: number } {
  const { min, max } = streetRange(world, street);
  let [lo, hi] = [min, max];
  for (const b of world.buildings) {
    if (b.type !== 'road' || b.status !== 'constructing' || streetOf(b.x) !== street) continue;
    // how far through laying its parcel the builder is
    let t = 0;
    for (const p of builders(world, b)) {
      const task = p.job!.worker.task;
      if (task.kind === 'job' && task.job.action === 'build') t = Math.max(t, Math.min(1, task.t / task.duration));
    }
    if ((b.road?.step ?? 1) > 0) hi = max + t * PLOT_SPACING;
    else lo = min - t * PLOT_SPACING;
  }
  return { min: lo, max: hi };
}
