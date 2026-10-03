// Every building type's generator, and the models they make, cached. A model
// depends on the type, the building's seed (no two alike), its size (a merged
// house or yard) and which sides another building's walls touch (no eaves
// overhang there, the roof flush). Generators with an upgrade (the farm) give
// both looks merged (elements.ts mergeLooks).

import type { BuildingType } from '../../game/buildings';
import type { Vec3 } from './elements';
import { chapel, market, tavern, warehouse, watchtower } from './civic';
import { farm } from './farm';
import { house } from './house';
import { mill, well } from './mill';
import { bakery, blacksmith, stonecutter, woodcutter } from './workshops';
import type { Model } from './model';
import { plotOf, type Sides } from './plot';

export type Generator = (seed: number, plot: ReturnType<typeof plotOf>) => Model;

const GENERATORS: Partial<Record<BuildingType, Generator>> = {
  warehouse,
  house,
  farm,
  mill,
  bakery,
  blacksmith,
  market,
  chapel,
  tavern,
  watchtower,
  well,
  woodcutter,
  stonecutter,
};

/** Whether a type is built in 3D. */
export const hasModel = (type: BuildingType) => !!GENERATORS[type];

/** The types built in 3D. */
export const modelTypes = () => Object.keys(GENERATORS) as BuildingType[];

const cache = new Map<string, Model>();

/** A building's model (cached): its type, seed, size and the sides its neighbours' walls touch. */
export function modelOf(type: BuildingType, seed: number, size: 1 | 2 | 3 = 1, sides: Sides = { left: false, right: false }): Model {
  const key = `${type}|${seed}|${size}|${+sides.left}${+sides.right}`;
  let m = cache.get(key);
  if (!m) {
    m = GENERATORS[type]!(seed, plotOf(type, size, sides));
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    cache.set(key, m);
  }
  return m;
}

/** A type's named points for its default look (tests hold `door` to the game's BuildingDef.door). */
export function pointsOf(type: BuildingType): Record<string, Vec3> | undefined {
  return GENERATORS[type] ? modelOf(type, 7).points : undefined;
}
