// Households: every villager has a home, a house (the monks the chapel), and a
// home's household eats and drinks from its own store, the shelf by its door
// (houseSlot in layout.ts). What it needs (NEEDS in
// balance.ts, per person per day) serfs bring like anything a building needs
// (BuildingDef.needs, transport.ts).
//
// A household is content as far as its needs are met, and its contentment
// follows that over about a day. Content, with room in the house: a newcomer
// comes out of its door every HOUSEHOLD.growDays. Discontent (below
// HOUSEHOLD.leaveBelow): people leave one by one, a person every
// HOUSEHOLD.leaveDays from the unhappiest such household in the village: they
// put down their work, walk to the end of the street they are on and are gone.
// An empty house waits for new people. The monks live and leave the same
// way, but no newcomers come out of the chapel.
//
// People without a home (a house pulled down, or new to the village) move into
// the nearest house with room as soon as there is one.

import { WINTER_FIRE, CHAPEL_REACH, CHAPEL_RESIDENTS, FARMSTEAD_EXTRA, HOUSE_RESIDENTS, HOUSEHOLD, NEEDS, TAX_PER_DAY, TOWNHOUSE_EXTRA, type Need } from './balance';
import { upgradesDone } from './buildings';
import { isWinter, timeOfDay } from './daynight';
import { release, type Person } from './people';
import type { Resource } from './resources';
import { streetDist, streetOf, streetRange } from './streets';
import type { Building, World } from './world';

/** A house's family: how content it is (0..1), what it is still owed of each need, and its clocks (days) for growing and losing people. */
export interface Household {
  content: number;
  /** By need (its goods joined with |). */
  owed: Record<string, number>;
  growIn: number;
  leaveIn: number;
}

/** What a household needs, per person per day, by its house's level (the monks theirs). */
export const householdNeeds = (b: Building): Need[] =>
  b.type === 'chapel' ? NEEDS.chapel : [NEEDS.cottage, NEEDS.farmstead, NEEDS.townhouse][Math.min(2, upgradesDone(b))];
/** A need's key in what a household is owed. */
const keyOf = (n: Need) => n.goods.join('|');

/** How many people a home holds: a merged house as many as all its parts. */
export const roomIn = (b: Building) => b.type === 'chapel' ? CHAPEL_RESIDENTS : (HOUSE_RESIDENTS + [0, FARMSTEAD_EXTRA, TOWNHOUSE_EXTRA][Math.min(2, upgradesDone(b))]) * (b.size ?? 1);

/** Whether a townhouse has the chapel within reach (its burghers want it); other houses don't ask. */
export function chapelNear(world: World, b: Building): boolean {
  if (upgradesDone(b) < 2) return true;
  return world.buildings.some((c) => c.type === 'chapel' && c.status === 'done' && streetDist(world, b.x, c.x) <= CHAPEL_REACH);
}

/** Whether b is somewhere people live: a house, or the chapel (the monks'). */
export const isHome = (b: Building) => (b.type === 'house' || b.type === 'chapel') && b.status === 'done';
const homes = (world: World) => world.buildings.filter(isHome);
/** Who lives in house b (not counting anyone already on their way out). */
export const residentsOf = (world: World, b: Building): Person[] => world.people.filter((p) => p.home === b.id && !p.leaving);
/** Whether home b is for p: the chapel for the monks, a house for everyone else. */
const homeFor = (p: Person, b: Building) => (b.type === 'chapel') === (p.look === 'monk');

/** A house's household, made when first asked for: content to start with. */
export function householdOf(b: Building): Household {
  return (b.household ??= { content: 1, owed: {}, growIn: 0, leaveIn: 0 });
}

/** What a household lacks right now: needs it is owed a whole item of and has none of (the first of their goods). */
export function lacking(b: Building): Resource[] {
  const h = householdOf(b);
  return householdNeeds(b).filter((n) => (h.owed[keyOf(n)] ?? 0) >= 1 && n.goods.every((r) => b.stock[r] < 1)).map((n) => n.goods[0]);
}

/** Give the homeless a home: the nearest house with room. */
function settle(world: World): void {
  const all = homes(world);
  const ids = new Set(all.map((b) => b.id));
  for (const p of world.people) {
    if (p.leaving || (p.home !== undefined && ids.has(p.home))) continue;
    delete p.home;
    const x = p.job ? (world.buildings.find((b) => b.id === p.job!.buildingId)?.x ?? p.stroll.x) : p.stroll.x;
    const free = all.filter((b) => homeFor(p, b) && residentsOf(world, b).length < roomIn(b)).sort((a, b) => streetDist(world, x, a.x) - streetDist(world, x, b.x));
    if (free[0]) p.home = free[0].id;
  }
}

/** Someone leaves the village: they put down their work and walk off down the street. */
function leave(world: World, p: Person): void {
  if (p.job) release(world, p);
  delete p.home;
  p.leaving = true;
  const { min, max } = streetRange(world, streetOf(p.stroll.x));
  p.stroll.dir = p.stroll.x - min < max - p.stroll.x ? -1 : 1;
  p.stroll.idle = 0;
}

/** Those leaving who have reached the end of their street are gone. */
function gone(world: World): void {
  world.people = world.people.filter((p) => {
    if (!p.leaving || p.job) return true;
    const { min, max } = streetRange(world, streetOf(p.stroll.x));
    return p.stroll.x > min + 1 && p.stroll.x < max - 1;
  });
}

/** A day's eating and drinking, contentment, newcomers and leavers, for dt seconds. */
export function updateHouseholds(world: World, dt: number, moveIn: (b: Building, n: number) => void): void {
  const days = (dt * timeOfDay(world).hoursPerSecond) / 24;
  settle(world);
  const winter = isWinter(world);
  // the unhappiest discontent household is the one people leave from next
  const discontent = homes(world).filter((b) => residentsOf(world, b).length && householdOf(b).content < HOUSEHOLD.leaveBelow);
  const unhappiest = discontent.sort((a, b) => householdOf(a).content - householdOf(b).content)[0];
  for (const b of homes(world)) {
    const h = householdOf(b);
    const people = residentsOf(world, b);
    const needs = householdNeeds(b);
    let met = 0;
    for (const n of needs) {
      // owed builds up as they eat and drink, and is paid off the shelf an item at a time, of whichever good there is
      const k = keyOf(n);
      // a winter fire burns twice the wood
      const cold = winter && n.goods.includes('firewood') ? WINTER_FIRE : 1;
      h.owed[k] = Math.min(2, (h.owed[k] ?? 0) + people.length * n.perDay * cold * days);
      for (let r = n.goods.find((g) => b.stock[g] >= 1); h.owed[k] >= 1 && r; r = n.goods.find((g) => b.stock[g] >= 1)) {
        b.stock[r] -= 1;
        h.owed[k] -= 1;
      }
      if (h.owed[k] < 1) met++;
    }
    // burghers want the chapel near too
    const wants = needs.length + (upgradesDone(b) >= 2 ? 1 : 0);
    if (upgradesDone(b) >= 2 && chapelNear(world, b)) met++;
    const share = people.length ? met / wants : 1;
    // content burghers pay their taxes
    if (upgradesDone(b) >= 2 && h.content >= 0.5) world.treasury += people.length * TAX_PER_DAY * days;
    h.content += (share - h.content) * Math.min(1, days * HOUSEHOLD.settleRate);

    // content, with room: a newcomer before long
    if (b.type === 'house' && people.length && h.content >= HOUSEHOLD.growAbove && people.length < roomIn(b) && !b.arriving) {
      h.growIn += days;
      if (h.growIn >= HOUSEHOLD.growDays) {
        h.growIn = 0;
        moveIn(b, 1);
      }
    } else h.growIn = 0;

    // discontent: one leaves, then another, until the rest are content again
    if (b === unhappiest) {
      h.leaveIn += days;
      if (h.leaveIn >= HOUSEHOLD.leaveDays) {
        h.leaveIn = 0;
        // the one with least to keep them: out of work before those in work
        leave(world, [...people].sort((p, q) => Number(!!p.job) - Number(!!q.job))[0]);
      }
    } else h.leaveIn = 0;
  }
  gone(world);
}
