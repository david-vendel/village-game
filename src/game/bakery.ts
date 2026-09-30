// The bakery as a workplace (worker.ts) for its baker, who bakes the flour in
// the bakery's store into bread at the door: each sack of flour makes twice
// as many loaves (LOAVES_PER_FLOUR). The store (the building's stock) keeps
// each thing in its own place: sacks of flour waiting left of the door,
// baskets of loaves right of it (BAKERY_SLOTS). Serfs bring the flour from a
// warehouse and take the bread away (transport.ts), on to the tavern
// (tavern.ts). The rest of the baker's day is the generic worker routine.

import { BUILDINGS } from './buildings';
import { BAKERY_DOOR } from './layout';
import { SACK } from './mill';
import { room, type Stock } from './resources';
import type { Workplace } from './worker';

/** Loaves in a basket; one basket per place in a store. */
export const BASKET = 10;
/** Loaves baked from each unit of flour. */
export const LOAVES_PER_FLOUR = 2;
/** Seconds to bake a sack of flour into bread. */
export const BAKE_TIME = 8;

export function bakeryWorkplace(stock: Stock): Workplace {
  const capacity = BUILDINGS.bakery.storage;
  const canBake = () => stock.flour > 0 && room(stock, capacity, 'bread') >= LOAVES_PER_FLOUR;
  return {
    door: BAKERY_DOOR,
    nextJob() {
      return canBake() ? { job: { action: 'bake', target: 0 }, ...BAKERY_DOOR } : null;
    },
    begin() {
      return canBake() ? BAKE_TIME : null;
    },
    finish() {
      // a sack of flour in the store becomes loaves in the store
      const n = Math.min(SACK, stock.flour, Math.floor(room(stock, capacity, 'bread') / LOAVES_PER_FLOUR));
      stock.flour -= n;
      stock.bread += n * LOAVES_PER_FLOUR;
      return null;
    },
    dropSpot() {
      return BAKERY_DOOR; // the baker never carries anything
    },
    deliver() {},
  };
}
