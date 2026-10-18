// Laying road. A road piece (the `road` building, world.ts roadEnd) is
// ROAD_PIECE parcels of road past a street's end, laid one parcel at a time:
// builders fetch the wood, a log each, and put it down in a heap at the end
// of the road; one of them lays the first parcel of grass into road with what
// lies there, walks on to the next and lays that, and so on. Each parcel is part of the street as soon as it
// is laid (world.ts syncRoads): the road, and the rider, go on along it while
// the rest is still being laid.

import { BUILDINGS } from './buildings';
import { PLOT_SPACING, STREET_LINE_Y } from './layout';
import { RESOURCES, total } from './resources';
import { siteWorkplace } from './site';
import type { JobTicket, Workplace } from './worker';
import type { Building, World } from './world';

/** Parcels (plots, blocks of three cells) a road piece lays a street on by. */
export const ROAD_PIECE = 9;

/** Parcels of a road piece laid so far (each is a ROAD_PIECE-th of its progress). */
export const parcelsLaid = (b: Building) => Math.min(ROAD_PIECE, Math.floor(b.progress * ROAD_PIECE + 1e-6));

/** dx from a road piece's x of the middle of its parcel k (0: the one next to where the road ended). */
export function parcelDx(b: Building, k: number): number {
  const step = b.road?.step ?? 1;
  return step * (-(ROAD_PIECE * PLOT_SPACING) / 2 + (k + 0.5) * PLOT_SPACING);
}

/** Where the heap of materials lies (dx): on the road, just short of the next parcel to be laid. */
export const heapDx = (b: Building) => parcelDx(b, parcelsLaid(b)) - (b.road?.step ?? 1) * 0.6 * PLOT_SPACING;

/** Builders stand on the road itself, in its middle. */
const ON_ROAD = STREET_LINE_Y;

/**
 * A road piece as a workplace for its builder: fetching (as at any site,
 * site.ts) puts the wood down at the heap; building lays the next parcel,
 * one at a time, with a ROAD_PIECE-th of the materials and of the labour.
 */
export function roadWorkplace(world: World, b: Building, buildSpeed: number): Workplace {
  const site = b.site!;
  const base = siteWorkplace(world, b, buildSpeed);
  const def = BUILDINGS[b.type];
  const heap = () => total(site.laid[0] ?? {});
  return {
    ...base,
    nextJob(w, taken: JobTicket[]) {
      // one parcel at a time, in order, by one builder, with what lies on the heap
      const k = parcelsLaid(b);
      const laying = taken.some((j) => j.action === 'build');
      if (heap() > 1e-9 && !laying && k < ROAD_PIECE) return { job: { action: 'build', target: k }, dx: parcelDx(b, k), y: ON_ROAD };
      // the others fetch the wood still needed, a log each (never building at the heap themselves)
      const next = base.nextJob(w, [...taken, { action: 'build', target: 0 }]);
      return next && next.job.action !== 'build' ? next : null;
    },
    begin(job) {
      if (job.action === 'build') return heap() > 1e-9 && job.target === parcelsLaid(b) ? def.buildTime / ROAD_PIECE / buildSpeed : null;
      return base.begin(job);
    },
    finish(job) {
      if (job.action !== 'build') return base.finish(job);
      const here = site.laid[0];
      const have = heap();
      if (!here || have <= 0) return null;
      const use = Math.min(have, total(def.cost) / ROAD_PIECE);
      for (const r of RESOURCES) here[r] -= (here[r] * use) / have;
      const k = job.target + 1;
      b.progress = k >= ROAD_PIECE ? 1 : k / ROAD_PIECE;
      return null;
    },
    dropSpot() {
      return { dx: heapDx(b), y: ON_ROAD };
    },
  };
}
