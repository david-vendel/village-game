// The farm's architecture rules (src/render/build3d/farm.ts): proportions,
// structural sanity, fit to the game's layout, construction order.

import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/game/buildings';
import { HOME, STORE } from '../src/game/layout';
import { beamTransform, bounds, type Element, rotate, shows, STAGES, type Vec3 } from '../src/render/build3d/elements';
import { farm, farmLook, farmPoints, levels, SPEC } from '../src/render/build3d/farm';

const U = 20;
const all = farm();
const looks = { default: farmLook(false), upgraded: farmLook(true) };
const byId = (els: Element[]) => new Map(els.map((e) => [e.id, e]));
/** What stands in a finished look: no scaffolding, stakes or parts. */
const body = (els: Element[]) => els.filter((e) => !e.tags.includes('scaffold') && !e.tags.some((t) => t.startsWith('part:')));
const top = (e: Element) => bounds(e)[1][2];
const bottom = (e: Element) => bounds(e)[0][2];

describe('beams', () => {
  it('put the box between their ends', () => {
    const cases: Array<[Vec3, Vec3]> = [
      [[0, 0, 0], [2, 0, 0]],
      [[0, 0, 0], [1, 0, 1]],
      [[1, 2, 0], [1, 5, 3]],
      [[0, 0, 0], [0, 0, 2]],
    ];
    for (const [a, b] of cases) {
      const t = beamTransform(a, b, 0.2, 0.1);
      const end = rotate([t.size[0] / 2, 0, 0], t.rot);
      for (let i = 0; i < 3; i++) expect(t.at[i] + end[i]).toBeCloseTo(b[i], 9);
    }
  });
});

describe('the farm', () => {
  it('has unique ids and real stages', () => {
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    expect(all.length).toBeGreaterThan(150);
    for (const e of all) expect(STAGES).toContain(e.stage);
  });

  it('fits the game footprint in both looks', () => {
    for (const els of Object.values(looks)) {
      const walls = body(els).filter((e) => ['footing-stone', 'pad-stone', 'plank', 'sill', 'post'].includes(e.kind));
      expect(Math.abs(Math.min(...walls.map((e) => bounds(e)[0][0])) + BUILDINGS.farm.width / U / 2)).toBeLessThan(0.25);
      expect(Math.abs(Math.max(...walls.map((e) => bounds(e)[1][0])) - BUILDINGS.farm.width / U / 2)).toBeLessThan(0.25);
    }
  });

  it("has its door at the farmer's home spot", () => {
    expect(byId(all).get('door')!.at[0]).toBeCloseTo(HOME.dx / U, 9);
    expect(farmPoints().door[0]).toBeCloseTo(HOME.dx / U, 9);
  });

  it("keeps the grain store's ground clear", () => {
    const [x0, x1] = [STORE.dx / U - 1.25, STORE.dx / U + 1.25];
    for (const [name, els] of Object.entries(looks)) {
      for (const e of body(els)) {
        if (['thatch', 'ridge', 'rafter', 'tie-beam', 'batten', 'shingles'].includes(e.kind)) continue; // eaves overhang above
        const [lo, hi] = bounds(e);
        expect(lo[1] < -0.01 && hi[0] > x0 && lo[0] < x1 && lo[2] < 2.2, `${name}: ${e.id} on the store's ground`).toBe(false);
      }
    }
  });

  it('stands its posts on sills, and the plates on the posts', () => {
    for (const [name, els] of Object.entries(looks)) {
      const ids = byId(els);
      for (const e of els) {
        if (e.kind === 'post' && !e.id.startsWith('barn')) {
          const sill = ids.get(e.on[0])!;
          expect(bottom(e), `${name} ${e.id}`).toBeCloseTo(top(sill), 6);
          const [lo, hi] = bounds(sill);
          expect(e.at[0] >= lo[0] - 1e-6 && e.at[0] <= hi[0] + 1e-6 && e.at[1] >= lo[1] - 1e-6 && e.at[1] <= hi[1] + 1e-6, `${e.id} off its sill`).toBe(true);
        }
        if (e.kind === 'plate' && !e.id.startsWith('barn')) for (const p of e.on) expect(bottom(e), `${e.id} on ${p}`).toBeCloseTo(top(ids.get(p)!), 6);
      }
    }
  });

  it('triangulates bays with braces at brace angles', () => {
    const { sillTop, plateBottom } = levels();
    for (const e of looks.default) {
      if (e.kind !== 'brace' || e.id.startsWith('barn')) continue;
      const [lo, hi] = [e.a!, e.b!].sort((p, q) => p[2] - q[2]);
      expect(lo[2]).toBeCloseTo(sillTop + 0.02, 6);
      expect(hi[2]).toBeCloseTo(plateBottom - 0.02, 6);
      const angle = (Math.atan2(hi[2] - lo[2], Math.hypot(hi[0] - lo[0], hi[1] - lo[1])) * 180) / Math.PI;
      expect(angle).toBeGreaterThanOrEqual(30);
      expect(angle).toBeLessThanOrEqual(75);
    }
  });

  it('pitches the roof for thatch, and the rafters meet at the ridge', () => {
    expect(SPEC.pitchDeg).toBeGreaterThanOrEqual(45);
    expect(SPEC.pitchDeg).toBeLessThanOrEqual(55);
    const rafters = looks.default.filter((e) => e.kind === 'rafter' && !e.id.startsWith('barn'));
    const tops = new Set(rafters.map((e) => e.b!.map((v) => v.toFixed(6)).join()));
    expect(tops.size).toBe(rafters.length / 2);
    for (const e of rafters) expect((Math.atan2(e.b![2] - e.a![2], Math.hypot(e.b![0] - e.a![0], e.b![1] - e.a![1])) * 180) / Math.PI).toBeCloseTo(SPEC.pitchDeg, 6);
  });

  it('lays the thatch on the battens, hiding the roof timbers', () => {
    const ids = byId(looks.default);
    const t = ids.get('thatch')!.params;
    const tan = Math.tan((t.pitchDeg * Math.PI) / 180);
    const drop = t.thickness / Math.cos((t.pitchDeg * Math.PI) / 180);
    const outer = (y: number) => t.ridgeZ - Math.abs(y - t.ridgeY) * tan;
    for (const e of looks.default) {
      if (!['batten', 'rafter', 'collar'].includes(e.kind) || e.id.startsWith('barn')) continue;
      const half = e.kind === 'rafter' ? e.size[2] / 2 / Math.cos((t.pitchDeg * Math.PI) / 180) : e.size[2] / 2;
      for (const p of [e.a!, e.b!]) expect(p[2] + half, e.id).toBeLessThanOrEqual(outer(p[1]) - drop + 1e-6);
    }
    expect(bottom(ids.get('ridge')!)).toBeLessThan(t.ridgeZ);
    expect(bottom(ids.get('chimney.cap')!)).toBeGreaterThan(t.ridgeZ);
  });

  it('builds nothing before what it rests on', () => {
    const ids = byId(all);
    for (const e of all) {
      for (const s of e.on) {
        expect(ids.has(s), `${e.id} rests on unknown ${s}`).toBe(true);
        expect(STAGES.indexOf(ids.get(s)!.stage), `${e.id} before ${s}`).toBeLessThanOrEqual(STAGES.indexOf(e.stage));
      }
    }
  });

  it('adds something every stage, and takes the scaffolding away', () => {
    for (const st of STAGES) expect(all.some((e) => e.stage === st)).toBe(true);
    for (const e of all.filter((x) => x.tags.includes('scaffold'))) expect(['staking', 'walls']).toContain(e.stage);
    const done = all.filter((e) => shows(e, { variant: 'default', parts: [] }));
    expect(done.some((e) => e.tags.includes('scaffold'))).toBe(false);
    expect(all.filter((e) => shows(e, { variant: 'default', stage: 'walls', parts: [] })).some((e) => e.tags.includes('scaffold'))).toBe(true);
  });

  it('gives the Large farm a room with a window, the barn giving way', () => {
    const tags = new Map(all.map((e) => [e.id, e.tags]));
    expect(tags.get('window1')).toContain('variant:upgraded');
    expect(looks.default.some((e) => e.id === 'window1')).toBe(false);
    const barnStart = (els: Element[]) => Math.min(...els.filter((e) => e.kind === 'plank').map((e) => bounds(e)[0][0]));
    expect(Math.abs(barnStart(looks.upgraded) - barnStart(looks.default) - SPEC.bayUpgraded)).toBeLessThan(0.15);
    expect(tags.get('door')).toEqual([]);
    expect(tags.get('thatch')).toEqual(['novariant:upgraded']);
    expect(tags.get('thatch@upgraded')).toEqual(['variant:upgraded']);
  });

  it('has the open door as a part of its own', () => {
    expect(new Set(all.filter((e) => e.tags.includes('part:doorOpen')).map((e) => e.kind))).toEqual(new Set(['doorway', 'door']));
  });

  it('varies with the seed, but not in its structure', () => {
    const other = farm(99);
    expect(other.length).toBeGreaterThan(150);
    const stones = (els: Element[]) => els.filter((e) => e.kind === 'footing-stone').map((e) => e.size[0].toFixed(3)).join();
    expect(stones(other)).not.toBe(stones(all));
    expect(byId(other).get('door')!.at).toEqual(byId(all).get('door')!.at);
  });
});
