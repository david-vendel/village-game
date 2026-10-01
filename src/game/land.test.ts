import { describe, expect, it } from 'vitest';
import { cellKey, cellName, cellsOf, fieldCell, footprintOf, landUse, rowName, whyNotHere } from './grid';
import { FIELD_CELLS } from './land';
import { HOME, VERGE_ROW } from './layout';
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

  it('a farm takes 4 × 2 cells, one cell back from the road', () => {
    const w = emptyWorld();
    const farm = placeBuilding(w, 1000, 'farm', { instant: true, free: true })!;
    const cells = cellsOf(w, footprintOf(farm)!);
    expect(cells).toHaveLength(8);
    expect(new Set(cells.map((c) => c.r))).toEqual(new Set([3, 4]));
    expect(new Set(cells.map((c) => c.c)).size).toBe(4);
  });

  it('a building goes anywhere it fits: not on another, not on the rocks, never next to a road', () => {
    const w = emptyWorld();
    const a = placeBuilding(w, 1000, 'farm', { free: true })!;
    // right beside it is fine, half over it is not
    expect(whyNotBuild(w, 'farm', a.x + 100)).toBeNull();
    expect(whyNotBuild(w, 'farm', a.x + 50)).toMatch(/in the way/);
    // the quarry's land
    expect(whyNotHere(w, 'farm', 1640)).toBeNull(); // the rocks start behind the lots
    // a crossroads: its road needs a cell clear either side of it
    const x = w.plots[8].x;
    placeBuilding(w, x, 'intersection', { instant: true, free: true });
    expect(whyNotBuild(w, 'farm', x + 50)).not.toBeNull();
    expect(whyNotBuild(w, 'farm', x + 100)).toBeNull();
  });

  it("a farm's fields are single free cells near it: never on a road or a building, nor in front of its door", () => {
    const w = emptyWorld();
    const farm = placeBuilding(w, 1000, 'farm', { instant: true, free: true })!;
    const keys = fieldKeys(w, farm);
    expect(keys).toHaveLength(FIELD_CELLS.base);
    expect(new Set(keys).size).toBe(keys.length);
    expect(farm.farm!.plots.every((p) => p.width === 25)).toBe(true);
    const land = landUse(w);
    for (const k of keys) expect(land.get(k)).toEqual({ kind: 'field', buildingId: farm.id });
    // the verge in front of the farm is sown, but for the cell before its door
    const f = footprintOf(farm)!;
    const verge = cellsOf(w, { ...f, j0: VERGE_ROW, j1: VERGE_ROW });
    const door = cellsOf(w, { ...f, i0: Math.floor((farm.x + HOME.dx) / 25), i1: Math.floor((farm.x + HOME.dx) / 25), j0: VERGE_ROW, j1: VERGE_ROW })[0];
    const sown = verge.filter((c) => keys.includes(cellKey(c.c, c.r)));
    expect(sown).toHaveLength(3);
    expect(keys).not.toContain(cellKey(door.c, door.r));
  });

  it('building next to a farm takes back the cells its fields were on, and the farm sows others', () => {
    const w = emptyWorld();
    const farm = placeBuilding(w, 1000, 'farm', { instant: true, free: true })!;
    const house = placeBuilding(w, farm.x + 125, 'house', { free: true })!; // still under construction: the land is claimed anyway
    const keys = fieldKeys(w, farm);
    expect(keys).toHaveLength(FIELD_CELLS.base);
    for (const k of footKeys(w, house)) expect(keys).not.toContain(k);
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
