// The village's common buildings.
// - The tavern: long, stone below and a jettied timber-framed storey over the
//   street, tiles, two chimneys; a bench out front for the bread baskets, a
//   sign with a mug, a lantern by the door, barrels.
// - The chapel: an ashlar nave with buttresses and lancet windows of stained
//   glass, a steep roof; the bell tower at its west end with the door at its
//   foot, the bell hung in the belfry (it swings when rung), a slate spire and
//   a gilt cross.
// - The market: two stalls under striped awnings, their counters spread with
//   goods, crates and barrels, a trodden square.
// - The watchtower: four splayed log legs braced crosswise, a ladder, the
//   watch cabin of boards up top under a pyramid roof, a banner, a brazier
//   that burns through the night.
// - The storage yard: a wattle fence round the back of trodden ground, an
//   open-fronted shed with shelves for what must stay dry; the piles lie in
//   their places (stock.ts).

import { CHAPEL_DOOR, TAVERN_DOOR, TAVERN_SLOTS } from '../../game/layout';
import { pick, uniform, type Vec3 } from './elements';
import { body, type OpeningSpec } from './kit/body';
import { footing, stoneShell } from './kit/masonry';
import { door, window_ } from './kit/openings';
import { barrel, bench, crate, hangingSign, ladder, lantern, wattleFence } from './kit/props';
import { coneRoof, gableRoof, leanTo, pyramidRoof } from './kit/roof';
import { dig, scaffold, stakeOut } from './kit/site';
import { type Model, ModelBuilder } from './model';
import { m, type Plot } from './plot';

export function tavern(seed: number, plot: Plot): Model {
  const b = new ModelBuilder(seed, plot);
  const r = b.rng('tavern');
  const rect = { x0: plot.x0, x1: plot.x1, y0: plot.y0 + 0.5, y1: plot.y1 - 0.03 };
  const doorU = m(TAVERN_DOOR.dx);
  const ops: OpeningSpec[] = [{ kind: 'door', side: 'front', u: doorU, w: 1.0, h: 1.9, storey: 0, name: 'door', hinge: 'left' }];
  [-4.3, -2.6, 1.3, 3.0, 4.5].forEach((u, i) => ops.push({ kind: 'window', side: 'front', u, w: 0.85, h: 0.62, storey: 0, sill: 0.95, name: `window${i}`, shutters: 'pair' }));
  [-4.4, -2.9, -1.4, 0.1, 1.6, 3.1, 4.5].forEach((u, i) => ops.push({ kind: 'window', side: 'front', u, w: 0.62, h: 0.6, storey: 1, sill: 0.75, name: `window${i + 5}`, shutters: 'pair' }));
  const info = body(b, {
    rect,
    footing: { h: 0.45 },
    storeys: [
      { kind: 'stone', h: 2.3, material: 'rubble', quoins: 'ashlar' },
      { kind: 'frame', h: 2.05, jetty: 0.35, infill: 'daub', material: pick(r, ['daub', 'daub-ochre']) },
    ],
    roof: { style: 'tile', pitchDeg: uniform(r, 42, 48), eaves: 0.3, overL: plot.sides.left ? 0 : 0.3, overR: plot.sides.right ? 0 : 0.3, gableFill: 'daub' },
    openings: ops,
    chimneys: [{ x: rect.x0 + 1.2 }, { x: rect.x1 - 1.6, w: 0.48, d: 0.45 }],
  });
  // the bench for the guests' bread, a sign, a lantern by the door, barrels at the end
  const bx = (m(TAVERN_SLOTS[0].dx) + m(TAVERN_SLOTS[1].dx)) / 2;
  bench(b, 'bench', bx, plot.y0 + 0.26, 1.35, { h: 0.44, depth: 0.36 });
  hangingSign(b, 'sign', rect.x0 + 0.3, rect.y0 - 0.01, 2.7, 'sign-mug', { out: 0.55 });
  lantern(b, 'lantern2', doorU - 0.85, rect.y0, 2.28);
  b.point('lamp:9', [doorU - 0.85, rect.y0 - 0.25, 2.28]);
  barrel(b, 'barrel0', rect.x1 - 0.45, plot.y0 + 0.25, { r: 0.22, h: 0.66 });
  barrel(b, 'barrel1', rect.x1 - 1.0, plot.y0 + 0.25, { r: 0.2, h: 0.6 });
  barrel(b, 'barrel2', rect.x1 - 0.7, plot.y0 + 0.24, { r: 0.18, h: 0.54, lying: true });

  b.point('door', [doorU, plot.y0, 0]);
  info.smoke.forEach((p, i) => b.point(`smoke:${i}`, p));
  return b.model();
}

export function chapel(seed: number, plot: Plot): Model {
  const b = new ModelBuilder(seed, plot);
  const r = b.rng('chapel');
  const tw = 2.15;
  const tx0 = plot.x0 + 0.05;
  const tx1 = tx0 + tw;
  const nave = { x0: tx1 - 0.3, x1: plot.x1 - 0.05, y0: plot.y0 + 0.45, y1: plot.y1 - 0.1 };
  const tower = { x0: tx0, x1: tx1, y0: plot.y0 + 0.1, y1: plot.y1 - 0.15 };
  const thick = 0.5;
  const wallH = 3.3;
  const fz = 0.4;
  const pitch = 52;
  const stone = pick(r, ['ashlar', 'ashlar', 'rubble']);
  stakeOut(b, { x0: plot.x0, x1: plot.x1, y0: nave.y0, y1: nave.y1 });
  dig(b, [
    { a: [tower.x0, tower.y0 + 0.25], b: [nave.x1, nave.y0 + 0.25], w: 0.6 },
    { a: [nave.x1 - 0.25, nave.y0], b: [nave.x1 - 0.25, nave.y1], w: 0.6 },
    { a: [nave.x1, nave.y1 - 0.25], b: [tower.x0, tower.y1 - 0.25], w: 0.6 },
    { a: [tower.x0 + 0.25, tower.y1], b: [tower.x0 + 0.25, tower.y0], w: 0.6 },
  ], [[0.6, (nave.y0 + nave.y1) / 2], [-2.6, (nave.y0 + nave.y1) / 2]]);
  footing(b, nave, { h: fz, w: thick + 0.06, prefix: 'nave.ft' });
  footing(b, tower, { h: fz, w: thick + 0.06, prefix: 'tower.ft' });
  // the nave: lancet windows along the front
  const lancets = [nave.x0 + 1.4, nave.x0 + 2.8, nave.x1 - 0.9].filter((u) => u < nave.x1 - 0.6);
  const winZ0 = fz + 1.0;
  const winH = 1.6;
  const apex = fz + wallH + ((nave.y1 - nave.y0) / 2) * Math.tan((pitch * Math.PI) / 180) - 0.05;
  stoneShell(b, {
    rect: nave,
    thick,
    z0: fz,
    z1: fz + wallH,
    material: stone,
    dressed: stone === 'ashlar',
    quoins: 'ashlar',
    openings: { front: lancets.map((u) => ({ u0: u - 0.28, u1: u + 0.28, z0: winZ0, z1: winZ0 + winH, sill: true })), right: [{ u0: (nave.y0 + nave.y1) / 2 - 0.25, u1: (nave.y0 + nave.y1) / 2 + 0.25, z0: fz + wallH + 0.25, z1: fz + wallH + 0.75, lintel: 'none' }] },
    skip: { left: true },
    gables: { left: false, right: true, apex, pitchDeg: pitch },
    stage: (z) => (z < fz + wallH * 0.45 ? 'frame' : 'walls'),
    prefix: 'nave.',
  });
  // buttresses between the windows
  for (const [i, u] of [nave.x0 + 2.1, nave.x1 - 1.6, nave.x1 - 0.15].entries()) {
    for (let k = 0; k < 4; k++) {
      const h = (wallH * 0.8) / 4;
      const deep = 0.42 - k * 0.08;
      b.box(`buttress${i}.${k}`, 'buttress', [u, nave.y0 - deep / 2 + 0.02, fz + h * (k + 0.5)], [0.42, deep, h - 0.01], 'ashlar', k < 2 ? 'frame' : 'walls', [], { shape: 'stone', params: { dressed: 1 } });
    }
  }
  // the lancets: pointed heads of stone, stained glass
  lancets.forEach((u, i) => {
    b.slab(`lancet${i}.head`, 'lancet-head', [u, nave.y0 + thick / 2, winZ0 + winH], [
      [-0.38, 0],
      [0.38, 0],
      [0.38, 0.12],
      [0, 0.5],
      [-0.38, 0.12],
    ], thick + 0.02, 'ashlar', 'walls', []);
    const glass = ['stained-red', 'stained-blue', 'stained-gold'];
    for (let k = 0; k < 4; k++) b.box(`lancet${i}.glass${k}`, 'pane', [u, nave.y0 + 0.2, winZ0 + (winH / 4) * (k + 0.5)], [0.5, 0.02, winH / 4 - 0.03], glass[(i + k) % 3], 'walls', []);
    b.box(`lancet${i}.lead`, 'mullion', [u, nave.y0 + 0.18, winZ0 + winH / 2], [0.04, 0.03, winH], 'iron', 'walls', []);
  });
  // the round window in the east gable
  b.cyl('rose', 'rose', [nave.x1 + 0.01, (nave.y0 + nave.y1) / 2, fz + wallH + 0.5], 0.3, 0.3, 0.04, 'stained-gold', 'walls', [], { sides: 16, rot: [0, Math.PI / 2, 0] });
  b.box('interior', 'interior', [(nave.x0 + nave.x1) / 2 + 0.2, (nave.y0 + nave.y1) / 2, fz + wallH / 2], [nave.x1 - nave.x0 - thick * 2, nave.y1 - nave.y0 - thick * 2, wallH - 0.1], 'interior', 'roof', []);
  for (const [side, y] of [
    ['f', nave.y0 + thick / 2],
    ['b', nave.y1 - thick / 2],
  ] as const)
    b.beam(`nave.plate.${side}`, 'plate', [nave.x0, y, fz + wallH + 0.07], [nave.x1 - 0.05, y, fz + wallH + 0.07], [0.22, 0.14], 'walls', []);
  gableRoof(b, { x0: nave.x0, x1: nave.x1, y0: nave.y0, y1: nave.y1, zWall: fz + wallH + 0.14, pitchDeg: pitch, style: pick(r, ['tile', 'slate'] as const), eaves: 0.3, overL: 0, overR: plot.sides.right ? 0 : 0.2, stage: 'roof', prefix: 'roof.' });
  scaffold(b, { x0: nave.x0 + 0.3, x1: nave.x1 - 0.2, y: nave.y0 - 0.4, out: 0.45, height: fz + wallH, stage: 'frame' });

  // the tower: the door at its foot, a slit window, the belfry's openings, the spire
  const th = 7.1;
  const doorU = m(CHAPEL_DOOR.dx);
  const bz = fz + th - 1.5;
  stoneShell(b, {
    rect: tower,
    thick,
    z0: fz,
    z1: fz + th,
    material: stone,
    dressed: stone === 'ashlar',
    quoins: 'ashlar',
    openings: {
      front: [
        { u0: doorU - 0.48, u1: doorU + 0.48, z0: fz, z1: fz + 2.05 },
        { u0: doorU - 0.1, u1: doorU + 0.1, z0: fz + 3.3, z1: fz + 4.1, sill: true },
        { u0: (tower.x0 + tower.x1) / 2 - 0.35, u1: (tower.x0 + tower.x1) / 2 + 0.35, z0: bz, z1: bz + 1.1, lintel: 'stone' },
      ],
      back: [{ u0: (tower.x0 + tower.x1) / 2 - 0.35, u1: (tower.x0 + tower.x1) / 2 + 0.35, z0: bz, z1: bz + 1.1 }],
      left: [{ u0: (tower.y0 + tower.y1) / 2 - 0.35, u1: (tower.y0 + tower.y1) / 2 + 0.35, z0: bz, z1: bz + 1.1 }],
      right: [{ u0: (tower.y0 + tower.y1) / 2 - 0.35, u1: (tower.y0 + tower.y1) / 2 + 0.35, z0: bz, z1: bz + 1.1 }],
    },
    stage: (z) => (z < fz + 2.8 ? 'frame' : 'walls'),
    prefix: 'tower.',
    courseH: 0.32,
  });
  door(b, { wall: { side: 'front', face: tower.y0, thick }, u: doorU, w: 0.92, h: 2.0, z0: fz, name: 'door', hinge: 'left', frame: false, arched: true, wood: 'oak' });
  b.slab('door.arch', 'arch', [doorU, tower.y0 + thick / 2, fz + 2.05], [
    [-0.62, 0],
    [0.62, 0],
    [0.62, 0.22],
    [0, 0.5],
    [-0.62, 0.22],
  ], thick + 0.04, 'ashlar', 'frame', []);
  b.box('tower.interior', 'interior', [(tower.x0 + tower.x1) / 2, (tower.y0 + tower.y1) / 2, fz + th / 2], [tw - thick * 2 + 0.02, tower.y1 - tower.y0 - thick * 2 + 0.02, th - 0.2], 'soot', 'roof', []);
  // the bell, hung from a beam across the belfry, swinging when rung
  const bc: Vec3 = [(tower.x0 + tower.x1) / 2, (tower.y0 + tower.y1) / 2, bz + 0.95];
  b.beam('bell.beam', 'beam', [tower.x0 + 0.2, bc[1], bc[2] + 0.1], [tower.x1 - 0.2, bc[1], bc[2] + 0.1], [0.16, 0.16], 'roof', [], 'oak');
  b.part('bell', { kind: 'swing', pivot: bc, axis: [1, 0, 0] }, () => {
    b.cyl('bell', 'bell', [bc[0], bc[1], bc[2] - 0.62], 0.33, 0.17, 0.48, 'bronze', 'roof', [], { sides: 16 });
    b.cyl('bell.crown', 'bell', [bc[0], bc[1], bc[2] - 0.15], 0.1, 0.06, 0.15, 'bronze', 'roof', [], { sides: 8 });
    b.box('bell.lip', 'bell', [bc[0], bc[1], bc[2] - 0.64], [0.68, 0.68, 0.05], 'bronze', 'roof', [], { shape: 'dome' });
  });
  // the spire, eight-sided, slated, a gilt cross on it
  const st = fz + th;
  b.box('tower.cornice', 'cornice', [(tower.x0 + tower.x1) / 2, (tower.y0 + tower.y1) / 2, st + 0.08], [tw + 0.12, tower.y1 - tower.y0 + 0.12, 0.16], 'ashlar', 'roof', [], { shape: 'stone', params: { dressed: 1 } });
  const spireTop = coneRoof(b, { cx: (tower.x0 + tower.x1) / 2, cy: (tower.y0 + tower.y1) / 2, r: tw * 0.66, z: st + 0.16, h: 4.6, style: 'slate', prefix: 'spire.', sides: 8 });
  b.beam('cross.v', 'cross', [bc[0], bc[1], spireTop - 0.1], [bc[0], bc[1], spireTop + 0.75], [0.06, 0.06], 'roof', [], 'gold');
  b.beam('cross.h', 'cross', [bc[0] - 0.22, bc[1], spireTop + 0.48], [bc[0] + 0.22, bc[1], spireTop + 0.48], [0.05, 0.05], 'roof', [], 'gold');
  scaffold(b, { x0: tower.x0 + 0.2, x1: tower.x1 - 0.2, y: tower.y0, out: 0.5, height: fz + th, stage: 'frame', prefix: 'tscaffold.' });

  b.point('door', [doorU, plot.y0, 0]);
  b.point('bell', bc);
  return b.model();
}

export function market(seed: number, plot: Plot): Model {
  const b = new ModelBuilder(seed, plot);
  const r = b.rng('market');
  stakeOut(b, { x0: plot.x0 + 0.2, x1: plot.x1 - 0.2, y0: plot.y0 + 0.2, y1: plot.y1 - 0.2 });
  dig(b, [{ a: [plot.x0 + 0.45, plot.y0 + 0.65], b: [plot.x1 - 0.45, plot.y0 + 0.65], w: 0.25 }, { a: [plot.x1 - 0.45, plot.y1 - 0.25], b: [plot.x0 + 0.45, plot.y1 - 0.25], w: 0.25 }], [[0, (plot.y0 + plot.y1) / 2]]);
  b.box('square', 'square', [0, (plot.y0 + plot.y1) / 2, 0.003], [plot.W - 0.15, plot.D - 0.15, 0.003], 'earth', 'foundation', [], { shape: 'patch' });
  const cloths = [
    ['cloth-red', 'cloth-white'],
    ['cloth-blue', 'cloth-yellow'],
    ['cloth-green', 'cloth-white'],
  ];
  const goods = [
    ['apples', 'produce', 'greens'],
    ['bread', 'linen', 'wicker'],
    ['produce', 'apples', 'sacking'],
  ];
  const n = plot.W > 6 ? 2 : 1;
  const sw = (plot.W - 0.6) / n - 0.3;
  for (let s = 0; s < n; s++) {
    const cx = plot.x0 + 0.45 + sw / 2 + s * (sw + 0.3);
    const y0 = plot.y0 + 0.65;
    const y1 = plot.y1 - 0.25;
    const pre = `stall${s}.`;
    const [c1, c2] = pick(r, cloths);
    // posts: taller at the front
    for (const [i, [px, py, h]] of ([
      [cx - sw / 2, y0, 2.35],
      [cx + sw / 2, y0, 2.35],
      [cx - sw / 2, y1, 2.0],
      [cx + sw / 2, y1, 2.0],
    ] as Array<[number, number, number]>).entries()) {
      b.box(`${pre}pad${i}`, 'pad-stone', [px, py, 0.06], [0.22, 0.22, 0.12], 'fieldstone', 'foundation', [], { shape: 'stone' });
      b.box(`${pre}post${i}`, 'post', [px, py, h / 2 + 0.1], [0.1, 0.1, h], 'pole', 'frame', []);
    }
    for (const [side, y, h] of [
      ['f', y0, 2.4],
      ['b', y1, 2.05],
    ] as const)
      b.beam(`${pre}rail${side}`, 'rail', [cx - sw / 2 - 0.05, y, h], [cx + sw / 2 + 0.05, y, h], [0.08, 0.08], 'frame', [], 'pole');
    // the counter: boards on trestles
    b.box(`${pre}counter`, 'counter', [cx, y0 + 0.28, 0.85], [sw - 0.1, 0.5, 0.06], 'planks', 'walls', []);
    b.box(`${pre}front`, 'counter', [cx, y0 + 0.05, 0.45], [sw - 0.1, 0.04, 0.78], 'boards', 'walls', []);
    // a back cloth hung between the back posts
    b.box(`${pre}back`, 'cloth', [cx, y1 + 0.02, 1.35], [sw, 0.02, 1.25], c2, 'walls', []);
    // the awning in stripes, from the back rail out over the front
    const stripes = Math.max(4, Math.round(sw / 0.32));
    for (let k = 0; k < stripes; k++) {
      const x0 = cx - sw / 2 - 0.12 + ((sw + 0.24) * k) / stripes;
      const x1 = x0 + (sw + 0.24) / stripes;
      b.add({ id: `${pre}awning${k}`, kind: 'awning', material: k % 2 ? c1 : c2, stage: 'roof', shape: 'course', params: { x0, x1, yl: y0 - 0.45, zl: 2.2, yu: y1 + 0.05, zu: 2.12 + 0.28, thickness: 0.02, style: 4, lip: 0 } });
      // the scalloped valance
      b.box(`${pre}valance${k}`, 'valance', [(x0 + x1) / 2, y0 - 0.46, 2.12], [x1 - x0 - 0.01, 0.015, 0.18], k % 2 ? c1 : c2, 'roof', []);
    }
    // goods on the counter
    const g = goods[(s + Math.floor(r() * 3)) % 3];
    for (let i = 0; i < Math.floor(sw / 0.22); i++) {
      const gx = cx - sw / 2 + 0.2 + i * 0.22;
      const mat = g[i % g.length];
      if (mat === 'linen' || mat === 'sacking') b.log(`${pre}bolt${i}`, 'bolt', [gx, y0 + 0.12, 0.95], [gx, y0 + 0.42, 0.95], 0.07, 'roof', [], mat);
      else if (mat === 'wicker') b.cyl(`${pre}basket${i}`, 'basket', [gx, y0 + 0.28, 0.88], 0.08, 0.1, 0.1, 'wicker', 'roof', [], { sides: 10 });
      else for (let k = 0; k < 3; k++) b.box(`${pre}good${i}.${k}`, 'goods', [gx + (k - 1) * 0.055, y0 + 0.2 + (k % 2) * 0.1, 0.88], [0.05, 0.05, 0.05], mat, 'roof', [], { shape: 'dome' });
    }
  }
  crate(b, 'crate0', plot.x0 + 0.3, plot.y0 + 0.3, 0.4);
  crate(b, 'crate1', plot.x0 + 0.32, plot.y0 + 0.3, 0.32, 0.4);
  barrel(b, 'barrel0', plot.x1 - 0.32, plot.y0 + 0.3, { r: 0.22, h: 0.68 });
  barrel(b, 'barrel1', plot.x1 - 0.8, plot.y0 + 0.28, { r: 0.2, h: 0.62 });
  return b.model();
}

export function watchtower(seed: number, plot: Plot): Model {
  const b = new ModelBuilder(seed, plot);
  const r = b.rng('tower');
  const cx = 0;
  const cy = (plot.y0 + plot.y1) / 2;
  const hw = plot.W / 2 - 0.35;
  const hd = plot.D / 2 - 0.32;
  const H = uniform(r, 6.2, 6.8);
  const tw = 1.25;
  const td = 1.0;
  stakeOut(b, { x0: cx - hw, x1: cx + hw, y0: cy - hd, y1: cy + hd });
  const feet: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  dig(b, feet.map(([sx, sy]) => ({ a: [cx + sx * hw - 0.2, cy + sy * hd] as [number, number], b: [cx + sx * hw + 0.2, cy + sy * hd] as [number, number], w: 0.45 })), [[cx, cy]]);
  feet.forEach(([sx, sy], i) => b.box(`pad${i}`, 'pad-stone', [cx + sx * hw, cy + sy * hd, 0.15], [0.5, 0.5, 0.3], 'fieldstone', 'foundation', [], { shape: 'stone' }));
  // the legs, leaning in to the platform
  const at = (sx: number, sy: number, z: number): Vec3 => {
    const f = z / H;
    return [cx + sx * (hw + (tw - hw) * f), cy + sy * (hd + (td - hd) * f), z];
  };
  feet.forEach(([sx, sy], i) => b.log(`leg${i}`, 'leg', at(sx, sy, 0.28), at(sx, sy, H + 0.2), 0.13, 'frame', [`pad${i}`], 'logs'));
  // bracing: a ring and crossed braces on each face, three lifts
  const lifts = 3;
  for (let k = 0; k < lifts; k++) {
    const z0 = 0.5 + ((H - 0.5) * k) / lifts;
    const z1 = 0.5 + ((H - 0.5) * (k + 1)) / lifts;
    for (let f = 0; f < 4; f++) {
      const [ax, ay] = feet[f];
      const [bx, by] = feet[(f + 1) % 4];
      b.log(`ring${k}.${f}`, 'ring', at(ax, ay, z1), at(bx, by, z1), 0.065, 'frame', [], 'logs');
      b.log(`x${k}.${f}a`, 'brace', at(ax, ay, z0), at(bx, by, z1), 0.05, 'frame', [], 'logs');
      b.log(`x${k}.${f}b`, 'brace', at(bx, by, z0), at(ax, ay, z1), 0.05, 'frame', [], 'logs');
    }
  }
  // the ladder up the front
  ladder(b, 'ladder', [cx + 0.35, cy - hd + 0.15, 0], [cx + 0.35, cy - td + 0.05, H + 0.1], 0.42, 'walls');
  // the platform and the cabin: a floor, posts, boarded walls to the waist, open above, a pyramid roof
  const pw = tw + 0.4;
  const pd = td + 0.4;
  b.box('floor', 'floor', [cx, cy, H + 0.3], [pw * 2, pd * 2, 0.08], 'boards', 'walls', []);
  for (const [i, [sx, sy]] of feet.entries()) b.box(`cabin.post${i}`, 'post', [cx + sx * (pw - 0.06), cy + sy * (pd - 0.06), H + 1.45], [0.11, 0.11, 2.2], 'oak', 'walls', []);
  for (const [side, y, along] of [
    ['f', cy - pd + 0.02, true],
    ['b', cy + pd - 0.02, true],
    ['l', cx - pw + 0.02, false],
    ['r', cx + pw - 0.02, false],
  ] as const) {
    const n = Math.round(((along ? pw : pd) * 2) / 0.2);
    for (let k = 0; k < n; k++) {
      const u = -(along ? pw : pd) + ((along ? pw : pd) * 2 * (k + 0.5)) / n;
      if (side === 'f' && Math.abs(u - 0.35) < 0.25) continue; // the hatch for the ladder
      const h = 1.0 + (k % 3) * 0.02;
      b.box(`cabin.${side}${k}`, 'board', along ? [cx + u, y, H + 0.34 + h / 2] : [y, cy + u, H + 0.34 + h / 2], along ? [0.19, 0.035, h] : [0.035, 0.19, h], 'boards', 'walls', []);
    }
    b.beam(`cabin.rail${side}`, 'rail', along ? [cx - pw, y, H + 1.38] : [y, cy - pd, H + 1.38], along ? [cx + pw, y, H + 1.38] : [y, cy + pd, H + 1.38], [0.1, 0.08], 'walls', []);
  }
  const roofTop = pyramidRoof(b, { cx, cy, w: pw * 2 + 0.5, d: pd * 2 + 0.5, z: H + 2.55, h: 1.6, style: 'shingle', prefix: 'roof.' });
  // the banner on its pole
  b.beam('flagpole', 'pole', [cx, cy, roofTop - 0.1], [cx, cy, roofTop + 1.3], [0.05, 0.05], 'roof', [], 'pole');
  b.part('banner', { kind: 'sway', pivot: [cx, cy, roofTop + 1.2], axis: [0, 0, 1] }, () => {
    b.box('banner.cloth', 'banner', [cx + 0.38, cy, roofTop + 1.0], [0.7, 0.02, 0.4], 'cloth-red', 'roof', []);
    b.box('banner.charge', 'banner', [cx + 0.38, cy - 0.012, roofTop + 1.0], [0.18, 0.005, 0.18], 'cloth-yellow', 'roof', []);
  });
  // the brazier on the platform
  const bz = H + 0.34;
  b.cyl('brazier.leg', 'brazier', [cx + 0.55, cy + 0.2, bz], 0.04, 0.04, 0.55, 'iron', 'roof', [], { sides: 6 });
  b.cyl('brazier.bowl', 'brazier', [cx + 0.55, cy + 0.2, bz + 0.55], 0.12, 0.24, 0.16, 'iron', 'roof', [], { sides: 12 });
  b.box('brazier.fire', 'fire', [cx + 0.55, cy + 0.2, bz + 0.715], [0.36, 0.36, 0.004], 'fire', 'roof', [], { shape: 'patch', params: { round: 1 } });
  b.point('flue:0', [cx + 0.55, cy + 0.2, bz + 0.8]);
  b.point('guard', [cx - 0.3, cy - pd, bz]);
  return b.model();
}

export function warehouse(seed: number, plot: Plot): Model {
  const b = new ModelBuilder(seed, plot);
  const r = b.rng('yard');
  stakeOut(b, { x0: plot.x0 + 0.1, x1: plot.x1 - 0.1, y0: plot.y0 + 0.1, y1: plot.y1 - 0.1 });
  // holes for the fence stakes and the shed's posts
  dig(b, [{ a: [plot.x0 + 0.1, plot.y1 - 0.12], b: [plot.x1 - 0.1, plot.y1 - 0.12], w: 0.25 }], [[0, (plot.y0 + plot.y1) / 2]]);
  b.box('yard', 'yard', [0, (plot.y0 + plot.y1) / 2, 0.003], [plot.W - 0.12, plot.D - 0.12, 0.003], 'earth', 'foundation', [], { shape: 'patch' });
  // the wattle fence round the back and the ends
  const fy = plot.y1 - 0.06;
  const segs = Math.max(2, Math.round(plot.W / 1.25));
  for (let i = 0; i < segs; i++) wattleFence(b, `fence.b${i}`, [plot.x0 + 0.05 + ((plot.W - 0.1) * i) / segs, fy], [plot.x0 + 0.05 + ((plot.W - 0.1) * (i + 1)) / segs, fy], 0.9, 'frame');
  for (const [s, x] of [
    ['l', plot.x0 + 0.06],
    ['r', plot.x1 - 0.06],
  ] as const)
    wattleFence(b, `fence.${s}`, [x, plot.y1 - 0.06], [x, plot.y0 + 0.9], 0.9, 'frame');
  // the shed: posts, a back wall of boards, shelves, a thatched roof sloping back
  const k = plot.size;
  const sx0 = -1.55 * Math.max(0.75, k / 2) - 0.05;
  const sx1 = 1.65 * Math.max(0.75, k / 2) + 0.05;
  const sy0 = plot.y1 - 1.3;
  const sy1 = plot.y1 - 0.18;
  footing(b, { x0: sx0, x1: sx1, y0: sy0, y1: sy1 }, { h: 0.18, w: 0.24, courses: 1, prefix: 'shed.ft' });
  const nPosts = Math.max(2, Math.round((sx1 - sx0) / 1.2) + 1);
  for (let i = 0; i < nPosts; i++) {
    const x = sx0 + 0.07 + ((sx1 - sx0 - 0.14) * i) / (nPosts - 1);
    b.box(`shed.postf${i}`, 'post', [x, sy0 + 0.07, 1.25], [0.13, 0.13, 2.5], 'oak', 'frame', []);
    b.box(`shed.postb${i}`, 'post', [x, sy1 - 0.07, 1.0], [0.13, 0.13, 2.0], 'oak', 'frame', []);
  }
  b.beam('shed.plate', 'plate', [sx0, sy0 + 0.07, 2.52], [sx1, sy0 + 0.07, 2.52], [0.14, 0.12], 'frame', []);
  for (let j = 0; j < 5; j++) b.box(`shed.back${j}`, 'board', [(sx0 + sx1) / 2, sy1 + 0.01, 0.22 + j * 0.4], [sx1 - sx0, 0.035, 0.38], 'boards', 'walls', []);
  for (const z of [1.08, 1.56]) b.box(`shed.shelf${z}`, 'shelf', [(sx0 + sx1) / 2, sy1 - 0.25, z], [sx1 - sx0 - 0.2, 0.36, 0.04], 'planks', 'walls', []);
  leanTo(b, { x0: sx0 - 0.2, x1: sx1 + 0.2, yLow: plot.y1 - 0.03, zLow: 2.12, yHigh: sy0 - 0.35, zHigh: 2.72, style: pick(r, ['thatch', 'shingle'] as const), prefix: 'shed.roof.' });
  void window_;
  void gableRoof;
  return b.model();
}
