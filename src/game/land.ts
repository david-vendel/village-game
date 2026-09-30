// The land grid: who uses each cell of the street (see CELL_W in layout.ts).
// Buildings claim the cells of their footprint the moment they are placed.
// Farms then take the free cells around them for fields: behind the road only
// up to the next building, in front of the road any land within reach that is
// closer to them than to another farm — including the land in front of the
// neighbouring lots, which a farm borrows only when its own land is all in use.
// Where a road runs off at a crossroads, no field is sown across it: a
// crossroads covers its cells on both of its streets, behind the road and in front of it.

import { BUILDINGS } from './buildings';
import { fieldSpots, footprintHalfCells, setFieldSpots, type FieldSpot } from './farm';
import { employees } from './people';
import { CELL_W, FIELD_REACH, FIELD_ROWS, GRID_X0, type FieldZone } from './layout';
import { crossings, SIDE_ROAD_HALF } from './streets';
import type { Building, World } from './world';

export type CellUse =
  | { kind: 'free' }
  | { kind: 'building'; buildingId: number }
  | { kind: 'field'; buildingId: number }
  /** Land a farm may farm but that is still grass (not tilled yet, or borrowed and resting). */
  | { kind: 'spare'; buildingId: number };

export interface LandGrid {
  /** Number of cells along the street. */
  count: number;
  /** One row of cells per field row (see FIELD_ROWS), back zone first, each far to near. */
  rows: Array<{ zone: FieldZone; row: number; cells: CellUse[] }>;
}

/** Index of the cell containing world x. */
export function cellAt(x: number): number {
  return Math.floor((x - GRID_X0) / CELL_W);
}

/** World x of the left edge of cell k. */
export function cellX(k: number): number {
  return GRID_X0 + k * CELL_W;
}

/** Cells a building covers, [from, to). Footprints are centred on the plot and rounded up to whole cells. */
export function footprint(world: World, b: Building): { from: number; to: number } {
  const centre = cellAt(world.plots[b.plotIndex].x + 0.5);
  const n = footprintHalfCells(BUILDINGS[b.type].width);
  return { from: centre - n, to: centre + n };
}

function buildingCells(world: World): Array<number | null> {
  const count = cellAt(world.plots[world.plots.length - 1].x) + 20;
  const cells: Array<number | null> = new Array(count).fill(null);
  const cover = (from: number, to: number, id: number) => {
    for (let k = Math.max(0, from); k < Math.min(count, to); k++) cells[k] = id;
  };
  for (const b of world.buildings) {
    const { from, to } = footprint(world, b);
    cover(from, to, b.id);
  }
  // a crossroads stands on the street it leads to as well
  const n = footprintHalfCells(BUILDINGS.intersection.width);
  for (const c of crossings(world)) cover(cellAt(c.x + 0.5) - n, cellAt(c.x + 0.5) + n, c.buildingId);
  return cells;
}

/** Cells in front of the road that a road running off at a crossroads crosses. */
function roadCells(world: World, count: number): boolean[] {
  const road = new Array<boolean>(count).fill(false);
  const xs = [...crossings(world).map((c) => c.x), ...world.buildings.filter((b) => b.type === 'intersection').map((b) => world.plots[b.plotIndex].x)];
  for (const x of xs) {
    for (let k = Math.max(0, cellAt(x - SIDE_ROAD_HALF * 1.6)); k <= Math.min(count - 1, cellAt(x + SIDE_ROAD_HALF * 1.6)); k++) road[k] = true;
  }
  return road;
}

/** The farm that should work a free cell: the nearest one within reach, if any. */
function farmFor(world: World, farms: Building[], zone: FieldZone, k: number, built: Array<number | null>): Building | null {
  const mid = cellX(k) + CELL_W / 2;
  let best: Building | null = null;
  let bestD = FIELD_REACH[zone];
  for (const f of farms) {
    const fx = world.plots[f.plotIndex].x;
    const d = Math.abs(mid - fx);
    if (d > bestD) continue;
    // behind the road a field never reaches past another building
    if (zone === 'back') {
      const [a, b] = mid < fx ? [k, cellAt(fx)] : [cellAt(fx), k];
      let blocked = false;
      for (let j = a + 1; j < b; j++) if (built[j] !== null && built[j] !== f.id) blocked = true;
      if (blocked) continue;
    }
    if (d < bestD || (d === bestD && best && f.plotIndex < best.plotIndex)) {
      best = f;
      bestD = d;
    }
  }
  return best;
}

function ownerGrid(world: World): { built: Array<number | null>; owner: Record<FieldZone, Array<number | null>> } {
  const built = buildingCells(world);
  const farms = world.buildings.filter((b) => b.type === 'farm');
  const owner: Record<FieldZone, Array<number | null>> = { back: [], front: [] };
  const road = roadCells(world, built.length);
  for (const zone of ['back', 'front'] as const) {
    owner[zone] = built.map((id, k) => ((zone === 'back' && id !== null) || (zone === 'front' && road[k]) ? null : farmFor(world, farms, zone, k, built)?.id ?? null));
  }
  return { built, owner };
}

/** Field plots a farm gets from the land around it right now. */
export function farmFieldSpots(world: World, farm: Building): FieldSpot[] {
  const { owner } = ownerGrid(world);
  const centre = cellAt(world.plots[farm.plotIndex].x + 0.5);
  return fieldSpots((zone, c) => owner[zone][centre + c] === farm.id);
}

/** Re-lay every finished farm's fields after the land changed (a building was placed). */
export function syncFarmFields(world: World): void {
  for (const b of world.buildings) {
    if (b.farm) setFieldSpots(b.farm, farmFieldSpots(world, b), employees(world, b).filter((p) => p.job!.role === 'farmer').map((p) => p.job!.worker));
  }
}

/**
 * Every cell's use, for display (the grid overlay). Behind the road buildings
 * stand on the cells; field cells are those inside a farm's plots.
 */
export function landGrid(world: World): LandGrid {
  const built = buildingCells(world);
  const count = built.length;
  const rows = (Object.keys(FIELD_ROWS) as FieldZone[]).flatMap((zone) =>
    FIELD_ROWS[zone].map((_, row) => ({
      zone,
      row,
      cells: built.map((id): CellUse => (zone === 'back' && id !== null ? { kind: 'building', buildingId: id } : { kind: 'free' })),
    })),
  );
  for (const b of world.buildings) {
    if (b.type !== 'farm') continue;
    const farm = b.farm;
    const spots = farm?.plots ?? farmFieldSpots(world, b);
    const fx = world.plots[b.plotIndex].x;
    spots.forEach((s, i) => {
      const cells = rows.find((r) => r.zone === s.zone && r.row === s.row)!.cells;
      const kind = farm?.plots[i].tilled ? 'field' : 'spare';
      for (let k = cellAt(fx + s.dx - s.width / 2 + 0.5); k < cellAt(fx + s.dx + s.width / 2 - 0.5) + 1; k++) {
        if (k >= 0 && k < count) cells[k] = { kind, buildingId: b.id };
      }
    });
  }
  return { count, rows };
}
