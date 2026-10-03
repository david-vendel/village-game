// The things that stand about a building and say what it is: barrels and
// crates, a bench, the woodcutter's chopping block and sawbuck and his cords
// of split wood, sacks, baskets of loaves, stooks of sheaves, an anvil, a
// trough, fences, a hanging sign, a lantern, a ladder. Placed on the ground at
// a plan point (x, y), all inside the plot.

import { type Builder, type Stage, uniform, type Vec3 } from '../elements';
import type { ModelBuilder } from '../model';

export function barrel(b: Builder, id: string, x: number, y: number, opts: { r?: number; h?: number; stage?: Stage; lying?: boolean } = {}): void {
  const r = opts.r ?? 0.26;
  const h = opts.h ?? 0.78;
  const st = opts.stage ?? 'roof';
  if (opts.lying) {
    b.add({ id: `${id}.staves`, kind: 'barrel', material: 'barrel', stage: st, shape: 'log', a: [x - h / 2, y, r], b: [x + h / 2, y, r], params: { r, sides: 14 } });
    for (const f of [0.18, 0.82]) b.add({ id: `${id}.hoop${f}`, kind: 'hoop', material: 'iron', stage: st, shape: 'log', a: [x - h / 2 + h * f - 0.02, y, r], b: [x - h / 2 + h * f + 0.02, y, r], params: { r: r + 0.008, sides: 14 } });
    return;
  }
  // bellied: two frustums
  b.cyl(`${id}.lo`, 'barrel', [x, y, 0], r * 0.86, r, h / 2, 'barrel', st, [], { sides: 14 });
  b.cyl(`${id}.hi`, 'barrel', [x, y, h / 2], r, r * 0.86, h / 2, 'barrel', st, [], { sides: 14 });
  for (const z of [0.12, h - 0.14]) b.cyl(`${id}.hoop${z.toFixed(2)}`, 'hoop', [x, y, z], r * 0.9 + 0.01, r * 0.9 + 0.01, 0.04, 'iron', st, [], { sides: 14 });
  b.cyl(`${id}.hoopm`, 'hoop', [x, y, h / 2 - 0.02], r + 0.008, r + 0.008, 0.04, 'iron', st, [], { sides: 14 });
}

export function crate(b: Builder, id: string, x: number, y: number, s = 0.45, z = 0, stage: Stage = 'roof'): void {
  b.box(`${id}`, 'crate', [x, y, z + s / 2], [s, s, s], 'crate', stage, []);
  for (const dz of [0.08, s - 0.08]) b.box(`${id}.slat${dz}`, 'slat', [x, y, z + dz], [s + 0.02, s + 0.02, 0.06], 'planks', stage, []);
}

/** A bench along x: a thick plank on two trestles. */
export function bench(b: Builder, id: string, x: number, y: number, len: number, opts: { h?: number; stage?: Stage; depth?: number } = {}): number {
  const h = opts.h ?? 0.45;
  const st = opts.stage ?? 'roof';
  const d = opts.depth ?? 0.32;
  b.box(`${id}.top`, 'bench', [x, y, h - 0.03], [len, d, 0.06], 'planks', st, []);
  for (const s of [-1, 1]) {
    for (const k of [-1, 1]) b.beam(`${id}.leg${s}${k}`, 'leg', [x + s * (len / 2 - 0.14) + k * 0.05, y - d * 0.35, 0], [x + s * (len / 2 - 0.14), y, h - 0.06], [0.06, 0.06], st, [], 'oak');
  }
  return h;
}

/** A chopping block (a stump of a log) with the axe stuck in it, and chips round about. */
export function choppingBlock(b: Builder, id: string, x: number, y: number, stage: Stage = 'roof'): void {
  b.cyl(`${id}`, 'chopping-block', [x, y, 0], 0.27, 0.25, 0.48, 'logs', stage, [], { sides: 12 });
  b.box(`${id}.top`, 'end-grain', [x, y, 0.481], [0.46, 0.46, 0.002], 'end-grain', stage, [], { shape: 'patch', params: { round: 1 } });
  b.beam(`${id}.helve`, 'axe', [x + 0.04, y, 0.5], [x + 0.32, y - 0.05, 0.92], [0.035, 0.035], stage, [], 'pole');
  b.box(`${id}.head`, 'axe', [x + 0.03, y, 0.5], [0.16, 0.025, 0.1], 'iron', stage, [], { rot: [0, -0.9, 0] });
  const r = b.rng(`${id}.chips`);
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2;
    const d = uniform(r, 0.35, 0.6);
    b.box(`${id}.chip${i}`, 'chips', [x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, 0.008], [0.08, 0.04, 0.016], 'end-grain', stage, [], { rot: [0, 0, r() * 3] });
  }
}

/** A sawbuck (two X trestles and a rail) with a log across it. */
export function sawbuck(b: Builder, id: string, x: number, y: number, stage: Stage = 'roof'): void {
  for (const s of [-0.3, 0.3]) {
    b.beam(`${id}.x${s}a`, 'sawbuck', [x + s, y - 0.25, 0], [x + s, y + 0.25, 0.9], [0.06, 0.06], stage, [], 'pole');
    b.beam(`${id}.x${s}b`, 'sawbuck', [x + s, y + 0.25, 0], [x + s, y - 0.25, 0.9], [0.06, 0.06], stage, [], 'pole');
  }
  b.beam(`${id}.rail`, 'sawbuck', [x - 0.35, y, 0.25], [x + 0.35, y, 0.25], [0.05, 0.05], stage, [], 'pole');
  b.log(`${id}.log`, 'log', [x - 0.75, y, 0.68], [x + 0.75, y, 0.68], 0.11, stage, [], 'logs');
}

/**
 * A cord of split wood: billets stacked with their cut ends to the street (along y), row on row,
 * between end posts; x0..x1 wide, `h` high, `deep` back from y. Returns the billet count.
 */
export function cordwood(b: Builder, id: string, x0: number, x1: number, y: number, h: number, deep: number, opts: { stage?: Stage; posts?: boolean; z0?: number } = {}): number {
  const st = opts.stage ?? 'roof';
  const z0 = opts.z0 ?? 0;
  const r = 0.07;
  const rr = b.rng(id);
  let n = 0;
  // on two sleepers, off the damp ground
  if (z0 === 0) for (const yy of [y + 0.12, y + deep - 0.12]) b.beam(`${id}.sleeper${yy.toFixed(2)}`, 'sleeper', [x0, yy, 0.05], [x1, yy, 0.05], [0.1, 0.1], st, [], 'logs');
  const base = z0 === 0 ? 0.1 : z0;
  for (let row = 0; base + r * 2 * (row + 1) <= h + z0 + 1e-6; row++) {
    const off = row % 2 ? r : 0;
    for (let x = x0 + r + off; x <= x1 - r + 1e-6; x += r * 2) {
      const rad = r * uniform(rr, 0.8, 1.05);
      const z = base + r + row * r * 1.85;
      const jut = uniform(rr, -0.03, 0.03);
      b.add({ id: `${id}.${row}.${n}`, kind: 'billet', material: 'logs', stage: st, shape: 'log', a: [x, y + jut, z], b: [x, y + deep + jut, z], params: { r: rad, sides: 6 } });
      n++;
    }
  }
  if (opts.posts !== false) for (const px of [x0 - 0.05, x1 + 0.05]) b.box(`${id}.post${px.toFixed(2)}`, 'post', [px, y + deep / 2, (h + z0) / 2], [0.07, 0.07, h + z0], 'pole', st, []);
  return n;
}

/** A sack standing on the ground (grain: sacking; flour: pale linen), tied at the neck. */
export function sack(b: Builder, id: string, x: number, y: number, z = 0, opts: { flour?: boolean; stage?: Stage } = {}): void {
  const mat = opts.flour ? 'linen' : 'sacking';
  const st = opts.stage ?? 'roof';
  b.box(`${id}`, 'sack', [x, y, z], [0.2, 0.17, 0.42], mat, st, [], { shape: 'dome' });
  b.cyl(`${id}.neck`, 'sack', [x, y, z + 0.38], 0.05, 0.07, 0.1, mat, st, [], { sides: 7 });
  b.cyl(`${id}.tie`, 'tie', [x, y, z + 0.39], 0.055, 0.055, 0.02, 'rope', st, [], { sides: 7 });
}

/** A wicker basket of loaves (`loaves` of five shown). */
export function breadBasket(b: Builder, id: string, x: number, y: number, z: number, loaves: number, stage: Stage = 'roof'): void {
  b.cyl(`${id}`, 'basket', [x, y, z], 0.16, 0.2, 0.14, 'wicker', stage, [], { sides: 12 });
  const spots: Array<[number, number]> = [
    [-0.07, -0.05],
    [0.07, -0.05],
    [0, 0.06],
    [-0.08, 0.06],
    [0.08, 0.06],
  ];
  spots.slice(0, Math.max(0, Math.min(5, loaves))).forEach(([dx, dy], i) => b.box(`${id}.loaf${i}`, 'loaf', [x + dx, y + dy, z + 0.12 + (i > 2 ? 0.03 : 0)], [0.075, 0.055, 0.06], 'bread', stage, [], { shape: 'dome' }));
}

/** A stook: sheaves stood together, heads up, bound. */
export function stook(b: Builder, id: string, x: number, y: number, stage: Stage = 'roof', s = 1): void {
  b.cyl(`${id}`, 'stook', [x, y, 0], 0.3 * s, 0.12 * s, 0.7 * s, 'straw', stage, [], { sides: 9 });
  b.cyl(`${id}.heads`, 'stook', [x, y, 0.7 * s], 0.12 * s, 0.03 * s, 0.32 * s, 'wheat', stage, [], { sides: 9 });
  b.cyl(`${id}.band`, 'band', [x, y, 0.5 * s], 0.18 * s, 0.17 * s, 0.05, 'straw-band', stage, [], { sides: 9 });
}

/** An anvil on its oak stump. */
export function anvil(b: Builder, id: string, x: number, y: number, stage: Stage = 'roof'): void {
  b.cyl(`${id}.stump`, 'stump', [x, y, 0], 0.24, 0.22, 0.5, 'logs', stage, [], { sides: 10 });
  b.box(`${id}.waist`, 'anvil', [x, y, 0.56], [0.2, 0.14, 0.12], 'iron', stage, []);
  b.box(`${id}.face`, 'anvil', [x, y, 0.67], [0.42, 0.15, 0.1], 'iron', stage, []);
  b.slab(`${id}.horn`, 'anvil', [x + 0.21, y, 0.62], [
    [0, 0.0],
    [0.2, 0.08],
    [0, 0.1],
  ], 0.1, 'iron', stage, []);
}

/** A trough of water on legs (or a tub). */
export function trough(b: Builder, id: string, x: number, y: number, len = 0.9, stage: Stage = 'roof'): void {
  b.box(`${id}`, 'trough', [x, y, 0.25], [len, 0.36, 0.3], 'planks', stage, []);
  b.box(`${id}.water`, 'water', [x, y, 0.385], [len - 0.08, 0.28, 0.002], 'water', stage, [], { shape: 'patch' });
  for (const s of [-1, 1]) b.box(`${id}.leg${s}`, 'leg', [x + s * (len / 2 - 0.1), y, 0.05], [0.08, 0.4, 0.1], 'oak', stage, []);
}

/** A wattle fence along a line: stakes and woven hazel between them. */
export function wattleFence(b: Builder, id: string, a: [number, number], c: [number, number], h = 0.8, stage: Stage = 'roof'): void {
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const n = Math.max(1, Math.round(len / 0.6));
  const dx = (c[0] - a[0]) / len;
  const dy = (c[1] - a[1]) / len;
  for (let i = 0; i <= n; i++) {
    const t = (len * i) / n;
    b.cyl(`${id}.stake${i}`, 'stake', [a[0] + dx * t, a[1] + dy * t, 0], 0.03, 0.025, h + 0.08, 'pole', stage, [], { sides: 5 });
  }
  const mx = (a[0] + c[0]) / 2;
  const my = (a[1] + c[1]) / 2;
  b.box(`${id}.weave`, 'wattle', [mx, my, h / 2 + 0.04], [Math.abs(dx) * len + Math.abs(dy) * 0.05, Math.abs(dy) * len + Math.abs(dx) * 0.05, h - 0.04], 'wattle', stage, []);
}

/** A post-and-rail fence along a line. */
export function railFence(b: Builder, id: string, a: [number, number], c: [number, number], h = 0.9, stage: Stage = 'roof'): void {
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const n = Math.max(1, Math.round(len / 1.4));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    b.cyl(`${id}.post${i}`, 'post', [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, 0], 0.05, 0.045, h + 0.05, 'pole', stage, [], { sides: 6 });
  }
  for (const z of [h * 0.45, h * 0.9]) b.log(`${id}.rail${z.toFixed(2)}`, 'rail', [a[0], a[1], z], [c[0], c[1], z], 0.035, stage, [], 'pole');
}

/**
 * A sign hung from an iron bracket on a wall face (outer face at y, facing −y): a board with a
 * picture on it (`emblem` material), swinging gently in the wind (a moving part).
 */
export function hangingSign(b: ModelBuilder, id: string, x: number, y: number, z: number, emblem: string, opts: { out?: number; side?: -1 | 1 } = {}): void {
  const out = opts.out ?? 0.6;
  const s = opts.side ?? -1;
  b.beam(`${id}.bracket`, 'bracket', [x, y - 0.02, z], [x + 0, y - out, z], [0.03, 0.04], 'roof', [], 'iron');
  b.beam(`${id}.stay`, 'bracket', [x, y - 0.02, z - 0.3], [x, y - out * 0.7, z - 0.01], [0.02, 0.02], 'roof', [], 'iron');
  const pivot: Vec3 = [x, y - out * 0.55, z - 0.03];
  b.part(`${id}`, { kind: 'sway', pivot, axis: [1, 0, 0] }, () => {
    for (const k of [-1, 1]) b.box(`${id}.chain${k}`, 'chain', [x + k * 0.0, y - out * 0.55 + k * 0.12, z - 0.09], [0.01, 0.01, 0.12], 'iron', 'roof', []);
    b.box(`${id}.board`, 'sign', [x, y - out * 0.55, z - 0.36], [0.05, 0.42, 0.34], 'planks', 'roof', []);
    b.box(`${id}.picture`, 'sign', [x + s * 0.028, y - out * 0.55, z - 0.36], [0.005, 0.32, 0.25], emblem, 'roof', []);
  });
}

/** A lantern on a bracket: its glass glows with the building's light. */
export function lantern(b: Builder, id: string, x: number, y: number, z: number, stage: Stage = 'roof'): void {
  b.beam(`${id}.arm`, 'bracket', [x, y + 0.02, z + 0.25], [x, y - 0.25, z + 0.25], [0.025, 0.025], stage, [], 'iron');
  b.box(`${id}.top`, 'lantern', [x, y - 0.25, z + 0.13], [0.15, 0.15, 0.04], 'iron', stage, [], {});
  b.box(`${id}.glass`, 'lantern', [x, y - 0.25, z], [0.11, 0.11, 0.2], 'lamp', stage, []);
  b.box(`${id}.foot`, 'lantern', [x, y - 0.25, z - 0.11], [0.14, 0.14, 0.03], 'iron', stage, []);
}

/** A ladder leaning from the ground at a to b. */
export function ladder(b: Builder, id: string, a: Vec3, c: Vec3, w = 0.4, stage: Stage = 'roof'): void {
  const len = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  // the rails, either side of the line, square to it across x
  for (const s of [-1, 1]) b.log(`${id}.rail${s}`, 'ladder', [a[0] + (s * w) / 2, a[1], a[2]], [c[0] + (s * w) / 2, c[1], c[2]], 0.03, stage, [], 'pole');
  for (let t = 0.28; t < len - 0.1; t += 0.3) {
    const f = t / len;
    const p: Vec3 = [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f, a[2] + (c[2] - a[2]) * f];
    b.log(`${id}.rung${t.toFixed(2)}`, 'ladder', [p[0] - w / 2, p[1], p[2]], [p[0] + w / 2, p[1], p[2]], 0.018, stage, [], 'pole');
  }
}

/** A dressed block of stone (a stonecutter's stock, a mason's work). */
export function block(b: Builder, id: string, x: number, y: number, z: number, s: Vec3 = [0.5, 0.36, 0.32], stage: Stage = 'roof', rot = 0): void {
  b.box(id, 'block', [x, y, z + s[2] / 2], s, 'ashlar', stage, [], { shape: 'stone', params: { dressed: 1 }, rot: [0, 0, rot] });
}

/**
 * A two-wheeled farm cart standing along x at (x, y): a plank bed with boarded sides on its axle,
 * big spoked wheels either side (rim felloes, spokes, a hub), the shafts down on the ground towards
 * `dir` (−1 left, 1 right); a load of hay heaped in it, or empty.
 */
export function cart(b: Builder, id: string, x: number, y: number, opts: { len?: number; wid?: number; wheelR?: number; dir?: -1 | 1; load?: 'hay' | 'none'; stage?: Stage } = {}): void {
  const st = opts.stage ?? 'roof';
  const len = opts.len ?? 1.3;
  const wid = opts.wid ?? 0.66;
  const R = opts.wheelR ?? 0.42;
  const dir = opts.dir ?? -1;
  const bedZ = R + 0.1;
  const rr = b.rng(id);
  // the axle and the bed on it
  b.log(`${id}.axle`, 'axle', [x, y - wid / 2 - 0.1, R], [x, y + wid / 2 + 0.1, R], 0.035, st, [], 'oak');
  for (const s of [-1, 1]) b.beam(`${id}.bolster${s}`, 'frame', [x - len / 2, y + s * (wid / 2 - 0.06), bedZ - 0.05], [x + len / 2, y + s * (wid / 2 - 0.06), bedZ - 0.05], [0.08, 0.08], st, [], 'oak');
  b.box(`${id}.bed`, 'cart', [x, y, bedZ + 0.02], [len, wid, 0.04], 'planks', st, []);
  for (const s of [-1, 1]) {
    b.box(`${id}.side${s}`, 'cart', [x, y + s * (wid / 2 - 0.02), bedZ + 0.2], [len, 0.035, 0.3], 'planks', st, []);
    b.box(`${id}.end${s}`, 'cart', [x + s * (len / 2 - 0.02), y, bedZ + 0.17], [0.035, wid - 0.06, 0.24], 'planks', st, []);
    // the stakes holding the sides
    for (const f of [-0.42, 0, 0.42]) b.box(`${id}.stake${s}${f}`, 'cart', [x + f * len, y + s * (wid / 2 + 0.005), bedZ + 0.2], [0.05, 0.03, 0.38], 'oak', st, []);
  }
  // the wheels: felloes round, spokes from the hub
  for (const s of [-1, 1]) {
    const yw = y + s * (wid / 2 + 0.07);
    const n = 12;
    const pt = (a: number, r: number): Vec3 => [x + Math.cos(a) * r, yw, R + Math.sin(a) * r];
    for (let i = 0; i < n; i++) b.beam(`${id}.wheel${s}.rim${i}`, 'wheel', pt((i / n) * Math.PI * 2, R - 0.03), pt(((i + 1) / n) * Math.PI * 2, R - 0.03), [0.06, 0.065], st, [], 'oak');
    const spokes = 10;
    const a0 = rr() * Math.PI;
    for (let i = 0; i < spokes; i++) {
      const a = a0 + (i / spokes) * Math.PI * 2;
      b.beam(`${id}.wheel${s}.spoke${i}`, 'spoke', pt(a, 0.07), pt(a, R - 0.06), [0.035, 0.03], st, [], 'oak');
    }
    b.cyl(`${id}.wheel${s}.hub`, 'hub', [x, yw - s * 0.07, R], 0.08, 0.07, 0.14, 'oak', st, [], { sides: 10, rot: [s > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0] });
  }
  // the shafts, down on the ground
  for (const s of [-1, 1]) b.log(`${id}.shaft${s}`, 'shaft', [x + dir * (len / 2 - 0.2), y + s * (wid / 2 - 0.08), bedZ - 0.04], [x + dir * (len / 2 + 1.0), y + s * 0.22, 0.04], 0.035, st, [], 'pole');
  if (opts.load !== 'none') {
    b.box(`${id}.hay`, 'hay', [x, y, bedZ + 0.05], [len * 0.46, wid * 0.46, 0.42], 'straw', st, [], { shape: 'dome', params: { rough: 0.3 } });
    b.box(`${id}.hay2`, 'hay', [x - dir * len * 0.18, y, bedZ + 0.25], [len * 0.3, wid * 0.36, 0.3], 'wheat', st, [], { shape: 'dome', params: { rough: 0.3 } });
  }
}

/** A round bale of hay lying on its side along x (or y), bound with two bands of twisted straw. */
export function hayBale(b: Builder, id: string, x: number, y: number, opts: { r?: number; len?: number; along?: 'x' | 'y'; z?: number; stage?: Stage } = {}): void {
  const st = opts.stage ?? 'roof';
  const r = opts.r ?? 0.3;
  const len = opts.len ?? 0.6;
  const z = (opts.z ?? 0) + r;
  const ax = opts.along !== 'y';
  const end = (t: number): Vec3 => (ax ? [x + t, y, z] : [x, y + t, z]);
  b.add({ id: `${id}`, kind: 'hay', material: 'straw', stage: st, shape: 'log', a: end(-len / 2), b: end(len / 2), params: { r, sides: 14 } });
  for (const f of [-0.28, 0.28]) b.add({ id: `${id}.band${f}`, kind: 'band', material: 'straw-band', stage: st, shape: 'log', a: end(f * len - 0.025), b: end(f * len + 0.025), params: { r: r + 0.012, sides: 14 } });
}
