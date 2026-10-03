// Firewood: logs split at the sawmill (FIREWOOD.perLog from each), so one
// tree warms a household for a long while. Every building with a fire
// (HAS_FIRE in buildings.ts) keeps a woodpile by its wall, which serfs keep
// stocked, and burns it as its fire burns (hearth.ts says how hard: a hearth
// FIREWOOD.hearthPerDay a day at full blaze, a furnace furnacePerDay).
// Every fire burns WINTER_FIRE times as much in winter; households burn theirs
// as a need (NEEDS, households.ts), the same. With none left the fire is out:
// no smoke, no warmth, and a fire trade (Recipe.fire) can't work.

import { FIREWOOD, WINTER_FIRE } from './balance';
import { HAS_FIRE } from './buildings';
import { isWinter, timeOfDay } from './daynight';
import { hearthOf } from './hearth';
import type { World } from './world';

/** dt seconds of every fire burning (houses burn theirs as a household need). */
export function burnFires(world: World, dt: number): void {
  const days = (dt * timeOfDay(world).hoursPerSecond) / 24;
  const winter = isWinter(world);
  for (const b of world.buildings) {
    if (b.type === 'house' || !HAS_FIRE.has(b.type) || b.stock.firewood < 1e-9) continue;
    const h = hearthOf(world, b);
    const burnt = (h.hearth * FIREWOOD.hearthPerDay + h.furnace * FIREWOOD.furnacePerDay) * days * (winter ? WINTER_FIRE : 1);
    b.stock.firewood = Math.max(0, b.stock.firewood - burnt);
  }
}

/** The starting village's woodpiles, full. */
export function stackWoodpiles(world: World): void {
  for (const b of world.buildings) if (HAS_FIRE.has(b.type)) b.stock.firewood = FIREWOOD.kept * (b.size ?? 1);
}
