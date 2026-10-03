// Carpentry. A timber-framed storey goes up as framers raise it: sills on the
// footing, posts on the sills (at every corner, each side of every opening,
// and between, no bay wider than the timber allows), wall plates on the posts,
// then the rails and girts, and braces triangulating the plain bays. The
// panels are filled afterwards: hazel wattle woven between staves first, then
// daub thrown on and limewashed, sitting a little back from the timbers. A
// jettied upper storey sits on floor joists whose ends stand out over the
// street. Log walls go up a course at a time, notched at the corners; plank
// walls are boards nailed to rails.

import { type Builder, type Stage, uniform, type Vec3 } from '../elements';
import { type Opening, type Side, SIDES } from './masonry';
import type { Rect } from './site';

export interface FrameSpec {
  /** Outer faces of the frame. */
  rect: Rect;
  /** Underside of the sills. */
  z0: number;
  /** Sill top to plate underside. */
  postH: number;
  sill?: [number, number];
  post?: number;
  plate?: [number, number];
  openings?: Partial<Record<Side, Opening[]>>;
  skip?: Partial<Record<Side, boolean>>;
  /** What fills the panels: wattle and daub, brick nogging, boards, or nothing (an open shed). */
  infill: 'daub' | 'brick' | 'boards' | 'none';
  /** Widest bay between posts. */
  maxBay?: number;
  braces?: boolean;
  /** Where the timbers and the infill belong. */
  stage?: Stage;
  infillStage?: Stage;
  prefix: string;
  /** Daub colour: plain limewash or a tinted one. */
  daub?: string;
  /** Timber material (oak, or darker old timber). */
  wood?: string;
}

export interface FrameResult {
  /** Top of the wall plates. */
  plateTop: number;
  sillTop: number;
  /** Post centres along each side (u: x for front/back, y for the sides). */
  posts: Record<Side, number[]>;
  /** Ids of the plates (for what rests on them). */
  plates: string[];
}

/** Post positions along one side: ends, each side of every opening, and between so no bay is too wide. */
function postsAlong(u0: number, u1: number, half: number, openings: Opening[], maxBay: number): number[] {
  const fixed = new Set<number>([u0 + half, u1 - half]);
  for (const o of openings) {
    fixed.add(o.u0 - half);
    fixed.add(o.u1 + half);
  }
  const sorted = [...fixed].map((u) => Math.round(u * 1e4) / 1e4).sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const u = sorted[i];
    if (out.length && u - out[out.length - 1] < half * 2 + 0.05) continue; // jambs that meet share a post
    if (out.length) {
      const prev = out[out.length - 1];
      const inOpening = openings.some((o) => prev <= o.u0 && u >= o.u1);
      if (!inOpening && u - prev > maxBay) {
        const n = Math.ceil((u - prev) / maxBay);
        for (let k = 1; k < n; k++) out.push(prev + ((u - prev) * k) / n);
      }
    }
    out.push(u);
  }
  return out;
}

/** A timber-framed storey: frame first (sills, posts, plates, rails, braces), then the infill. */
export function frameStorey(b: Builder, spec: FrameSpec): FrameResult {
  const r = spec.rect;
  const sill = spec.sill ?? [0.2, 0.2];
  const post = spec.post ?? 0.18;
  const plate = spec.plate ?? [0.2, 0.18];
  const half = post / 2;
  const maxBay = spec.maxBay ?? 1.3;
  const stage = spec.stage ?? 'frame';
  const infillStage = spec.infillStage ?? 'walls';
  const wood = spec.wood ?? 'oak';
  const pre = spec.prefix;
  const sillTop = spec.z0 + sill[1];
  const plateBot = sillTop + spec.postH;
  const plateTop = plateBot + plate[1];
  const w = sill[0];
  const lineOf = (side: Side) => (side === 'front' ? r.y0 + w / 2 : side === 'back' ? r.y1 - w / 2 : side === 'left' ? r.x0 + w / 2 : r.x1 - w / 2);
  const along = (side: Side) => side === 'front' || side === 'back';
  const P = (side: Side, u: number, z: number, off = 0): Vec3 => (along(side) ? [u, lineOf(side) + off, z] : [lineOf(side) + off, u, z]);
  const inward = (side: Side) => (side === 'front' || side === 'left' ? 1 : -1);
  const has = (side: Side) => !spec.skip?.[side];

  // sills: the long ones run the length, the short ones between
  const sz = spec.z0 + sill[1] / 2;
  for (const side of SIDES) {
    if (!has(side)) continue;
    const [u0, u1] = along(side) ? [r.x0, r.x1] : [r.y0 + w, r.y1 - w];
    b.beam(`${pre}sill.${side}`, 'sill', P(side, u0, sz), P(side, u1, sz), sill, stage, []);
  }

  // posts: corner posts on the long walls' ends (where the side walls' lines cross them), each side
  // of every opening, and between
  const posts = {} as Record<Side, number[]>;
  for (const side of SIDES) {
    if (!has(side)) {
      posts[side] = [];
      continue;
    }
    const ops = spec.openings?.[side] ?? [];
    if (along(side)) posts[side] = postsAlong(r.x0 + w / 2 - half, r.x1 - w / 2 + half, half, ops, maxBay);
    else {
      const pts = postsAlong(r.y0 + w / 2 - half, r.y1 - w / 2 + half, half, ops, maxBay);
      // the corners belong to the long walls, unless there is none there
      posts[side] = pts.filter((_, i) => (i > 0 || !has('front')) && (i < pts.length - 1 || !has('back')));
    }
    posts[side].forEach((u, i) => b.box(`${pre}post.${side}${i}`, 'post', P(side, u, (sillTop + plateBot) / 2), [post, post, spec.postH], wood, stage, [`${pre}sill.${side}`]));
  }

  // plates on the posts
  const pz = plateBot + plate[1] / 2;
  const plates: string[] = [];
  for (const side of SIDES) {
    if (!has(side)) continue;
    const [u0, u1] = along(side) ? [r.x0, r.x1] : [r.y0 + w, r.y1 - w];
    b.beam(`${pre}plate.${side}`, 'plate', P(side, u0, pz), P(side, u1, pz), plate, stage, []);
    plates.push(`${pre}plate.${side}`);
  }

  // rails, girts and braces, bay by bay; then the panels they leave
  const mid = sillTop + spec.postH * 0.5;
  type Panel = { side: Side; u0: number; u1: number; z0: number; z1: number };
  const panels: Panel[] = [];
  for (const side of SIDES) {
    if (!has(side)) continue;
    let us = posts[side];
    if (!along(side)) us = [...(has('front') ? [r.y0 + w / 2] : []), ...us, ...(has('back') ? [r.y1 - w / 2] : [])];
    const ops = spec.openings?.[side] ?? [];
    for (let i = 0; i < us.length - 1; i++) {
      const a = us[i] + half;
      const c = us[i + 1] - half;
      if (c - a < 0.08) continue;
      const o = ops.find((op) => op.u0 >= a - 0.02 && op.u1 <= c + 0.02);
      const id = `${pre}${side}${i}`;
      if (o) {
        const door = o.z0 <= sillTop + 0.05;
        // a rail over it (the door head, the window head), one under a window
        if (o.z1 < plateBot - 0.1) b.beam(`${id}.head`, 'rail', P(side, a, o.z1 + 0.06), P(side, c, o.z1 + 0.06), [0.17, 0.12], stage, []);
        if (!door) b.beam(`${id}.wsill`, 'rail', P(side, a, o.z0 - 0.06), P(side, c, o.z0 - 0.06), [0.17, 0.12], stage, []);
        // panels each side of a narrower opening, above and below it
        if (o.u0 - a > 0.08) panels.push({ side, u0: a, u1: o.u0, z0: door ? sillTop : o.z0, z1: o.z1 });
        if (c - o.u1 > 0.08) panels.push({ side, u0: o.u1, u1: c, z0: door ? sillTop : o.z0, z1: o.z1 });
        if (!door) panels.push({ side, u0: a, u1: c, z0: sillTop, z1: o.z0 - 0.12 });
        if (o.z1 + 0.12 < plateBot - 0.05) panels.push({ side, u0: a, u1: c, z0: o.z1 + 0.12, z1: plateBot });
      } else {
        b.beam(`${id}.girt`, 'girt', P(side, a, mid), P(side, c, mid), [0.16, 0.13], stage, []);
        if (spec.braces !== false && c - a > 0.5) {
          // braces rise towards the nearer end of the wall, as a carpenter sets them
          const towardsEnd = (a + c) / 2 > ((us[0] + us[us.length - 1]) / 2) ? 1 : -1;
          const [lo, hi] = towardsEnd > 0 ? [a, c] : [c, a];
          b.beam(`${id}.brace`, 'brace', P(side, lo, sillTop + 0.02, -0.005 * inward(side)), P(side, hi, plateBot - 0.02, -0.005 * inward(side)), [0.15, 0.11], stage, []);
        }
        panels.push({ side, u0: a, u1: c, z0: sillTop, z1: mid - 0.065 });
        panels.push({ side, u0: a, u1: c, z0: mid + 0.065, z1: plateBot });
      }
    }
  }

  // pegs: the frame is pinned at every joint (a dot of end grain on the face of each post's head and foot)
  for (const side of SIDES) {
    if (!has(side)) continue;
    posts[side].forEach((u, i) => {
      for (const z of [sillTop + 0.07, plateBot - 0.07]) b.box(`${pre}peg.${side}${i}.${z.toFixed(2)}`, 'peg', P(side, u, z, -inward(side) * (w / 2 + 0.004)), along(side) ? [0.035, 0.012, 0.035] : [0.012, 0.035, 0.035], 'oak-end', stage, []);
    });
  }

  // the infill: wattle first, then the daub over it (or brick, or boards)
  if (spec.infill !== 'none') {
    const ps = panels.filter((p) => p.u1 - p.u0 > 0.06 && p.z1 - p.z0 > 0.06);
    if (spec.infill === 'daub') {
      ps.forEach((p, i) => {
        const at = P(p.side, (p.u0 + p.u1) / 2, (p.z0 + p.z1) / 2, inward(p.side) * 0.03);
        b.box(`${pre}wattle${i}`, 'wattle', at, along(p.side) ? [p.u1 - p.u0, 0.05, p.z1 - p.z0] : [0.05, p.u1 - p.u0, p.z1 - p.z0], 'wattle', infillStage, []);
      });
    }
    ps.forEach((p, i) => {
      const deep = spec.infill === 'boards' ? 0.04 : 0.12;
      const back = spec.infill === 'boards' ? 0.0 : 0.018;
      const at = P(p.side, (p.u0 + p.u1) / 2, (p.z0 + p.z1) / 2, inward(p.side) * back);
      const mat = spec.infill === 'daub' ? (spec.daub ?? 'daub') : spec.infill === 'brick' ? 'brick' : 'boards';
      b.box(`${pre}panel${i}`, spec.infill, at, along(p.side) ? [p.u1 - p.u0, deep, p.z1 - p.z0] : [deep, p.u1 - p.u0, p.z1 - p.z0], mat, infillStage, []);
    });
  }
  return { plateTop, sillTop, posts, plates };
}

/**
 * Floor joists across the building (along y) on the plates, standing out `out` over the front for a
 * jettied storey above: their ends show along the street. Returns the joists' top.
 */
export function joists(b: Builder, opts: { x0: number; x1: number; y0: number; y1: number; z: number; out: number; prefix: string; stage?: Stage }): number {
  const n = Math.max(2, Math.round((opts.x1 - opts.x0) / 0.5));
  const h = 0.16;
  for (let i = 0; i <= n; i++) {
    const x = opts.x0 + 0.1 + ((opts.x1 - opts.x0 - 0.2) * i) / n;
    b.beam(`${opts.prefix}joist${i}`, 'joist', [x, opts.y0 - opts.out, opts.z + h / 2], [x, opts.y1, opts.z + h / 2], [0.13, h], opts.stage ?? 'frame', []);
  }
  return opts.z + h;
}

/**
 * Log walls: whole logs laid a course at a time round a rectangle, notched over each other at the
 * corners where their ends stand out; openings sawn out (the cut ends showing). Returns the top.
 */
export function logWalls(b: Builder, opts: { rect: Rect; z0: number; z1: number; r?: number; openings?: Partial<Record<Side, Opening[]>>; stage: (z: number) => Stage; prefix: string }): number {
  const rad = opts.r ?? 0.13;
  const r = opts.rect;
  const step = rad * 1.7; // each course sits down into the one below
  const over = 0.22; // the ends stand out past the corners
  let z = opts.z0 + rad;
  for (let k = 0; z < opts.z1; k++) {
    // the side walls' logs sit half a log higher than the long walls' (they notch over each other)
    for (const side of SIDES) {
      const long = side === 'front' || side === 'back';
      const zz = z + (long ? 0 : step / 2);
      if (zz > opts.z1) continue;
      const c = side === 'front' ? r.y0 + rad : side === 'back' ? r.y1 - rad : side === 'left' ? r.x0 + rad : r.x1 - rad;
      const [u0, u1] = long ? [r.x0 - over, r.x1 + over] : [r.y0 - over, r.y1 + over];
      const cuts: Array<[number, number]> = (opts.openings?.[side] ?? []).filter((o) => zz + rad > o.z0 && zz - rad < o.z1).map((o) => [o.u0, o.u1]);
      let segs: Array<[number, number]> = [[u0, u1]];
      for (const [a, cc] of cuts) segs = segs.flatMap(([s0, s1]) => (cc <= s0 || a >= s1 ? [[s0, s1]] : [...(a > s0 ? [[s0, a]] : []), ...(cc < s1 ? [[cc, s1]] : [])]) as Array<[number, number]>);
      segs.forEach(([s0, s1], j) => {
        const rr = b.rng(`${opts.prefix}${k}${side}${j}`);
        const rr0 = rad * uniform(rr, 0.9, 1.08);
        const A: Vec3 = long ? [s0, c, zz] : [c, s0, zz];
        const B: Vec3 = long ? [s1, c, zz] : [c, s1, zz];
        b.log(`${opts.prefix}log${k}.${side}.${j}`, 'log', A, B, rr0, opts.stage(zz), []);
      });
    }
    z += step;
  }
  return z - step + rad + step / 2;
}

/** Vertical boards on rails along one wall line (a barn, a shed, a watch cabin), with gaps between. */
export function boardWall(b: Builder, opts: { a: [number, number]; b: [number, number]; z0: number; top: (u: number) => number; thick?: number; prefix: string; stage: Stage; skip?: Array<[number, number]>; material?: string }): void {
  const [ax, ay] = opts.a;
  const [bx, by] = opts.b;
  const len = Math.hypot(bx - ax, by - ay);
  const dx = (bx - ax) / len;
  const dy = (by - ay) / len;
  const rr = b.rng(opts.prefix);
  let k = 0;
  for (let u = 0; u < len - 1e-6; ) {
    const w = Math.min(len - u, uniform(rr, 0.2, 0.3));
    const um = u + w / 2;
    if (!(opts.skip ?? []).some(([s0, s1]) => um > s0 && um < s1)) {
      const top = opts.top(um);
      const t = opts.thick ?? 0.035;
      b.box(`${opts.prefix}${k}`, 'board', [ax + dx * um, ay + dy * um, (opts.z0 + top) / 2], [Math.abs(dx) * (w - 0.012) + Math.abs(dy) * t, Math.abs(dy) * (w - 0.012) + Math.abs(dx) * t, top - opts.z0], opts.material ?? 'boards', opts.stage, []);
      k++;
    }
    u += w;
  }
}
