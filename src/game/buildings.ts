// Data-driven building registry: gameplay data only (name, purpose, footprint,
// build time, storage, jobs; what it costs is in balance.ts). How a building
// looks — including its drawn height — lives in render/buildings.ts (BUILDING_ART), keyed by the same
// `BuildingType`. Behaviour specific to one type (a farm's fields) lives in
// its own module (farm.ts).
// To add a building: add an entry here, its cost in balance.ts (NEW_BUILDING_COST)
// and an entry in BUILDING_ART.

import { WORKSHOP_DOOR, BAKERY_DOOR, BAKERY_OVEN, CHAPEL_DOOR, HOME, HOUSE_DOOR_DX, MILL_DOOR, SAWMILL_DOOR, SAWMILL_SAW, SMITHY_DOOR, STAND_Y, STONECUTTER_DOOR, TAVERN_DOOR, PILE_UNIT, LIVESTOCK_DOOR, WELL_DRAW, WOODCUTTER_DOOR, YARD_ITEMS, type Spot } from './layout';
import { COSTS, FIREWOOD, UPGRADE_COSTS } from './balance';
import type { Livestock } from './livestock';
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
  | 'sawmill'
  | 'dairy'
  | 'smokehouse'
  | 'weaver'
  | 'storehouse'
  | 'tannery'
  | 'chandler'
  | 'saddler'
  | 'stable'
  | 'brewery'
  | 'pastrycook'
  | 'reeve'
  | 'chickenfarm'
  | 'cowfarm'
  | 'sheepfarm'
  | 'horsefarm'
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
export type Role = 'farmer' | 'builder' | 'miller' | 'baker' | 'woodcutter' | 'sawyer' | 'stonecutter' | 'herder' | 'dairymaid' | 'smoker' | 'weaver' | 'tanner' | 'chandler' | 'saddler' | 'brewer' | 'pastrycook' | 'smith' | 'serf';
export const ROLES: readonly Role[] = ['farmer', 'builder', 'miller', 'baker', 'woodcutter', 'sawyer', 'stonecutter', 'herder', 'dairymaid', 'smoker', 'weaver', 'tanner', 'chandler', 'saddler', 'brewer', 'pastrycook', 'smith', 'serf'];
/** Skilled work: only freemen take it, people whose home is a farmstead or better (people.ts). */
export const SKILLED: ReadonlySet<Role> = new Set<Role>(['weaver', 'saddler', 'smith']);

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
  /** A second thing each batch uses up, `amount` of it per one of `from` (the bakery's water). */
  also?: { resource: Resource; amount: number };
  /** Made instead of `to`, `per` of it for each one of `from`, when the village is shorter of it (the sawmill's firewood). */
  or?: { resource: Resource; per: number };
  /** Worked over a fire: no firewood, no work (firewood.ts). */
  fire?: true;
  /** Used if there is any, one a batch, for `factor` times as much made (the smokehouse's salt: two joints cured from one). */
  boost?: { resource: Resource; factor: number };
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
  /** Once upgraded, what its store holds instead (a farmstead's shelf holds more). */
  storage?: Amounts;
  /** Once upgraded, what it needs instead. */
  needs?: Resource[];
  /** The upgrade after this one, if it has one (a farmstead becomes a townhouse). */
  next?: Upgrade;
  /** How many of the castle's charters it takes (castle.ts). */
  charter?: number;
}

/** How many upgrades a building has had (0, 1 or 2). */
export const upgradesDone = (b: { upgraded?: true; level?: number }): number => b.level ?? (b.upgraded ? 1 : 0);

/** The upgrades a type has, in order. */
export function upgradesOf(type: BuildingType): Upgrade[] {
  const out: Upgrade[] = [];
  for (let u = BUILDINGS[type].upgrade; u; u = u.next) out.push(u);
  return out;
}

/** The upgrade a building has had last, if any: what it now is. */
export const currentUpgrade = (b: { type: BuildingType; upgraded?: true; level?: number }): Upgrade | undefined => upgradesOf(b.type)[upgradesDone(b) - 1];
/** The upgrade it can have next, if any. */
export const nextUpgrade = (b: { type: BuildingType; upgraded?: true; level?: number }): Upgrade | undefined => upgradesOf(b.type)[upgradesDone(b)];
/** Its name: its type's, or its last upgrade's. */
export const nameOf = (b: { type: BuildingType; upgraded?: true; level?: number }): string => currentUpgrade(b)?.name ?? BUILDINGS[b.type].name;
/** What it needs brought: its type's, or its last upgrade's. */
export const needsOf = (b: { type: BuildingType; upgraded?: true; level?: number }): Resource[] => currentUpgrade(b)?.needs ?? BUILDINGS[b.type].needs ?? [];

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
  /** An animal farm: the herd it keeps, what it eats and what it gives (livestock.ts). */
  livestock?: Livestock;
  /**
   * Drawn here by hand, without end (the well's water): whoever comes for it
   * and finds none waiting draws it at `at`, for WELL_DRAW_SECONDS (balance.ts),
   * and serfs with nothing to do nearby fill the store (transport.ts).
   */
  drawn?: { resource: Resource; at: Spot };
  upgrade?: Upgrade;
  /** How many of the castle's charters it takes before the lord may build one (castle.ts). */
  charter?: number;
  /** Only one in the village (the reeve's house). */
  unique?: true;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  warehouse: {
    type: 'warehouse',
    door: null, // an open storage yard
    name: 'Storage yard',
    purpose: "Open yard with the village's wood, stone, planks, grain, flour and bread in piles. Builders fetch from here.",
    width: 75,
    buildTime: 14,
    cost: COSTS.warehouse,
    // everything lies out in the open, in its place in a pile (layout.ts warehouseSlot)
    storage: Object.fromEntries(Object.entries(YARD_ITEMS).map(([r, n]) => [r, n * PILE_UNIT])),
    jobs: {},
  },
  house: {
    type: 'house',
    door: { dx: HOUSE_DOOR_DX[1], y: STAND_Y },
    name: 'House',
    purpose: 'A home for three. Its family needs bread and water; content, it grows, wanting, people leave.',
    width: 75,
    buildTime: 10,
    cost: COSTS.house,
    // what the family eats and drinks, on the shelf by the door (layout.ts houseSlot); households.ts
    storage: { bread: 2, water: 2 },
    needs: ['bread', 'water'],
    jobs: {},
    // the house's levels: cottage (peasants), farmstead (freemen), townhouse (burghers); households.ts NEEDS
    upgrade: {
      name: 'Farmstead',
      cost: UPGRADE_COSTS.farmstead!,
      buildTime: 8,
      jobs: {},
      storage: { bread: 2, water: 2, cheese: 1, smokedmeat: 1, cloth: 1 },
      needs: ['bread', 'water', 'cheese', 'smokedmeat', 'cloth'],
      charter: 1,
      next: {
        name: 'Townhouse',
        cost: UPGRADE_COSTS.townhouse!,
        buildTime: 10,
        jobs: {},
        storage: { bread: 2, water: 2, cheese: 1, smokedmeat: 1, cloth: 1, ale: 1, candles: 1, pastries: 1 },
        needs: ['bread', 'water', 'cheese', 'smokedmeat', 'cloth', 'ale', 'candles', 'pastries'],
        charter: 2,
      },
    },
  },
  farm: {
    type: 'farm',
    door: HOME,
    name: 'Farm',
    purpose: 'A farmstead with fields of wheat (grain) and meadow (hay). Feeds the village and its animals.',
    // farmhouse, barn and grain store on 6 × 3 cells; the fields use free cells around it
    width: 150,
    depth: 3,
    buildTime: 12,
    cost: COSTS.farm,
    // sheaves on the pallet (layout.ts SHEAF_SLOTS), bales of hay by the barn (HAY_SLOTS)
    storage: { grain: 5, hay: 3, horse: 1 },
    jobs: { farmer: 1 },
    ships: ['grain', 'hay'],
    // a plough horse makes the work go quicker (carts.ts PLOUGH_SPEED)
    needs: ['horse'],
    // a second room built on: two farmers live and work here
    upgrade: { name: 'Large farm', cost: UPGRADE_COSTS.farm!, buildTime: 8, jobs: { farmer: 2 } },
  },
  mill: {
    type: 'mill',
    door: MILL_DOOR,
    name: 'Mill',
    purpose: 'Grinds grain from the farms into flour.',
    width: 150,
    buildTime: 16,
    cost: COSTS.mill,
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
    purpose: 'Bakes flour from the mill and water from the well into bread for the tavern.',
    width: 150,
    buildTime: 12,
    cost: COSTS.bakery,
    // a sack of flour waiting per slot, a basket of loaves per slot (layout.ts BAKERY_SLOTS)
    // and buckets of water left of the flour (layout.ts BAKERY_WATER_SLOTS)
    storage: { flour: 3, bread: 4, water: 2 },
    jobs: { baker: 1 },
    ships: ['bread'],
    needs: ['flour', 'water'],
    makes: { from: 'flour', to: 'bread', batch: 1, per: 2, seconds: 6, verb: 'bake', door: BAKERY_DOOR, at: BAKERY_OVEN, fire: true, also: { resource: 'water', amount: 1 } },
  },
  blacksmith: {
    type: 'blacksmith',
    door: SMITHY_DOOR,
    name: 'Blacksmith',
    purpose: 'Forges the merchant\'s iron into tools. Tools in store make every worker quicker. Skilled work.',
    width: 150,
    buildTime: 14,
    cost: COSTS.blacksmith,
    // iron by the anvil, tools hung up beside it (layout.ts SMITHY_SLOTS)
    storage: { iron: 3, tools: 3 },
    jobs: { smith: 1 },
    ships: ['tools'],
    needs: ['iron'],
    makes: { from: 'iron', to: 'tools', batch: 1, per: 1, seconds: 10, verb: 'forge', door: SMITHY_DOOR, fire: true },
  },
  market: {
    type: 'market',
    door: null, // open stalls
    name: 'Market',
    purpose: 'Every few days a merchant comes: he buys surplus wool, cloth and cheese and sells iron and salt (market.ts).',
    width: 150,
    buildTime: 9,
    cost: COSTS.market,
    // what is for sale to him on the left stall, what he sold on the right (layout.ts MARKET_SLOTS)
    storage: { wool: 3, cloth: 3, cheese: 3, iron: 4, salt: 4 },
    jobs: {},
    ships: ['iron', 'salt'],
  },
  chapel: {
    type: 'chapel',
    door: CHAPEL_DOOR,
    name: 'Chapel',
    purpose: 'Bells, prayer and a steeple seen for miles. Home of the monks, who need bread and water like any family.',
    width: 150,
    buildTime: 18,
    cost: COSTS.chapel,
    // what the monks eat and drink, on a shelf by the door (layout.ts houseSlot); households.ts
    storage: { bread: 2, water: 2 },
    needs: ['bread', 'water'],
    jobs: {},
  },
  tavern: {
    type: 'tavern',
    door: TAVERN_DOOR,
    name: 'Tavern',
    purpose: 'Ale, songs, rumours and bread for weary travellers.',
    width: 225,
    buildTime: 13,
    cost: COSTS.tavern,
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
    cost: COSTS.watchtower,
    storage: {},
    jobs: {},
  },
  well: {
    type: 'well',
    door: null, // no door
    name: 'Well',
    purpose: 'Fresh water for the street, drawn by hand: the bakery needs it for bread.',
    width: 75,
    buildTime: 6,
    cost: COSTS.well,
    // buckets drawn and waiting, two each side (layout.ts WELL_SLOTS)
    storage: { water: 4 },
    jobs: {},
    ships: ['water'],
    drawn: { resource: 'water', at: WELL_DRAW },
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
    cost: COSTS.woodcutter,
    // a cord of split wood per load in the yard (layout.ts WOODCUTTER_SLOTS); the woods: nature.ts
    storage: { wood: 3 },
    jobs: { woodcutter: 1 },
    ships: ['wood'],
  },
  sawmill: {
    type: 'sawmill',
    door: SAWMILL_DOOR,
    name: 'Sawmill',
    purpose: 'Saws logs from the woodcutters into planks (two a log) or splits them into firewood (six a log), whichever the village is shorter of.',
    width: 150,
    buildTime: 11,
    cost: COSTS.sawmill,
    // logs waiting left of the door, split firewood and boards stacked by the saw bench (layout.ts SAWMILL_SLOTS)
    storage: { wood: 3, planks: 4, firewood: 6 },
    jobs: { sawyer: 1 },
    ships: ['planks', 'firewood'],
    needs: ['wood'],
    makes: { from: 'wood', to: 'planks', batch: 1, per: 2, seconds: 5, verb: 'saw', door: SAWMILL_DOOR, at: SAWMILL_SAW, or: { resource: 'firewood', per: FIREWOOD.perLog } },
  },
  dairy: {
    type: 'dairy',
    door: WORKSHOP_DOOR,
    name: 'Dairy',
    purpose: 'Makes the cow and sheep farms\' milk into cheese, which keeps: two pails a cheese.',
    width: 150,
    buildTime: 10,
    cost: COSTS.dairy,
    charter: 1,
    // what comes in left of the door, what is made right of it (layout.ts WORKSHOP_IN, WORKSHOP_OUT)
    storage: { milk: 4, cheese: 4 },
    jobs: { dairymaid: 1 },
    ships: ['cheese'],
    needs: ['milk'],
    makes: { from: 'milk', to: 'cheese', batch: 2, per: 0.5, seconds: 8, verb: 'churn', door: WORKSHOP_DOOR },
  },
  smokehouse: {
    type: 'smokehouse',
    door: WORKSHOP_DOOR,
    name: 'Smokehouse',
    purpose: 'Smokes the animal farms\' meat, so it keeps through the winter; with salt, each joint cures into two.',
    width: 150,
    buildTime: 10,
    cost: COSTS.smokehouse,
    charter: 1,
    // salt from the merchant (market.ts) left of the meat: with it a joint cures into two
    storage: { meat: 3, smokedmeat: 4, salt: 2 },
    jobs: { smoker: 1 },
    ships: ['smokedmeat'],
    needs: ['meat', 'salt'],
    makes: { from: 'meat', to: 'smokedmeat', batch: 1, per: 1, seconds: 8, verb: 'smoke', door: WORKSHOP_DOOR, fire: true, boost: { resource: 'salt', factor: 2 } },
  },
  weaver: {
    type: 'weaver',
    door: WORKSHOP_DOOR,
    name: "Weaver's",
    purpose: 'Spins and weaves the sheep farms\' wool into cloth for clothes. Skilled work: a freeman weaves.',
    width: 150,
    buildTime: 10,
    cost: COSTS.weaver,
    charter: 1,
    storage: { wool: 4, cloth: 4 },
    jobs: { weaver: 1 },
    ships: ['cloth'],
    needs: ['wool'],
    makes: { from: 'wool', to: 'cloth', batch: 2, per: 0.5, seconds: 10, verb: 'weave', door: WORKSHOP_DOOR },
  },
  storehouse: {
    type: 'storehouse',
    door: null, // an open-fronted barn
    name: 'Storehouse',
    purpose: 'A barn where goods that keep are stored on shelves: cheese, smoked meat, cloth, leather, candles, ale, tools and more.',
    charter: 1,
    width: 150,
    buildTime: 12,
    cost: COSTS.storehouse,
    // a shelf for each kind of good (layout.ts storehouseSlot)
    storage: { cheese: 8, smokedmeat: 8, cloth: 8, hides: 8, tallow: 8, leather: 8, candles: 8, harness: 8, ale: 8, pastries: 8, iron: 8, tools: 8, salt: 8 },
    jobs: {},
  },
  tannery: {
    type: 'tannery',
    door: WORKSHOP_DOOR,
    name: 'Tannery',
    purpose: 'Tans the hides left from butchering into leather, in pits of water.',
    width: 150,
    buildTime: 10,
    cost: COSTS.tannery,
    charter: 1,
    storage: { hides: 4, water: 2, leather: 4 },
    jobs: { tanner: 1 },
    ships: ['leather'],
    needs: ['hides', 'water'],
    makes: { from: 'hides', to: 'leather', batch: 1, per: 1, seconds: 10, verb: 'tan', door: WORKSHOP_DOOR, also: { resource: 'water', amount: 1 } },
  },
  chandler: {
    type: 'chandler',
    door: WORKSHOP_DOOR,
    name: "Chandler's",
    purpose: 'Renders tallow from butchering into candles: two from each.',
    width: 150,
    buildTime: 9,
    cost: COSTS.chandler,
    charter: 1,
    storage: { tallow: 4, candles: 4 },
    jobs: { chandler: 1 },
    ships: ['candles'],
    needs: ['tallow'],
    makes: { from: 'tallow', to: 'candles', batch: 1, per: 2, seconds: 8, verb: 'dip', door: WORKSHOP_DOOR, fire: true },
  },
  saddler: {
    type: 'saddler',
    door: WORKSHOP_DOOR,
    name: "Saddler's",
    purpose: 'Makes harness out of leather, for the stable\'s cart horses. Skilled work.',
    width: 150,
    buildTime: 10,
    cost: COSTS.saddler,
    charter: 2,
    storage: { leather: 4, harness: 3 },
    jobs: { saddler: 1 },
    ships: ['harness'],
    needs: ['leather'],
    makes: { from: 'leather', to: 'harness', batch: 2, per: 0.5, seconds: 10, verb: 'stitch', door: WORKSHOP_DOOR },
  },
  stable: {
    type: 'stable',
    door: null, // horses stand in its stalls
    name: 'Stable',
    purpose: 'Keeps cart horses: each horse with a harness lets a serf carry four loads at once. They eat hay.',
    width: 150,
    buildTime: 12,
    cost: COSTS.stable,
    charter: 2,
    // a horse in each stall, harness on pegs, hay in the rack (layout.ts STABLE_SLOTS)
    storage: { horse: 4, harness: 4, hay: 4 },
    jobs: {},
    needs: ['horse', 'harness', 'hay'],
  },
  brewery: {
    type: 'brewery',
    door: WORKSHOP_DOOR,
    name: 'Brewery',
    purpose: 'Brews ale from grain and well water, for the tavern and the burghers.',
    width: 150,
    buildTime: 11,
    cost: COSTS.brewery,
    charter: 2,
    storage: { grain: 4, water: 2, ale: 4 },
    jobs: { brewer: 1 },
    ships: ['ale'],
    needs: ['grain', 'water'],
    makes: { from: 'grain', to: 'ale', batch: 1, per: 1, seconds: 10, verb: 'brew', door: WORKSHOP_DOOR, fire: true, also: { resource: 'water', amount: 1 } },
  },
  pastrycook: {
    type: 'pastrycook',
    door: WORKSHOP_DOOR,
    name: 'Pastry cook',
    purpose: 'Bakes pastries from flour and eggs for the burghers.',
    width: 150,
    buildTime: 10,
    cost: COSTS.pastrycook,
    charter: 2,
    storage: { flour: 3, eggs: 2, pastries: 4 },
    jobs: { pastrycook: 1 },
    ships: ['pastries'],
    needs: ['flour', 'eggs'],
    makes: { from: 'flour', to: 'pastries', batch: 1, per: 2, seconds: 8, verb: 'bake-pastries', door: WORKSHOP_DOOR, fire: true, also: { resource: 'eggs', amount: 1 } },
  },
  reeve: {
    type: 'reeve',
    door: WORKSHOP_DOOR,
    name: "Reeve's house",
    purpose: 'Where the castle\'s requests come down and what it asks for is gathered and sent up (castle.ts). One in the village.',
    width: 150,
    buildTime: 10,
    cost: COSTS.reeve,
    unique: true,
    // whatever the castle may ask for, on the cart in the yard (layout.ts reeveSlot)
    storage: { bread: 12, planks: 12, cheese: 12, smokedmeat: 12, cloth: 12, horse: 4, leather: 12, candles: 12, ale: 12, tools: 12, eggs: 12, wool: 12 },
    jobs: {},
  },
  chickenfarm: {
    type: 'chickenfarm',
    door: LIVESTOCK_DOOR,
    name: 'Chicken farm',
    purpose: 'Hens and a cock fed on grain from the farms: the hens lay eggs, and every bird ends as meat.',
    width: 150,
    buildTime: 9,
    cost: COSTS.chickenfarm,
    // the feed left of the door, what the animals give right of it (layout.ts FEED_SLOTS, GOODS_SLOTS)
    storage: { grain: 3, eggs: 4, meat: 2 },
    jobs: { herder: 1 },
    needs: ['grain'],
    livestock: { animal: 'chicken', feed: 'grain', gives: 'eggs', per: 2 },
  },
  cowfarm: {
    type: 'cowfarm',
    door: LIVESTOCK_DOOR,
    name: 'Cow farm',
    purpose: 'Cows and a bull fed on hay from the farms: the cows give two pails of milk a feed, and every beast ends as meat.',
    width: 150,
    buildTime: 11,
    cost: COSTS.cowfarm,
    storage: { hay: 3, milk: 4, meat: 2 },
    jobs: { herder: 1 },
    needs: ['hay'],
    livestock: { animal: 'cow', feed: 'hay', gives: 'milk', per: 2 },
  },
  sheepfarm: {
    type: 'sheepfarm',
    door: LIVESTOCK_DOOR,
    name: 'Sheep farm',
    purpose: 'Ewes and a ram fed on hay from the farms: ewes give milk, all give wool, and every sheep ends as meat.',
    width: 150,
    buildTime: 11,
    cost: COSTS.sheepfarm,
    storage: { hay: 3, milk: 2, wool: 2, meat: 2 },
    jobs: { herder: 1 },
    needs: ['hay'],
    livestock: { animal: 'sheep', feed: 'hay', gives: 'milk', per: 1, or: 'wool' },
  },
  horsefarm: {
    type: 'horsefarm',
    door: LIVESTOCK_DOOR,
    name: 'Horse farm',
    purpose: 'Mares and a stallion fed on hay, grazing the free land behind the farm: foals are born and grow up there.',
    width: 150,
    buildTime: 12,
    cost: COSTS.horsefarm,
    // grown horses beyond a breeding pair are haltered and led out to the stables and farms
    storage: { hay: 3, horse: 2, meat: 2 },
    jobs: { herder: 1 },
    needs: ['hay'],
    ships: ['horse'],
    livestock: { animal: 'horse', feed: 'hay' },
  },
  stonecutter: {
    type: 'stonecutter',
    door: STONECUTTER_DOOR,
    name: "Stonecutter's hut",
    purpose: 'Cuts blocks of stone out of the nearest quarry in the hills.',
    width: 150,
    buildTime: 10,
    cost: COSTS.stonecutter,
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
    cost: COSTS.intersection,
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
    cost: COSTS.road,
    storage: {},
    jobs: {},
  },
};

export const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];

/** What a building's store holds, and how much of each: a merged one (Building.size) holds as much as all its parts; an upgraded one, its upgrade's store. */
const storages = new Map<string, Amounts>();
export function storageOf(b: { type: BuildingType; size?: number; upgraded?: true; level?: number }): Amounts {
  // the same few kinds over and over: worked out once each
  const key = `${b.type}|${b.size ?? 1}|${upgradesDone(b)}`;
  const known = storages.get(key);
  if (known) return known;
  const out: Amounts = {};
  storages.set(key, out);
  for (const [r, n] of Object.entries(currentUpgrade(b)?.storage ?? BUILDINGS[b.type].storage)) out[r as keyof Amounts] = (n ?? 0) * (b.size ?? 1);
  return out;
}

/** A building's door (BuildingDef.door), for its size: a merged house's is in the middle of its front. */
export function doorOf(type: BuildingType, size: 1 | 2 | 3 = 1): Spot | null {
  return type === 'house' ? { dx: HOUSE_DOOR_DX[size], y: STAND_Y } : BUILDINGS[type].door;
}

/**
 * The buildings with a fire, which burn firewood (firewood.ts): homes, and
 * every building whose workers live in it (but the mill, whose miller keeps
 * no fire among the flour), the tavern, the watch's brazier. Each keeps a
 * woodpile by its wall (FIREWOOD.kept) that serfs keep stocked. The sawmill keeps
 * none either, for its sawdust.
 */
export const HAS_FIRE: ReadonlySet<BuildingType> = new Set(
  BUILDING_TYPES.filter((t) => t !== 'mill' && t !== 'sawmill' && (t === 'house' || t === 'tavern' || t === 'watchtower' || Object.keys(BUILDINGS[t].jobs).length > 0)),
);
for (const t of HAS_FIRE) {
  const def = BUILDINGS[t];
  def.storage = { ...def.storage, firewood: Math.max(def.storage.firewood ?? 0, FIREWOOD.kept) };
  def.needs = [...(def.needs ?? []), 'firewood'];
  for (let u = def.upgrade; u; u = u.next) {
    if (u.storage) u.storage = { ...u.storage, firewood: FIREWOOD.kept };
    if (u.needs) u.needs = [...u.needs, 'firewood'];
  }
}

// Every animal farm keeps water for its animals (livestock.ts), brought from the well.
for (const t of BUILDING_TYPES) {
  const def = BUILDINGS[t];
  if (!def.livestock) continue;
  def.storage = { ...def.storage, water: 3 };
  def.needs = [...(def.needs ?? []), 'water'];
}
