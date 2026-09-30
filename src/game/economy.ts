// The village economy. The village's materials are whatever its warehouses
// hold: builders fetch wood and stone from them for construction sites
// (site.ts), and serfs carry goods between the warehouses and the buildings
// that make or use them (transport.ts). Every store keeps each item in its
// own place (storeSlot), where it is picked up from and put down.

import { BUILDINGS, type BuildingType } from './buildings';
import { BAKERY_SLOTS, BASKET, MILL_SLOTS, PILE_UNIT, SACK, STONECUTTER_SLOTS, TAVERN_SLOTS, SHEAF_SLOTS, STAND_Y, warehouseSlot, WOODCUTTER_SLOTS, type Slot, type Spot } from './layout';
import { room, RESOURCES, shortfall, stockOf, type Amounts, type Load, type Resource, type Stock } from './resources';
import { owed } from './site';
import { streetDist } from './streets';
import type { Building, World } from './world';

/** What the starting village's warehouse holds. */
export const WAREHOUSE_START: Stock = stockOf({ wood: 250, stone: 200 });

const xOf = (world: World, b: Building) => world.plots[b.plotIndex].x;
/** How far building b is from world x, along the streets. */
const away = (world: World, b: Building, x: number) => streetDist(world, x, xOf(world, b));

/** Finished warehouses. */
export function warehouses(world: World): Building[] {
  return world.buildings.filter((b) => b.type === 'warehouse' && b.status === 'done');
}

/** Everything the village has in its warehouses. */
export function villageStock(world: World): Stock {
  const s = stockOf();
  for (const w of warehouses(world)) for (const r of RESOURCES) s[r] += w.stock[r];
  return s;
}

/**
 * Materials in the warehouses already promised to construction sites (still
 * to be fetched), and so not free for new buildings.
 */
export function committed(world: World): Stock {
  const s = stockOf();
  for (const b of world.buildings) {
    if (!b.site) continue;
    const need = owed(world, b);
    for (const r of RESOURCES) s[r] += need[r] ?? 0;
  }
  return s;
}

/** What the village can still spend on a new building: in the warehouses and not yet promised. */
export function available(world: World): Stock {
  const have = villageStock(world);
  const promised = committed(world);
  for (const r of RESOURCES) have[r] = Math.max(0, have[r] - promised[r]);
  return have;
}

/** What the village still lacks to start this building (empty when it can). */
export function buildShortfall(world: World, type: BuildingType): Amounts {
  return shortfall(available(world), BUILDINGS[type].cost);
}

/** What the village still lacks to upgrade this building (empty when it can). */
export function upgradeShortfall(world: World, b: Building): Amounts {
  return shortfall(available(world), BUILDINGS[b.type].upgrade?.cost ?? {});
}

/** The warehouse nearest x that has some of r, if any. */
export function warehouseWith(world: World, r: Resource, x: number): Building | null {
  let best: Building | null = null;
  for (const w of warehouses(world)) {
    if (w.stock[r] <= 0) continue;
    if (!best || away(world, w, x) < away(world, best, x)) best = w;
  }
  return best;
}

/** Take up to `amount` of r out of a warehouse; returns how much was taken. */
export function takeOut(warehouse: Building, r: Resource, amount: number): number {
  const n = Math.max(0, Math.min(amount, warehouse.stock[r]));
  warehouse.stock[r] -= n;
  return n;
}

/** Take whatever there is of `amounts` out of the warehouses, nearest to x first; returns what was taken. */
export function takeFromWarehouses(world: World, amounts: Amounts, x: number): Stock {
  const got = stockOf();
  const near = [...warehouses(world)].sort((a, b) => away(world, a, x) - away(world, b, x));
  for (const r of RESOURCES) {
    for (const w of near) got[r] += takeOut(w, r, (amounts[r] ?? 0) - got[r]);
  }
  return got;
}

/** Put a load into the warehouse nearest x that has room; returns how much fitted. */
export function putAway(world: World, load: Load, x: number): number {
  const capacity = BUILDINGS.warehouse.storage;
  const fits = warehouses(world)
    .filter((w) => room(w.stock, capacity, load.resource) > 0)
    .sort((a, b) => away(world, a, x) - away(world, b, x));
  let left = load.amount;
  for (const w of fits) {
    const n = Math.min(left, room(w.stock, capacity, load.resource));
    w.stock[load.resource] += n;
    left -= n;
    if (left <= 0) break;
  }
  return load.amount - left;
}

/**
 * How a building's store keeps r: how much one item holds, how many items a
 * person carries at once, and where item i lies (layout.ts). Null if it keeps none.
 */
export function storeSlots(b: Building, r: Resource): { unit: number; perTrip: number; slot: (i: number) => Slot } | null {
  const pick = (slots: readonly Slot[]) => (i: number) => slots[Math.max(0, Math.min(i, slots.length - 1))];
  if (b.type === 'warehouse') return { unit: PILE_UNIT, perTrip: 1, slot: (i) => warehouseSlot(r, i) };
  if (b.type === 'farm' && r === 'grain') return { unit: 1, perTrip: 2, slot: pick(SHEAF_SLOTS) };
  if (b.type === 'mill' && (r === 'grain' || r === 'flour')) return { unit: SACK, perTrip: 1, slot: pick(MILL_SLOTS[r]) };
  if (b.type === 'bakery' && r === 'flour') return { unit: SACK, perTrip: 1, slot: pick(BAKERY_SLOTS.flour) };
  if (b.type === 'bakery' && r === 'bread') return { unit: BASKET, perTrip: 1, slot: pick(BAKERY_SLOTS.bread) };
  if (b.type === 'tavern' && r === 'bread') return { unit: BASKET, perTrip: 1, slot: pick(TAVERN_SLOTS) };
  if (b.type === 'woodcutter' && r === 'wood') return { unit: PILE_UNIT, perTrip: 1, slot: pick(WOODCUTTER_SLOTS) };
  if (b.type === 'stonecutter' && r === 'stone') return { unit: PILE_UNIT, perTrip: 1, slot: pick(STONECUTTER_SLOTS) };
  return null;
}

/** How much of r one person carries away from this store at a time. */
export function tripLoad(b: Building, r: Resource): number {
  const s = storeSlots(b, r);
  return s ? s.unit * s.perTrip : PILE_UNIT;
}

/**
 * Where someone stands at a building's store of r: `top` for the item they
 * would pick up, else where the next `adding` goes down. x relative to `fromX`.
 */
export function storeSpot(world: World, b: Building, r: Resource, fromX: number, top: boolean, adding = 0): Spot {
  const s = storeSlots(b, r);
  const items = (amount: number) => Math.ceil(amount / (s?.unit ?? PILE_UNIT) - 1e-9);
  const i = top ? items(b.stock[r]) - 1 : items(b.stock[r] + Math.max(adding, 1e-6)) - 1;
  return { dx: xOf(world, b) + (s?.slot(Math.max(0, i)).dx ?? 0) - fromX, y: STAND_Y };
}

/** Where someone stands at a warehouse's stack of r: the top item (to pick up), or where the next load goes. */
export function warehouseSpot(world: World, wh: Building, r: Resource, fromX: number, top: boolean): Spot {
  return storeSpot(world, wh, r, fromX, top, PILE_UNIT);
}
