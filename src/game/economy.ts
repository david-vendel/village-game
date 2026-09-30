// The village economy: one stockpile (world.stock) that pays for buildings,
// fed by the buildings' own stores. Goods produced at a building (a farm's
// sheaves) wait in its store until the village collects them: one of each
// stored resource every COLLECT_EVERY seconds. That also keeps production
// going, since a full store stops e.g. the harvest.

import { BUILDINGS } from './buildings';
import { pay, RESOURCES, shortfall, stockOf, type Amounts, type Stock } from './resources';
import type { BuildingType } from './buildings';
import type { World } from './world';

/** What a new village starts with. */
export const STARTING_STOCK: Stock = stockOf({ wood: 250, stone: 250 });

/** How often (s) the village collects from each building's store. */
export const COLLECT_EVERY = 30;

/** What the village still lacks to build this (empty when it can). */
export function buildShortfall(world: World, type: BuildingType): Amounts {
  return shortfall(world.stock, BUILDINGS[type].cost);
}

/** Pay for a building from the stockpile; false if the village can't afford it. */
export function payForBuilding(world: World, type: BuildingType): boolean {
  return pay(world.stock, BUILDINGS[type].cost);
}

export function collectGoods(world: World, dt: number): void {
  for (const b of world.buildings) {
    b.collectIn -= dt;
    if (b.collectIn > 0) continue;
    b.collectIn += COLLECT_EVERY;
    for (const r of RESOURCES) {
      if (b.stock[r] <= 0) continue;
      b.stock[r] -= 1;
      world.stock[r] += 1;
    }
  }
}
