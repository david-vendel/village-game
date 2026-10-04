// Firewood: logs split at the sawmill (FIREWOOD.perLog from each), so one
// tree warms a household for a long while. Every building with a fire
// (HAS_FIRE in buildings.ts) keeps a woodpile by its wall, which serfs keep
// stocked, and burns it as its fire burns (hearth.ts says how hard: a hearth
// FIREWOOD.hearthPerDay a day at full blaze, a furnace furnacePerDay).
// Every fire burns WINTER_FIRE times as much in winter; households burn theirs
// as a need (NEEDS, households.ts), the same. A fire takes a whole log off the
// woodpile at a time and burns it down (Building.burning), so the woodpile is
// always whole logs. With none left on the fire or the pile, the fire is out:
// no smoke, no warmth, and a fire trade (Recipe.fire) can't work.

import { FIREWOOD, WINTER_FIRE } from './balance';
import { HAS_FIRE } from './buildings';
import { isWinter, timeOfDay } from './daynight';
import { hearthOf } from './hearth';
import type { Building, World } from './world';

/** Whether b's fire is burning: a log on it, or one on the woodpile to put on. */
export const fireLit = (b: Building) => (b.burning ?? 0) > 1e-9 || b.stock.firewood >= 1;

/** dt seconds of every fire burning (houses burn theirs as a household need). */
export function burnFires(world: World, dt: number): void {
  const days = (dt * timeOfDay(world).hoursPerSecond) / 24;
  const winter = isWinter(world);
  for (const b of world.buildings) {
    if (b.type === 'house' || !HAS_FIRE.has(b.type) || !fireLit(b)) continue;
    const h = hearthOf(world, b);
    let burnt = (h.hearth * FIREWOOD.hearthPerDay + h.furnace * FIREWOOD.furnacePerDay) * days * (winter ? WINTER_FIRE : 1);
    // the log on the fire burns down; burnt through, the next goes on from the woodpile
    while (burnt > 1e-12) {
      if ((b.burning ?? 0) <= 1e-12) {
        if (b.stock.firewood < 1) break;
        b.stock.firewood -= 1;
        b.burning = 1;
      }
      const used = Math.min(burnt, b.burning!);
      b.burning! -= used;
      burnt -= used;
    }
    if ((b.burning ?? 0) <= 1e-12) delete b.burning;
  }
}

/** The starting village's woodpiles, full. */
export function stackWoodpiles(world: World): void {
  for (const b of world.buildings) if (HAS_FIRE.has(b.type)) b.stock.firewood = FIREWOOD.kept * (b.size ?? 1);
}
