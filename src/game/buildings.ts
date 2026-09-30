// Data-driven building registry: gameplay data only (name, purpose, footprint,
// build time, cost, storage, jobs). How a building looks — including its drawn
// height — lives in render/buildings.ts (BUILDING_ART), keyed by the same
// `BuildingType`. Behaviour specific to one type (a farm's fields) lives in
// its own module (farm.ts).
// To add a building: add an entry here and an entry in BUILDING_ART.

import { BAKERY_DOOR, BAKERY_OVEN, MILL_DOOR, PILE_UNIT, YARD_ITEMS, type Spot } from './layout';
import type { Amounts, Resource } from './resources';

export type BuildingType =
  | 'warehouse'
  | 'house'
  | 'farm'
  | 'mill'
  | 'bakery'
  | 'blacksmith'
  | 'market'
  | 'chapel'
  | 'tavern'
  | 'watchtower'
  | 'well'
  | 'woodcutter'
  | 'stonecutter'
  | 'intersection';

/**
 * Jobs a building can offer (see people.ts); builders work on construction
 * sites (site.ts); serfs run errands, carrying goods between buildings
 * (transport.ts). Serf is the one job that is not a profession: anyone out of
 * work takes it for as long as there is carrying to do. Serf comes last:
 * hiring fills the other jobs first.
 */
export type Role = 'farmer' | 'builder' | 'miller' | 'baker' | 'woodcutter' | 'stonecutter' | 'serf';
export const ROLES: readonly Role[] = ['farmer', 'builder', 'miller', 'baker', 'woodcutter', 'stonecutter', 'serf'];

/**
 * What a workshop makes (workshop.ts): its worker takes `batch` of `from` out
 * of the store, carries it to `at` (outside, e.g. the bakery's oven) or else
 * in through `door`, works it there for `seconds` and carries `per` of `to`
 * for each one to its place in the store.
 */
export interface Recipe {
  from: Resource;
  to: Resource;
  batch: number;
  per: number;
  seconds: number;
  /** The job's name (the worker's action), e.g. 'grind'. */
  verb: string;
  door: Spot;
  /** Where the work is done outdoors; without it, inside. */
  at?: Spot;
}

/**
 * What a finished building can be upgraded to: builders bring `cost` and build
 * it on (site.ts) for `buildTime` seconds of labour, while it keeps working.
 * Once upgraded it employs `jobs` instead of its own.
 */
export interface Upgrade {
  name: string;
  cost: Amounts;
  buildTime: number;
  jobs: Partial<Record<Role, number>>;
}

export interface BuildingDef {
  type: BuildingType;
  name: string;
  purpose: string;
  /** Footprint width in world px (must fit a plot). Rounded up to whole land-grid cells. */
  width: number;
  /** Seconds to construct when construction is enabled. */
  buildTime: number;
  /** Materials builders must bring from the warehouse to build it (site.ts). */
  cost: Amounts;
  /** What the building's own store holds, and how much of each. */
  storage: Amounts;
  /** Workers it employs once finished, per role. */
  jobs: Partial<Record<Role, number>>;
  /** Goods it makes, which serfs carry from its store to a warehouse. */
  ships?: Resource[];
  /** Goods it uses, which serfs bring to its store from the nearest place that has them (transport.ts). */
  needs?: Resource[];
  /** A workshop: what its worker makes of what it needs (workshop.ts). */
  makes?: Recipe;
  upgrade?: Upgrade;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  warehouse: {
    type: 'warehouse',
    name: 'Storage yard',
    purpose: "Open yard with the village's wood, stone, grain, flour and bread in piles. Builders fetch from here.",
    width: 170,
    buildTime: 14,
    cost: { wood: 60, stone: 40 },
    // everything lies out in the open, in its place in a pile (layout.ts warehouseSlot)
    storage: Object.fromEntries(Object.entries(YARD_ITEMS).map(([r, n]) => [r, n * PILE_UNIT])),
    jobs: {},
  },
  house: {
    type: 'house',
    name: 'House',
    purpose: 'Shelter for villagers. More homes, more hands.',
    width: 150,
    buildTime: 10,
    cost: { wood: 40, stone: 10 },
    storage: {},
    jobs: {},
  },
  farm: {
    type: 'farm',
    name: 'Farm',
    purpose: 'A farmstead with wheat fields. Feeds the village.',
    // farmhouse, barn and grain store; the fields use free land around it
    width: 200,
    buildTime: 12,
    cost: { wood: 50, stone: 20 },
    storage: { grain: 5 },
    jobs: { farmer: 1 },
    ships: ['grain'],
    // a second room built on: two farmers live and work here
    upgrade: { name: 'Large farm', cost: { wood: 40, stone: 20 }, buildTime: 8, jobs: { farmer: 2 } },
  },
  mill: {
    type: 'mill',
    name: 'Mill',
    purpose: 'Grinds grain from the farms into flour.',
    width: 130,
    buildTime: 16,
    cost: { wood: 60, stone: 60 },
    // a sack of grain waiting per slot, a sack of flour per slot (layout.ts MILL_SLOTS)
    storage: { grain: 30, flour: 30 },
    jobs: { miller: 1 },
    ships: ['flour'],
    needs: ['grain'],
    makes: { from: 'grain', to: 'flour', batch: 10, per: 1, seconds: 6, verb: 'grind', door: MILL_DOOR },
  },
  bakery: {
    type: 'bakery',
    name: 'Bakery',
    purpose: 'Bakes flour from the mill into bread for the tavern.',
    width: 150,
    buildTime: 12,
    cost: { wood: 40, stone: 50 },
    // a sack of flour waiting per slot, a basket of loaves per slot (layout.ts BAKERY_SLOTS)
    storage: { flour: 30, bread: 40 },
    jobs: { baker: 1 },
    ships: ['bread'],
    needs: ['flour'],
    makes: { from: 'flour', to: 'bread', batch: 10, per: 2, seconds: 8, verb: 'bake', door: BAKERY_DOOR, at: BAKERY_OVEN },
  },
  blacksmith: {
    type: 'blacksmith',
    name: 'Blacksmith',
    purpose: 'Forges tools and arms at the glowing anvil.',
    width: 170,
    buildTime: 14,
    cost: { wood: 40, stone: 80 },
    storage: {},
    jobs: {},
  },
  market: {
    type: 'market',
    name: 'Market',
    purpose: 'Stalls where merchants trade goods and coin.',
    width: 170,
    buildTime: 9,
    cost: { wood: 60, stone: 20 },
    storage: {},
    jobs: {},
  },
  chapel: {
    type: 'chapel',
    name: 'Chapel',
    purpose: 'Bells, prayer and a steeple seen for miles.',
    width: 160,
    buildTime: 18,
    cost: { wood: 40, stone: 150 },
    storage: {},
    jobs: {},
  },
  tavern: {
    type: 'tavern',
    name: 'Tavern',
    purpose: 'Ale, songs, rumours and bread for weary travellers.',
    width: 180,
    buildTime: 13,
    cost: { wood: 80, stone: 40 },
    // baskets of loaves on the bench outside (layout.ts TAVERN_SLOTS); guests eat them (tavern.ts)
    storage: { bread: 20 },
    jobs: {},
    needs: ['bread'],
  },
  watchtower: {
    type: 'watchtower',
    name: 'Watchtower',
    purpose: 'Guards keep watch over the road and the woods.',
    width: 90,
    buildTime: 12,
    cost: { wood: 60, stone: 60 },
    storage: {},
    jobs: {},
  },
  well: {
    type: 'well',
    name: 'Well',
    purpose: 'Fresh water for the whole street.',
    width: 80,
    buildTime: 6,
    cost: { wood: 5, stone: 30 },
    storage: {},
    jobs: {},
  },
  woodcutter: {
    type: 'woodcutter',
    name: "Woodcutter's hut",
    purpose: 'Fells grown trees in the woods behind the street for wood.',
    width: 130,
    buildTime: 9,
    cost: { wood: 30, stone: 10 },
    // logs stacked by the wall (layout.ts WOODCUTTER_SLOTS); the woods: nature.ts
    storage: { wood: 30 },
    jobs: { woodcutter: 1 },
    ships: ['wood'],
  },
  stonecutter: {
    type: 'stonecutter',
    name: "Stonecutter's hut",
    purpose: 'Cuts blocks of stone out of the nearest quarry in the hills.',
    width: 130,
    buildTime: 10,
    cost: { wood: 40, stone: 10 },
    // blocks set down by the wall (layout.ts STONECUTTER_SLOTS)
    storage: { stone: 30 },
    jobs: { stonecutter: 1 },
    ships: ['stone'],
  },
  intersection: {
    type: 'intersection',
    name: 'Crossroads',
    purpose: 'A road across the street, at right angles. Ride up to it and turn to follow the new street.',
    // the road it opens is a street of its own (streets.ts); the footprint is where it meets this one
    width: 60,
    buildTime: 4,
    cost: { wood: 10 },
    storage: {},
    jobs: {},
  },
};

export const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];
