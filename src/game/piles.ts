// Things left lying on the ground at the side of the road: any resource, in
// any amount, anywhere along any street (what a pulled-down building leaves
// behind, say). Each pile is tracked and saved; serfs carry them, a load at a
// time, to wherever that resource is wanted or else to a warehouse
// (transport.ts), and a pile is gone once the last of it has been picked up.

import { STAND_Y, PILE_UNIT, type Spot } from './layout';
import type { Load, Resource } from './resources';
import type { World } from './world';

export interface Pile {
  id: number;
  /** World x (which street, and how far along it). */
  x: number;
  resource: Resource;
  amount: number;
}

/** Depth (world y) piles lie at: just in front of the building line, at the edge of the road. */
export const GROUND_PILE_Y = STAND_Y + 8;
/** How much one person carries off a pile at a time: an item. */
export const GROUND_LOAD = PILE_UNIT;
/** Piles of different things put down together lie this far apart (px). */
export const PILE_GAP = 26;
/** A load put down this close to a pile of the same thing goes onto it. */
const MERGE = 10;

export const pileById = (world: World, id: number | undefined): Pile | undefined => world.piles.find((p) => p.id === id);

/** Put a load down on the ground at world x, onto a pile of the same thing there if there is one. */
export function dropOnGround(world: World, x: number, load: Load): void {
  if (load.amount <= 1e-9) return;
  const near = world.piles.find((p) => p.resource === load.resource && Math.abs(p.x - x) < MERGE);
  if (near) near.amount += load.amount;
  else world.piles.push({ id: world.nextId++, x, resource: load.resource, amount: load.amount });
}

/** Take up to `amount` off a pile (it is gone once empty); returns how much was taken. */
export function takeFromPile(world: World, pile: Pile, amount: number): number {
  const n = Math.max(0, Math.min(amount, pile.amount));
  pile.amount -= n;
  if (pile.amount <= 1e-9) world.piles = world.piles.filter((p) => p !== pile);
  return n;
}

/** Where someone stands to pick up from a pile, relative to fromX. */
export const pileSpot = (pile: Pile, fromX: number): Spot => ({ dx: pile.x - fromX, y: GROUND_PILE_Y + 3 });
