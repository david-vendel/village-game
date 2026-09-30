import { describe, expect, it } from 'vitest';
import { cellX, footprint, landGrid } from './land';
import { createWorld, placeBuilding, type Building, type World } from './world';

/** World x-range of each of a farm's plots in one zone. */
function spans(world: World, farm: Building, zone: 'back' | 'front'): Array<[number, number]> {
  const x = world.plots[farm.plotIndex].x;
  return farm.farm!.plots.filter((p) => p.zone === zone).map((p) => [x + p.dx - p.width / 2, x + p.dx + p.width / 2]);
}

function footprintX(world: World, b: Building): [number, number] {
  const { from, to } = footprint(world, b);
  return [cellX(from), cellX(to)];
}

const overlaps = ([a0, a1]: [number, number], [b0, b1]: [number, number]) => a0 < b1 && b0 < a1;

describe('land grid', () => {
  it('plot centres fall on cell edges and footprints cover whole cells', () => {
    const w = createWorld({ village: false });
    const b = placeBuilding(w, 3, 'blacksmith', { instant: true })!;
    const { from, to } = footprint(w, b);
    expect(to - from).toBe(8); // 170 px → 8 cells of 25
    const [x0, x1] = footprintX(w, b);
    expect((x0 + x1) / 2).toBe(w.plots[3].x);
  });

  it('a farm between a chapel and a blacksmith keeps its back fields off their footprints', () => {
    const w = createWorld({ village: false });
    const chapel = placeBuilding(w, 2, 'chapel', { instant: true })!;
    const farm = placeBuilding(w, 3, 'farm', { instant: true })!;
    const smith = placeBuilding(w, 4, 'blacksmith', { instant: true })!;
    const back = spans(w, farm, 'back');
    for (const s of back) {
      expect(overlaps(s, footprintX(w, chapel))).toBe(false);
      expect(overlaps(s, footprintX(w, smith))).toBe(false);
      expect(overlaps(s, footprintX(w, farm))).toBe(false);
    }
    // one field on each side, squeezed between the buildings
    expect(back).toHaveLength(2);
    // in front of the road the neighbours' land is still free to farm
    const front = spans(w, farm, 'front');
    expect(Math.min(...front.map((s) => s[0]))).toBeLessThan(w.plots[3].x - 125);
    expect(Math.max(...front.map((s) => s[1]))).toBeGreaterThan(w.plots[3].x + 125);
  });

  it('building next to a farm takes back the land its fields were on', () => {
    const w = createWorld({ village: false });
    const farm = placeBuilding(w, 3, 'farm', { instant: true })!;
    const before = spans(w, farm, 'back').length;
    const house = placeBuilding(w, 4, 'house')!; // still under construction: the land is claimed anyway
    const after = spans(w, farm, 'back');
    expect(after.length).toBeLessThan(before);
    for (const s of after) expect(overlaps(s, footprintX(w, house))).toBe(false);
  });

  it('neighbouring farms share the land in front of the road without overlap', () => {
    const w = createWorld({ village: false });
    const a = placeBuilding(w, 3, 'farm', { instant: true })!;
    const b = placeBuilding(w, 4, 'farm', { instant: true })!;
    for (const zone of ['back', 'front'] as const) {
      for (const sa of spans(w, a, zone)) for (const sb of spans(w, b, zone)) expect(overlaps(sa, sb)).toBe(false);
    }
  });

  it('every cell has one use', () => {
    const w = createWorld();
    const g = landGrid(w);
    for (const row of [g.back, g.front]) expect(row).toHaveLength(g.count);
    expect(g.back.some((c) => c.kind === 'building')).toBe(true);
    expect(g.back.some((c) => c.kind === 'field')).toBe(true);
    expect(g.front.some((c) => c.kind === 'field')).toBe(true);
    expect(g.front.every((c) => c.kind !== 'building')).toBe(true);
  });
});
