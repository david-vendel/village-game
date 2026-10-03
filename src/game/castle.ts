// The castle on the hill. Its lord sends the village requests, one at a time
// (CASTLE_REQUESTS in balance.ts, then the last repeating, larger each time):
// goods to gather at the reeve's house by a day. Serfs bring them there like
// anything a building needs (wantsOf, transport.ts); once all are there they
// go up to the castle and the village earns a charter and coin, and its
// standing rises. Missed, the request lapses and standing falls.
//
// Charters unlock: each building or upgrade with a `charter` needs that many
// (whyLocked). The village's coin (World.treasury) comes from the castle,
// burghers' taxes (households.ts) and the merchant (market.ts).

import { CASTLE_REQUESTS, CASTLE_GAP_DAYS } from './balance';
import { BUILDINGS, nextUpgrade, type BuildingType } from './buildings';
import { clock } from './daynight';
import { RESOURCES, type Amounts, type Resource } from './resources';
import type { Building, World } from './world';

/** What the castle asks for: the goods, by which day, and what it gives for them. */
export interface Request {
  goods: Amounts;
  due: number;
  coin: number;
}

export interface Castle {
  request: Request | null;
  /** Charters earned: each request met is one. */
  charters: number;
  /** How the castle sees the village: up a point for each request met, down for each missed. */
  standing: number;
  /** The day the next request comes down. */
  nextOn: number;
  /** How many requests have come down so far. */
  asked: number;
}

export const newCastle = (): Castle => ({ request: null, charters: 0, standing: 0, nextOn: 2, asked: 0 });

/** The reeve's house, if the village has one. */
export const reeveOf = (world: World): Building | undefined => world.buildings.find((b) => b.type === 'reeve' && b.status === 'done');

/** What the castle still lacks at the reeve's house for its request. */
export function stillAsked(world: World): Amounts {
  const req = world.castle.request;
  const reeve = reeveOf(world);
  if (!req) return {};
  const out: Amounts = {};
  for (const r of Object.keys(req.goods) as Resource[]) {
    const n = (req.goods[r] ?? 0) - (reeve?.stock[r] ?? 0);
    if (n > 0) out[r] = n;
  }
  return out;
}

/** Why the lord may not build this yet (too few charters, or one already stands), or null. */
export function whyLocked(world: World, type: BuildingType): string | null {
  const def = BUILDINGS[type];
  if ((def.charter ?? 0) > world.castle.charters) return `Needs ${def.charter} charter${def.charter === 1 ? '' : 's'} from the castle`;
  if (def.unique && world.buildings.some((b) => b.type === type)) return `There is a ${def.name} already`;
  return null;
}

/** Why this building may not be upgraded yet for want of charters, or null. */
export function upgradeLocked(world: World, b: Building): string | null {
  const c = nextUpgrade(b)?.charter ?? 0;
  return c > world.castle.charters ? `Needs ${c} charter${c === 1 ? '' : 's'} from the castle` : null;
}

/** The request the castle sends the n-th time (0 first): the authored ones, then the last, larger each time. */
function requestFor(n: number, today: number): Request {
  const list = CASTLE_REQUESTS;
  const base = list[Math.min(n, list.length - 1)];
  const more = Math.max(0, n - list.length + 1);
  const goods: Amounts = {};
  for (const r of RESOURCES) if (base.goods[r]) goods[r] = Math.ceil(base.goods[r]! * (1 + 0.5 * more));
  return { goods, due: today + base.days, coin: base.coin * (1 + more) };
}

/** Requests come down, are met, or lapse. */
export function updateCastle(world: World): void {
  const c = world.castle;
  const today = clock(world).day;
  if (!c.request) {
    // the castle sends word once there is a reeve to receive it
    if (today >= c.nextOn && reeveOf(world)) {
      c.request = requestFor(c.asked, today);
      c.asked++;
    }
    return;
  }
  const reeve = reeveOf(world);
  if (reeve && Object.keys(stillAsked(world)).length === 0) {
    // all there: up to the castle it goes
    for (const r of Object.keys(c.request.goods) as Resource[]) reeve.stock[r] -= c.request.goods[r] ?? 0;
    world.treasury += c.request.coin;
    c.charters++;
    c.standing++;
    c.request = null;
    c.nextOn = today + CASTLE_GAP_DAYS;
    world.events.push({ kind: 'charter', buildingId: reeve.id });
  } else if (today > c.request.due) {
    c.standing--;
    c.request = null;
    c.nextOn = today + CASTLE_GAP_DAYS;
  }
}
