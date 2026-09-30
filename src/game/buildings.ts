// Data-driven building registry. Pure data — drawing lives in render/buildings.ts,
// keyed by the same `BuildingType`. To add a building: add an entry here and a
// draw function in the render registry.

export type BuildingType =
  | 'house'
  | 'farm'
  | 'mill'
  | 'blacksmith'
  | 'market'
  | 'chapel'
  | 'tavern'
  | 'watchtower'
  | 'well';

export interface BuildingDef {
  type: BuildingType;
  name: string;
  purpose: string;
  /** Footprint width in world px (must fit a plot). */
  width: number;
  /** Approximate finished height in world px — used by construction scaffolding. */
  height: number;
  /** Seconds to construct when construction is enabled. */
  buildTime: number;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  house: {
    type: 'house',
    name: 'House',
    purpose: 'Shelter for villagers. More homes, more hands.',
    width: 150,
    height: 140,
    buildTime: 10,
  },
  farm: {
    type: 'farm',
    name: 'Farm',
    purpose: 'A farmstead with wheat fields. Feeds the village.',
    width: 150,
    height: 120,
    buildTime: 12,
  },
  mill: {
    type: 'mill',
    name: 'Mill',
    purpose: 'Grinds grain from the farms into flour.',
    width: 130,
    height: 250,
    buildTime: 16,
  },
  blacksmith: {
    type: 'blacksmith',
    name: 'Blacksmith',
    purpose: 'Forges tools and arms at the glowing anvil.',
    width: 170,
    height: 150,
    buildTime: 14,
  },
  market: {
    type: 'market',
    name: 'Market',
    purpose: 'Stalls where merchants trade goods and coin.',
    width: 170,
    height: 110,
    buildTime: 9,
  },
  chapel: {
    type: 'chapel',
    name: 'Chapel',
    purpose: 'Bells, prayer and a steeple seen for miles.',
    width: 160,
    height: 270,
    buildTime: 18,
  },
  tavern: {
    type: 'tavern',
    name: 'Tavern',
    purpose: 'Ale, songs and rumours for weary travellers.',
    width: 180,
    height: 170,
    buildTime: 13,
  },
  watchtower: {
    type: 'watchtower',
    name: 'Watchtower',
    purpose: 'Guards keep watch over the road and the woods.',
    width: 90,
    height: 260,
    buildTime: 12,
  },
  well: {
    type: 'well',
    name: 'Well',
    purpose: 'Fresh water for the whole street.',
    width: 80,
    height: 90,
    buildTime: 6,
  },
};

export const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];
