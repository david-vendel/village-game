// The market and its merchant. Every MARKET.everyDays days, through the
// daylight hours, a merchant stands at the market. Serfs bring the village's
// surplus there (wool, cloth, cheese the stores hold more than MARKET.keep of:
// wantsOf, transport.ts), and he buys what lies on the stall, an item every
// game hour, for coin (World.treasury). He sells iron (the blacksmith's) and
// salt (the smokehouse's) onto the other stall while there is coin to pay,
// and serfs carry them on from there (BuildingDef.ships).

import { MARKET } from './balance';
import { storageOf } from './buildings';
import { clock, isWorkTime } from './daynight';
import { villageStock } from './economy';
import { room, type Resource } from './resources';
import type { Building, World } from './world';

/** Whether the merchant is at the market now. */
export function merchantHere(world: World): boolean {
  return clock(world).day % MARKET.everyDays === 0 && isWorkTime(world);
}

/** What the market wants brought for the merchant: the surplus the stores hold. */
export function marketWants(world: World): Resource[] {
  const have = villageStock(world);
  return (Object.keys(MARKET.buys) as Resource[]).filter((r) => have[r] > MARKET.keep);
}

/** The merchant's trading, an item an hour of each kind, from the hour clock at `before`. */
export function updateMarkets(world: World, before: number): void {
  if (!merchantHere(world)) return;
  const hour = (c: number) => Math.floor(c / (300 / 24));
  const n = hour(world.dayClock) - hour(before);
  if (n <= 0) return;
  for (const b of world.buildings) if (b.type === 'market' && b.status === 'done') for (let i = 0; i < n; i++) trade(world, b);
}

function trade(world: World, b: Building): void {
  // he buys an item of each kind on the stall
  for (const [r, price] of Object.entries(MARKET.buys) as Array<[Resource, number]>) {
    if (b.stock[r] >= 1) {
      b.stock[r] -= 1;
      world.treasury += price;
    }
  }
  // and sells an item of each where the stall has room and the village can pay
  const capacity = storageOf(b);
  for (const [r, price] of Object.entries(MARKET.sells) as Array<[Resource, number]>) {
    if (room(b.stock, capacity, r) >= 1 && world.treasury >= price) {
      b.stock[r] += 1;
      world.treasury -= price;
    }
  }
}
