// The village as text: a map of the land grid from above (north up, one
// character per cell), a list of the buildings, and the checks that every
// state of the world must pass. It reads the same game state and the same
// geometry the renderer draws from (grid.ts landUse, footprintOf, fieldCell),
// so what is right here is where the pictures go too.
//
// Imports only src/game, and never changes the world.

import type { BuildingType } from '../game/buildings';
import { clock } from '../game/daynight';
import { villageStock } from '../game/economy';
import { baseLand, cellKey, cellName, cellOf, cellsOf, fieldCell, footprintAt as footprintOfType, footprintOf, keptLand, roadCells, sizeOfBuilding, type Cell } from '../game/grid';
import { FIELD_CELLS, FIELD_REACH } from '../game/land';
import { BLOCK, CELL_W, QUARRIES, quarryLand, ROAD_GRID, ROAD_GRID_COL, ROAD_GRID_ROW } from '../game/layout';
import { treePoint } from '../game/nature';
import { RESOURCES } from '../game/resources';
import { groundPoint, mapPoint, streetOf, streetRange, streetStart } from '../game/streets';
import { MERGES, type Building, type World } from '../game/world';

/** One letter per building type: upper case when standing, lower case while being built or pulled down. */
export const GLYPH: Record<BuildingType, string> = {
  warehouse: 'W',
  house: 'H',
  farm: 'F',
  mill: 'M',
  bakery: 'B',
  blacksmith: 'S',
  market: 'K',
  chapel: 'C',
  tavern: 'T',
  watchtower: 'O',
  well: 'U',
  woodcutter: 'X',
  stonecutter: 'Q',
  intersection: 'I',
};

/** A field by its state: claimed but still grass, tilled and fallow, growing, ripe. */
const FIELD_GLYPH = { grass: ',', fallow: '_', growing: '"', ripe: '*' } as const;

/** A building's place in text: its type, id and the street cells it takes (s0:37-45). */
export function where(world: World, b: Building): string {
  const f = footprintAt(world, b);
  return f ? `s${f.street}:${f.i0}-${f.i1}` : `s${streetOf(b.x)}:${alongOf(b.x)}`;
}

const alongOf = (x: number) => Math.floor((x - streetStart(streetOf(x))) / CELL_W + 1e-6);

/** The cells a building takes; a crossroads, the lots its road runs through (even once it is road). */
const footprintAt = (_world: World, b: Building) => (b.type === 'intersection' ? footprintOfType(b.type, b.x) : footprintOf(b));

/** The cell each of a farm's fields is on, with the field. */
function farmFields(world: World, b: Building): Array<{ cell: Cell; glyph: string }> {
  if (!b.farm) return [];
  return b.farm.plots.flatMap((p) => {
    const cell = fieldCell(world, b, p);
    if (!cell) return [];
    return [{ cell, glyph: p.tilled ? FIELD_GLYPH[p.state] : FIELD_GLYPH.grass }];
  });
}

export interface MapOptions {
  /** Cells to show, inclusive (default: everything built on, with a margin). */
  region?: { c0: number; c1: number; r0: number; r1: number };
  /** Label each building with its own letter (fields in its lower case) instead of its type: shows which is which. */
  ids?: boolean;
  /** Show trees (^ grown, ' growing) on free land. */
  trees?: boolean;
  margin?: number;
}

/** Letters for buildings in `ids` mode, in id order. */
const ID_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Every cell anything is built on: buildings, fields, junctions. */
function builtCells(world: World): Cell[] {
  const out: Cell[] = [];
  for (const b of world.buildings) {
    const f = footprintAt(world, b);
    if (f) out.push(...cellsOf(world, f));
    for (const { cell } of farmFields(world, b)) out.push(cell);
  }
  for (const j of world.junctions) out.push(cellOf(mapPoint(world, j.a)));
  return out;
}

/** The region of the grid around what is built (or around the rider if nothing is). */
export function defaultRegion(world: World, margin = 3) {
  const cells = builtCells(world);
  if (!cells.length) cells.push(cellOf(mapPoint(world, world.rider.x)));
  const cs = cells.map((c) => c.c);
  const rs = cells.map((c) => c.r);
  return { c0: Math.min(...cs) - margin, c1: Math.max(...cs) + margin, r0: Math.min(...rs) - margin, r1: Math.max(...rs) + margin };
}

/**
 * The map: the grid from above, north up, one character per cell. Each row
 * is labelled with its letter on the left; the ruler on top numbers every
 * tenth column, and marks with | the cells where a block of three starts on
 * the main street (3n + 1), where buildings can start.
 */
export function renderMap(world: World, opts: MapOptions = {}): string {
  const { c0, c1, r0, r1 } = opts.region ?? defaultRegion(world, opts.margin);
  const grid = new Map<string, string>();
  const put = (c: Cell, ch: string, over = true) => {
    const k = cellKey(c.c, c.r);
    if (over || !grid.has(k)) grid.set(k, ch);
  };
  const labels = new Map<number, string>();
  [...world.buildings].sort((a, b) => a.id - b.id).forEach((b, n) => labels.set(b.id, ID_LABELS[n] ?? '?'));

  // quarries, then roads (a cell two roads share is a crossing)
  for (const q of QUARRIES) {
    const r = quarryLand(q);
    for (let c = Math.round(r.x0 / CELL_W); c < Math.round(r.x1 / CELL_W); c++) for (let row = Math.round(r.y0 / CELL_W); row < Math.round(r.y1 / CELL_W); row++) put({ c, r: row }, '#');
  }
  for (const s of world.streets) {
    if (s.gone) continue;
    const ch = Math.abs(s.dir.x) > 0.5 ? '=' : '|';
    for (const cell of roadCells(world, s)) {
      const had = grid.get(cellKey(cell.c, cell.r));
      put(cell, had === '=' || had === '|' ? '+' : ch);
    }
  }
  if (opts.trees) {
    for (const t of world.trees) {
      if (t.state === 'stump') continue;
      put(cellOf(treePoint(world, t)), t.state === 'grown' ? '^' : "'", false);
    }
  }
  // places kept for a crossroads, where a signpost stands
  for (const k of keptLand(world)) {
    const [c, r] = k.split(',').map(Number);
    put({ c, r }, 'Y', false);
  }
  for (const b of world.buildings) {
    const label = labels.get(b.id)!;
    for (const { cell, glyph } of farmFields(world, b)) put(cell, opts.ids ? label.toLowerCase() : glyph);
    const f = footprintAt(world, b);
    if (!f || (b.type === 'intersection' && b.status !== 'constructing')) continue;
    const g = opts.ids ? label : b.status === 'done' ? GLYPH[b.type] : GLYPH[b.type].toLowerCase();
    for (const cell of cellsOf(world, f)) put(cell, g);
  }
  put(cellOf(mapPoint(world, world.rider.x)), '@');

  const rowW = Math.max(...[r0, r1].map((r) => cellName(0, r).length - 1)) + 1;
  const lines: string[] = [];
  let ruler = '';
  let ticks = '';
  for (let c = c0; c <= c1; c++) {
    if (c % 10 === 0 && ruler.length <= c - c0) ruler = ruler.padEnd(c - c0) + String(c);
    ticks += ((c - 1) % BLOCK + BLOCK) % BLOCK === 0 ? '|' : ' ';
  }
  lines.push(' '.repeat(rowW + 1) + ruler.slice(0, c1 - c0 + 1));
  lines.push(' '.repeat(rowW + 1) + ticks);
  for (let r = r1; r >= r0; r--) {
    let line = '';
    for (let c = c0; c <= c1; c++) line += grid.get(cellKey(c, r)) ?? '.';
    lines.push(cellName(0, r).slice(0, -1).padStart(rowW) + ' ' + line);
  }
  const used = new Set(world.buildings.map((b) => b.type));
  const legend = opts.ids
    ? [...labels].filter(([id]) => world.buildings.some((b) => b.id === id)).map(([id, l]) => {
        const b = world.buildings.find((o) => o.id === id)!;
        return `${l}=#${id} ${b.type}`;
      })
    : [...(Object.keys(GLYPH) as BuildingType[])].filter((t) => used.has(t)).map((t) => `${GLYPH[t]} ${t}`);
  lines.push('');
  lines.push(`  ${legend.join('  ')}`);
  lines.push(`  = | road  + crossing  Y kept for a crossroads  # rocks  @ rider  fields: , grass  _ fallow  " growing  * ripe${opts.trees ? "  ^ tree  ' sapling" : ''}  (lower case: being built)`);
  return lines.join('\n');
}

/** One line per building: id, type, size, state, where it stands, what it holds, its fields and people. */
export function listBuildings(world: World): string {
  const lines = world.buildings.map((b) => {
    const parts = [`#${b.id}`, b.type + (b.size ? `×${b.size}` : ''), where(world, b), b.status === 'done' ? 'done' : `${b.status} ${Math.round(b.progress * 100)}%`];
    if (b.junction) parts.push('junction');
    if (b.upgraded) parts.push('upgraded');
    const held = RESOURCES.filter((r) => b.stock[r] > 0).map((r) => `${r}=${Math.round(b.stock[r])}`);
    if (held.length) parts.push(`[${held.join(' ')}]`);
    if (b.farm) {
      const n = (s: string) => b.farm!.plots.filter((p) => (s === 'grass' ? !p.tilled : p.tilled && p.state === s)).length;
      parts.push(`fields=${b.farm.plots.length} (grass ${n('grass')}, fallow ${n('fallow')}, growing ${n('growing')}, ripe ${n('ripe')})`);
    }
    const staff = world.people.filter((p) => p.job?.buildingId === b.id).map((p) => p.job!.role);
    if (staff.length) parts.push(`staff: ${staff.join(', ')}`);
    return parts.join('  ');
  });
  return lines.join('\n') || '(no buildings)';
}

/** The streets and where they meet. */
export function listStreets(world: World): string {
  const lines = world.streets.map((s) => {
    if (s.gone) return `s${s.index}  gone`;
    const dir = s.dir.x > 0.5 ? 'east' : s.dir.x < -0.5 ? 'west' : s.dir.y > 0.5 ? 'north' : 'south';
    const back = s.dir.x > 0.5 ? 'north' : s.dir.x < -0.5 ? 'south' : s.dir.y > 0.5 ? 'west' : 'east';
    const { min, max } = streetRange(world, s.index);
    const lo = Math.round((min - streetStart(s.index)) / CELL_W);
    const hi = Math.round((max - streetStart(s.index)) / CELL_W) - 1;
    return `s${s.index}  runs ${dir} (lots on its ${back} side), cells ${lo}..${hi}${s.from != null ? `, from crossroads #${s.from}` : ''}`;
  });
  for (const j of world.junctions) lines.push(`  crossroads #${j.buildingId}: s${streetOf(j.a)}:${alongOf(j.a)} = s${streetOf(j.b)}:${alongOf(j.b)} (cell ${cellName(cellOf(mapPoint(world, j.a)).c, cellOf(mapPoint(world, j.a)).r)})`);
  return lines.join('\n');
}

/** Time, the warehouses' stock, the people. */
export function summary(world: World): string {
  const t = clock(world);
  const s = villageStock(world);
  const jobs = new Map<string, number>();
  for (const p of world.people) {
    const k = p.job?.role ?? (p.seeker ? 'looking for work' : p.profession ? `idle ${p.profession}` : 'townsfolk');
    jobs.set(k, (jobs.get(k) ?? 0) + 1);
  }
  return [
    `day ${t.day} ${String(t.hours).padStart(2, '0')}:${String(t.minutes).padStart(2, '0')} (t=${world.time.toFixed(1)}s)  construction ${world.constructionEnabled ? 'on' : 'off'}`,
    `warehouses: ${RESOURCES.map((r) => `${r}=${Math.round(s[r])}`).join(' ')}`,
    `people: ${[...jobs].map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}`,
    `rider: s${streetOf(world.rider.x)}:${alongOf(world.rider.x)} facing ${world.rider.facing > 0 ? '+' : '-'}`,
  ].join('\n');
}

/**
 * What must hold in every state of the world; each broken rule as a line.
 * Buildings never share a cell or stand on a road or the rocks; they start at
 * a cell 3n + 1; fields lie on free land, each cell one farm's, near their
 * farm; small houses and yards side by side are merged; roads keep off the
 * rocks and cross only at a crossroads, on the road grid; every job is at a building that is there; nobody stands off
 * the streets.
 */
export function checkInvariants(world: World): string[] {
  const bad: string[] = [];
  const name = (b: Building) => `#${b.id} ${b.type} at ${where(world, b)}`;
  const at = new Map<string, Building>();
  const roads = new Set<string>();
  const rocks = new Set<string>();
  for (const [k, use] of baseLand(world)) if (use.kind === 'quarry') rocks.add(k);
  for (const s of world.streets) if (!s.gone) for (const c of roadCells(world, s)) roads.add(cellKey(c.c, c.r));

  for (const b of world.buildings) {
    if (b.type === 'intersection') continue;
    const f = footprintOf(b)!;
    if ((((f.i0 - 1) % BLOCK) + BLOCK) % BLOCK !== 0) bad.push(`${name(b)} does not start at a cell 3n + 1 (starts at ${f.i0})`);
    if (f.i1 - f.i0 + 1 !== sizeOfBuilding(b).w) bad.push(`${name(b)} is ${f.i1 - f.i0 + 1} cells wide, not ${sizeOfBuilding(b).w}`);
    for (const c of cellsOf(world, f)) {
      const k = cellKey(c.c, c.r);
      const other = at.get(k);
      if (other) bad.push(`${name(b)} overlaps ${name(other)} at ${cellName(c.c, c.r)}`);
      at.set(k, b);
      if (roads.has(k)) bad.push(`${name(b)} stands on a road at ${cellName(c.c, c.r)}`);
      if (rocks.has(k)) bad.push(`${name(b)} stands on the rocks at ${cellName(c.c, c.r)}`);
    }
  }
  // a crossroads being built keeps its lots free for its road
  for (const b of world.buildings) {
    if (b.type !== 'intersection' || b.status !== 'constructing') continue;
    for (const c of cellsOf(world, footprintAt(world, b)!)) {
      const other = at.get(cellKey(c.c, c.r));
      if (other) bad.push(`${name(other)} stands where the road of ${name(b)} will run, at ${cellName(c.c, c.r)}`);
    }
  }

  const fieldOf = new Map<string, Building>();
  for (const b of world.buildings) {
    if (!b.farm) continue;
    if (b.status !== 'done') bad.push(`${name(b)} has fields but is ${b.status}`);
    const max = b.upgraded ? FIELD_CELLS.upgraded : FIELD_CELLS.base;
    if (b.farm.plots.length > max) bad.push(`${name(b)} has ${b.farm.plots.length} fields, more than ${max}`);
    const f = footprintOf(b)!;
    for (const p of b.farm.plots) {
      const c = fieldCell(world, b, p);
      if (!c) {
        bad.push(`${name(b)} has a field off the grid`);
        continue;
      }
      const k = cellKey(c.c, c.r);
      const cn = cellName(c.c, c.r);
      const other = fieldOf.get(k);
      if (other === b) bad.push(`${name(b)} has two fields on ${cn}`);
      else if (other) bad.push(`${name(b)} and ${name(other)} both have a field on ${cn}`);
      fieldOf.set(k, b);
      if (roads.has(k)) bad.push(`${name(b)} has a field on a road at ${cn}`);
      if (rocks.has(k)) bad.push(`${name(b)} has a field on the rocks at ${cn}`);
      const on = at.get(k);
      if (on) bad.push(`${name(b)} has a field under ${name(on)} at ${cn}`);
      const i = alongOf(b.x + p.dx);
      if (i < f.i0 - FIELD_REACH || i > f.i1 + FIELD_REACH) bad.push(`${name(b)} has a field ${cn} out of its reach`);
    }
  }

  // small houses and yards finished side by side are one building
  for (const a of world.buildings) {
    if (!MERGES[a.type] || a.status !== 'done' || a.site) continue;
    const fa = footprintOf(a)!;
    for (const b of world.buildings) {
      if (b.id <= a.id || b.type !== a.type || b.status !== 'done' || b.site || streetOf(b.x) !== streetOf(a.x)) continue;
      const fb = footprintOf(b)!;
      const touch = fa.i1 + 1 === fb.i0 || fb.i1 + 1 === fa.i0;
      if (touch && (a.size ?? 1) + (b.size ?? 1) <= 3) bad.push(`${name(a)} and ${name(b)} stand side by side but did not merge`);
    }
  }

  // roads keep to the road grid and off the rocks
  for (const s of world.streets) {
    if (s.gone) continue;
    for (const c of roadCells(world, s)) {
      if (rocks.has(cellKey(c.c, c.r))) {
        bad.push(`the road of s${s.index} runs over the rocks at ${cellName(c.c, c.r)}`);
        break;
      }
    }
  }
  for (const j of world.junctions) {
    const c = cellOf(mapPoint(world, j.a));
    const on = (n: number, at: number) => (((n - at) % ROAD_GRID) + ROAD_GRID) % ROAD_GRID === 0;
    if (!on(c.c, ROAD_GRID_COL) || !on(c.r, ROAD_GRID_ROW)) bad.push(`crossroads #${j.buildingId} at ${cellName(c.c, c.r)} is off the road grid`);
  }

  // where two roads cross there is a crossroads, so people can turn there
  const roadOf = new Map<string, number>();
  const crossed = new Map<string, Set<number>>();
  for (const s of world.streets) {
    if (s.gone) continue;
    for (const c of roadCells(world, s)) {
      const k = cellKey(c.c, c.r);
      const o = roadOf.get(k);
      if (o !== undefined && o !== s.index) crossed.set(k, new Set([o, s.index]));
      roadOf.set(k, s.index);
    }
  }
  const met = new Set(world.junctions.map((j) => [streetOf(j.a), streetOf(j.b)].sort().join('-')));
  const told = new Set<string>();
  for (const [k, pair] of crossed) {
    const key = [...pair].sort().join('-');
    if (met.has(key) || told.has(key)) continue;
    told.add(key);
    const [c, r] = k.split(',').map(Number);
    bad.push(`the roads of s${[...pair].join(' and s')} cross at ${cellName(c, r)} with no crossroads`);
  }

  const ids = new Set(world.buildings.map((b) => b.id));
  for (const p of world.people) {
    if (p.job && !ids.has(p.job.buildingId)) bad.push(`${p.name} works at #${p.job.buildingId}, which is not there`);
    const x = p.job ? world.buildings.find((b) => b.id === p.job!.buildingId)!.x + p.job.worker.dx : p.stroll.x;
    const s = world.streets[streetOf(x)];
    if (!s || s.gone) bad.push(`${p.name} is on a street that is not there (x=${x.toFixed(0)})`);
  }
  if (!Number.isFinite(groundPoint(world, world.rider.x, 474).x)) bad.push('the rider is nowhere');
  return bad;
}
