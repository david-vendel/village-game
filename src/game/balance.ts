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
  dairy: NEW_BUILDING_COST,
  smokehouse: NEW_BUILDING_COST,
  weaver: NEW_BUILDING_COST,
  storehouse: NEW_BUILDING_COST,
  tannery: NEW_BUILDING_COST,
  chandler: NEW_BUILDING_COST,
  saddler: NEW_BUILDING_COST,
  stable: NEW_BUILDING_COST,
  brewery: NEW_BUILDING_COST,
  pastrycook: NEW_BUILDING_COST,
  reeve: NEW_BUILDING_COST,
  cowfarm: NEW_BUILDING_COST,
  sheepfarm: NEW_BUILDING_COST,
  horsefarm: NEW_BUILDING_COST,
  stonecutter: { wood: 4, stone: 1 },
  intersection: { wood: 1 },
  road: { wood: 3 },
};

/** What builders bring to upgrade a building that can be (BuildingDef.upgrade). */
export const UPGRADE_COSTS: Partial<Record<BuildingType | 'farmstead' | 'townhouse', Amounts>> = {
  farm: { wood: 2, planks: 2, stone: 2 },
  farmstead: NEW_BUILDING_COST,
  townhouse: NEW_BUILDING_COST,
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
/** Monks a chapel houses. */
export const CHAPEL_RESIDENTS = 4;

/**
 * Hunger (hunger.ts): everyone carries some days of food in them, used up a day
 * a game day. At none left they are hungry: they eat at home if its pantry has
 * food, else at a tavern. `starving` days past that they are starving: they put
 * down their work and eat whatever food they find anywhere. `leave` days past
 * it they leave the village. A meal takes `mealHours` game hours. At home (lunch,
 * or the night) they eat from the pantry once down to `topUp` days.
 */
export const HUNGER = { starving: 1, leave: 3, mealHours: 0.5, topUp: 0.5 };
/** What people eat, and how many days of food an item of each is. */
export const FOODS: Partial<Record<Resource, number>> = { bread: 1, cheese: 1, smokedmeat: 1, pastries: 1, eggs: 0.5, milk: 0.5, meat: 0.5 };
/** Loaves a building people live in keeps in its pantry (by the door), brought by serfs. */
export const PANTRY = 2;

/**
 * What a household needs, by its house's level: each need is one of `goods`
 * (any will do), `perDay` per person per game day. Clothing is a cloth a
 * person a year (YEAR_DAYS).
 */
export interface Need {
  goods: Resource[];
  perDay: number;
}
export const NEEDS: Record<'chapel' | 'cottage' | 'farmstead' | 'townhouse', Need[]> = {
  // the monks: water, and no fire to keep (food is each person's own hunger: HUNGER)
  chapel: [{ goods: ['water'], perDay: 1 / 2 }],
  cottage: [
    { goods: ['water'], perDay: 1 / 2 },
    { goods: ['firewood'], perDay: 1 / 6 },
  ],
  farmstead: [
    { goods: ['water'], perDay: 1 / 2 },
    { goods: ['firewood'], perDay: 1 / 6 },
    { goods: ['cheese', 'smokedmeat'], perDay: 1 / 4 },
    { goods: ['cloth'], perDay: 1 / 12 },
  ],
  townhouse: [
    { goods: ['water'], perDay: 1 / 2 },
    { goods: ['firewood'], perDay: 1 / 6 },
    { goods: ['cheese', 'smokedmeat'], perDay: 1 / 4 },
    { goods: ['cloth'], perDay: 1 / 12 },
    { goods: ['ale'], perDay: 1 / 4 },
    { goods: ['candles'], perDay: 1 / 6 },
    { goods: ['pastries'], perDay: 1 / 6 },
  ],
};
/** Burghers also want the chapel within this many px along the streets of home; without, that need is unmet. */
export const CHAPEL_REACH = 1200;
/** Coin a content burgher pays the village a day. */
export const TAX_PER_DAY = 2;
/** Extra people a house holds per small house's width once it is a farmstead. */
export const FARMSTEAD_EXTRA = 1;
/** And once it is a townhouse. */
export const TOWNHOUSE_EXTRA = 2;

/**
 * How households live (households.ts): contentment follows how well needs are
 * met at `settleRate` a day; content (at least `growAbove`) with room, a
 * newcomer every `growDays`; discontent (below `leaveBelow`), one person
 * leaves every `leaveDays`.
 */
export const HOUSEHOLD = { settleRate: 1.5, growAbove: 0.8, growDays: 1, leaveBelow: 0.35, leaveDays: 0.5 };

/** Days fresh goods keep before they spoil (spoilage.ts); what is not here keeps. */
export const SHELF_LIFE: Partial<Record<Resource, number>> = { milk: 1, eggs: 2, meat: 1, bread: 3, hides: 3, tools: 12 };

/**
 * The castle's requests, in order (castle.ts): goods for the reeve's house, the
 * days to gather them, the coin given. After the last, it repeats, half as much
 * again each time.
 */
export const CASTLE_REQUESTS: Array<{ goods: Amounts; days: number; coin: number }> = [
  { goods: { bread: 6, planks: 6 }, days: 6, coin: 20 },
  { goods: { cheese: 4, cloth: 3, eggs: 6 }, days: 8, coin: 40 },
  { goods: { horse: 2, leather: 4, candles: 6 }, days: 10, coin: 60 },
  { goods: { ale: 6, smokedmeat: 6, tools: 3 }, days: 10, coin: 80 },
];
/** Days between one request ending and the next coming down. */
export const CASTLE_GAP_DAYS = 2;

/**
 * The merchant (market.ts): comes every `everyDays` days; buys wool, cloth and
 * cheese (coin each) the stores hold more than `keep` of; sells iron and salt.
 */
export const MARKET = {
  everyDays: 4,
  keep: 4,
  buys: { wool: 2, cloth: 6, cheese: 4 } as Partial<Record<Resource, number>>,
  sells: { iron: 5, salt: 3 } as Partial<Record<Resource, number>>,
};
/** What a stabled horse eats a day (carts.ts). */
export const HORSE_HAY = 0.25;
/** Work goes this many times as fast while the stores hold tools (tools wear out: SHELF_LIFE). */
export const TOOL_SPEED = 1.25;

/**
 * Firewood (firewood.ts): split at the sawmill, `perLog` from a log. A fire
 * burns `hearthPerDay` a day at full blaze (a home's or a workshop's hearth),
 * a furnace `furnacePerDay` (the oven, the forge); households burn theirs as a
 * need (NEEDS), twice as much in winter. A building keeps `kept` by its wall.
 */
export const FIREWOOD = { perLog: 6, hearthPerDay: 0.5, furnacePerDay: 1, kept: 3 };
/** How many times as much firewood every fire burns in winter (heating). */
export const WINTER_FIRE = 2;

/** Water each animal drinks a day (livestock.ts), from its farm's store; SUMMER_DRINK times as much in summer. */
export const ANIMAL_WATER: Record<AnimalKind, number> = { chicken: 0.05, cow: 0.4, sheep: 0.15, horse: 0.4 };
export const SUMMER_DRINK = 2;

/** What the starting village's storage yard holds. */
export const START_STOCK: Amounts = { wood: 25, stone: 20, planks: 10, bread: 10 };
