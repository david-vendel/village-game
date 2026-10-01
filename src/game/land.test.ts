import { describe, expect, it } from 'vitest';
import { cellKey, cellName, cellsOf, fieldCell, footprintOf, landUse, rowName, whyNotHere } from './grid';
import { FIELD_CELLS } from './land';
import { LOT_ROW } from './layout';
import { createWorld, placeBuilding, whyNotBuild, type Building, type World } from './world';

const emptyWorld = () => createWorld({ village: false });

/** The grid cells a farm's fields are on. */
const fieldKeys = (w: World, farm: Building) => farm.farm!.plots.map((p) => fieldCell(w, farm, p)!).map((c) => cellKey(c.c, c.r));
const footKeys = (w: World, b: Building) => cellsOf(w, footprintOf(b)!).map((c) => cellKey(c.c, c.r));

describe('land grid', () => {
  it('names cells by row (A, B, … north, -A, -B, … south) and column (0, 1, … east, -1, … west)', () => {
    expect(cellName(0, 0)).toBe('A0');
    expect(cellName(3, 1)).toBe('B3');
    expect(cellName(-1, -1)).toBe('-A-1');
    expect(rowName(25)).toBe('Z');
    expect(rowName(26)).toBe('AA');
    expect(rowName(-3)).toBe('-C');
  });

  it('the main street is a road three cells wide, on rows -A, A and B', () => {
    const w = emptyWorld();
    const land = landUse(w);
    for (const r of [-1, 0, 1]) expect(land.get(cellKey(40, r))?.kind).toBe('road');
    expect(land.has(cellKey(40, -2))).toBe(false);
    expect(land.has(cellKey(40, 2))).toBe(false);
  });

  it('a farm takes 6 × 3 cells, right by the road', () => {
    const w = emptyWorld();
    const farm = placeBuilding(w, 1000, 'farm', { instant: true, free: true })!;
    const cells = cellsOf(w, footprintOf(farm)!);
    expect(cells).toHaveLength(18);
    expect(new Set(cells.map((c) => c.r))).toEqual(new Set([2, 3, 4]));
    expect(new Set(cells.map((c) => c.c)).size).toBe(6);
    expect(Math.min(...cells.map((c) => c.c)) % 3).toBe(1); // it starts at a cell 3n + 1
  });

  it('a building goes anywhere it fits: not on another, not on a road or the rocks', () => {
    const w = emptyWorld();
    const a = placeBuilding(w, 1000, 'farm', { free: true })!;
    // right beside it is fine, half over it is not
    expect(whyNotBuild(w, 'farm', a.x + 150)).toBeNull();
    expect(whyNotBuild(w, 'farm', a.x + 25)).toMatch(/in the way/);
    expect(whyNotHere(w, 'farm', 1640)).toBeNull(); // the rocks start behind the lots
    // a crossroads: right up to its road, but not on it
    const x = w.plots[32].x;
    placeBuilding(w, x, 'intersection', { instant: true, free: true });
    expect(whyNotBuild(w, 'farm', x + 30)).toMatch(/road/);
    expect(whyNotBuild(w, 'farm', x + 112.5)).toBeNull();
  });

  it("a farm's fields are single free cells near it, never on a road or a building", () => {
    const w = emptyWorld();
    const farm = placeBuilding(w, 1000, 'farm', { instant: true, free: true })!;
    const keys = fieldKeys(w, farm);
    expect(keys).toHaveLength(FIELD_CELLS.base);
    expect(new Set(keys).size).toBe(keys.length);
    expect(farm.farm!.plots.every((p) => p.width === 25)).toBe(true);
    const land = landUse(w);
    for (const k of keys) expect(land.get(k)).toEqual({ kind: 'field', buildingId: farm.id });
    // right beside the farmstead, by the road
    const f = footprintOf(farm)!;
    const beside = cellsOf(w, { ...f, i0: f.i1 + 1, i1: f.i1 + 1, j0: LOT_ROW, j1: LOT_ROW })[0];
    expect(keys).toContain(cellKey(beside.c, beside.r));
  });

  it('building next to a farm takes back the cells its fields were on, and the farm sows others', () => {
    const w = emptyWorld();
    const farm = placeBuilding(w, 1000, 'farm', { instant: true, free: true })!;
    const house = placeBuilding(w, farm.x + 112.5, 'house', { free: true })!; // still under construction: the land is claimed anyway
    const keys = fieldKeys(w, farm);
    expect(keys).toHaveLength(FIELD_CELLS.base);
    for (const k of footKeys(w, house)) expect(keys).not.toContain(k);
  });

  it('a small house built right beside a house becomes part of it: medium, then large, no larger', () => {
    const w = emptyWorld();
    const a = placeBuilding(w, 1000, 'house', { instant: true, free: true })!;
    const b = placeBuilding(w, a.x + 75, 'house', { instant: true, free: true })!;
    expect(b).toBe(a);
    expect(w.buildings).toHaveLength(1);
    expect(a.size).toBe(2);
    expect(cellsOf(w, footprintOf(a)!)).toHaveLength(12);
    placeBuilding(w, a.x - 112.5, 'house', { instant: true, free: true });
    expect(a.size).toBe(3);
    placeBuilding(w, a.x + 150, 'house', { instant: true, free: true });
    expect(w.buildings).toHaveLength(2); // a fourth stays a small house of its own
  });

  it('a field keeps its crop when the fields around it are re-laid', () => {
    const w = emptyWorld();
    const farm = placeBuilding(w, 1000, 'farm', { instant: true, free: true })!;
    const near = farm.farm!.plots[0];
    near.tilled = true;
    near.state = 'ripe';
    const key = fieldKeys(w, farm)[0];
    placeBuilding(w, farm.x - 300, 'house', { free: true });
    const i = fieldKeys(w, farm).indexOf(key);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(farm.farm!.plots[i]).toMatchObject({ tilled: true, state: 'ripe' });
  });
});
