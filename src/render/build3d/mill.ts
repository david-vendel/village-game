// The mill: a tower mill. A round tower of limewashed rubble, tapering as it
// rises, laid ring by ring; its door where the miller carries the grain in
// (MILL_DOOR), a window on each floor; a boat-shaped cap of shingles or thatch
// turned into the wind, and four lattice sails on their stocks, turning (a
// moving part about the windshaft). Sacks of grain wait left of the door,
// flour right of it (stock.ts).

import { MILL_DOOR } from '../../game/layout';
import { pick, uniform, type Vec3 } from './elements';
import { footing, roundWall } from './kit/masonry';
import { door, window_ } from './kit/openings';
import { coneRoof } from './kit/roof';
import { dig, scaffold, stakeOut } from './kit/site';
import { type Model, ModelBuilder } from './model';
import { m, type Plot } from './plot';

export function mill(seed: number, plot: Plot): Model {
  const b = new ModelBuilder(seed, plot);
  const r = b.rng('mill');
  const cx = m(MILL_DOOR.dx);
  const cy = (plot.y0 + plot.y1) / 2;
  const R0 = Math.min(1.15, (plot.y1 - plot.y0) / 2 - 0.1);
  const R1 = R0 * 0.8;
  const H = uniform(r, 5.6, 6.3);
  const thick = 0.42;
  const fz = 0.35;
  stakeOut(b, { x0: cx - R0, x1: cx + R0, y0: cy - R0, y1: cy + R0 });
  // the ring trench
  const runs = Array.from({ length: 8 }, (_, i) => {
    const a0 = (i / 8) * Math.PI * 2;
    const a1 = ((i + 1) / 8) * Math.PI * 2;
    const rr = R0 - 0.2;
    return { a: [cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr] as [number, number], b: [cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr] as [number, number], w: 0.5 };
  });
  dig(b, runs, [[cx, cy]]);
  // the footing ring: a low drum of big stones
  roundWall(b, { cx, cy, r0: R0 + 0.06, r1: R0 + 0.04, z0: 0, z1: fz, thick: 0.5, material: 'fieldstone', stage: () => 'foundation', prefix: 'ft.', courseH: 0.18, core: 'fieldstone' });
  void footing;
  // the tower: door and windows cut out of the rings
  const front = -Math.PI / 2;
  const doorW = 0.9;
  const doorH = 1.85;
  const dA = Math.asin(doorW / 2 / R0);
  const winA = Math.asin(0.3 / R1);
  roundWall(b, {
    cx,
    cy,
    r0: R0,
    r1: R1,
    z0: fz,
    z1: fz + H,
    thick,
    material: pick(r, ['limewash', 'limewash', 'rubble']),
    openings: [
      { a0: front - dA, a1: front + dA, z0: fz, z1: fz + doorH },
      { a0: front - winA, a1: front + winA, z0: fz + 2.6, z1: fz + 3.2 },
      { a0: -winA * 1.1, a1: winA * 1.1, z0: fz + 4.2, z1: fz + 4.75 },
    ],
    stage: (z) => (z < fz + H * 0.45 ? 'frame' : 'walls'),
    prefix: 'tower.',
  });
  const Rat = (z: number) => R0 + ((R1 - R0) * (z - fz)) / H;
  const doorFace = cy - Rat(fz) + 0.02;
  // lintels over the openings
  b.box('lintel.door', 'lintel', [cx, cy - Rat(fz + doorH) + thick / 2, fz + doorH + 0.1], [doorW + 0.3, thick, 0.2], 'ashlar', 'frame', [], { shape: 'stone', params: { dressed: 1 } });
  b.box('lintel.win', 'lintel', [cx, cy - Rat(fz + 3.2) + thick / 2, fz + 3.3], [0.85, thick, 0.18], 'ashlar', 'walls', [], { shape: 'stone', params: { dressed: 1 } });
  door(b, { wall: { side: 'front', face: doorFace, thick }, u: cx, w: doorW, h: doorH, z0: fz, name: 'door', hinge: 'left', frame: true });
  const win = window_(b, { wall: { side: 'front', face: cy - Rat(fz + 2.9), thick }, u: cx, w: 0.5, h: 0.58, z0: fz + 2.62, name: 'window0', shutters: 'single', mullion: false });
  scaffold(b, { x0: cx - R0 - 0.2, x1: cx + R0 + 0.2, y: cy - R0, out: 0.55, height: fz + H - 0.3, stage: 'frame' });

  // the cap: a curb ring, then the cap's covering
  const top = fz + H;
  b.cyl('cap.curb', 'curb', [cx, cy, top], R1 + 0.08, R1 + 0.08, 0.22, 'oak', 'roof', [], { sides: 16 });
  b.box('interior', 'interior', [cx, cy, top - 0.5], [R1, R1, 0.6], 'interior', 'roof', []);
  const capStyle = pick(r, ['shingle', 'shingle', 'thatch'] as const);
  const capTop = coneRoof(b, { cx, cy: cy + 0.15, r: R1 + 0.32, z: top + 0.2, h: 1.6, style: capStyle, prefix: 'cap.', sides: 16 });
  b.cyl('cap.finial', 'finial', [cx, cy + 0.15, capTop - 0.05], 0.06, 0.03, 0.4, 'oak', 'roof', [], { sides: 6 });

  // the windshaft out of the cap's front, and the sails on it
  const hub: Vec3 = [cx, cy - R1 - 0.55, top + 0.85];
  b.beam('windshaft', 'shaft', [cx, cy - R1 + 0.3, top + 0.8], [hub[0], hub[1] + 0.05, hub[2]], [0.26, 0.26], 'roof', [], 'oak');
  const L = Math.min(4.2, top + 0.85 - 2.3);
  b.part('sails', { kind: 'spin', pivot: hub, axis: [0, -1, 0], speed: 0.7 + 0.25 * r() }, () => {
    b.cyl('sails.hub', 'hub', [hub[0], hub[1] + 0.12, hub[2]], 0.2, 0.18, 0.28, 'oak', 'roof', [], { sides: 10, rot: [Math.PI / 2, 0, 0] });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.3;
      const dir: Vec3 = [Math.cos(a), 0, Math.sin(a)];
      const side: Vec3 = [-Math.sin(a), 0, Math.cos(a)];
      const p = (d: number, s: number, y = 0): Vec3 => [hub[0] + dir[0] * d + side[0] * s, hub[1] - 0.18 + y, hub[2] + dir[2] * d + side[2] * s];
      b.beam(`sails.stock${k}`, 'stock', p(0, 0), p(L, 0), [0.12, 0.14], 'roof', [], 'oak');
      // the lattice: bars across, a rail along the outer edge, the cloth spread on it
      const inner = 0.75;
      const w = L * 0.24;
      const bars = 9;
      for (let i = 0; i <= bars; i++) {
        const d = inner + ((L - inner) * i) / bars;
        b.beam(`sails.bar${k}.${i}`, 'sail-bar', p(d, -0.04), p(d, w), [0.04, 0.04], 'roof', [], 'pole');
      }
      b.beam(`sails.rail${k}`, 'sail-bar', p(inner, w), p(L, w), [0.045, 0.045], 'roof', [], 'pole');
      // the cloth, a slab in the sail's plane
      const c0 = p(inner, 0.02, 0.03);
      b.slab(`sails.cloth${k}`, 'sail', [c0[0], c0[1], c0[2]], [
        [0, 0],
        [L - inner, 0],
        [L - inner, w - 0.04],
        [0, w - 0.04],
      ], 0.012, 'linen', 'roof', [], { rot: [0, -a, 0] });
    }
  });

  b.point('door', [cx, plot.y0, 0]);
  b.point('window:0', win);
  return b.model();
}

/**
 * The well: a round drum of stones ring by ring round the shaft, the dark water down in it, two
 * posts with a windlass and its crank (turning), the rope and a bucket, a little shingled roof on
 * top, flags round it and a bucket waiting on the rim.
 */
export function well(seed: number, plot: Plot): Model {
  const b = new ModelBuilder(seed, plot);
  const r = b.rng('well');
  const cx = 0;
  const cy = (plot.y0 + plot.y1) / 2 + 0.05;
  const R = 0.78;
  stakeOut(b, { x0: cx - R, x1: cx + R, y0: cy - R, y1: cy + R });
  // the shaft: dug round, deep
  const runs = Array.from({ length: 6 }, (_, i) => {
    const a0 = (i / 6) * Math.PI * 2;
    const a1 = ((i + 1) / 6) * Math.PI * 2;
    return { a: [cx + Math.cos(a0) * 0.5, cy + Math.sin(a0) * 0.5] as [number, number], b: [cx + Math.cos(a1) * 0.5, cy + Math.sin(a1) * 0.5] as [number, number], w: 0.55 };
  });
  dig(b, runs, [
    [cx - 1.3, cy + 0.2],
    [cx + 1.3, cy + 0.2],
  ]);
  b.box('shaft', 'shaft', [cx, cy, 0.006], [1.1, 1.1, 0.006], 'earth-dark', 'staking', [], { shape: 'patch', params: { round: 1 }, tags: ['until:foundation'] });
  // flagstones round it
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const rr = b.rng(`flag${i}`);
    b.box(`flag${i}`, 'flag', [cx + Math.cos(a) * (R + 0.32), cy + Math.sin(a) * (R + 0.26) * 0.85, 0.02], [0.5, 0.42, 0.04], 'fieldstone', 'foundation', [], { shape: 'stone', rot: [0, 0, a + uniform(rr, -0.2, 0.2)], params: { dressed: 1 } });
  }
  roundWall(b, { cx, cy, r0: R, r1: R, z0: 0, z1: 0.92, thick: 0.28, material: pick(r, ['rubble', 'fieldstone']), stage: (z) => (z < 0.45 ? 'frame' : 'walls'), prefix: 'drum.', courseH: 0.2, core: 'soot' });
  b.cyl('coping', 'coping', [cx, cy, 0.92], R + 0.03, R + 0.03, 0.08, 'ashlar', 'walls', [], { sides: 18 });
  b.box('water', 'water', [cx, cy, 0.55], [(R - 0.3) * 2, (R - 0.3) * 2, 0.002], 'water', 'walls', [], { shape: 'patch', params: { round: 1 } });
  // posts and the windlass
  const postH = 2.15;
  for (const s of [-1, 1]) {
    b.box(`post${s}`, 'post', [cx + s * (R + 0.02), cy, postH / 2], [0.14, 0.14, postH], 'oak', 'frame', []);
    b.beam(`brace${s}`, 'brace', [cx + s * (R + 0.02), cy - 0.45, 0.92], [cx + s * (R + 0.02), cy, 1.55], [0.08, 0.08], 'frame', []);
    b.beam(`braceb${s}`, 'brace', [cx + s * (R + 0.02), cy + 0.45, 0.92], [cx + s * (R + 0.02), cy, 1.55], [0.08, 0.08], 'frame', []);
  }
  const axleZ = 1.45;
  b.part('windlass', { kind: 'spin', pivot: [cx, cy, axleZ], axis: [1, 0, 0], speed: 0.35 }, () => {
    b.log('windlass.drum', 'windlass', [cx - R + 0.1, cy, axleZ], [cx + R - 0.1, cy, axleZ], 0.09, 'walls', [], 'logs');
    b.beam('windlass.crank', 'crank', [cx + R + 0.1, cy, axleZ], [cx + R + 0.1, cy, axleZ + 0.32], [0.04, 0.04], 'walls', [], 'iron');
    b.beam('windlass.handle', 'crank', [cx + R + 0.1, cy, axleZ + 0.32], [cx + R + 0.3, cy, axleZ + 0.32], [0.035, 0.035], 'walls', [], 'oak');
  });
  b.beam('rope', 'rope', [cx, cy, axleZ - 0.08], [cx, cy, 1.05], [0.02, 0.02], 'walls', [], 'rope');
  b.cyl('bucket', 'bucket', [cx, cy, 0.78], 0.12, 0.15, 0.24, 'barrel', 'walls', [], { sides: 10 });
  b.cyl('bucket2', 'bucket', [cx + R + 0.32, cy - 0.45, 0], 0.12, 0.15, 0.24, 'barrel', 'roof', [], { sides: 10 });
  // a little gable roof on the posts
  const z = postH;
  b.beam('ridgepole', 'ridge', [cx - R - 0.3, cy, z + 0.55], [cx + R + 0.3, cy, z + 0.55], [0.1, 0.12], 'roof', [], 'oak');
  for (const s of [-1, 1]) {
    b.beam(`plate${s}`, 'plate', [cx - R - 0.3, cy + s * 0.55, z], [cx + R + 0.3, cy + s * 0.55, z], [0.1, 0.1], 'roof', [], 'oak');
    const style = 2;
    b.add({ id: `roof${s}`, kind: 'shingle', material: 'shingle', stage: 'roof', shape: 'course', params: { x0: cx - R - 0.38, x1: cx + R + 0.38, yl: cy + s * 0.72, zl: z - 0.04, yu: cy + s * 0.02, zu: z + 0.62, thickness: 0.04, style, lip: 0 } });
  }
  return b.model();
}
