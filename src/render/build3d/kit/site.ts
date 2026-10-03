// Before anything stands: the plan pegged out with stakes and strings, the
// foundation trenches dug run by run with the spoil heaped up inside the plot
// (it goes back in round the footing once the frame is up), and scaffolding
// for the builders. All of it is temporary (until:<stage>).

import { type Builder, type Stage, uniform, type Vec3 } from '../elements';

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Stakes at the corners and strings between them, at the start of the staking stage. */
export function stakeOut(b: Builder, r: Rect, prefix = ''): void {
  const corners: Array<[number, number]> = [
    [r.x0, r.y0],
    [r.x1, r.y0],
    [r.x1, r.y1],
    [r.x0, r.y1],
  ];
  // batter boards a little outside each corner would stand on the road: plain pegs on the corners
  corners.forEach(([px, py], i) => {
    const lean = b.rng(`${prefix}stake${i}`);
    b.box(`${prefix}stake${i}`, 'stake', [px, py, 0.28], [0.05, 0.05, 0.56], 'pole', 'staking', [], { tags: ['until:frame'], rot: [uniform(lean, -0.05, 0.05), uniform(lean, -0.05, 0.05), 0] });
  });
  corners.forEach(([ax, ay], i) => {
    const [bx, by] = corners[(i + 1) % 4];
    b.beam(`${prefix}line${i}`, 'line', [ax, ay, 0.42], [bx, by, 0.42], [0.012, 0.012], 'staking', [`${prefix}stake${i}`], 'rope', ['until:frame']);
  });
}

/** A run of trench to dig: from a to b (plan points), w wide. */
export interface Run {
  a: [number, number];
  b: [number, number];
  w: number;
}

/**
 * Dig the trenches for the footings, a stretch at a time (each a dark patch of opened ground), throwing
 * the spoil onto heaps that grow inside the plot (`heaps`: where they stand). Kept until the frame
 * is up, when the spoil goes back in round the stones.
 */
export function dig(b: Builder, runs: Run[], heaps: Array<[number, number]>, prefix = ''): void {
  const step = 0.55;
  const pieces: Array<{ at: Vec3; size: Vec3; rot: Vec3 }> = [];
  for (const run of runs) {
    const [ax, ay] = run.a;
    const [bx, by] = run.b;
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(len / step));
    const yaw = Math.atan2(by - ay, bx - ax);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      pieces.push({ at: [ax + (bx - ax) * t, ay + (by - ay) * t, 0.004], size: [len / n + 0.02, run.w, 0.004], rot: [0, 0, yaw] });
    }
  }
  const perHeap = Math.max(1, Math.ceil(pieces.length / Math.max(1, heaps.length * 3)));
  let thrown = 0;
  pieces.forEach((p, i) => {
    b.box(`${prefix}trench${i}`, 'trench', p.at, p.size, 'earth-dark', 'staking', [], { shape: 'patch', rot: p.rot, tags: ['until:foundation'] });
    // every few stretches, another load on the nearest heap
    if ((i + 1) % perHeap === 0 && heaps.length) {
      const h = heaps[thrown % heaps.length];
      const k = Math.floor(thrown / heaps.length);
      const r = b.rng(`${prefix}spoil${thrown}`);
      const s = 0.32 + 0.12 * k;
      b.box(`${prefix}spoil${thrown}`, 'spoil', [h[0] + uniform(r, -0.12, 0.12), h[1] + uniform(r, -0.08, 0.08), 0], [s * 1.25, s, 0.16 + 0.07 * k], 'earth', 'staking', [], { shape: 'dome', params: { rough: 0.3 }, tags: ['until:frame'] });
      thrown++;
    }
  });
}

/**
 * Scaffolding along a wall face (outer face line y, x from x0 to x1), standing `out` in front of it:
 * poles, ledgers and boards at each lift up to `height`. Put up in `stage`, taken down when the
 * building is done.
 */
export function scaffold(b: Builder, opts: { x0: number; x1: number; y: number; out: number; height: number; stage: Stage; prefix?: string; side?: 'front' | 'back' | 'left' | 'right' }): void {
  const pre = opts.prefix ?? 'scaffold.';
  const side = opts.side ?? 'front';
  const along = side === 'front' || side === 'back';
  const sgn = side === 'front' || side === 'left' ? -1 : 1;
  const line = opts.y + sgn * opts.out;
  const pt = (u: number, z: number): Vec3 => (along ? [u, line, z] : [line, u, z]);
  const pt2 = (u: number, z: number, d: number): Vec3 => (along ? [u, line + d, z] : [line + d, u, z]);
  const span = opts.x1 - opts.x0;
  const n = Math.max(2, Math.round(span / 1.8) + 1);
  const poles: string[] = [];
  for (let i = 0; i < n; i++) {
    const u = opts.x0 + (span * i) / (n - 1);
    const r = b.rng(`${pre}pole${i}`);
    const id = `${pre}pole${i}`;
    b.add({ id, kind: 'scaffold', material: 'pole', stage: opts.stage, shape: 'log', a: pt(u, 0), b: pt(u + uniform(r, -0.04, 0.04), opts.height + 0.5), params: { r: 0.045, sides: 6 }, tags: ['scaffold'] });
    poles.push(id);
  }
  const lifts = Math.max(1, Math.floor(opts.height / 1.3));
  for (let k = 1; k <= lifts; k++) {
    const z = (opts.height * k) / lifts - 0.15;
    b.add({ id: `${pre}ledger${k}`, kind: 'scaffold', material: 'pole', stage: opts.stage, shape: 'log', a: pt(opts.x0 - 0.15, z), b: pt(opts.x1 + 0.15, z), params: { r: 0.035, sides: 6 }, on: poles, tags: ['scaffold'] });
    // putlogs into the wall and boards on them
    for (let i = 0; i < n; i++) {
      const u = opts.x0 + (span * i) / (n - 1);
      b.add({ id: `${pre}putlog${k}.${i}`, kind: 'scaffold', material: 'pole', stage: opts.stage, shape: 'log', a: pt2(u, z + 0.05, 0.12 * sgn), b: pt2(u, z + 0.05, -sgn * (opts.out - 0.05)), params: { r: 0.03, sides: 5 }, tags: ['scaffold'] });
    }
    const boards = 2;
    for (let j = 0; j < boards; j++) {
      const d = -sgn * (0.12 + j * 0.24) + sgn * 0.0;
      const at = pt2((opts.x0 + opts.x1) / 2, z + 0.11, d + sgn * 0.0);
      const size: Vec3 = along ? [span + 0.3, 0.22, 0.04] : [0.22, span + 0.3, 0.04];
      b.box(`${pre}board${k}.${j}`, 'scaffold', at, size, 'boards', opts.stage, [], { tags: ['scaffold'] });
    }
  }
  // a ladder up to the first lift
  const lu = opts.x0 + 0.5;
  const top = opts.height / lifts;
  for (const dx of [-0.2, 0.2]) b.add({ id: `${pre}ladder${dx}`, kind: 'scaffold', material: 'pole', stage: opts.stage, shape: 'log', a: pt2(lu + dx, 0, -sgn * 0.45), b: pt2(lu + dx, top + 0.6, -sgn * 0.02), params: { r: 0.025, sides: 5 }, tags: ['scaffold'] });
  for (let z = 0.3; z < top; z += 0.3) {
    const d = -sgn * 0.45 * (1 - z / (top + 0.6)) - sgn * 0.02 * (z / (top + 0.6));
    b.add({ id: `${pre}rung${z.toFixed(1)}`, kind: 'scaffold', material: 'pole', stage: opts.stage, shape: 'log', a: pt2(lu - 0.2, z, d), b: pt2(lu + 0.2, z, d), params: { r: 0.015, sides: 4 }, tags: ['scaffold'] });
  }
}
