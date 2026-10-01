// The land grid: the whole plane cut into square cells CELL_W across, north
// up. Columns are numbered from 0 eastwards (-1, -2, … to the west), rows are
// lettered from A northwards (-A, -B, … to the south): cell B3 is the fourth
// column east of the line x = 0 and the second row north of y = 0.
//
// Everything on the land takes whole cells: each street's road (three lanes,
// three cells wide), each building's footprint (BuildingDef width and depth,
// in cells), each field of a farm (one cell; land.ts), and the quarries'
// rocky land. What nothing takes is free.
//
// Every street runs along the grid with its middle lane down a row (or
// column) of cells, so seen from a street the cells lie in rows along it:
// cell i along it (from i·CELL_W to (i+1)·CELL_W past the street's start) in
// row j, j cells behind the middle of the road (layout.ts LOT_ROW).
//
// A building may stand anywhere along a street where it fits (whyNotHere):
// on free land, right by the road. Buildings are whole blocks of three cells
// wide and start at a cell 3n + 1 along their street (siteX), so they line up
// with each other and with the crossroads (whose roads take a block too).

import { BUILDINGS, type BuildingType } from './buildings';
import { BLOCK, CELL_W, FIELD_ROW_J, LOT_ROW, QUARRIES, quarryLand } from './layout';
import { backOf, streetOf, streetRange, streetStart, type Street, type Vec } from './streets';
import type { Building, World } from './world';

export type LandUse =
  | { kind: 'road'; street: number }
  | { kind: 'building'; buildingId: number }
  | { kind: 'field'; buildingId: number }
  | { kind: 'quarry' };

/** What takes each cell that something takes, by cellKey. */
export type Land = Map<string, LandUse>;

export interface Cell {
  c: number;
  r: number;
}

export const cellKey = (c: number, r: number) => `${c},${r}`;

/** The cell map point p is in. */
export const cellOf = (p: Vec): Cell => ({ c: Math.floor(p.x / CELL_W), r: Math.floor(p.y / CELL_W) });

/** 1 → A, 26 → Z, 27 → AA. */
function letters(n: number): string {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Row r's name: A, B, … northwards from y = 0 (r = 0, 1, …), -A, -B, … southwards. */
export const rowName = (r: number) => (r >= 0 ? letters(r + 1) : `-${letters(-r)}`);
/** A cell's name: its row, then its column (B3, -A-2). */
export const cellName = (c: number, r: number) => `${rowName(r)}${c}`;

/** The cell of the grid that is cell i along street s, in its row j. */
export function streetCell(s: Street, i: number, j: number): Cell {
  const t = (i + 0.5) * CELL_W;
  const d = j * CELL_W;
  const b = backOf(s.dir);
  return cellOf({ x: s.origin.x + s.dir.x * t + b.x * d, y: s.origin.y + s.dir.y * t + b.y * d });
}

/** Which cell along its street world x is in. */
export const alongCell = (x: number) => Math.floor((x - streetStart(streetOf(x))) / CELL_W + 1e-6);

/** Cells a building of this type takes: w along the street, d back from it; `size` times as wide (a merged house). */
export function sizeOf(type: BuildingType, size = 1): { w: number; d: number } {
  const def = BUILDINGS[type];
  return { w: Math.ceil(def.width / CELL_W - 1e-6) * size, d: def.depth ?? 2 };
}

/** Cells a building takes (sizeOf, for its own size). */
export const sizeOfBuilding = (b: Building) => sizeOf(b.type, b.size);

/** A block of cells seen from a street: cells i0..i1 along it, rows j0..j1. */
export interface Footprint {
  street: number;
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

/**
 * The cells a building of this type standing at world x takes. A crossroads
 * takes the lots its road will run through, three cells wide, until it is
 * built (then they are road).
 */
export function footprintAt(type: BuildingType, x: number, size = 1): Footprint {
  const street = streetOf(x);
  if (type === 'intersection') {
    const i = alongCell(x);
    return { street, i0: i - 1, i1: i + 1, j0: LOT_ROW, j1: LOT_ROW + 2 };
  }
  const { w, d } = sizeOf(type, size);
  const i0 = Math.round((x - streetStart(street)) / CELL_W - w / 2);
  return { street, i0, i1: i0 + w - 1, j0: LOT_ROW, j1: LOT_ROW + d - 1 };
}

/** The cells a building takes (none for a finished crossroads: it is road). */
export function footprintOf(b: Building): Footprint | null {
  return b.type === 'intersection' && b.status !== 'constructing' ? null : footprintAt(b.type, b.x, b.size);
}

/** Whether world x is on a cell 3n + 1 along its street: where a building can start. */
export const atBlockStart = (x: number) => (((alongCell(x) - 1) % BLOCK) + BLOCK) % BLOCK === 0;

/** World x of the cell 3n + 1 starting the block of three cells world x is in. */
export function blockStartX(x: number): number {
  const i0 = BLOCK * Math.floor((alongCell(x) - 1) / BLOCK) + 1;
  return streetStart(streetOf(x)) + (i0 + 0.5) * CELL_W;
}

/** World x a building of this type stands at when wanted at x: starting at the cell 3n + 1 of the block x is in. */
export function siteX(type: BuildingType, x: number): number {
  const { w } = sizeOf(type);
  const start = streetStart(streetOf(x));
  const i0 = BLOCK * Math.floor((alongCell(x) - 1) / BLOCK) + 1;
  return start + (i0 + w / 2) * CELL_W;
}

/** Every cell of a block seen from a street. */
export function cellsOf(world: World, f: Footprint): Cell[] {
  const s = world.streets[f.street];
  if (!s) return [];
  const out: Cell[] = [];
  for (let i = f.i0; i <= f.i1; i++) for (let j = f.j0; j <= f.j1; j++) out.push(streetCell(s, i, j));
  return out;
}

/** The cells of street s's road: its three lanes, from end to end. */
export function roadCells(world: World, s: Street): Cell[] {
  const { min, max } = streetRange(world, s.index);
  const start = streetStart(s.index);
  return cellsOf(world, { street: s.index, i0: Math.round((min - start) / CELL_W), i1: Math.round((max - start) / CELL_W) - 1, j0: -1, j1: 1 });
}

/** Where a field of a farm lies on the grid. */
export function fieldCell(world: World, farm: Building, p: { zone: 'back' | 'front'; row: number; dx: number }): Cell | null {
  const s = world.streets[streetOf(farm.x)];
  const j = FIELD_ROW_J[p.zone][p.row];
  return s && j !== undefined ? streetCell(s, alongCell(farm.x + p.dx), j) : null;
}

// What takes the land is worked out once for each state of the streets,
// buildings and fields, and kept until one of them changes.
interface Known {
  sig: string;
  fields: unknown[];
  base: Land;
  full: Land | null;
}
const known = new WeakMap<World, Known>();

const signature = (world: World) =>
  world.streets.map((s) => (s.gone ? 'x' : `${s.lo}:${s.hi}`)).join(',') + '|' + world.buildings.map((b) => `${b.id}:${b.type}:${b.x}:${b.status}`).join(',');

function knownFor(world: World): Known {
  const sig = signature(world);
  let k = known.get(world);
  if (!k || k.sig !== sig) {
    k = { sig, fields: [], base: makeBase(world), full: null };
    known.set(world, k);
  }
  return k;
}

function makeBase(world: World): Land {
  const land: Land = new Map();
  for (const q of QUARRIES) {
    const r = quarryLand(q);
    for (let c = Math.round(r.x0 / CELL_W); c < Math.round(r.x1 / CELL_W); c++) {
      for (let row = Math.round(r.y0 / CELL_W); row < Math.round(r.y1 / CELL_W); row++) land.set(cellKey(c, row), { kind: 'quarry' });
    }
  }
  for (const s of world.streets) {
    if (s.gone) continue;
    for (const { c, r } of roadCells(world, s)) land.set(cellKey(c, r), { kind: 'road', street: s.index });
  }
  for (const b of world.buildings) {
    const f = footprintOf(b);
    if (f) for (const { c, r } of cellsOf(world, f)) land.set(cellKey(c, r), { kind: 'building', buildingId: b.id });
  }
  return land;
}

/** The land the roads, the buildings and the quarries take (not the fields: they give way). */
export function baseLand(world: World): Land {
  return knownFor(world).base;
}

/** All the land that is taken: roads, buildings, quarries and every farm's fields. */
export function landUse(world: World): Land {
  const k = knownFor(world);
  const farms = world.buildings.filter((b) => b.farm);
  const fields = farms.map((b) => b.farm!.plots);
  if (!k.full || fields.length !== k.fields.length || fields.some((f, i) => f !== k.fields[i])) {
    const land: Land = new Map(k.base);
    for (const b of farms) {
      for (const p of b.farm!.plots) {
        const cell = fieldCell(world, b, p);
        if (cell && !land.has(cellKey(cell.c, cell.r))) land.set(cellKey(cell.c, cell.r), { kind: 'field', buildingId: b.id });
      }
    }
    k.full = land;
    k.fields = fields;
  }
  return k.full;
}

/**
 * Why a building of this type can't stand at world x (where siteX puts it),
 * or null if it fits: the street must run past all of it, and its cells must
 * be free (fields give way). A crossroads takes the land its road will run
 * through.
 */
export function whyNotHere(world: World, type: BuildingType, x: number): string | null {
  const s = world.streets[streetOf(x)];
  if (!s || s.gone) return 'There is no street here';
  const f = footprintAt(type, x);
  const { min, max } = streetRange(world, s.index);
  const start = streetStart(s.index);
  if (start + f.i0 * CELL_W < min - 1e-6 || start + (f.i1 + 1) * CELL_W > max + 1e-6) return 'The street ends here';
  const land = baseLand(world);
  const at = (i: number, j: number) => {
    const cell = streetCell(s, i, j);
    return land.get(cellKey(cell.c, cell.r));
  };
  const nameOf = (id: number) => BUILDINGS[world.buildings.find((b) => b.id === id)?.type ?? 'house'].name;
  for (let i = f.i0; i <= f.i1; i++) {
    for (let j = f.j0; j <= f.j1; j++) {
      const use = at(i, j);
      if (use?.kind === 'quarry') return 'The rocks are in the way';
      if (use?.kind === 'road') return 'A road is in the way';
      if (use?.kind === 'building') return `The ${nameOf(use.buildingId)} is in the way`;
    }
  }
  return null;
}

/**
 * Whether street s's road, from t0 to t1 along it (px from its start), would
 * run over the rocks or a building (a crossroads aside: roads run through those).
 */
export function roadBlocked(world: World, s: Street, t0: number, t1: number): boolean {
  const land = baseLand(world);
  const i0 = Math.floor(Math.min(t0, t1) / CELL_W + 1e-6);
  const i1 = Math.ceil(Math.max(t0, t1) / CELL_W - 1e-6) - 1;
  for (let i = i0; i <= i1; i++) {
    for (let j = -1; j <= 1; j++) {
      const cell = streetCell(s, i, j);
      const use = land.get(cellKey(cell.c, cell.r));
      if (use?.kind === 'quarry') return true;
      if (use?.kind === 'building' && world.buildings.find((b) => b.id === use.buildingId)?.type !== 'intersection') return true;
    }
  }
  return false;
}

/**
 * Whether street s's road, from t0 to t1 along it (px from its start), would
 * run onto the road of another street (where it isn't laid yet: s is new).
 */
export function roadInWay(world: World, s: Street, t0: number, t1: number): boolean {
  const land = baseLand(world);
  const i0 = Math.floor(Math.min(t0, t1) / CELL_W + 1e-6);
  const i1 = Math.ceil(Math.max(t0, t1) / CELL_W - 1e-6) - 1;
  for (let i = i0; i <= i1; i++) {
    for (let j = -1; j <= 1; j++) {
      const cell = streetCell(s, i, j);
      const use = land.get(cellKey(cell.c, cell.r));
      if (use?.kind === 'road' && use.street !== s.index) return true;
    }
  }
  return false;
}
