// The craftsmen's places.
// - The woodcutter's hut: a log cabin at the back of its plot under a board
//   roof, a lean-to of round logs waiting to be sawn beside it, and in front,
//   by the street, the wood yard: a cord of split wood stacked per load
//   (stock.ts), the chopping block with the axe in it, a sawbuck, chips.
// - The stonecutter's hut: a squat rubble hut under slates, a mason's
//   banker in front with a block on it, and the yard beside it with a shelter,
//   rough stone, and the dressed blocks set down by the street (stock.ts).
// - The bakery: a bakehouse, stone below and timber-framed, under tiles, with
//   a bench for the baskets of loaves in front; the domed clay oven built on at
//   the side under its own little roof, its mouth glowing while it burns, its
//   flue smoking (a furnace: game/hearth.ts).
// - The smithy: stone back and side walls, open to the street, slates; the
//   forge against the back wall, its coals glowing, its great chimney; the
//   bellows, the anvil on its stump, a quench tub, tools on the wall.

import { BAKERY_DOOR, BAKERY_OVEN_MOUTH_DX, SMITHY_DOOR, STONECUTTER_DOOR, WOODCUTTER_DOOR } from '../../game/layout';
import { pick, uniform, type Vec3 } from './elements';
import { body } from './kit/body';
import { chimney, footing, stoneShell } from './kit/masonry';
import { anvil, barrel, bench, block, choppingBlock, crate, hangingSign, sawbuck, trough } from './kit/props';
import { gableRoof, leanTo } from './kit/roof';
import { dig, stakeOut } from './kit/site';
import { type Model, ModelBuilder } from './model';
import { m, type Plot } from './plot';

export function woodcutter(seed: number, plot: Plot): Model {
  const b = new ModelBuilder(seed, plot);
  const r = b.rng('woodcutter');
  const yardD = 1.3;
  const hx1 = 0.75;
  // the log ends stand out past the corners: the walls keep that far inside the plot
  const rect = { x0: plot.x0 + 0.26, x1: hx1, y0: plot.y0 + yardD, y1: plot.y1 - 0.26 };
  const doorU = m(WOODCUTTER_DOOR.dx);
  const info = body(b, {
    rect,
    footing: { h: 0.3, w: 0.38 },
    storeys: [{ kind: 'log', h: 2.05 }],
    roof: { style: pick(r, ['shingle', 'boards'] as const), pitchDeg: 38, eaves: 0.35, overL: plot.sides.left ? 0 : 0.3, overR: 0.3, gableFill: 'boards' },
    openings: [
      { kind: 'door', side: 'front', u: doorU, w: 0.84, h: 1.75, storey: 0, name: 'door', hinge: 'left' },
      { kind: 'window', side: 'front', u: rect.x0 + 0.95, w: 0.5, h: 0.48, storey: 0, sill: 0.95, name: 'window0', shutters: 'single' },
    ],
    chimneys: [{ x: rect.x0 + 0.5, material: 'fieldstone' }],
    noScaffold: true,
  });
  // the log shed beside the hut: posts, a back wall of boards, a roof sloping back, round logs under it
  const sx0 = hx1 + 0.08;
  const sx1 = plot.x1 - 0.05;
  const sy0 = plot.y0 + yardD + 0.2;
  const sy1 = plot.y1 - 0.08;
  for (const [i, [px, py]] of ([
    [sx0 + 0.1, sy0],
    [sx1 - 0.1, sy0],
    [(sx0 + sx1) / 2, sy0],
    [sx0 + 0.1, sy1],
    [sx1 - 0.1, sy1],
  ] as Array<[number, number]>).entries()) {
    const h = py === sy0 ? 2.45 : 2.08;
    b.box(`shed.post${i}`, 'post', [px, py, h / 2], [0.14, 0.14, h], 'pole', 'frame', []);
  }
  b.beam('shed.plate.f', 'plate', [sx0, sy0, 2.5], [sx1, sy0, 2.5], [0.13, 0.12], 'frame', [], 'pole');
  b.beam('shed.plate.b', 'plate', [sx0, sy1, 2.13], [sx1, sy1, 2.13], [0.13, 0.12], 'frame', [], 'pole');
  leanTo(b, { x0: sx0 - 0.15, x1: sx1 + (plot.sides.right ? 0.02 : 0.25), yLow: plot.y1 - 0.03, zLow: 2.2, yHigh: sy0 - 0.3, zHigh: 2.72, style: 'boards', prefix: 'shed.roof.' });
  for (let k = 0; k < 4; k++) b.box(`shed.wall${k}`, 'board', [(sx0 + sx1) / 2, sy1 + 0.04, 0.25 + k * 0.42], [sx1 - sx0, 0.035, 0.4], 'boards', 'walls', []);
  // round logs stacked lengthwise under it, ends to the street
  const rows = [5, 4, 3];
  rows.forEach((n, row) => {
    for (let i = 0; i < n; i++) {
      const rr = uniform(r, 0.11, 0.15);
      const x = sx0 + 0.35 + ((sx1 - sx0 - 0.7) * (i + row * 0.5)) / Math.max(1, rows[0] - 1);
      b.log(`shed.log${row}.${i}`, 'log', [x, sy0 + 0.05, 0.15 + row * 0.24], [x + uniform(r, -0.05, 0.05), sy1 - 0.1, 0.15 + row * 0.24], rr, 'roof', [], 'logs');
    }
  });
  // the yard: chopping block, sawbuck, a trodden patch with chips
  b.box('yard', 'yard', [(plot.x0 + plot.x1) / 2, plot.y0 + yardD / 2, 0.003], [plot.W - 0.2, yardD - 0.1, 0.003], 'earth', 'roof', [], { shape: 'patch' });
  choppingBlock(b, 'block', plot.x0 + 0.75, plot.y0 + 0.55);
  sawbuck(b, 'sawbuck', -1.75, plot.y0 + 0.7);
  hangingSign(b, 'sign', rect.x0 + 0.2, rect.y0 - 0.02, 2.0, 'sign-axe');

  b.point('door', [doorU, plot.y0, 0]);
  info.smoke.forEach((p, i) => b.point(`smoke:${i}`, p));
  b.point('sleep:0', [rect.x0 + 1, rect.y0, 2.9]);
  return b.model();
}

export function stonecutter(seed: number, plot: Plot): Model {
  const b = new ModelBuilder(seed, plot);
  const r = b.rng('stonecutter');
  const hx1 = 0.85;
  const rect = { x0: plot.x0 + 0.05, x1: hx1, y0: plot.y0 + 0.6, y1: plot.y1 - 0.05 };
  const doorU = m(STONECUTTER_DOOR.dx);
  const info = body(b, {
    rect,
    footing: { h: 0.32 },
    storeys: [{ kind: 'stone', h: 1.95, material: pick(r, ['rubble', 'fieldstone']), thick: 0.38, quoins: 'ashlar' }],
    roof: { style: 'slate', pitchDeg: 40, eaves: 0.3, overL: plot.sides.left ? 0 : 0.25, overR: 0.25 },
    openings: [
      { kind: 'door', side: 'front', u: doorU, w: 0.84, h: 1.72, storey: 0, name: 'door', hinge: 'right' },
      { kind: 'window', side: 'front', u: rect.x0 + 0.9, w: 0.5, h: 0.46, storey: 0, sill: 0.9, name: 'window0', shutters: 'single' },
    ],
    chimneys: [{ x: rect.x0 + 0.5 }],
    stoneGables: { left: true, right: true },
    noScaffold: true,
  });
  // the yard's shelter: posts and a slate lean-to over the banker's spot at the back
  const sx0 = hx1 + 0.15;
  const sx1 = plot.x1 - 0.08;
  const sy1 = plot.y1 - 0.1;
  for (const [i, x] of [sx0, sx1].entries()) {
    b.box(`shelter.post${i}f`, 'post', [x, sy1 - 1.05, 1.25], [0.13, 0.13, 2.5], 'oak', 'frame', []);
    b.box(`shelter.post${i}b`, 'post', [x, sy1, 1.05], [0.13, 0.13, 2.1], 'oak', 'frame', []);
  }
  leanTo(b, { x0: sx0 - 0.1, x1: sx1 + (plot.sides.right ? 0.02 : 0.2), yLow: plot.y1 - 0.03, zLow: 2.2, yHigh: sy1 - 1.35, zHigh: 2.62, style: 'slate', prefix: 'shelter.roof.' });
  // rough stone from the quarry under it, a banker with a block being dressed
  for (let i = 0; i < 6; i++) {
    const rr = b.rng(`rough${i}`);
    b.box(`rough${i}`, 'rough-stone', [sx0 + 0.35 + uniform(rr, 0, sx1 - sx0 - 0.7), sy1 - 0.45 + uniform(rr, -0.25, 0.25), 0.18 + (i > 3 ? 0.28 : 0)], [uniform(rr, 0.35, 0.6), uniform(rr, 0.3, 0.45), uniform(rr, 0.25, 0.35)], 'rubble', 'roof', [], { shape: 'stone', rot: [0, 0, uniform(rr, -0.4, 0.4)] });
  }
  const bx = plot.x0 + 0.65;
  const by = plot.y0 + 0.3;
  b.box('banker', 'banker', [bx, by, 0.6], [0.7, 0.42, 0.12], 'oak', 'roof', []);
  for (const s of [-1, 1]) b.box(`banker.leg${s}`, 'leg', [bx + s * 0.26, by, 0.27], [0.1, 0.36, 0.54], 'oak', 'roof', []);
  block(b, 'banker.block', bx, by, 0.66, [0.42, 0.3, 0.26]);
  b.box('mallet', 'tool', [bx + 0.28, by - 0.08, 0.7], [0.12, 0.08, 0.08], 'oak', 'roof', []);
  // stone chips on the ground
  for (let i = 0; i < 10; i++) {
    const rr = b.rng(`chip${i}`);
    b.box(`chip${i}`, 'chips', [bx + uniform(rr, -0.6, 0.7), by + uniform(rr, -0.1, 0.3), 0.012], [0.07, 0.05, 0.025], 'ashlar', 'roof', [], { shape: 'stone' });
  }

  b.point('door', [doorU, plot.y0, 0]);
  info.smoke.forEach((p, i) => b.point(`smoke:${i}`, p));
  b.point('sleep:0', [rect.x0 + 1, rect.y0, 2.8]);
  return b.model();
}

export function bakery(seed: number, plot: Plot): Model {
  const b = new ModelBuilder(seed, plot);
  const r = b.rng('bakery');
  const hx1 = 1.95;
  const rect = { x0: plot.x0, x1: hx1, y0: plot.y0 + 0.58, y1: plot.y1 - 0.03 };
  const doorU = m(BAKERY_DOOR.dx);
  const info = body(b, {
    rect,
    footing: { h: 0.4 },
    storeys: [{ kind: 'frame', h: 2.3, infill: 'daub', material: pick(r, ['daub', 'daub-ochre']) }],
    roof: { style: 'tile', pitchDeg: 45, eaves: 0.35, overL: plot.sides.left ? 0 : 0.28, overR: 0.15, gableFill: 'daub' },
    openings: [
      { kind: 'door', side: 'front', u: doorU, w: 0.9, h: 1.82, storey: 0, name: 'door', hinge: 'left' },
      { kind: 'window', side: 'front', u: rect.x0 + 0.95, w: 0.66, h: 0.62, storey: 0, sill: 0.85, name: 'window0', shutters: 'pair' },
      { kind: 'window', side: 'front', u: hx1 - 0.8, w: 0.66, h: 0.62, storey: 0, sill: 0.85, name: 'window1', shutters: 'pair' },
    ],
    chimneys: [{ x: rect.x0 + 0.55 }],
  });
  // a bench for the bread baskets in front, a sign with a loaf
  bench(b, 'bench', m(21), plot.y0 + 0.3, 1.45, { h: 0.44, depth: 0.36 });
  hangingSign(b, 'sign', rect.x0 + 0.25, rect.y0 - 0.01, 2.68, 'sign-loaf');

  // the oven: a stone plinth, the clay dome on it laid ring by ring, its mouth facing the street
  const ox = m(BAKERY_OVEN_MOUTH_DX);
  const oy = plot.y0 + 1.25;
  const ow = 1.3;
  const od = 1.75;
  const oz = 0.62;
  stakeOut(b, { x0: ox - ow / 2, x1: ox + ow / 2, y0: oy - od / 2, y1: oy + od / 2 }, 'oven.');
  dig(b, [{ a: [ox - ow / 2, oy - od / 2 + 0.15], b: [ox + ow / 2, oy - od / 2 + 0.15], w: 0.35 }, { a: [ox + ow / 2, oy + od / 2 - 0.15], b: [ox - ow / 2, oy + od / 2 - 0.15], w: 0.35 }], [[ox, oy]], 'oven.');
  footing(b, { x0: ox - ow / 2, x1: ox + ow / 2, y0: oy - od / 2, y1: oy + od / 2 }, { h: 0.3, w: 0.35, prefix: 'oven.ft', courses: 1 });
  stoneShell(b, { rect: { x0: ox - ow / 2, x1: ox + ow / 2, y0: oy - od / 2, y1: oy + od / 2 }, thick: 0.3, z0: 0.3, z1: oz, material: 'fieldstone', stage: () => 'frame', prefix: 'oven.base.', courseH: 0.16 });
  b.box('oven.hearth', 'hearth', [ox, oy, oz + 0.04], [ow - 0.1, od - 0.1, 0.08], 'ashlar', 'frame', [], { shape: 'stone', params: { dressed: 1 } });
  // the dome, in rings (each a little smaller), then a skin of clay over it
  const R = 0.66;
  for (let k = 0; k < 5; k++) {
    const z0 = oz + 0.08 + (k / 5) * R * 0.95;
    const r0 = Math.sqrt(Math.max(0, 1 - ((z0 - oz - 0.08) / (R * 0.95)) ** 2)) * R;
    const r1 = Math.sqrt(Math.max(0, 1 - ((z0 - oz - 0.08 + (R * 0.95) / 5) / (R * 0.95)) ** 2)) * R;
    b.cyl(`oven.ring${k}`, 'oven', [ox, oy, z0], r0, Math.max(0.05, r1), (R * 0.95) / 5, 'brick', 'walls', [], { sides: 14 });
  }
  b.box('oven.dome', 'oven', [ox, oy, oz + 0.08], [R + 0.05, R + 0.12, R * 1.0], 'clay', 'walls', [], { shape: 'dome' });
  // the mouth: an arch of stone, the dark inside, the embers (glowing with the fire)
  const mouthY = oy - R - 0.04;
  b.box('oven.mouth', 'oven-mouth', [ox, mouthY + 0.02, oz + 0.25], [0.46, 0.18, 0.36], 'ashlar', 'walls', [], { shape: 'stone', params: { dressed: 1 } });
  b.box('oven.dark', 'oven-mouth', [ox, mouthY - 0.075, oz + 0.22], [0.32, 0.02, 0.26], 'interior', 'walls', []);
  b.box('oven.embers', 'embers', [ox, mouthY - 0.08, oz + 0.12], [0.3, 0.025, 0.07], 'fire', 'walls', []);
  const flue = chimney(b, { x: ox + 0.15, y: oy + 0.35, w: 0.3, d: 0.3, z0: oz + R * 0.6, z1: 3.35, roofZ: 2.45, material: 'brick', prefix: 'oven.flue.' });
  // its little roof on four posts
  for (const [i, [px, py]] of ([
    [ox - ow / 2 - 0.05, oy - od / 2 - 0.05],
    [ox + ow / 2 + 0.05, oy - od / 2 - 0.05],
    [ox - ow / 2 - 0.05, oy + od / 2 + 0.05],
    [ox + ow / 2 + 0.05, oy + od / 2 + 0.05],
  ] as Array<[number, number]>).entries())
    b.box(`oven.post${i}`, 'post', [Math.min(plot.x1 - 0.08, px), py, 1.15], [0.12, 0.12, 2.3], 'oak', 'frame', []);
  gableRoof(b, { x0: ox - ow / 2 - 0.1, x1: Math.min(plot.x1 - 0.02, ox + ow / 2 + 0.1), y0: oy - od / 2 - 0.1, y1: oy + od / 2 + 0.1, zWall: 2.3, pitchDeg: 35, style: 'shingle', eaves: 0.2, overL: 0, overR: plot.sides.right ? 0 : 0.15, stage: 'roof', prefix: 'oven.roof.' });
  // a peel leaning by the oven, a stack of firewood
  b.beam('peel', 'peel', [ox - ow / 2 - 0.22, oy - 0.3, 0], [ox - ow / 2 - 0.1, oy - 0.25, 1.7], [0.04, 0.04], 'roof', [], 'pole');
  b.box('peel.blade', 'peel', [ox - ow / 2 - 0.23, oy - 0.3, 0.12], [0.03, 0.28, 0.24], 'planks', 'roof', []);
  for (let i = 0; i < 6; i++) b.log(`kindling${i}`, 'billet', [ox + ow / 2 - 0.25 + (i % 3) * 0.13, oy + od / 2 - 0.2, 0.07 + Math.floor(i / 3) * 0.12], [ox + ow / 2 - 0.25 + (i % 3) * 0.13, oy + od / 2 - 0.65, 0.07 + Math.floor(i / 3) * 0.12], 0.06, 'roof', [], 'logs');

  b.point('door', [doorU, plot.y0, 0]);
  info.smoke.forEach((p, i) => b.point(`smoke:${i}`, p));
  b.point('flue:0', flue);
  b.point('oven', [ox, mouthY, oz + 0.2]);
  b.point('sleep:0', [rect.x0 + 1, rect.y0, 3.3]);
  return b.model();
}

export function blacksmith(seed: number, plot: Plot): Model {
  const b = new ModelBuilder(seed, plot);
  const r = b.rng('smithy');
  const rect = { x0: plot.x0, x1: plot.x1, y0: plot.y0 + 0.15, y1: plot.y1 - 0.03 };
  const thick = 0.42;
  const wallH = 2.45;
  stakeOut(b, rect);
  dig(b, [
    { a: [rect.x0, rect.y1 - 0.2], b: [rect.x1, rect.y1 - 0.2], w: 0.5 },
    { a: [rect.x0 + 0.2, rect.y1], b: [rect.x0 + 0.2, rect.y0], w: 0.5 },
    { a: [rect.x1 - 0.2, rect.y1], b: [rect.x1 - 0.2, rect.y0], w: 0.5 },
  ], [[0, (rect.y0 + rect.y1) / 2]]);
  footing(b, rect, { h: 0.35, w: thick + 0.05 });
  // stone on three sides, open to the street; posts carry the front plate
  stoneShell(b, { rect, thick, z0: 0.35, z1: 0.35 + wallH, material: pick(r, ['rubble', 'fieldstone']), quoins: 'ashlar', skip: { front: true }, gables: { left: true, right: true, apex: 0.35 + wallH + ((rect.y1 - rect.y0) / 2) * Math.tan((42 * Math.PI) / 180) - 0.05, pitchDeg: 42 }, stage: (z) => (z < 1.5 ? 'frame' : 'walls'), prefix: 'wall.' });
  const top = 0.35 + wallH;
  const posts = [rect.x0 + 0.25, m(SMITHY_DOOR.dx) - 1.4, m(SMITHY_DOOR.dx) + 1.4, rect.x1 - 0.25];
  posts.forEach((x, i) => {
    b.box(`post${i}.pad`, 'pad-stone', [x, rect.y0 + 0.15, 0.1], [0.3, 0.3, 0.2], 'fieldstone', 'foundation', [], { shape: 'stone' });
    b.box(`post${i}`, 'post', [x, rect.y0 + 0.15, 0.2 + (top - 0.2) / 2], [0.2, 0.2, top - 0.2], 'oak', 'frame', []);
  });
  b.beam('plate.front', 'plate', [rect.x0, rect.y0 + 0.15, top + 0.08], [rect.x1, rect.y0 + 0.15, top + 0.08], [0.22, 0.16], 'frame', []);
  b.beam('plate.back', 'plate', [rect.x0, rect.y1 - thick / 2, top + 0.08], [rect.x1, rect.y1 - thick / 2, top + 0.08], [0.22, 0.16], 'walls', []);
  posts.slice(1, -1).forEach((x, i) => {
    for (const s of [-1, 1]) b.beam(`knee${i}${s}`, 'brace', [x, rect.y0 + 0.15, top - 0.6], [x + s * 0.55, rect.y0 + 0.15, top], [0.12, 0.1], 'frame', []);
  });
  const roof = gableRoof(b, { x0: rect.x0, x1: rect.x1, y0: rect.y0 + 0.05, y1: rect.y1, zWall: top + 0.16, pitchDeg: 42, style: 'slate', eaves: 0.3, overL: plot.sides.left ? 0 : 0.25, overR: plot.sides.right ? 0 : 0.25, stage: 'roof', prefix: 'roof.' });
  // the dark of the workshop's back
  b.box('interior', 'interior', [0, rect.y1 - thick - 0.03, top / 2 + 0.2], [rect.x1 - rect.x0 - thick * 2, 0.04, top - 0.4], 'interior', 'roof', []);
  // the forge against the back wall, left: hearth, coals, hood, and the stack
  const fx = rect.x0 + 1.15;
  const fy = rect.y1 - thick - 0.45;
  b.box('forge', 'forge', [fx, fy, 0.42], [1.1, 0.85, 0.7], 'ashlar', 'walls', [], { shape: 'stone', params: { dressed: 1 } });
  b.box('forge.coals', 'coals', [fx, fy - 0.05, 0.78], [0.6, 0.45, 0.04], 'fire', 'walls', []);
  b.box('forge.hood', 'hood', [fx, fy + 0.05, 1.75], [1.1, 0.8, 0.5], 'ashlar', 'walls', [], { shape: 'stone', params: { dressed: 1 } });
  const flue = chimney(b, { x: fx, y: fy + 0.15, w: 0.75, d: 0.62, z0: 2.0, z1: roof.ridgeZ + 0.8, roofZ: roof.surface(fy + 0.15), prefix: 'forge.stack.' });
  // the bellows beside it
  b.slab('bellows', 'bellows', [fx + 0.85, fy, 0.75], [
    [-0.35, -0.08],
    [0.3, -0.02],
    [0.3, 0.02],
    [-0.35, 0.08],
  ], 0.4, 'sacking', 'roof', []);
  b.box('bellows.board', 'bellows', [fx + 0.82, fy, 0.86], [0.7, 0.42, 0.03], 'planks', 'roof', []);
  // the anvil out under the eaves, a quench tub, tools on the wall, iron stock
  anvil(b, 'anvil', 0.9, rect.y0 + 0.75);
  barrel(b, 'quench', 1.65, rect.y0 + 0.6, { r: 0.24, h: 0.58 });
  b.box('quench.water', 'water', [1.65, rect.y0 + 0.6, 0.585], [0.36, 0.36, 0.002], 'water', 'roof', [], { shape: 'patch', params: { round: 1 } });
  for (let i = 0; i < 6; i++) {
    const x = 0.2 + i * 0.32;
    b.box(`tool${i}`, 'tool', [x, rect.y1 - thick - 0.03, 1.55 - (i % 2) * 0.1], [0.04, 0.03, 0.55], i % 3 === 0 ? 'oak' : 'iron', 'roof', []);
  }
  b.box('rack', 'rack', [0.95, rect.y1 - thick - 0.05, 1.85], [2.1, 0.06, 0.08], 'oak', 'roof', []);
  for (let i = 0; i < 5; i++) b.beam(`bar${i}`, 'iron', [2.4 + i * 0.07, rect.y1 - thick - 0.15, 0.05], [2.3 + i * 0.07, rect.y1 - thick - 0.05, 1.3], [0.03, 0.03], 'roof', [], 'iron');
  crate(b, 'crate', rect.x1 - 0.7, rect.y0 + 0.55, 0.42);
  trough(b, 'trough', rect.x1 - 1.4, rect.y1 - thick - 0.3, 0.8);
  hangingSign(b, 'sign', rect.x0 + 0.25, rect.y0 + 0.05, 2.7, 'sign-anvil');

  b.point('door', [m(SMITHY_DOOR.dx), plot.y0, 0]);
  b.point('flue:0', flue);
  b.point('forge', [fx, fy, 0.9] as Vec3);
  b.point('anvil', [0.9, rect.y0 + 0.75, 0.7]);
  return b.model();
}
