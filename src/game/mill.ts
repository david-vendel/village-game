// The mill as a workplace (worker.ts) for its miller, who grinds the grain in
// the mill's store into flour at the door. The store (the building's stock)
// keeps each sack in its own place: grain waiting left of the door, flour
// right of it (MILL_SLOTS). Serfs bring the grain from a warehouse and take
// the flour away (transport.ts). The rest of the miller's day is the generic
// worker routine.

import { BUILDINGS } from './buildings';
import { MILL_DOOR } from './layout';
import { room, type Stock } from './resources';
import type { Workplace } from './worker';

/** What a sack holds (grain or flour); one sack per place in the store. */
export const SACK = 10;
/** Seconds to grind a sack of grain into flour. */
export const GRIND_TIME = 6;

export function millWorkplace(stock: Stock): Workplace {
  const capacity = BUILDINGS.mill.storage;
  const canGrind = () => stock.grain > 0 && room(stock, capacity, 'flour') > 0;
  return {
    door: MILL_DOOR,
    nextJob() {
      return canGrind() ? { job: { action: 'grind', target: 0 }, ...MILL_DOOR } : null;
    },
    begin() {
      return canGrind() ? GRIND_TIME : null;
    },
    finish() {
      // a sack of grain in the store becomes a sack of flour in the store
      const n = Math.min(SACK, stock.grain, room(stock, capacity, 'flour'));
      stock.grain -= n;
      stock.flour += n;
      return null;
    },
    dropSpot() {
      return MILL_DOOR; // the miller never carries anything
    },
    deliver() {},
  };
}
