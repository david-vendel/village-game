// Households: every villager (but the monks, who live at the chapel) has a
// home, a house, and a house's family eats and drinks from its own store, the
// shelf by its door (HOUSE_SLOTS in layout.ts). What it needs (NEEDS in
// balance.ts, per person per day) serfs bring like anything a building needs
// (BuildingDef.needs, transport.ts).
//
// A household is content as far as its needs are met, and its contentment
// follows that over about a day. Content, with room in the house: a newcomer
// comes out of its door every HOUSEHOLD.growDays. Discontent (below
// HOUSEHOLD.leaveBelow): people leave one by one, a person every
// HOUSEHOLD.leaveDays from the unhappiest such household in the village: they
// put down their work, walk to the end of the street they are on and are gone.
// An empty house waits for new people.
//
// People without a home (a house pulled down, or new to the village) move into
// the nearest house with room as soon as there is one.

import { HOUSE_RESIDENTS, HOUSEHOLD, NEEDS } from './balance';
import { timeOfDay } from './daynight';
import { release, type Person } from './people';
import type { Resource } from './resources';
import { streetDist, streetOf, streetRange } from './streets';
import type { Building, World } from './world';

/** A house's family: how content it is (0..1), what it is still owed of each need, and its clocks (days) for growing and losing people. */
export interface Household {
  content: number;
  owed: Partial<Record<Resource, number>>;
  growIn: number;
  leaveIn: number;
}

/** What a household needs, per person per day. */
export const needsOf = (_b: Building) => NEEDS.cottage;

/** How many people a house holds: a merged one as many as all its parts. */
export const roomIn = (b: Building) => HOUSE_RESIDENTS * (b.size ?? 1);

const houses = (world: World) => world.buildings.filter((b) => b.type === 'house' && b.status === 'done');
/** Who lives in house b (not counting anyone already on their way out). */
export const residentsOf = (world: World, b: Building): Person[] => world.people.filter((p) => p.home === b.id && !p.leaving);
/** Whether p has a home to go to: everyone but the monks. */
const housed = (p: Person) => p.look !== 'monk';

/** A house's household, made when first asked for: content to start with. */
export function householdOf(b: Building): Household {
  return (b.household ??= { content: 1, owed: {}, growIn: 0, leaveIn: 0 });
}

/** What a household lacks right now: needs it is owed a whole item of and has none of. */
export function lacking(b: Building): Resource[] {
  const h = householdOf(b);
  return (Object.keys(needsOf(b)) as Resource[]).filter((r) => (h.owed[r] ?? 0) >= 1 && b.stock[r] < 1);
}

/** Give the homeless a home: the nearest house with room. */
function settle(world: World): void {
  const all = houses(world);
  const ids = new Set(all.map((b) => b.id));
  for (const p of world.people) {
    if (!housed(p) || p.leaving || (p.home !== undefined && ids.has(p.home))) continue;
    delete p.home;
    const x = p.job ? (world.buildings.find((b) => b.id === p.job!.buildingId)?.x ?? p.stroll.x) : p.stroll.x;
    const free = all.filter((b) => residentsOf(world, b).length < roomIn(b)).sort((a, b) => streetDist(world, x, a.x) - streetDist(world, x, b.x));
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
  // the unhappiest discontent household is the one people leave from next
  const discontent = houses(world).filter((b) => residentsOf(world, b).length && householdOf(b).content < HOUSEHOLD.leaveBelow);
  const unhappiest = discontent.sort((a, b) => householdOf(a).content - householdOf(b).content)[0];
  for (const b of houses(world)) {
    const h = householdOf(b);
    const people = residentsOf(world, b);
    const needs = needsOf(b);
    let met = 0;
    for (const [r, perDay] of Object.entries(needs) as Array<[Resource, number]>) {
      // owed builds up as they eat and drink, and is paid off the shelf an item at a time
      h.owed[r] = Math.min(2, (h.owed[r] ?? 0) + people.length * perDay * days);
      while ((h.owed[r] ?? 0) >= 1 && b.stock[r] >= 1) {
        b.stock[r] -= 1;
        h.owed[r]! -= 1;
      }
      if ((h.owed[r] ?? 0) < 1) met++;
    }
    const share = people.length ? met / Object.keys(needs).length : 1;
    h.content += (share - h.content) * Math.min(1, days * HOUSEHOLD.settleRate);

    // content, with room: a newcomer before long
    if (people.length && h.content >= HOUSEHOLD.growAbove && people.length < roomIn(b) && !b.arriving) {
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
