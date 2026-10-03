// Game balance: what every building costs to build or upgrade, and what a new
// village starts with. All in one place so balancing is done here, nowhere
// else (buildings.ts reads the costs; economy.ts the starting stock).
//
// A new building type starts at NEW_BUILDING_COST until it is balanced.
// Amounts are items: a log (wood), a block (stone), a board (planks).

import type { BuildingType } from './buildings';
import type { Amounts } from './resources';

/** What a new building type costs until it is balanced. */
export const NEW_BUILDING_COST: Amounts = { wood: 2, stone: 2 };

/** What builders bring to put each building up (site.ts). */
export const COSTS: Record<BuildingType, Amounts> = {
  warehouse: { wood: 6, stone: 4 },
  house: { wood: 2, planks: 2, stone: 1 },
  farm: { wood: 3, planks: 2, stone: 2 },
  mill: { wood: 3, planks: 4, stone: 6 },
  bakery: { wood: 2, planks: 2, stone: 5 },
  blacksmith: { wood: 2, planks: 2, stone: 8 },
  market: { wood: 2, planks: 4, stone: 2 },
  chapel: { wood: 2, planks: 2, stone: 15 },
  tavern: { wood: 4, planks: 4, stone: 4 },
  watchtower: { wood: 4, planks: 2, stone: 6 },
  well: { wood: 1, stone: 3 },
  woodcutter: { wood: 3, stone: 1 },
  sawmill: NEW_BUILDING_COST,
  stonecutter: { wood: 4, stone: 1 },
  intersection: { wood: 1 },
  road: { wood: 3 },
};

/** What builders bring to upgrade a building that can be (BuildingDef.upgrade). */
export const UPGRADE_COSTS: Partial<Record<BuildingType, Amounts>> = {
  farm: { wood: 2, planks: 2, stone: 2 },
};

/** What the starting village's storage yard holds. */
export const START_STOCK: Amounts = { wood: 25, stone: 20, planks: 10 };
