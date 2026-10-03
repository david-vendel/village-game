// The 3D buildings' architecture rules (src/render/build3d): every type, in
// several seeds and sizes, alone and between neighbours. Each stays on the
// cells the game gives it below head height (people walk round those cells and
// must never walk through a wall or a woodpile), builds nothing before what it
// rests on, adds something every stage in a real order, has its door where the
// game walks people in, its smoke where its chimney is, and is its own: no two
// seeds alike.

import { describe, expect, it } from 'vitest';
import { BUILDINGS, type BuildingType } from '../src/game/buildings';
import { HOME, STORE } from '../src/game/layout';
import { animOf, bounds, type Element, inVariant, shows, stageCounts, STAGES, untilOf } from '../src/render/build3d/elements';
import { ARCHES, farmLook, YARD } from '../src/render/build3d/farm';
import { modelOf, modelTypes } from '../src/render/build3d/index';
import { HEADROOM, plotOf, U } from '../src/render/build3d/plot';
import { stockElements } from '../src/render/build3d/stock';

const TYPES = modelTypes();
const SEEDS = [7, 1234, 98765];
const sizesOf = (t: BuildingType): Array<1 | 2 | 3> => (t === 'house' || t === 'warehouse' ? [1, 2, 3] : [1]);
const byId = (els: Element[]) => new Map(els.map((e) => [e.id, e]));
/** What stands once finished, in a look. */
const finished = (els: Element[], variant: 'default' | 'upgraded' = 'default') => els.filter((e) => shows(e, { variant }));

describe('every 3D building', () => {
  it('covers every building type but the crossroads', () => {
    for (const t of Object.keys(BUILDINGS) as BuildingType[]) if (t !== 'intersection') expect(TYPES, t).toContain(t);
  });

  for (const type of TYPES) {
    describe(type, () => {
      const models = SEEDS.flatMap((seed) => sizesOf(type).map((size) => ({ seed, size, model: modelOf(type, seed, size) })));

      it('has unique ids, real stages, and something in every stage', () => {
        for (const { model } of models) {
          const els = model.elements;
          expect(new Set(els.map((e) => e.id)).size).toBe(els.length);
          for (const e of els) expect(STAGES).toContain(e.stage);
          for (const st of STAGES) expect(els.some((e) => e.stage === st), `${type} has nothing in ${st}`).toBe(true);
        }
      });

      it('stays on its own cells below head height, in every look', () => {
        for (const { size, model } of models) {
          const p = plotOf(type, size);
          for (const variant of ['default', 'upgraded'] as const) {
            for (const e of finished(model.elements, variant)) {
              const [lo, hi] = bounds(e);
              if (lo[2] >= HEADROOM) continue;
              const inside = lo[0] >= p.x0 - 0.02 && hi[0] <= p.x1 + 0.02 && lo[1] >= p.y0 - 0.02 && hi[1] <= p.y1 + 0.02;
              expect(inside, `${type} ×${size}: ${e.id} (${e.kind}) [${lo.map((v) => v.toFixed(2))}]..[${hi.map((v) => v.toFixed(2))}] leaves its cells below head height`).toBe(true);
            }
          }
        }
      });

      it('keeps its store on its own cells too', () => {
        const full = { wood: 999, stone: 999, grain: 999, flour: 999, bread: 999 };
        for (const size of sizesOf(type)) {
          const p = plotOf(type, size);
          for (const e of stockElements(type, full, size, 7)) {
            const [lo, hi] = bounds(e);
            expect(lo[0] >= p.x0 - 0.02 && hi[0] <= p.x1 + 0.02 && lo[1] >= p.y0 - 0.02 && hi[1] <= p.y1 + 0.02, `${type} ×${size}: ${e.id} off its cells`).toBe(true);
          }
        }
      });

      it('builds nothing before what it rests on', () => {
        for (const { model } of models) {
          const ids = byId(model.elements);
          for (const e of model.elements) {
            for (const s of e.on) {
              expect(ids.has(s), `${e.id} rests on unknown ${s}`).toBe(true);
              expect(STAGES.indexOf(ids.get(s)!.stage), `${e.id} before ${s}`).toBeLessThanOrEqual(STAGES.indexOf(e.stage));
            }
          }
        }
      });

      it('goes up a piece at a time, never losing what stays, and is cleared of its scaffolding when done', () => {
        const els = models[0].model.elements;
        const counts = stageCounts(els, 'default');
        let before = new Set<string>();
        for (const st of STAGES) {
          for (let k = 1; k <= 8; k++) {
            const look = { variant: 'default' as const, build: { stage: st, t: k / 8 } };
            const now = new Set(els.filter((e) => !untilOf(e) && shows(e, look, undefined, counts)).map((e) => e.id));
            for (const id of before) expect(now.has(id), `${type}: ${id} gone at ${st} ${k}/8`).toBe(true);
            expect(now.size).toBeGreaterThanOrEqual(before.size);
            before = now;
          }
        }
        expect(finished(els).some((e) => untilOf(e))).toBe(false);
        // digging is done before anything is laid
        expect(els.some((e) => e.kind === 'trench' && e.stage === 'staking')).toBe(true);
      });

      it('is its own in each seed, in the same plan', () => {
        const [a, b] = [models[0].model, models[sizesOf(type).length].model];
        const sig = (els: Element[]) => els.map((e) => `${e.size.map((v) => v.toFixed(3))}${e.material}`).join();
        expect(sig(a.elements)).not.toBe(sig(b.elements));
        expect(a.points.door?.[0]).toEqual(b.points.door?.[0]);
      });

      it('has its door where the game walks people in, and a leaf that swings in', () => {
        const door = BUILDINGS[type].door;
        const { model } = models[0];
        if (!door) return;
        expect(model.points.door[0] * U).toBeCloseTo(door.dx, 6);
        if (type === 'blacksmith') return; // open-fronted
        const leaves = Object.entries(model.anims).filter(([, a]) => a.kind === 'door');
        expect(leaves.length, `${type} has no door leaf`).toBeGreaterThan(0);
        const near = leaves.some(([, a]) => Math.abs(a.pivot[0] - door.dx / U) < 0.6);
        expect(near, `${type}: no leaf hung at its door`).toBe(true);
      });

      it('has every moving part declared, and every declared part has pieces', () => {
        for (const { model } of models) {
          const used = new Set(model.elements.map(animOf).filter((a): a is string => !!a));
          for (const a of used) expect(model.anims[a], `${type}: ${a} undeclared`).toBeDefined();
          for (const a of Object.keys(model.anims)) expect(used.has(a), `${type}: ${a} has no pieces`).toBe(true);
        }
      });

      it('puts each chimney top above its roof', () => {
        const { model } = models[0];
        const tops = Object.entries(model.points).filter(([n]) => n.startsWith('smoke:') || n.startsWith('flue:'));
        for (const [n, p] of tops) {
          const below = model.elements.filter((e) => e.shape === 'course' && inVariant(e, 'default'));
          for (const e of below) {
            const [lo, hi] = bounds(e);
            if (p[0] > lo[0] && p[0] < hi[0] && p[1] > lo[1] && p[1] < hi[1]) expect(p[2], `${type} ${n} under ${e.id}`).toBeGreaterThan(hi[2] - 0.6);
          }
        }
      });
    });
  }
});

describe('houses', () => {
  it('come in styles: thatch, tiles and shingles or slate, stone and timber', () => {
    const roofs = new Set<string>();
    const walls = new Set<string>();
    for (let seed = 1; seed < 40; seed++) {
      const els = modelOf('house', seed).elements;
      for (const e of els) {
        if (e.shape === 'course') roofs.add(e.material);
        if (e.kind === 'stone' || e.kind === 'daub') walls.add(e.kind);
      }
    }
    expect(roofs.size).toBeGreaterThanOrEqual(3);
    expect(walls).toEqual(new Set(['stone', 'daub']));
  });

  it("meet a neighbour's wall with the roof flush, and overhang their gables alone", () => {
    for (const seed of SEEDS) {
      const p = plotOf('house');
      const reach = (left: boolean, right: boolean) => {
        const cov = modelOf('house', seed, 1, { left, right }).elements.filter((e) => e.shape === 'course');
        return [Math.min(...cov.map((e) => bounds(e)[0][0])), Math.max(...cov.map((e) => bounds(e)[1][0]))];
      };
      const [aloneL, aloneR] = reach(false, false);
      expect(aloneL).toBeLessThan(p.x0 - 0.15);
      expect(aloneR).toBeGreaterThan(p.x1 + 0.15);
      const [flushL, flushR] = reach(true, true);
      expect(flushL).toBeCloseTo(p.x0, 2);
      expect(flushR).toBeCloseTo(p.x1, 2);
      // and their walls stand on the boundary, to meet the neighbour's
      const stones = modelOf('house', seed, 1, { left: true, right: true }).elements.filter((e) => ['footing-stone'].includes(e.kind));
      expect(Math.min(...stones.map((e) => bounds(e)[0][0]))).toBeLessThan(p.x0 + 0.06);
      expect(Math.max(...stones.map((e) => bounds(e)[1][0]))).toBeGreaterThan(p.x1 - 0.06);
    }
  });

  it('grow longer with their size, with more windows', () => {
    const windows = (size: 1 | 2 | 3) => Object.keys(modelOf('house', 11, size).anims).filter((a) => a.includes('shutter')).length;
    expect(windows(3)).toBeGreaterThan(windows(1));
  });
});

describe('the farm', () => {
  const def = farmLook(false).elements;
  const up = farmLook(true).elements;

  it('has its door at the farmer\'s home spot', () => {
    expect(modelOf('farm', 7).points.door[0]).toBeCloseTo(HOME.dx / U, 9);
  });

  it("keeps the grain store's ground clear", () => {
    const [x0, x1] = [STORE.dx / U - 1.1, STORE.dx / U + 1.1];
    const p = plotOf('farm');
    for (const els of [def, up]) {
      for (const e of finished(els)) {
        if (untilOf(e)) continue;
        const [lo, hi] = bounds(e);
        const onStore = hi[0] > x0 && lo[0] < x1 && lo[1] < p.y0 + YARD - 0.12 && lo[2] < HEADROOM;
        if (['yard', 'trough', 'barrel'].includes(e.kind) || e.id.startsWith('ft') || e.kind === 'trench') continue;
        expect(onStore, `${e.id} (${e.kind}) on the store's ground`).toBe(false);
      }
    }
  });

  it('opens its barn through round arches turned in voussoirs, a pair of leaves hung in each', () => {
    const keystones = def.filter((e) => e.kind === 'keystone');
    expect(keystones.length).toBe(ARCHES.length);
    for (const a of ARCHES) {
      // each keystone over its arch's middle, above head height
      expect(keystones.some((e) => Math.abs(e.at[0] - a.u) < 1e-6 && bounds(e)[1][2] > HEADROOM)).toBe(true);
      const leaves = Object.entries(farmLook(false).anims).filter(([n, an]) => n.startsWith(a.name) && an.kind === 'door');
      expect(leaves.length, a.name).toBe(2);
    }
    expect(def.some((e) => e.kind === 'voussoir')).toBe(true);
  });

  it('stands its living floor out over the yard above head height', () => {
    const p = plotOf('farm');
    const daub = finished(def).filter((e) => e.kind === 'daub');
    expect(Math.min(...daub.map((e) => bounds(e)[0][1]))).toBeLessThan(p.y0 + YARD - 0.4);
    for (const e of daub) if (bounds(e)[0][1] < p.y0 + YARD - 0.1) expect(bounds(e)[0][2], e.id).toBeGreaterThan(HEADROOM);
  });

  it('gives the Large farm a room in the roof with a window and a hearth of its own, on the same footprint', () => {
    const all = modelOf('farm', 7).elements;
    expect(all.some((e) => e.id.startsWith('dormer1.window.') && e.tags.includes('variant:upgraded'))).toBe(true);
    expect(def.some((e) => e.id.startsWith('dormer1.'))).toBe(false);
    const smoke = (els: Record<string, unknown>) => Object.keys(els).filter((n) => n.startsWith('smoke:')).length;
    expect(smoke(farmLook(true).points)).toBe(smoke(farmLook(false).points) + 1);
    const footprint = (els: Element[]) => {
      const bs = els.filter((e) => e.kind === 'footing-stone').map(bounds);
      return [Math.min(...bs.map((b) => b[0][0])), Math.max(...bs.map((b) => b[1][0])), Math.min(...bs.map((b) => b[0][1])), Math.max(...bs.map((b) => b[1][1]))];
    };
    expect(footprint(up)).toEqual(footprint(def));
  });

  it('pitches its tiles steep, and breaks its eaves with a gable', () => {
    const rafters = def.filter((e) => e.kind === 'rafter' && e.id.startsWith('roof.'));
    expect(rafters.length).toBeGreaterThan(6);
    for (const e of rafters) {
      const deg = (Math.atan2(Math.abs(e.b![2] - e.a![2]), Math.hypot(e.b![0] - e.a![0], e.b![1] - e.a![1])) * 180) / Math.PI;
      expect(deg).toBeGreaterThanOrEqual(45);
      expect(deg).toBeLessThanOrEqual(56);
    }
    expect(def.filter((e) => e.shape === 'course' && e.material === 'tile').length).toBeGreaterThan(20);
    expect(def.some((e) => e.id.startsWith('gable.window.'))).toBe(true);
  });
});
