// The village economy. The village's materials are whatever its warehouses
// hold: builders fetch wood and stone from them for construction sites
// (site.ts), and producers carry their goods there themselves (a farmer
// hauls sheaves when the fields need nothing). Every load is picked up from,
// and put down at, its own place in a warehouse's stacks (warehouseSlot).

import { BUILDINGS, type BuildingType } from './buildings';
import { pileItems, STAND_Y, warehouseSlot, type Spot } from './layout';
import { room, RESOURCES, shortfall, stockOf, type Amounts, type Load, type Resource, type Stock } from './resources';
import { owed } from './site';
import type { Depot } from './worker';
import type { Building, World } from './world';

/** What the starting village's warehouse holds. */
export const WAREHOUSE_START: Stock = stockOf({ wood: 50, stone: 50 });

const xOf = (world: World, b: Building) => world.plots[b.plotIndex].x;

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

/** The warehouse nearest x that has some of r, if any. */
export function warehouseWith(world: World, r: Resource, x: number): Building | null {
  let best: Building | null = null;
  for (const w of warehouses(world)) {
    if (w.stock[r] <= 0) continue;
    if (!best || Math.abs(xOf(world, w) - x) < Math.abs(xOf(world, best) - x)) best = w;
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
  const near = [...warehouses(world)].sort((a, b) => Math.abs(xOf(world, a) - x) - Math.abs(xOf(world, b) - x));
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
    .sort((a, b) => Math.abs(xOf(world, a) - x) - Math.abs(xOf(world, b) - x));
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
 * Where someone stands at a warehouse to reach its stack of r: `top` for the
 * item they would pick up, else where the next one goes down. x relative to `fromX`.
 */
export function warehouseSpot(world: World, wh: Building, r: Resource, fromX: number, top: boolean): Spot {
  const n = pileItems(wh.stock[r]);
  return { dx: xOf(world, wh) + warehouseSlot(r, top ? n - 1 : n).dx - fromX, y: STAND_Y };
}

/** The warehouses as a place for a workplace at `fromX` to take its goods. */
export function depotFor(world: World, fromX: number): Depot {
  const capacity = BUILDINGS.warehouse.storage;
  const find = (id: number) => warehouses(world).find((w) => w.id === id) ?? null;
  return {
    find(r) {
      let best: Building | null = null;
      for (const w of warehouses(world)) {
        if (room(w.stock, capacity, r) <= 0) continue;
        if (!best || Math.abs(xOf(world, w) - fromX) < Math.abs(xOf(world, best) - fromX)) best = w;
      }
      return best?.id ?? null;
    },
    spot(id, r) {
      const wh = find(id);
      return wh ? warehouseSpot(world, wh, r, fromX, false) : null;
    },
    put(id, load) {
      const wh = find(id);
      const n = wh ? Math.min(load.amount, room(wh.stock, capacity, load.resource)) : 0;
      if (wh) wh.stock[load.resource] += n;
      // it filled up while they walked: whatever doesn't fit goes to the next one with room
      if (n < load.amount) putAway(world, { resource: load.resource, amount: load.amount - n }, fromX);
    },
  };
}
