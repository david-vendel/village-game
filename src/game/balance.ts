// Game balance: what every building costs to build or upgrade, and what a new
// village starts with. All in one place so balancing is done here, nowhere
// else (buildings.ts reads the costs; economy.ts the starting stock).
//
// A new building type starts at NEW_BUILDING_COST until it is balanced.
// Amounts are items: a log (wood), a block (stone), a board (planks).

import type { BuildingType } from './buildings';
import type { AnimalKind } from './livestock';
import type { Amounts, Resource } from './resources';

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
  chickenfarm: NEW_BUILDING_COST,
  cowfarm: NEW_BUILDING_COST,
  sheepfarm: NEW_BUILDING_COST,
  horsefarm: NEW_BUILDING_COST,
  stonecutter: { wood: 4, stone: 1 },
  intersection: { wood: 1 },
  road: { wood: 3 },
};

/** What builders bring to upgrade a building that can be (BuildingDef.upgrade). */
export const UPGRADE_COSTS: Partial<Record<BuildingType, Amounts>> = {
  farm: { wood: 2, planks: 2, stone: 2 },
};

/** Seconds of work to draw a bucket of water at a well (transport.ts). */
export const WELL_DRAW_SECONDS = 2;

/**
 * The animals' lives, in years (one game day is a year), as on a real farm:
 * grown up (`adult`), giving eggs or milk and breeding until `productiveUntil`,
 * and butchered for `meat` (items) at the end of their `lifespan`. Every
 * `feedsPerBirth` feeds a productive pair has a young one, up to `max` animals
 * (horses: also as their pasture allows, pasture.ts).
 */
export const ANIMALS: Record<AnimalKind, { adult: number; productiveUntil: number; lifespan: number; feedsPerBirth: number; max: number; meat: number }> = {
  chicken: { adult: 0.5, productiveUntil: 3, lifespan: 8, feedsPerBirth: 2, max: 8, meat: 1 },
  cow: { adult: 2, productiveUntil: 10, lifespan: 20, feedsPerBirth: 4, max: 4, meat: 2 },
  sheep: { adult: 1, productiveUntil: 7, lifespan: 12, feedsPerBirth: 3, max: 6, meat: 1 },
  horse: { adult: 4, productiveUntil: 20, lifespan: 30, feedsPerBirth: 4, max: 6, meat: 2 },
};

/** The seasons: every YEAR_DAYS days, the last WINTER_DAYS are winter (nothing grows, nobody sows). */
export const YEAR_DAYS = 12;
export const WINTER_DAYS = 3;

/** People a small house holds (a merged one, as many as its parts). */
export const HOUSE_RESIDENTS = 3;

/** What a household needs, per person per game day, by its house's level. */
export const NEEDS = {
  cottage: { bread: 1 / 3, water: 1 / 2 },
};

/**
 * How households live (households.ts): contentment follows how well needs are
 * met at `settleRate` a day; content (at least `growAbove`) with room, a
 * newcomer every `growDays`; discontent (below `leaveBelow`), one person
 * leaves every `leaveDays`.
 */
export const HOUSEHOLD = { settleRate: 1.5, growAbove: 0.8, growDays: 1, leaveBelow: 0.35, leaveDays: 0.5 };

/** Days fresh goods keep before they spoil (spoilage.ts); what is not here keeps. */
export const SHELF_LIFE: Partial<Record<Resource, number>> = { milk: 1, eggs: 2, meat: 1, bread: 3 };

/** What the starting village's storage yard holds. */
export const START_STOCK: Amounts = { wood: 25, stone: 20, planks: 10, bread: 10 };
