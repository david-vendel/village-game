// Stone work, laid the way masons lay it: a course at a time all the way
// round, so the walls rise evenly, the corners bonded (each course's long
// walls run through the corner one course, the short walls the next), the
// joints broken course to course, a lintel over every opening, a sill under
// every window, and the gable ends stepping in to the roof's slope. Footings
// of big fieldstones in the trench; round towers and well drums ring by ring;
// chimney stacks course by course.

import { type Builder, type Stage, uniform, type Vec3 } from '../elements';
import type { Rect } from './site';

export type Side = 'front' | 'back' | 'left' | 'right';
export const SIDES: readonly Side[] = ['front', 'right', 'back', 'left'];

/** An opening in a wall: along it from u0 to u1 (x for the front and back, y for the sides), z0 up to z1. */
export interface Opening {
  u0: number;
  u1: number;
  z0: number;
  z1: number;
  /** What spans it: a stone lintel (default), an oak one, or none (an open front, or one framed separately). */
  lintel?: 'stone' | 'timber' | 'none';
  /** A window: a stone sill under it. */
  sill?: boolean;
  /**
   * A round head: z1 is the crown of a half circle as wide as the opening, turned in a ring of
   * dressed wedge stones (voussoirs) laid on the centring with the courses beside it, a keystone at
   * the top. No lintel.
   */
  arch?: boolean;
}

/** How deep an arch's ring of voussoirs is (the keystone and every other stone a little more). */
export const ARCH_RING = 0.24;

/** One voussoir of an arch: its wedge round the centre (uc, zs) and the height its middle stands at. */
interface Voussoir {
  pts: Array<[number, number]>;
  zc: number;
  key: boolean;
}

/** The ring of wedge stones round an arch of radius R: an odd number, the keystone in the middle, long and short in turn. */
function voussoirs(R: number, rng: () => number): Voussoir[] {
  const n = Math.max(5, Math.round((Math.PI * (R + ARCH_RING / 2)) / 0.2) | 1);
  const out: Voussoir[] = [];
  for (let i = 0; i < n; i++) {
    const key = i === (n - 1) / 2;
    // the joints: a hair of mortar between each wedge
    const g0 = i === 0 ? 0 : 0.008 / R;
    const g1 = i === n - 1 ? 0 : 0.008 / R;
    const a0 = (Math.PI * i) / n + g0;
    const a1 = (Math.PI * (i + 1)) / n - g1;
    const mid = (a0 + a1) / 2;
    // the ring's outer edge ragged as masons leave it, longer up top where the courses can take it
    const high = Math.sin(mid) > 0.45;
    const ro = R + ARCH_RING + (key ? 0.09 : high && i % 2 ? 0.06 : 0) + uniform(rng, -0.015, 0.015);
    out.push({
      pts: [
        [Math.cos(a0) * R, Math.sin(a0) * R],
        [Math.cos(a1) * R, Math.sin(a1) * R],
        [Math.cos(a1) * ro, Math.sin(a1) * ro],
        [Math.cos(a0) * ro, Math.sin(a0) * ro],
      ],
      zc: Math.sin(mid) * (R + ro) * 0.5,
      key,
    });
  }
  return out;
}

export interface ShellSpec {
  /** The walls' outer faces. */
  rect: Rect;
  thick: number;
  /** From the top of the footing up to the wall head (the eaves). */
  z0: number;
  z1: number;
  material: string;
  /** Squared blocks (ashlar) rather than rubble. */
  dressed?: boolean;
  /** Dressed, bigger stones at the corners. */
  quoins?: string;
  openings?: Partial<Record<Side, Opening[]>>;
  /** Sides with no wall (an open-fronted workshop) or another building's wall (built by it). */
  skip?: Partial<Record<Side, boolean>>;
  /** Stone gables on the side walls, up to the underside of the roof: its apex height at the wall middle, and pitch. */
  gables?: { left: boolean; right: boolean; apex: number; pitchDeg: number };
  /** Course height (the stones vary about it). */
  courseH?: number;
  /** The stage each course belongs to, by its height. */
  stage: (z: number) => Stage;
  prefix: string;
}

/** Where a wall's run lies: along x (front, back) at y, or along y (sides) at x; its centre line. */
function wallLine(r: Rect, side: Side, t: number): { along: 'x' | 'y'; at: number } {
  switch (side) {
    case 'front':
      return { along: 'x', at: r.y0 + t / 2 };
    case 'back':
      return { along: 'x', at: r.y1 - t / 2 };
    case 'left':
      return { along: 'y', at: r.x0 + t / 2 };
    default:
      return { along: 'y', at: r.x1 - t / 2 };
  }
}

/** Intervals of [a, b] left once `cuts` are taken out. */
export function subtract(a: number, b: number, cuts: Array<[number, number]>): Array<[number, number]> {
  let out: Array<[number, number]> = [[a, b]];
  for (const [c0, c1] of cuts) {
    const next: Array<[number, number]> = [];
    for (const [s0, s1] of out) {
      if (c1 <= s0 || c0 >= s1) next.push([s0, s1]);
      else {
        if (c0 > s0) next.push([s0, c0]);
        if (c1 < s1) next.push([c1, s1]);
      }
    }
    out = next;
  }
  return out.filter(([s0, s1]) => s1 - s0 > 0.04);
}

/**
 * Lay a run of stones along a wall course, from u0 to u1, centred on the wall line, h high from z.
 * Returns the ids. `ends`: the run's ends are corners (bigger, dressed quoin stones there).
 */
function lay(b: Builder, id: string, line: { along: 'x' | 'y'; at: number }, u0: number, u1: number, z: number, h: number, thick: number, spec: ShellSpec, stage: Stage, ends: [boolean, boolean]): void {
  const r = b.rng(id);
  const len = u1 - u0;
  const pos = (u: number, off = 0): Vec3 => (line.along === 'x' ? [u, line.at + off, z + h / 2] : [line.at + off, u, z + h / 2]);
  const size = (l: number, t: number, hh: number): Vec3 => (line.along === 'x' ? [l, t, hh] : [t, l, hh]);
  // the mortar bed and core behind the faces: the joints show it, nothing shows through
  b.box(`${id}.m`, 'mortar', pos(u0 + len / 2), size(len, thick * 0.72, h), 'mortar', stage, []);
  const dressed = !!spec.dressed;
  const [lo, hi] = dressed ? [0.32, 0.62] : [0.22, 0.52];
  let u = u0;
  // break joints with the course below
  let first = uniform(r, lo * 0.5, hi);
  for (let i = 0; u < u1 - 1e-6; i++) {
    let l = i === 0 ? first : uniform(r, lo, hi);
    const corner = (i === 0 && ends[0]) || (u + l >= u1 - 0.2 && ends[1]);
    if (corner && spec.quoins) l = Math.max(l, uniform(r, 0.42, 0.58));
    if (u1 - u - l < lo * 0.6) l = u1 - u; // no slivers at the end
    l = Math.min(l, u1 - u);
    const quoin = corner && !!spec.quoins;
    const gap = dressed || quoin ? 0.012 : 0.026;
    const face = quoin ? 0.015 : uniform(r, -0.012, 0.018); // some stand proud
    const t = thick - uniform(r, 0, 0.03);
    b.box(`${id}.${i}`, quoin ? 'quoin' : 'stone', pos(u + l / 2, 0), size(Math.max(0.05, l - gap), t + face, h - (dressed ? 0.012 : 0.022)), quoin ? spec.quoins! : spec.material, stage, [], {
      shape: 'stone',
      params: dressed || quoin ? { dressed: 1 } : {},
    });
    u += l;
    first = 0;
  }
}

/**
 * The walls of a stone building, course by course all the way round. Returns the height each
 * course reached (the last is the wall head) so roofs and floors can sit on it.
 */
export function stoneShell(b: Builder, spec: ShellSpec): { courses: number[] } {
  const r = spec.rect;
  const t = spec.thick;
  const ch = spec.courseH ?? (spec.dressed ? 0.3 : 0.24);
  const rr = b.rng(`${spec.prefix}courses`);
  const g = spec.gables;
  const tan = g ? Math.tan((g.pitchDeg * Math.PI) / 180) : 1;
  const top = g && (g.left || g.right) ? g.apex : spec.z1;
  const tops: number[] = [];
  const ym = (r.y0 + r.y1) / 2;
  let z = spec.z0;
  const lintelsDone = new Set<string>();
  const sillsDone = new Set<string>();
  // each arch's ring, its stones laid with the course that reaches them
  const rings = new Map<string, { R: number; uc: number; zs: number; stones: Voussoir[]; next: number }>();
  for (const side of SIDES)
    (spec.openings?.[side] ?? []).forEach((o, j) => {
      if (!o.arch) return;
      const R = (o.u1 - o.u0) / 2;
      rings.set(`${side}${j}`, { R, uc: (o.u0 + o.u1) / 2, zs: o.z1 - R, stones: voussoirs(R, b.rng(`${spec.prefix}arch.${side}${j}`)), next: 0 });
    });
  for (let k = 0; z < top - 0.03; k++) {
    let h = ch * uniform(rr, 0.86, 1.14);
    // land exactly on the wall head, then on up the gables
    if (z < spec.z1 && z + h > spec.z1 - 0.06) h = spec.z1 - z;
    if (top - z - h < 0.08) h = top - z;
    const above = z >= spec.z1 - 1e-6;
    const stage = spec.stage(z + h / 2);
    const longThrough = k % 2 === 0; // which walls run through the corners this course
    for (const side of SIDES) {
      if (spec.skip?.[side]) continue;
      const line = wallLine(r, side, t);
      const isLong = side === 'front' || side === 'back';
      if (above && (isLong || !(side === 'left' ? g?.left : g?.right))) continue;
      let u0 = isLong ? r.x0 : r.y0;
      let u1 = isLong ? r.x1 : r.y1;
      const through = isLong === longThrough;
      // a corner whose other wall is skipped runs through regardless
      const otherA = isLong ? 'left' : 'front';
      const otherB = isLong ? 'right' : 'back';
      if (!through) {
        if (!spec.skip?.[otherA]) u0 += t;
        if (!spec.skip?.[otherB]) u1 -= t;
      }
      if (above) {
        // the gable steps in to the roof: as wide as the slope allows at the top of this course
        const half = Math.max(0, (g!.apex - (z + h)) / tan);
        u0 = Math.max(u0, ym - half - 0.02);
        u1 = Math.min(u1, ym + half + 0.02);
        if (u1 - u0 < 0.12) continue;
      }
      const cuts: Array<[number, number]> = [];
      for (const [j, o] of (spec.openings?.[side] ?? []).entries()) {
        const key = `${side}${j}`;
        const ring = rings.get(key);
        if (ring) {
          if (above) continue;
          // below the springing the courses stop at the jambs; above it, round the ring, the gap
          // between the ring's curve and the squared stones packed with mortar behind
          const { R, uc, zs } = ring;
          const Ro = R + ARCH_RING + 0.03;
          if (z + h > o.z0 + 0.02 && z < zs + Ro + 0.06) {
            const dz = z - zs;
            const hw = z + h <= zs + 0.02 ? R : dz <= 0 ? Ro : dz < Ro ? Math.sqrt(Ro * Ro - dz * dz) : 0;
            if (hw > 0) cuts.push([uc - hw, uc + hw]);
            if (z + h > zs + 0.02) {
              const ho = dz <= 0 ? R : dz < R ? Math.sqrt(R * R - dz * dz) : 0;
              for (const s of [-1, 1]) {
                const a = uc + s * ho;
                const c = uc + s * (hw + 0.02);
                if (Math.abs(c - a) < 0.03) continue;
                const um = (a + c) / 2;
                const at: Vec3 = line.along === 'x' ? [um, line.at, z + h / 2] : [line.at, um, z + h / 2];
                const size: Vec3 = line.along === 'x' ? [Math.abs(c - a), t * 0.72, h] : [t * 0.72, Math.abs(c - a), h];
                b.box(`${spec.prefix}c${k}.${key}.pack${s}`, 'mortar', at, size, 'mortar', stage, []);
              }
            }
            // the voussoirs this course reaches, on the centring
            while (ring.next < ring.stones.length && zs + ring.stones[ring.next].zc < z + h) {
              const v = ring.stones[ring.next];
              const out = side === 'front' || side === 'left' ? -1 : 1;
              const proud = v.key ? 0.015 : 0;
              const at: Vec3 = line.along === 'x' ? [uc, line.at + out * proud, zs] : [line.at + out * proud, uc, zs];
              b.slab(`${spec.prefix}arch.${key}.${ring.next}`, v.key ? 'keystone' : 'voussoir', at, v.pts, t + (v.key ? 0.05 : 0.02), spec.quoins ?? 'ashlar', stage, [], { rot: line.along === 'x' ? [0, 0, 0] : [0, 0, Math.PI / 2] });
              ring.next++;
            }
          }
          continue;
        }
        // the courses beside the opening stop for it; the one that reaches its head carries the lintel
        if (z < o.z1 - 0.02 && z + h > o.z0 + 0.02) cuts.push([o.u0, o.u1]);
        if (o.lintel !== 'none' && !lintelsDone.has(key) && z + h >= o.z1 - 1e-6 && z < o.z1 + 0.02) {
          lintelsDone.add(key);
          const lintelH = Math.max(0.12, z + h - o.z1);
          const span = o.u1 - o.u0 + 0.3;
          const um = (o.u0 + o.u1) / 2;
          const at: Vec3 = line.along === 'x' ? [um, line.at, o.z1 + lintelH / 2] : [line.at, um, o.z1 + lintelH / 2];
          const size: Vec3 = line.along === 'x' ? [span, t + 0.03, lintelH - 0.01] : [t + 0.03, span, lintelH - 0.01];
          if (o.lintel === 'timber') b.box(`${spec.prefix}lintel.${key}`, 'lintel', at, size, 'oak', stage, []);
          else b.box(`${spec.prefix}lintel.${key}`, 'lintel', at, size, spec.quoins ?? 'ashlar', stage, [], { shape: 'stone', params: { dressed: 1 } });
          // the stones of this course stop short of the lintel's ends
          cuts.push([o.u0 - 0.15, o.u1 + 0.15]);
        }
        if (o.sill && !sillsDone.has(key) && z + h >= o.z0 - 0.06) {
          sillsDone.add(key);
          const um = (o.u0 + o.u1) / 2;
          const out = side === 'front' || side === 'left' ? -0.04 : 0.04;
          const at: Vec3 = line.along === 'x' ? [um, line.at + out, o.z0 - 0.05] : [line.at + out, um, o.z0 - 0.05];
          const size: Vec3 = line.along === 'x' ? [o.u1 - o.u0 + 0.16, t + 0.1, 0.1] : [t + 0.1, o.u1 - o.u0 + 0.16, 0.1];
          b.box(`${spec.prefix}sill.${key}`, 'window-sill', at, size, spec.quoins ?? 'ashlar', spec.stage(o.z0), [], { shape: 'stone', params: { dressed: 1 } });
        }
      }
      // corners: the ends of a run that meet another wall
      const ends: [boolean, boolean] = [!above && through && !spec.skip?.[otherA], !above && through && !spec.skip?.[otherB]];
      subtract(u0, u1, cuts).forEach(([a, c], j) => lay(b, `${spec.prefix}c${k}.${side}.${j}`, line, a, c, z, h, t, spec, stage, [ends[0] && a === u0, ends[1] && c === u1]));
    }
    z += h;
    tops.push(z);
  }
  return { courses: tops };
}

/**
 * A footing of big fieldstones in two courses round a rectangle (outer faces on its lines), laid in
 * the trench course by course; w thick, h high in all.
 */
export function footing(b: Builder, r: Rect, opts: { h: number; w: number; prefix?: string; material?: string; courses?: number }): string[] {
  const pre = opts.prefix ?? 'ft';
  const ids: string[] = [];
  const w = opts.w;
  const n = opts.courses ?? 2;
  const courseH = opts.h / n;
  const runs: Array<[string, [number, number], [number, number]]> = [
    ['f', [r.x0, r.y0 + w / 2], [r.x1, r.y0 + w / 2]],
    ['r', [r.x1 - w / 2, r.y0 + w], [r.x1 - w / 2, r.y1 - w]],
    ['b', [r.x1, r.y1 - w / 2], [r.x0, r.y1 - w / 2]],
    ['l', [r.x0 + w / 2, r.y1 - w], [r.x0 + w / 2, r.y0 + w]],
  ];
  for (let course = 0; course < n; course++) {
    for (const [name, [ax, ay], [bx, by]] of runs) {
      const length = Math.hypot(bx - ax, by - ay);
      if (length < 0.1) continue;
      const alongX = Math.abs(bx - ax) > Math.abs(by - ay);
      const rr = b.rng(`${pre}${name}${course}`);
      let t = course === 0 ? 0 : uniform(rr, 0.15, 0.3); // the upper course starts short: joints don't line up
      for (let i = 0; t < length - 1e-6; i++) {
        let l = Math.min(length - t, uniform(rr, 0.34, 0.66));
        if (length - t - l < 0.2) l = length - t; // don't leave a sliver
        const f = (t + l / 2) / length;
        const cx = ax + (bx - ax) * f;
        const cy = ay + (by - ay) * f;
        const h = courseH * uniform(rr, 0.94, 1.08);
        const d = w * uniform(rr, 0.88, 1);
        const size: Vec3 = alongX ? [l - 0.025, d, h] : [d, l - 0.025, h];
        const id = `${pre}${name}${course}.${i}`;
        b.box(id, 'footing-stone', [cx, cy, course * courseH + h / 2], size, opts.material ?? 'fieldstone', 'foundation', [], { shape: 'stone', rot: [0, 0, uniform(rr, -0.03, 0.03)] });
        ids.push(id);
        t += l;
      }
    }
  }
  return ids;
}

/**
 * A round wall (a tower mill, a well's drum): rings of stones from radius r0 at z0 tapering to r1 at
 * z1, `thick` through, a core of the inside behind them; openings by angle (a0..a1, radians from
 * +x towards +y; the front, −y, is −π/2).
 */
export function roundWall(
  b: Builder,
  opts: { cx: number; cy: number; r0: number; r1: number; z0: number; z1: number; thick: number; material: string; openings?: Array<{ a0: number; a1: number; z0: number; z1: number }>; stage: (z: number) => Stage; prefix: string; courseH?: number; core?: string },
): number[] {
  const rr = b.rng(`${opts.prefix}rings`);
  const ch = opts.courseH ?? 0.24;
  const tops: number[] = [];
  let z = opts.z0;
  for (let k = 0; z < opts.z1 - 0.03; k++) {
    let h = ch * uniform(rr, 0.88, 1.12);
    if (opts.z1 - z - h < 0.08) h = opts.z1 - z;
    const f = (z + h / 2 - opts.z0) / (opts.z1 - opts.z0);
    const R = opts.r0 + (opts.r1 - opts.r0) * f;
    const stage = opts.stage(z + h / 2);
    // the dark inside, ring by ring (seen through the door and windows)
    b.cyl(`${opts.prefix}core${k}`, 'core', [opts.cx, opts.cy, z], R - opts.thick + 0.03, R - opts.thick + 0.03, h, opts.core ?? 'interior', stage, [], { sides: 14 });
    const circ = 2 * Math.PI * (R - opts.thick / 2);
    const n = Math.max(6, Math.round(circ / uniform(rr, 0.36, 0.44)));
    const off = k % 2 ? Math.PI / n : 0;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2;
      const am = ((a + Math.PI) % (Math.PI * 2)) - Math.PI;
      if ((opts.openings ?? []).some((o) => am > o.a0 && am < o.a1 && z < o.z1 + 0.15 && z + h > o.z0)) continue;
      const rm = R - opts.thick / 2;
      const l = (circ / n) * 1.04;
      const sr = b.rng(`${opts.prefix}r${k}.${i}`);
      b.box(`${opts.prefix}r${k}.${i}`, 'stone', [opts.cx + Math.cos(a) * rm, opts.cy + Math.sin(a) * rm, z + h / 2], [opts.thick - uniform(sr, 0, 0.03), l - 0.025, h - 0.02], opts.material, stage, [], { shape: 'stone', rot: [0, 0, a] });
    }
    z += h;
    tops.push(z);
  }
  return tops;
}

/**
 * A chimney stack of squared stones course by course: w × d, from z0 to z1, a cap stone on top.
 * Courses below `roofZ` belong to the walls stage, the rest to the roof. Returns the smoke point.
 */
export function chimney(b: Builder, opts: { x: number; y: number; w: number; d: number; z0: number; z1: number; roofZ: number; material?: string; prefix?: string; lean?: number; rough?: boolean }): Vec3 {
  const pre = opts.prefix ?? 'chimney.';
  const mat = opts.material ?? 'ashlar';
  const rr = b.rng(pre);
  // an old stack settles off the upright a little (lean: metres along x per metre up, above the roof)
  const off = (zz: number) => (opts.lean ?? 0) * Math.max(0, zz - opts.roofZ);
  const params: Record<string, number> = opts.rough ? {} : { dressed: 1 };
  let z = opts.z0;
  for (let k = 0; z < opts.z1 - 0.02; k++) {
    let h = 0.2 * uniform(rr, 0.9, 1.1);
    if (opts.z1 - z - h < 0.06) h = opts.z1 - z;
    const stage: Stage = z + h < opts.roofZ ? 'walls' : 'roof';
    const x = opts.x + off(z + h / 2);
    // two stones a course, the joint turning a quarter each course
    const across = k % 2 === 0;
    for (let j = 0; j < 2; j++) {
      const at: Vec3 = across ? [x, opts.y + (j - 0.5) * (opts.d / 2), z + h / 2] : [x + (j - 0.5) * (opts.w / 2), opts.y, z + h / 2];
      const size: Vec3 = across ? [opts.w, opts.d / 2 - 0.012, h - 0.012] : [opts.w / 2 - 0.012, opts.d, h - 0.012];
      b.box(`${pre}${k}.${j}`, 'chimney', at, size, mat, stage, [], { shape: 'stone', params });
    }
    z += h;
  }
  const xt = opts.x + off(opts.z1);
  b.box(`${pre}cap`, 'chimney', [xt, opts.y, opts.z1 + 0.05], [opts.w + 0.14, opts.d + 0.14, 0.1], mat, 'roof', [], { shape: 'stone', params: { dressed: 1 } });
  // the flue's mouth: dark
  b.box(`${pre}flue`, 'flue', [xt, opts.y, opts.z1 + 0.101], [opts.w * 0.5, opts.d * 0.5, 0.004], 'soot', 'roof', [], { shape: 'patch' });
  return [xt, opts.y, opts.z1 + 0.12];
}
