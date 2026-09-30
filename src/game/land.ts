// The land grid: who uses each cell of the street (see CELL_W in layout.ts).
// Buildings claim the cells of their footprint the moment they are placed.
// Farms then take the free cells around them for fields: behind the road only
// up to the next building, in front of the road any land within reach that is
// closer to them than to another farm.

import { BUILDINGS } from './buildings';
import { fieldSpots, footprintHalfCells, setFieldSpots, type FieldSpot } from './farm';
import { CELL_W, FIELD_REACH, GRID_X0, type FieldZone } from './layout';
import type { Building, World } from './world';

export type CellUse = { kind: 'free' } | { kind: 'building'; buildingId: number } | { kind: 'field'; buildingId: number };

export interface LandGrid {
  /** Number of cells along the street. */
  count: number;
  back: CellUse[];
  front: CellUse[];
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
  for (const b of world.buildings) {
    const { from, to } = footprint(world, b);
    for (let k = Math.max(0, from); k < Math.min(count, to); k++) cells[k] = b.id;
  }
  return cells;
}

/** The farm that should work a free cell: the nearest one within reach, if any. */
function farmFor(world: World, farms: Building[], zone: FieldZone, k: number, built: Array<number | null>): Building | null {
  const mid = cellX(k) + CELL_W / 2;
  let best: Building | null = null;
  let bestD = FIELD_REACH;
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
  for (const zone of ['back', 'front'] as const) {
    owner[zone] = built.map((id, k) => (zone === 'back' && id !== null ? null : farmFor(world, farms, zone, k, built)?.id ?? null));
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
  for (const b of world.buildings) if (b.farm) setFieldSpots(b.farm, farmFieldSpots(world, b));
}

/** Every cell's use, for display (the grid overlay). Field cells are those inside a farm's plots. */
export function landGrid(world: World): LandGrid {
  const built = buildingCells(world);
  const count = built.length;
  const back: CellUse[] = built.map((id) => (id === null ? { kind: 'free' } : { kind: 'building', buildingId: id }));
  const front: CellUse[] = built.map(() => ({ kind: 'free' }));
  for (const b of world.buildings) {
    if (b.type !== 'farm') continue;
    const spots = b.farm?.plots ?? farmFieldSpots(world, b);
    const fx = world.plots[b.plotIndex].x;
    for (const s of spots) {
      const row = s.zone === 'back' ? back : front;
      for (let k = cellAt(fx + s.dx - s.width / 2 + 0.5); k < cellAt(fx + s.dx + s.width / 2 - 0.5) + 1; k++) {
        if (k >= 0 && k < count) row[k] = { kind: 'field', buildingId: b.id };
      }
    }
  }
  return { count, back, front };
}
