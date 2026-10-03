// Data-driven building registry: gameplay data only (name, purpose, footprint,
// build time, cost, storage, jobs). How a building looks — including its drawn
// height — lives in render/buildings.ts (BUILDING_ART), keyed by the same
// `BuildingType`. Behaviour specific to one type (a farm's fields) lives in
// its own module (farm.ts).
// To add a building: add an entry here and an entry in BUILDING_ART.

import { BAKERY_DOOR, BAKERY_OVEN, CHAPEL_DOOR, HOME, HOUSE_DOOR_DX, MILL_DOOR, SMITHY_DOOR, STAND_Y, STONECUTTER_DOOR, TAVERN_DOOR, PILE_UNIT, WOODCUTTER_DOOR, YARD_ITEMS, type Spot } from './layout';
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
  | 'intersection'
  | 'road';

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
  /** Footprint width along the street in world px: whole blocks of three land-grid cells (grid.ts). */
  width: number;
  /** Footprint depth in land-grid cells, back from the verge (default 2). */
  depth?: number;
  /** Seconds to construct when construction is enabled. */
  buildTime: number;
  /** Materials builders must bring from the warehouse to build it (site.ts). */
  cost: Amounts;
  /** What the building's own store holds, and how much of each. */
  storage: Amounts;
  /**
   * Where people go in and out (the middle of the doorway, on the ground; dx from
   * the building's x), or null for one nobody enters. Every building says which:
   * its drawing, 3D model and sprite (`door` point) put the door here, and the
   * game walks people through it (workplaces, new villagers out of a house).
   * A merged house's door moves with its size: doorOf.
   */
  door: Spot | null;
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
    door: null, // an open storage yard
    name: 'Storage yard',
    purpose: "Open yard with the village's wood, stone, grain, flour and bread in piles. Builders fetch from here.",
    width: 75,
    buildTime: 14,
    cost: { wood: 6, stone: 4 },
    // everything lies out in the open, in its place in a pile (layout.ts warehouseSlot)
    storage: Object.fromEntries(Object.entries(YARD_ITEMS).map(([r, n]) => [r, n * PILE_UNIT])),
    jobs: {},
  },
  house: {
    type: 'house',
    door: { dx: HOUSE_DOOR_DX[1], y: STAND_Y },
    name: 'House',
    purpose: 'Shelter for villagers. More homes, more hands.',
    width: 75,
    buildTime: 10,
    cost: { wood: 4, stone: 1 },
    storage: {},
    jobs: {},
  },
  farm: {
    type: 'farm',
    door: HOME,
    name: 'Farm',
    purpose: 'A farmstead with wheat fields. Feeds the village.',
    // farmhouse, barn and grain store on 6 × 3 cells; the fields use free cells around it
    width: 150,
    depth: 3,
    buildTime: 12,
    cost: { wood: 5, stone: 2 },
    storage: { grain: 5 },
    jobs: { farmer: 1 },
    ships: ['grain'],
    // a second room built on: two farmers live and work here
    upgrade: { name: 'Large farm', cost: { wood: 4, stone: 2 }, buildTime: 8, jobs: { farmer: 2 } },
  },
  mill: {
    type: 'mill',
    door: MILL_DOOR,
    name: 'Mill',
    purpose: 'Grinds grain from the farms into flour.',
    width: 150,
    buildTime: 16,
    cost: { wood: 6, stone: 6 },
    // a sack of grain waiting per slot, a sack of flour per slot (layout.ts MILL_SLOTS)
    storage: { grain: 3, flour: 3 },
    jobs: { miller: 1 },
    ships: ['flour'],
    needs: ['grain'],
    makes: { from: 'grain', to: 'flour', batch: 1, per: 1, seconds: 4, verb: 'grind', door: MILL_DOOR },
  },
  bakery: {
    type: 'bakery',
    door: BAKERY_DOOR,
    name: 'Bakery',
    purpose: 'Bakes flour from the mill into bread for the tavern.',
    width: 150,
    buildTime: 12,
    cost: { wood: 4, stone: 5 },
    // a sack of flour waiting per slot, a basket of loaves per slot (layout.ts BAKERY_SLOTS)
    storage: { flour: 3, bread: 4 },
    jobs: { baker: 1 },
    ships: ['bread'],
    needs: ['flour'],
    makes: { from: 'flour', to: 'bread', batch: 1, per: 2, seconds: 6, verb: 'bake', door: BAKERY_DOOR, at: BAKERY_OVEN },
  },
  blacksmith: {
    type: 'blacksmith',
    door: SMITHY_DOOR,
    name: 'Blacksmith',
    purpose: 'Forges tools and arms at the glowing anvil.',
    width: 150,
    buildTime: 14,
    cost: { wood: 4, stone: 8 },
    storage: {},
    jobs: {},
  },
  market: {
    type: 'market',
    door: null, // open stalls
    name: 'Market',
    purpose: 'Stalls where merchants trade goods and coin.',
    width: 150,
    buildTime: 9,
    cost: { wood: 6, stone: 2 },
    storage: {},
    jobs: {},
  },
  chapel: {
    type: 'chapel',
    door: CHAPEL_DOOR,
    name: 'Chapel',
    purpose: 'Bells, prayer and a steeple seen for miles.',
    width: 150,
    buildTime: 18,
    cost: { wood: 4, stone: 15 },
    storage: {},
    jobs: {},
  },
  tavern: {
    type: 'tavern',
    door: TAVERN_DOOR,
    name: 'Tavern',
    purpose: 'Ale, songs, rumours and bread for weary travellers.',
    width: 225,
    buildTime: 13,
    cost: { wood: 8, stone: 4 },
    // baskets of loaves on the bench outside (layout.ts TAVERN_SLOTS); guests eat them (tavern.ts)
    storage: { bread: 2 },
    jobs: {},
    needs: ['bread'],
  },
  watchtower: {
    type: 'watchtower',
    door: null, // climbed by its ladder, no door
    name: 'Watchtower',
    purpose: 'Guards keep watch over the road and the woods.',
    width: 75,
    buildTime: 12,
    cost: { wood: 6, stone: 6 },
    storage: {},
    jobs: {},
  },
  well: {
    type: 'well',
    door: null, // no door
    name: 'Well',
    purpose: 'Fresh water for the whole street.',
    width: 75,
    buildTime: 6,
    cost: { wood: 1, stone: 3 },
    storage: {},
    jobs: {},
  },
  woodcutter: {
    type: 'woodcutter',
    door: WOODCUTTER_DOOR,
    name: "Woodcutter's hut",
    purpose: 'Fells grown trees in the woods behind the street for wood.',
    // the hut at the back, its wood yard in front of it by the street
    width: 150,
    depth: 3,
    buildTime: 9,
    cost: { wood: 3, stone: 1 },
    // a cord of split wood per load in the yard (layout.ts WOODCUTTER_SLOTS); the woods: nature.ts
    storage: { wood: 3 },
    jobs: { woodcutter: 1 },
    ships: ['wood'],
  },
  stonecutter: {
    type: 'stonecutter',
    door: STONECUTTER_DOOR,
    name: "Stonecutter's hut",
    purpose: 'Cuts blocks of stone out of the nearest quarry in the hills.',
    width: 150,
    buildTime: 10,
    cost: { wood: 4, stone: 1 },
    // blocks set down by the wall (layout.ts STONECUTTER_SLOTS)
    storage: { stone: 3 },
    jobs: { stonecutter: 1 },
    ships: ['stone'],
  },
  intersection: {
    type: 'intersection',
    door: null, // a crossroads
    name: 'Crossroads',
    purpose: 'A road across the street, at right angles. Ride up to it and turn to follow the new street.',
    // the road it opens is a street of its own (streets.ts); the footprint is where it meets this one
    width: 75,
    buildTime: 4,
    cost: { wood: 1 },
    storage: {},
    jobs: {},
  },
  road: {
    type: 'road',
    door: null, // a stretch of road
    name: 'Road',
    purpose: 'Lays the road nine parcels (27 squares) further. The only thing built at the end of a road; never onto another road.',
    // the 27 cells of road it adds past the street's end (world.ts roadEnd); once laid it is part of the street
    width: 675,
    depth: 3,
    buildTime: 14,
    cost: { wood: 3 },
    storage: {},
    jobs: {},
  },
};

export const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];

/** What a building's store holds, and how much of each: a merged one (Building.size) holds as much as all its parts. */
export function storageOf(b: { type: BuildingType; size?: number }): Amounts {
  const out: Amounts = {};
  for (const [r, n] of Object.entries(BUILDINGS[b.type].storage)) out[r as keyof Amounts] = (n ?? 0) * (b.size ?? 1);
  return out;
}

/** A building's door (BuildingDef.door), for its size: a merged house's is in the middle of its front. */
export function doorOf(type: BuildingType, size: 1 | 2 | 3 = 1): Spot | null {
  return type === 'house' ? { dx: HOUSE_DOOR_DX[size], y: STAND_Y } : BUILDINGS[type].door;
}
