// Data-driven building registry: gameplay data only (name, purpose, footprint,
// build time). How a building looks — including its drawn height — lives in
// render/buildings.ts (BUILDING_ART), keyed by the same `BuildingType`.
// To add a building: add an entry here and an entry in BUILDING_ART.

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
  /** Seconds to construct when construction is enabled. */
  buildTime: number;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  house: {
    type: 'house',
    name: 'House',
    purpose: 'Shelter for villagers. More homes, more hands.',
    width: 150,
    buildTime: 10,
  },
  farm: {
    type: 'farm',
    name: 'Farm',
    purpose: 'A farmstead with wheat fields. Feeds the village.',
    width: 150,
    buildTime: 12,
  },
  mill: {
    type: 'mill',
    name: 'Mill',
    purpose: 'Grinds grain from the farms into flour.',
    width: 130,
    buildTime: 16,
  },
  blacksmith: {
    type: 'blacksmith',
    name: 'Blacksmith',
    purpose: 'Forges tools and arms at the glowing anvil.',
    width: 170,
    buildTime: 14,
  },
  market: {
    type: 'market',
    name: 'Market',
    purpose: 'Stalls where merchants trade goods and coin.',
    width: 170,
    buildTime: 9,
  },
  chapel: {
    type: 'chapel',
    name: 'Chapel',
    purpose: 'Bells, prayer and a steeple seen for miles.',
    width: 160,
    buildTime: 18,
  },
  tavern: {
    type: 'tavern',
    name: 'Tavern',
    purpose: 'Ale, songs and rumours for weary travellers.',
    width: 180,
    buildTime: 13,
  },
  watchtower: {
    type: 'watchtower',
    name: 'Watchtower',
    purpose: 'Guards keep watch over the road and the woods.',
    width: 90,
    buildTime: 12,
  },
  well: {
    type: 'well',
    name: 'Well',
    purpose: 'Fresh water for the whole street.',
    width: 80,
    buildTime: 6,
  },
};

export const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];
