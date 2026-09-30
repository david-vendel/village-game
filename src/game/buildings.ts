// Data-driven building registry: gameplay data only (name, purpose, footprint,
// build time, cost, storage, jobs). How a building looks — including its drawn
// height — lives in render/buildings.ts (BUILDING_ART), keyed by the same
// `BuildingType`. Behaviour specific to one type (a farm's fields) lives in
// its own module (farm.ts).
// To add a building: add an entry here and an entry in BUILDING_ART.

import { PILE_UNIT, YARD_ITEMS } from './layout';
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
  | 'well';

/**
 * Jobs a building can offer (see people.ts); builders work on construction
 * sites (site.ts); serfs run errands, carrying goods between buildings
 * (transport.ts). Serf is the one job that is not a profession: anyone out of
 * work takes it for as long as there is carrying to do. Serf comes last:
 * hiring fills the other jobs first.
 */
export type Role = 'farmer' | 'builder' | 'miller' | 'baker' | 'serf';
export const ROLES: readonly Role[] = ['farmer', 'builder', 'miller', 'baker', 'serf'];

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
  /** Goods it uses, which serfs bring to its store from a warehouse. */
  needs?: Resource[];
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
};

export const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];
