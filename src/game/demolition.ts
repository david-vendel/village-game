// Pulling a building down. Builders take it apart, standing at its work spots
// along the front (the way it was put up, in reverse), in half the labour it
// took to build. As it comes down, its materials are left lying on the ground
// in front of it (piles.ts), a share for every bit of work, for serfs to
// carry off; once it is down, the plot is free again (world.ts).

import { BUILDINGS } from './buildings';
import { STAND_Y } from './layout';
import { dropOnGround, PILE_GAP } from './piles';
import { RESOURCES, stockOf, type Amounts, type Stock } from './resources';
import { BUILD_CHUNK, workSpots } from './site';
import type { Workplace } from './worker';
import type { Building, World } from './world';

/** A building being pulled down: the labour it takes in all, the progress it came down from, and the materials still in it. */
export interface Demolition {
  work: number;
  from: number;
  left: Stock;
}

/** The materials in a building: what it cost (and its upgrade), or what was brought to its site so far. */
export function materialsIn(b: Building): Stock {
  const out = stockOf();
  const add = (a: Amounts) => {
    for (const r of RESOURCES) out[r] += a[r] ?? 0;
  };
  const def = BUILDINGS[b.type];
  if (b.status === 'done') add(def.cost);
  if (b.upgraded && def.upgrade) add(def.upgrade.cost);
  if (b.site) add(b.site.delivered);
  if (b.demolition) add(b.demolition.left);
  return out;
}

/** Seconds of labour to pull a building down: half what it took to build (as far as it got). */
export function demolitionWork(b: Building): number {
  const def = BUILDINGS[b.type];
  const built = def.buildTime * (b.status === 'done' ? 1 : b.progress);
  const upgrade = def.upgrade ? def.upgrade.buildTime * (b.upgraded ? 1 : b.site && b.status === 'done' ? b.progress : 0) : 0;
  return (built + upgrade) / 2;
}

/** Put amounts down on the ground in front of world x, a pile of each thing side by side. */
export function dropAll(world: World, x: number, amounts: Amounts): void {
  const kinds = RESOURCES.filter((r) => (amounts[r] ?? 0) > 1e-9);
  kinds.forEach((r, i) => dropOnGround(world, x + (i - (kinds.length - 1) / 2) * PILE_GAP, { resource: r, amount: amounts[r]! }));
}

/** Take `seconds` of labour off a building coming down, leaving that share of its materials on the ground. */
export function tearDown(world: World, b: Building, seconds: number): void {
  const d = b.demolition;
  if (!d || b.progress <= 0) return;
  const before = b.progress;
  b.progress = d.work > 0 ? Math.max(0, before - (seconds / d.work) * d.from) : 0;
  const share = b.progress <= 1e-9 ? 1 : (before - b.progress) / before;
  const out: Amounts = {};
  for (const r of RESOURCES) {
    out[r] = d.left[r] * share;
    d.left[r] -= out[r]!;
  }
  dropAll(world, b.x, out);
}

/** A building coming down, as a workplace for the builders taking it apart. */
export function demolitionWorkplace(world: World, b: Building): Workplace {
  const spots = workSpots(b.type);
  const front = { dx: 0, y: STAND_Y };
  return {
    dayLabour: true,
    allHours: true,
    temporary: true,
    walkSpeed: world.params.builderWalk,
    door: front,
    nextJob(w, taken) {
      if (b.progress <= 0) return null;
      // each at a spot of their own, the nearest free one
      const busy = new Set(taken.filter((j) => j.action === 'demolish').map((j) => j.target));
      let best = -1;
      spots.forEach((dx, k) => {
        if (!busy.has(k) && (best < 0 || Math.abs(dx - w.dx) < Math.abs(spots[best] - w.dx))) best = k;
      });
      return best < 0 ? null : { job: { action: 'demolish', target: best }, dx: spots[best], y: STAND_Y };
    },
    begin: () => (b.progress > 0 ? BUILD_CHUNK : null),
    finish() {
      tearDown(world, b, BUILD_CHUNK * world.params.buildSpeed);
      return null;
    },
    dropSpot: () => front,
    deliver() {},
  };
}
