// The farms' fields on the land grid (grid.ts). A field is one cell. A farm
// works the free cells nearest to it: in the two rows of lots beside it, in
// the verge between the lots and the road, and in the two rows in front of
// the road (layout.ts FIELD_ROW_J), up to FIELD_REACH cells to either side. A
// cell between two farms goes to the nearer one. Each farm keeps its nearest
// FIELD_CELLS of them (more once upgraded, for its second farmer).
//
// The verge in front of a building is its doorstep and is left free, but a
// farm's own verge is sown too, all but the cell in front of its door. Fields
// give way: when something is built on one, or a road runs over it, the farm
// gets the next nearest free cell instead (syncFarmFields).

import { setFieldSpots, type FieldSpot } from './farm';
import { alongCell, baseLand, cellKey, footprintOf, streetCell } from './grid';
import { employees } from './people';
import { CELL_W, FIELD_ROW_J, HOME, VERGE_ROW, type FieldZone } from './layout';
import { streetOf } from './streets';
import type { Building, World } from './world';

/** How many cells either side of the farmstead its fields may lie. */
export const FIELD_REACH = 8;
/** Fields a farm works: as many as its farmers can keep up with. */
export const FIELD_CELLS = { base: 24, upgraded: 40 };

/** Verge cells left free: the doorstep of every building but a farm, and a farm's door. */
function doorsteps(world: World): Set<string> {
  const out = new Set<string>();
  for (const b of world.buildings) {
    const f = footprintOf(b);
    const s = world.streets[streetOf(b.x)];
    if (!f || !s || b.type === 'intersection') continue;
    const add = (i: number) => {
      const c = streetCell(s, i, VERGE_ROW);
      out.add(cellKey(c.c, c.r));
    };
    if (b.type === 'farm') add(alongCell(b.x + HOME.dx));
    else for (let i = f.i0; i <= f.i1; i++) add(i);
  }
  return out;
}

/** Each farm's fields from the land as it is now: which cells, as field spots around the farm. */
function allFields(world: World): Map<number, FieldSpot[]> {
  const land = baseLand(world);
  const steps = doorsteps(world);
  const farms = world.buildings.filter((b) => b.type === 'farm' && b.status === 'done');
  /** cell → the nearest farm's claim on it */
  const claims = new Map<string, { farm: Building; spot: FieldSpot; d: number }>();
  for (const farm of farms) {
    const f = footprintOf(farm);
    const s = world.streets[streetOf(farm.x)];
    if (!f || !s) continue;
    const mid = { i: (f.i0 + f.i1 + 1) / 2, j: (f.j0 + f.j1 + 1) / 2 };
    for (const zone of ['back', 'front'] as FieldZone[]) {
      FIELD_ROW_J[zone].forEach((j, row) => {
        for (let i = f.i0 - FIELD_REACH; i <= f.i1 + FIELD_REACH; i++) {
          const c = streetCell(s, i, j);
          const key = cellKey(c.c, c.r);
          if (land.has(key) || steps.has(key)) continue;
          const d = Math.hypot(i + 0.5 - mid.i, j + 0.5 - mid.j);
          const had = claims.get(key);
          if (had && (had.d < d || (had.d === d && had.farm.id < farm.id))) continue;
          claims.set(key, { farm, spot: { zone, row, dx: (i + 0.5 - mid.i) * CELL_W, width: CELL_W }, d });
        }
      });
    }
  }
  const out = new Map<number, FieldSpot[]>();
  for (const farm of farms) {
    const mine = [...claims.values()].filter((c) => c.farm === farm).sort((a, b) => a.d - b.d);
    const n = farm.upgraded ? FIELD_CELLS.upgraded : FIELD_CELLS.base;
    out.set(farm.id, mine.slice(0, n).map((c) => c.spot));
  }
  return out;
}

/** Field spots a farm gets from the land around it right now. */
export function farmFieldSpots(world: World, farm: Building): FieldSpot[] {
  if (farm.status !== 'done') return [];
  return allFields(world).get(farm.id) ?? [];
}

/** Re-lay every finished farm's fields after the land changed (something was built, pulled down, or a road laid). */
export function syncFarmFields(world: World): void {
  const all = allFields(world);
  for (const b of world.buildings) {
    if (b.farm) setFieldSpots(b.farm, all.get(b.id) ?? [], employees(world, b).filter((p) => p.job!.role === 'farmer').map((p) => p.job!.worker));
  }
}
