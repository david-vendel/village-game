// Data-driven building registry: gameplay data only (name, purpose, footprint,
// build time, cost, storage, jobs). How a building looks — including its drawn
// height — lives in render/buildings.ts (BUILDING_ART), keyed by the same
// `BuildingType`. Behaviour specific to one type (a farm's fields) lives in
// its own module (farm.ts).
// To add a building: add an entry here and an entry in BUILDING_ART.

import type { Amounts } from './resources';

export type BuildingType =
  | 'warehouse'
  | 'house'
  | 'farm'
  | 'mill'
  | 'blacksmith'
  | 'market'
  | 'chapel'
  | 'tavern'
  | 'watchtower'
  | 'well';

/** Jobs a building can offer (see people.ts); builders work on construction sites (site.ts). */
export type Role = 'farmer' | 'builder';
export const ROLES: readonly Role[] = ['farmer', 'builder'];

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
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  warehouse: {
    type: 'warehouse',
    name: 'Warehouse',
    purpose: "Holds the village's wood, stone and grain. Builders fetch from here.",
    width: 170,
    buildTime: 14,
    cost: { wood: 60, stone: 40 },
    storage: { wood: 300, stone: 300, grain: 100 },
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
  },
  mill: {
    type: 'mill',
    name: 'Mill',
    purpose: 'Grinds grain from the farms into flour.',
    width: 130,
    buildTime: 16,
    cost: { wood: 60, stone: 60 },
    storage: {},
    jobs: {},
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
    purpose: 'Ale, songs and rumours for weary travellers.',
    width: 180,
    buildTime: 13,
    cost: { wood: 80, stone: 40 },
    storage: {},
    jobs: {},
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
