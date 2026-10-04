// The village economy. The village's materials are whatever its warehouses
// hold: builders fetch wood, stone and planks from them for construction sites
// (site.ts), or straight from a woodcutter's or stonecutter's hut when that is
// nearer (materialSource), and serfs carry goods between the warehouses and the buildings
// that make or use them (transport.ts). Every store keeps each item in its
// own place (storeSlot), where it is picked up from and put down.

import { START_STOCK } from './balance';
import { BUILDINGS, doorOf, nextUpgrade, type BuildingType, storageOf } from './buildings';
import { DRINK_SLOTS, woodpileSlot, FARM_HORSE, marketSlot, reeveSlot, SMITHY_SLOTS, STABLE_SLOTS, WORKSHOP_DOOR, storehouseSlot, WORKSHOP_ALSO, WORKSHOP_IN, WORKSHOP_OUT, houseSlot, isYardItem, FEED_SLOTS, GOODS_SLOTS, HAY_SLOTS, BAKERY_SLOTS, BAKERY_WATER_SLOTS, WELL_SLOTS, BASKET, MILL_SLOTS, SACK, SAWMILL_SLOTS, STONECUTTER_SLOTS, TAVERN_SLOTS, SHEAF_SLOTS, STAND_Y, PILE_UNIT, warehouseSlot, WOODCUTTER_SLOTS, type Slot, type Spot } from './layout';
import { goodsOf } from './livestock';
import { room, RESOURCES, shortfall, stockOf, type Amounts, type Load, type Resource, type Stock } from './resources';
import { takeFromPile, type Pile } from './piles';
import { fellsForWood, owed } from './site';
import { streetDist } from './streets';
import { errandResource, type Free } from './transport';
import { delivering } from './worker';
import type { Building, World } from './world';

const WORKSHOP_DOOR_DX = WORKSHOP_DOOR.dx;

/** What the starting village's warehouse holds. */
export const WAREHOUSE_START: Stock = stockOf(START_STOCK);

const xOf = (_world: World, b: Building) => b.x;
/** How far building b is from world x, along the streets. */
const away = (world: World, b: Building, x: number) => streetDist(world, x, xOf(world, b));

/** Places the village keeps its goods: storage yards and storehouses. */
export const isStore = (b: { type: BuildingType }) => b.type === 'warehouse' || b.type === 'storehouse';

/** Finished warehouses: storage yards and storehouses (the transport hub is the oldest yard: transport.ts). */
export function warehouses(world: World): Building[] {
  return world.buildings.filter((b) => isStore(b) && b.status === 'done');
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

/** Whether builders can fetch r from b: a finished warehouse, or a finished building that makes r (a woodcutter's hut for wood). */
const holdsFor = (b: Building, r: Resource) => b.status === 'done' && (isStore(b) || !!BUILDINGS[b.type].ships?.includes(r));

/**
 * What the village can still spend on a new building: in the warehouses, the
 * huts' stores and the piles on the ground (builders fetch from all three),
 * plus what serfs are carrying off the ground or into a warehouse, and not
 * yet promised.
 */
export function available(world: World): Stock {
  const have = stockOf();
  for (const b of world.buildings) for (const r of RESOURCES) if (holdsFor(b, r)) have[r] += b.stock[r];
  for (const p of world.piles) have[p.resource] += p.amount;
  for (const p of world.people) {
    const w = p.job?.worker;
    const job = w && delivering(w);
    if (!w?.carrying || !job || !errandResource(job.action)) continue;
    // off the ground, or on its way into a warehouse (out of a hut's store)
    if (job.action.startsWith('collect-') || world.buildings.some((o) => o.id === job.to && isStore(o))) have[w.carrying.resource] += w.carrying.amount;
  }
  const promised = committed(world);
  for (const r of RESOURCES) have[r] = Math.max(0, have[r] - promised[r]);
  return have;
}

/**
 * What the village still lacks to start this building (empty when it can). A
 * woodcutter's hut never lacks wood: its builders fell trees for what there is
 * none of (site.ts fellsForWood).
 */
export function buildShortfall(world: World, type: BuildingType): Amounts {
  const lack = shortfall(available(world), BUILDINGS[type].cost);
  if (fellsForWood({ type, status: 'constructing' })) delete lack.wood;
  return lack;
}

/** What the village still lacks to upgrade this building (empty when it can). */
export function upgradeShortfall(world: World, b: Building): Amounts {
  return shortfall(available(world), nextUpgrade(b)?.cost ?? {});
}

/**
 * Where a builder at x fetches r from: the nearest warehouse or building that
 * makes r (a woodcutter's hut for wood) with some in its store; at equal
 * distance the warehouse.
 */
export function materialSource(world: World, r: Resource, x: number, free: Free): Building | null {
  let best: Building | null = null;
  for (const b of world.buildings) {
    if (!holdsFor(b, r) || free(b, r) <= 1e-9) continue;
    const d = away(world, b, x);
    if (!best || d < away(world, best, x) || (d === away(world, best, x) && isStore(b) && !isStore(best))) best = b;
  }
  return best;
}

/** The nearest pile of r on the ground to x with some free to take, if any. */
export function nearestPile(world: World, r: Resource, x: number, free: Free): Pile | null {
  let best: Pile | null = null;
  for (const p of world.piles) {
    if (p.resource !== r || free(p, r) <= 1e-9) continue;
    if (!best || streetDist(world, x, p.x) < streetDist(world, x, best.x)) best = p;
  }
  return best;
}

/** Take up to `amount` of r out of a warehouse; returns how much was taken. */
export function takeOut(warehouse: Building, r: Resource, amount: number): number {
  const n = Math.max(0, Math.min(amount, warehouse.stock[r]));
  warehouse.stock[r] -= n;
  return n;
}

/**
 * Take whatever there is of `amounts` out of the warehouses, nearest to x
 * first, then off the huts' stores and the piles on the ground; returns what was taken.
 */
export function takeFromWarehouses(world: World, amounts: Amounts, x: number): Stock {
  const got = stockOf();
  const near = [...warehouses(world)].sort((a, b) => away(world, a, x) - away(world, b, x));
  for (const r of RESOURCES) {
    for (const w of near) got[r] += takeOut(w, r, (amounts[r] ?? 0) - got[r]);
    for (const b of world.buildings) if (!isStore(b) && holdsFor(b, r)) got[r] += takeOut(b, r, (amounts[r] ?? 0) - got[r]);
    for (const p of [...world.piles]) if (p.resource === r) got[r] += takeFromPile(world, p, (amounts[r] ?? 0) - got[r]);
  }
  return got;
}

/** Put a load into the warehouse nearest x that has room; returns how much fitted. */
export function putAway(world: World, load: Load, x: number): number {
  const fits = warehouses(world)
    .filter((w) => room(w.stock, storageOf(w), load.resource) > 0)
    .sort((a, b) => away(world, a, x) - away(world, b, x));
  let left = load.amount;
  for (const w of fits) {
    const n = Math.min(left, room(w.stock, storageOf(w), load.resource));
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
  // a yard keeps only what it has piles for (no water, hay or the animals' goods)
  if (b.type === 'warehouse') return isYardItem(r) ? { unit: PILE_UNIT, perTrip: 1, slot: (i) => warehouseSlot(r, i, b.size ?? 1) } : null;
  if (b.type === 'storehouse') {
    const k = Math.max(0, Object.keys(storageOf(b)).indexOf(r));
    return { unit: 1, perTrip: 1, slot: (i) => storehouseSlot(k, i) };
  }
  if (b.type === 'house' && storageOf(b)[r]) {
    const door = doorOf('house', b.size ?? 1)!.dx;
    return { unit: 1, perTrip: 1, slot: (i) => ({ dx: door + houseSlot(r, i).dx, lift: 0 }) };
  }
  if (b.type === 'farm' && r === 'grain') return { unit: 1, perTrip: 1, slot: pick(SHEAF_SLOTS) };
  if (b.type === 'farm' && r === 'hay') return { unit: 1, perTrip: 1, slot: pick(HAY_SLOTS) };
  if (b.type === 'farm' && r === 'horse') return { unit: 1, perTrip: 1, slot: () => FARM_HORSE };
  if (b.type === 'blacksmith' && (r === 'iron' || r === 'tools')) return { unit: 1, perTrip: 1, slot: pick(SMITHY_SLOTS[r]) };
  if (b.type === 'stable' && (r === 'horse' || r === 'harness' || r === 'hay')) return { unit: 1, perTrip: 1, slot: pick(STABLE_SLOTS[r]) };
  if (b.type === 'market') {
    const side = r === 'iron' || r === 'salt' ? 'sells' : 'buys';
    const kinds = side === 'sells' ? ['iron', 'salt'] : ['wool', 'cloth', 'cheese'];
    if (kinds.includes(r)) return { unit: 1, perTrip: 1, slot: (i) => marketSlot(side, kinds.indexOf(r), i) };
  }
  if (b.type === 'reeve' && storageOf(b)[r]) {
    const k = Object.keys(storageOf(b)).indexOf(r);
    return { unit: 1, perTrip: 1, slot: (i) => reeveSlot(k, i) };
  }
  const stock = BUILDINGS[b.type].livestock;
  if (stock) {
    const def = BUILDINGS[b.type];
    if (r === stock.feed) return { unit: 1, perTrip: 1, slot: pick(FEED_SLOTS) };
    if (r === 'water') return { unit: 1, perTrip: 1, slot: pick(DRINK_SLOTS) };
    // what the animals give, side by side right of the door, each kind after the one before (livestock.ts goodsOf)
    const goods = goodsOf(def);
    const k = goods.indexOf(r);
    if (k >= 0) {
      const first = goods.slice(0, k).reduce((n, g) => n + (def.storage[g] ?? 0), 0);
      return { unit: 1, perTrip: 1, slot: pick(GOODS_SLOTS.slice(first)) };
    }
  }
  if (b.type === 'mill' && (r === 'grain' || r === 'flour')) return { unit: SACK, perTrip: 1, slot: pick(MILL_SLOTS[r]) };
  if (b.type === 'bakery' && r === 'flour') return { unit: SACK, perTrip: 1, slot: pick(BAKERY_SLOTS.flour) };
  if (b.type === 'bakery' && r === 'bread') return { unit: BASKET, perTrip: 1, slot: pick(BAKERY_SLOTS.bread) };
  if (b.type === 'bakery' && r === 'water') return { unit: 1, perTrip: 1, slot: pick(BAKERY_WATER_SLOTS) };
  if (b.type === 'well' && r === 'water') return { unit: 1, perTrip: 1, slot: pick(WELL_SLOTS) };
  if (b.type === 'tavern' && r === 'bread') return { unit: BASKET, perTrip: 1, slot: pick(TAVERN_SLOTS) };
  if (b.type === 'sawmill' && (r === 'wood' || r === 'planks' || r === 'firewood')) return { unit: 1, perTrip: 1, slot: pick(SAWMILL_SLOTS[r]) };
  if (r === 'firewood' && b.type !== 'sawmill' && storageOf(b).firewood) {
    const width = BUILDINGS[b.type].width * (b.size ?? 1);
    return { unit: 1, perTrip: 1, slot: (i) => woodpileSlot(width, i) };
  }
  if (b.type === 'woodcutter' && r === 'wood') return { unit: 1, perTrip: 1, slot: pick(WOODCUTTER_SLOTS) };
  if (b.type === 'stonecutter' && r === 'stone') return { unit: 1, perTrip: 1, slot: pick(STONECUTTER_SLOTS) };
  // the newer workshops' shared yard (layout.ts WORKSHOP_IN)
  const recipe = BUILDINGS[b.type].makes;
  if (recipe && BUILDINGS[b.type].door?.dx === WORKSHOP_DOOR_DX) {
    if (r === recipe.from) return { unit: 1, perTrip: 1, slot: pick(WORKSHOP_IN) };
    if (r === recipe.also?.resource) return { unit: 1, perTrip: 1, slot: pick(WORKSHOP_ALSO) };
    if (r === recipe.to) return { unit: 1, perTrip: 1, slot: pick(WORKSHOP_OUT) };
  }
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
