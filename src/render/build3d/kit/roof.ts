// Roofs, as a roofer builds them: the rafters in pairs on the wall plates
// (collars tying the pairs), battens across them from the eaves up, then the
// covering a course at a time from the eaves to the ridge, front and back in
// turn: thatch in thick bundled courses, pantiles, cleft shingles, slates or
// boards; then the ridge (a straw roll, ridge tiles, a pair of ridge boards)
// and verge boards where the roof runs out past a gable.
//
// A gable that meets a neighbour's wall has no overhang: the roof ends flush on
// the boundary, so two buildings side by side read as one roofline. Alone, the
// roof runs out a little past the gable wall.

import { type Builder, ROOF_STYLES, type RoofStyle, type Stage, type Vec3 } from '../elements';
import type { ModelBuilder } from '../model';
import { window_ } from './openings';
import { frameStorey } from './timber';

const rad = (deg: number) => (deg * Math.PI) / 180;

/** How each covering is laid: course height along the slope, thickness, batten spacing, and pitch range. */
export const COVERING: Record<RoofStyle, { course: number; thick: number; batten: number; material: string; minPitch: number; maxPitch: number }> = {
  thatch: { course: 0.44, thick: 0.3, batten: 0.3, material: 'thatch', minPitch: 45, maxPitch: 55 },
  tile: { course: 0.3, thick: 0.05, batten: 0.3, material: 'tile', minPitch: 35, maxPitch: 50 },
  shingle: { course: 0.2, thick: 0.035, batten: 0.2, material: 'shingle', minPitch: 35, maxPitch: 60 },
  slate: { course: 0.24, thick: 0.03, batten: 0.24, material: 'slate', minPitch: 30, maxPitch: 60 },
  boards: { course: 0.55, thick: 0.035, batten: 0.6, material: 'roof-boards', minPitch: 20, maxPitch: 45 },
};

export interface GableSpec {
  /** Wall extents along x (outer faces of the gable walls). */
  x0: number;
  x1: number;
  /** Outer faces of the front and back walls. */
  y0: number;
  y1: number;
  /** Top of the wall plates: where the rafters sit. */
  zWall: number;
  pitchDeg: number;
  style: RoofStyle;
  /** Horizontal overhang of the eaves past the front and back walls. */
  eaves: number;
  /** Overhang past each gable: 0 where a neighbour's wall meets this one. */
  overL: number;
  overR: number;
  /** Where the rafters belong (raised with a timber frame, or after the stone walls). */
  stage: Stage;
  prefix: string;
  /** What closes the gable triangles under the roof (stone gables are built with the walls). */
  gableFill?: { left: 'boards' | 'daub' | 'none'; right: 'boards' | 'daub' | 'none' };
  /** Material of the covering, if not the style's own (a darker, older thatch). */
  material?: string;
  rafter?: [number, number];
  /**
   * Where a wall dormer (a gable standing up from the front wall) breaks the front slope: x0..x1, and
   * the height its own roof comes down to. Below that the front slope's covering and battens stop
   * either side of it and its rafters start at the wall plate, not out at the eaves.
   */
  gaps?: Array<{ x0: number; x1: number; z: number }>;
}

/** Pieces of [a, b] along x left by the gaps (a run of covering or a batten). */
function aroundGaps(a: number, b: number, gaps: Array<{ x0: number; x1: number }>): Array<[number, number]> {
  let out: Array<[number, number]> = [[a, b]];
  for (const g of gaps) out = out.flatMap(([s0, s1]) => (g.x1 <= s0 || g.x0 >= s1 ? [[s0, s1]] : [...(g.x0 > s0 + 0.05 ? [[s0, g.x0]] : []), ...(g.x1 < s1 - 0.05 ? [[g.x1, s1]] : [])]) as Array<[number, number]>);
  return out;
}

export interface RoofInfo {
  /** Height of the outer surface at plan y (between the eaves). */
  surface: (y: number) => number;
  /** Top of the outer surface at the ridge. */
  ridgeZ: number;
  /** The ridge line's y. */
  ridgeY: number;
  /** Underside of the covering at the eaves (the lowest it comes). */
  eaveLow: number;
  /** Covering extents. */
  xa: number;
  xb: number;
  /** Rafters' top line at y (the roof timbers stay under the covering). */
  rafterTop: (y: number) => number;
}

export function gableRoof(b: Builder, spec: GableSpec): RoofInfo {
  const pitch = rad(spec.pitchDeg);
  const tan = Math.tan(pitch);
  const cos = Math.cos(pitch);
  const sin = Math.sin(pitch);
  const cov = COVERING[spec.style];
  const [rw, rh] = spec.rafter ?? [0.11, 0.15];
  const ym = (spec.y0 + spec.y1) / 2;
  const pre = spec.prefix;
  const xa = spec.x0 - spec.overL;
  const xb = spec.x1 + spec.overR;
  // the rafters' top line: from the outer edge of the wall plate up at the pitch
  const top0 = spec.zWall + rh / cos;
  const rafterTop = (y: number) => top0 + (y < ym ? y - spec.y0 : spec.y1 - y) * tan;
  const apex = rafterTop(ym);
  const batten = 0.04;
  const lift = (batten + cov.thick) / cos;
  const surface = (y: number) => rafterTop(y) + lift;
  const foot = spec.y0 - spec.eaves; // rafter feet, front
  // rafter centre lines: the top line moved half a rafter down, square to the slope
  const n = Math.max(2, Math.round((spec.x1 - spec.x0 - 0.2) / 0.62));
  const rafterIds: string[] = [];
  for (let k = 0; k <= n; k++) {
    const x = spec.x0 + 0.1 + ((spec.x1 - spec.x0 - 0.2) * k) / n;
    for (const [side, sgn] of [
      ['f', 1],
      ['b', -1],
    ] as const) {
      const inGap = sgn > 0 && (spec.gaps ?? []).some((g) => x > g.x0 - 0.06 && x < g.x1 + 0.06);
      const yFoot = sgn > 0 ? (inGap ? spec.y0 + 0.06 : foot) : spec.y1 + spec.eaves;
      const a: Vec3 = [x, yFoot + sgn * sin * (rh / 2), rafterTop(yFoot) - cos * (rh / 2)];
      const c: Vec3 = [x, ym + sgn * sin * (rh / 2) - sgn * 0.01, apex - cos * (rh / 2)];
      b.beam(`${pre}rafter${k}${side}`, 'rafter', a, c, [rw, rh], spec.stage, []);
      rafterIds.push(`${pre}rafter${k}${side}`);
    }
    // a collar two thirds up
    const cz = spec.zWall + (apex - spec.zWall) * 0.62;
    const cy = (apex - cz) / tan - 0.08;
    b.beam(`${pre}collar${k}`, 'collar', [x, ym - cy, cz], [x, ym + cy, cz], [0.09, 0.13], spec.stage, [`${pre}rafter${k}f`, `${pre}rafter${k}b`]);
  }

  // gable infill under the end rafters
  for (const [side, x] of [
    ['left', spec.x0 + 0.06],
    ['right', spec.x1 - 0.06],
  ] as const) {
    const fill = spec.gableFill?.[side] ?? 'none';
    if (fill === 'none') continue;
    const zTop = apex - rh / cos - 0.02;
    const pts: Array<[number, number]> = [
      [spec.y0 - ym + 0.12, spec.zWall],
      [spec.y1 - ym - 0.12, spec.zWall],
      [0, zTop],
    ];
    if (fill === 'boards') {
      // upright boards, each cut to the slope
      const w = 0.22;
      const half = ym - spec.y0 - 0.12;
      for (let u = -half, k = 0; u < half - 1e-6; u += w, k++) {
        const u1 = Math.min(half, u + w);
        const zt = (v: number) => Math.max(spec.zWall + 0.03, spec.zWall + (half - Math.abs(v)) * tan - 0.03);
        if (zt(u) - spec.zWall < 0.05 && zt(u1) - spec.zWall < 0.05) continue;
        const quad: Array<[number, number]> = [
          [u + 0.006, spec.zWall],
          [u1 - 0.006, spec.zWall],
          [u1 - 0.006, zt(u1 - 0.006)],
          ...(u < 0 && u1 > 0 ? ([[0, zt(0)]] as Array<[number, number]>) : []),
          [u + 0.006, zt(u + 0.006)],
        ];
        b.slab(`${pre}gable.${side}${k}`, 'gable-board', [x, ym, 0], quad, 0.035, 'boards', 'walls', [], { rot: [0, 0, Math.PI / 2] });
      }
    } else {
      b.slab(`${pre}gable.${side}`, 'gable-daub', [x, ym, 0], pts, 0.12, 'daub', 'walls', [], { rot: [0, 0, Math.PI / 2] });
      // a king post and struts on it
      b.beam(`${pre}gable.${side}.king`, 'post', [x + (side === 'left' ? -0.05 : 0.05), ym, spec.zWall], [x + (side === 'left' ? -0.05 : 0.05), ym, zTop], [0.14, 0.14], spec.stage, []);
      for (const s of [-1, 1]) b.beam(`${pre}gable.${side}.strut${s}`, 'brace', [x + (side === 'left' ? -0.05 : 0.05), ym + s * (ym - spec.y0) * 0.55, spec.zWall + 0.05], [x + (side === 'left' ? -0.05 : 0.05), ym + s * 0.07, spec.zWall + (zTop - spec.zWall) * 0.62], [0.12, 0.1], spec.stage, []);
    }
  }

  // battens, from the eaves up, front and back in turn
  const run = (ym - foot) / cos; // slope length from the rafter feet to the ridge
  const rows = Math.max(2, Math.floor(run / cov.batten));
  for (let j = 0; j < rows; j++) {
    const s = (j + 0.4) * (run / rows);
    for (const [side, sgn] of [
      ['f', 1],
      ['b', -1],
    ] as const) {
      const y = sgn > 0 ? foot + s * cos : spec.y1 + spec.eaves - s * cos;
      const z = rafterTop(y) + batten / 2;
      const gaps = sgn > 0 ? (spec.gaps ?? []).filter((g) => z < g.z) : [];
      aroundGaps(xa + 0.02, xb - 0.02, gaps).forEach(([u0, u1], q) => b.beam(`${pre}batten.${side}${j}${q ? `.${q}` : ''}`, 'batten', [u0, y, z], [u1, y, z], [0.06, batten], 'roof', [`${pre}rafter0${side}`]));
    }
  }

  // the covering, a course at a time from the eaves to the ridge
  const style = ROOF_STYLES.indexOf(spec.style);
  const material = spec.material ?? cov.material;
  const past = spec.style === 'thatch' ? 0.18 : 0.06; // the covering runs on past the rafter feet
  const yEave = foot - past * cos;
  const total = (ym - yEave) / cos;
  const courses = Math.max(2, Math.ceil(total / cov.course));
  const step = total / courses;
  for (let k = 0; k < courses; k++) {
    for (const [side, sgn] of [
      ['f', 1],
      ['b', -1],
    ] as const) {
      const sLo = k * step;
      const sHi = Math.min(total + (spec.style === 'thatch' ? 0.05 : 0.02), (k + 1) * step + (k < courses - 1 ? step * 0.25 : 0));
      const yl = sgn > 0 ? yEave + sLo * cos : 2 * ym - yEave - sLo * cos;
      const yu = sgn > 0 ? yEave + sHi * cos : 2 * ym - yEave - sHi * cos;
      const along = (y: number) => surface(Math.min(Math.max(y, -1e9), 1e9));
      // later courses lie a hair above the ones below them, so each course's butt shows
      const raise = k * 0.004;
      // a wall dormer's gable breaks the front slope's lower courses
      const gaps = sgn > 0 ? (spec.gaps ?? []).filter((g) => along(yl) < g.z) : [];
      aroundGaps(xa, xb, gaps).forEach(([x0, x1], q) =>
        b.add({
          id: `${pre}course.${side}${k}${q ? `.${q}` : ''}`,
          kind: spec.style,
          material,
          stage: 'roof',
          shape: 'course',
          params: { x0, x1, yl, zl: along(yl) + raise, yu, zu: along(yu) + raise, thickness: cov.thick, style, lip: spec.style === 'thatch' ? 0.1 : 0 },
          on: [`${pre}batten.${side}0`],
        }),
      );
    }
  }

  // the ridge
  const rz = surface(ym);
  if (spec.style === 'thatch') {
    b.log(`${pre}ridge`, 'ridge', [xa + 0.05, ym, rz - 0.06], [xb - 0.05, ym, rz - 0.06], 0.17, 'roof', [`${pre}course.f${courses - 1}`], material);
    // the ridge's pinned wrap: liggers along each side
    for (const s of [-1, 1]) b.beam(`${pre}ligger${s}`, 'ligger', [xa + 0.08, ym + s * 0.16, rz - 0.06], [xb - 0.08, ym + s * 0.16, rz - 0.06], [0.025, 0.025], 'roof', [`${pre}ridge`], 'hazel');
  } else if (spec.style === 'tile') {
    const n2 = Math.max(1, Math.round((xb - xa) / 0.36));
    for (let i = 0; i < n2; i++) {
      const a = xa + ((xb - xa) * i) / n2;
      const c = xa + ((xb - xa) * (i + 1)) / n2;
      b.add({ id: `${pre}ridge${i}`, kind: 'ridge', material, stage: 'roof', shape: 'log', a: [a, ym, rz - 0.01], b: [c + 0.02, ym, rz - 0.01], params: { r: 0.095, sides: 8 }, on: [`${pre}course.f${courses - 1}`] });
    }
  } else {
    for (const s of [-1, 1]) {
      const dy = s * 0.09 * cos;
      b.beam(`${pre}ridge${s}`, 'ridge', [xa, ym + dy, rz + 0.01 - 0.09 * sin * 0.5], [xb, ym + dy, rz + 0.01 - 0.09 * sin * 0.5], [0.2, 0.035], 'roof', [`${pre}course.f${courses - 1}`], spec.style === 'slate' ? material : 'boards');
    }
  }

  // verge boards where the roof runs out past a gable (not on thatch, whose verge is rolled)
  if (spec.style !== 'thatch') {
    for (const [side, x, over] of [
      ['l', xa, spec.overL],
      ['r', xb, spec.overR],
    ] as const) {
      if (over < 0.05) continue;
      for (const [s, sgn] of [
        ['f', 1],
        ['b', -1],
      ] as const) {
        const yA = sgn > 0 ? yEave : 2 * ym - yEave;
        b.beam(`${pre}verge.${side}${s}`, 'verge', [x + (side === 'l' ? 0.02 : -0.02), yA, surface(yA) - 0.06], [x + (side === 'l' ? 0.02 : -0.02), ym, rz - 0.04], [0.03, 0.2], 'roof', [], 'boards');
      }
    }
  }

  const eaveLow = surface(yEave) - cov.thick / cos - 0.1;
  return { surface, ridgeZ: rz + (spec.style === 'thatch' ? 0.11 : 0.08), ridgeY: ym, eaveLow, xa, xb, rafterTop };
}

/**
 * A pyramid or hipped roof over a rectangle (a watch cabin, a well head): hip rafters from the corners
 * to the apex, then the covering in bands from the eaves up; w × d at the eaves, rising h.
 */
export function pyramidRoof(b: Builder, opts: { cx: number; cy: number; w: number; d: number; z: number; h: number; style: RoofStyle; prefix: string; stage?: Stage; material?: string; finial?: boolean }): number {
  const cov = COVERING[opts.style];
  const pre = opts.prefix;
  const apex: Vec3 = [opts.cx, opts.cy, opts.z + opts.h];
  for (const [i, [sx, sy]] of ([
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const).entries()) {
    b.beam(`${pre}hip${i}`, 'rafter', [opts.cx + (sx * opts.w) / 2 * 0.92, opts.cy + (sy * opts.d) / 2 * 0.92, opts.z - 0.04], [apex[0], apex[1], apex[2] - 0.12], [0.1, 0.12], opts.stage ?? 'roof', []);
  }
  const bands = Math.max(2, Math.ceil(Math.hypot(opts.h, Math.max(opts.w, opts.d) / 2) / (cov.course * 1.4)));
  const style = ROOF_STYLES.indexOf(opts.style);
  for (let k = 0; k < bands; k++) {
    const f0 = k / bands;
    const f1 = Math.min(1, (k + 1.25) / bands);
    b.add({
      id: `${pre}band${k}`,
      kind: opts.style,
      material: opts.material ?? cov.material,
      stage: 'roof',
      shape: 'cone',
      at: [opts.cx, opts.cy, opts.z],
      params: { r0: Math.SQRT2 * (1 - f0), r1: Math.SQRT2 * (1 - f1), z0: opts.h * f0 + k * 0.004, z1: opts.h * f1 + k * 0.004, thickness: cov.thick, sides: 4, style, sx: opts.w / 2, sy: opts.d / 2 },
      on: [`${pre}hip0`],
    });
  }
  if (opts.finial !== false) b.cyl(`${pre}finial`, 'finial', [apex[0], apex[1], apex[2] - 0.02], 0.05, 0.02, 0.35, 'oak', 'roof', [`${pre}band${bands - 1}`], { sides: 6 });
  return apex[2];
}

/** A cone of covering over a round tower (a mill's cap): radius r at z, rising h. */
export function coneRoof(b: Builder, opts: { cx: number; cy: number; r: number; z: number; h: number; style: RoofStyle; prefix: string; sides?: number; material?: string }): number {
  const cov = COVERING[opts.style];
  const bands = Math.max(3, Math.ceil(Math.hypot(opts.h, opts.r) / (cov.course * 1.3)));
  const style = ROOF_STYLES.indexOf(opts.style);
  for (let k = 0; k < bands; k++) {
    const f0 = k / bands;
    const f1 = Math.min(1, (k + 1.25) / bands);
    // a cap swells a little, like a boat's hull turned over
    const bulge = (f: number) => 1 + 0.12 * Math.sin(f * Math.PI);
    b.add({
      id: `${opts.prefix}band${k}`,
      kind: opts.style,
      material: opts.material ?? cov.material,
      stage: 'roof',
      shape: 'cone',
      at: [opts.cx, opts.cy, opts.z],
      params: { r0: opts.r * (1 - f0) * bulge(f0), r1: opts.r * (1 - f1) * bulge(f1), z0: opts.h * f0 + k * 0.004, z1: opts.h * f1 + k * 0.004, thickness: cov.thick, sides: opts.sides ?? 16, style },
    });
  }
  return opts.z + opts.h;
}

/**
 * A mono-pitch roof (a lean-to, a shed, a smithy's front): from its low edge (yLow, zLow) up to its
 * high edge (yHigh, zHigh), x0..x1, on rafters, covered course by course.
 */
export function leanTo(b: Builder, opts: { x0: number; x1: number; yLow: number; zLow: number; yHigh: number; zHigh: number; style: RoofStyle; prefix: string; stage?: Stage; material?: string; rafters?: boolean }): void {
  const cov = COVERING[opts.style];
  const pre = opts.prefix;
  const len = Math.hypot(opts.yHigh - opts.yLow, opts.zHigh - opts.zLow);
  const nx = (opts.zHigh - opts.zLow) / len; // how much the surface rises per unit along the slope
  if (opts.rafters !== false) {
    // the rafters over the walls or posts; the covering runs on past them
    const [r0, r1] = [opts.x0 + 0.27, opts.x1 - 0.27];
    const n = Math.max(2, Math.round((r1 - r0) / 0.7));
    for (let k = 0; k <= n; k++) {
      const x = r0 + ((r1 - r0) * k) / n;
      b.beam(`${pre}rafter${k}`, 'rafter', [x, opts.yLow, opts.zLow - 0.12], [x, opts.yHigh, opts.zHigh - 0.12], [0.09, 0.11], opts.stage ?? 'roof', []);
    }
  }
  const courses = Math.max(1, Math.ceil(len / cov.course));
  const style = ROOF_STYLES.indexOf(opts.style);
  for (let k = 0; k < courses; k++) {
    const f0 = k / courses;
    const f1 = Math.min(1, (k + 1.25) / courses);
    const y = (f: number) => opts.yLow + (opts.yHigh - opts.yLow) * f;
    const z = (f: number) => opts.zLow + (opts.zHigh - opts.zLow) * f + k * 0.004 * nx;
    b.add({ id: `${pre}course${k}`, kind: opts.style, material: opts.material ?? cov.material, stage: 'roof', shape: 'course', params: { x0: opts.x0, x1: opts.x1, yl: y(f0), zl: z(f0), yu: y(f1), zu: z(f1), thickness: cov.thick, style, lip: opts.style === 'thatch' ? 0.08 : 0 } });
  }
}

/** The pitch a covering wants, from a 0..1 choice within its range. */
export const pitchFor = (style: RoofStyle, t: number) => COVERING[style].minPitch + (COVERING[style].maxPitch - COVERING[style].minPitch) * t;

export interface DormerSpec {
  /** Its middle along the roof, and its width (outer faces of the cheeks). */
  cx: number;
  w: number;
  /** The roof it stands on (its front slope), and where its face stands (plan y). */
  roof: RoofInfo;
  y: number;
  /** Its face from its foot up to the top of its plate. */
  h: number;
  /**
   * A wall dormer: its face stands on the wall plate at this height, flush with the wall below, and
   * breaks the eaves (the main roof leaves it a gap: dormerGap). Otherwise it stands on the slope.
   */
  wallTop?: number;
  pitchDeg: number;
  style: RoofStyle;
  material?: string;
  daub?: string;
  /** Its windows: u from its middle (default 0), with shutters and a flower box if wanted. */
  windows: Array<{ u?: number; w: number; h: number; name: string; shutters?: 'pair' | 'single' | 'none'; flowers?: boolean }>;
  prefix: string;
}

/** The foot of a dormer's face. */
const dormerFoot = (d: Pick<DormerSpec, 'roof' | 'y' | 'wallTop'>) => d.wallTop ?? d.roof.surface(d.y) - 0.12;

/** The gap a wall dormer needs in the main roof's front slope (GableSpec.gaps). */
export function dormerGap(d: { cx: number; w: number; h: number; wallTop: number }): { x0: number; x1: number; z: number } {
  return { x0: d.cx - d.w / 2 + 0.1, x1: d.cx + d.w / 2 - 0.1, z: d.wallTop + d.h };
}

/**
 * A dormer: a little timber-framed face standing up out of the roof (or, a wall dormer, up from the
 * wall plate through the eaves) with its windows, daubed cheeks back to where the roof meets its
 * plate, and its own small gable roof run back into the main one (built by gableRoof and turned, so
 * it is laid as any roof is: rafters with the frame, battens, then the covering course by course).
 * Returns its windows' middles.
 */
export function dormer(b: ModelBuilder, d: DormerSpec): Vec3[] {
  const pre = d.prefix;
  const slope = (d.roof.surface(d.y + 0.01) - d.roof.surface(d.y)) / 0.01;
  const zb = dormerFoot(d);
  const x0 = d.cx - d.w / 2;
  const x1 = d.cx + d.w / 2;
  const sill = 0.12;
  const wins = d.windows.map((w) => ({ ...w, u: d.cx + (w.u ?? 0), z0: zb + 0.2 + sill }));
  const res = frameStorey(b, {
    rect: { x0, x1, y0: d.y, y1: d.y + 0.4 },
    z0: zb,
    postH: d.h - 0.38,
    sill: [0.16, 0.2],
    post: 0.14,
    plate: [0.16, 0.18],
    openings: { front: wins.map((w) => ({ u0: w.u - w.w / 2, u1: w.u + w.w / 2, z0: w.z0, z1: w.z0 + w.h })) },
    infill: 'daub',
    daub: d.daub,
    skip: { back: true, left: true, right: true },
    braces: false,
    stage: 'frame',
    infillStage: 'walls',
    prefix: `${pre}face.`,
  });
  const zw = res.plateTop;
  // the cheeks: triangles from the face back to where the covering comes up to the plate
  const zs = d.roof.surface(d.y);
  const back = (zw - zs) / slope;
  for (const [k, x] of [
    [0, x0 + 0.05],
    [1, x1 - 0.05],
  ] as const) {
    b.slab(`${pre}cheek${k}`, 'gable-daub', [x, d.y, 0], [
      [0.08, Math.max(zb, zs - 0.2) + 0.08],
      [back + 0.1, zw - 0.12],
      [back + 0.1, zw],
      [0.08, zw],
    ], 0.08, d.daub ?? 'daub', 'walls', [], { rot: [0, 0, Math.PI / 2] });
  }
  // its roof, the ridge running back into the main roof
  const rise = (d.w / 2) * Math.tan(rad(d.pitchDeg));
  const run = Math.min((zw + rise + 0.25 - zs) / slope, d.roof.ridgeY - d.y - 0.05);
  b.turned([d.cx, d.y, 0], Math.PI / 2, (sub) =>
    gableRoof(sub, {
      x0: d.cx,
      x1: d.cx + run,
      y0: d.y - d.w / 2,
      y1: d.y + d.w / 2,
      zWall: zw,
      pitchDeg: d.pitchDeg,
      style: d.style,
      material: d.material,
      eaves: d.wallTop !== undefined ? 0.2 : 0.12,
      overL: d.wallTop !== undefined ? 0.3 : 0.2,
      overR: 0,
      stage: 'frame',
      prefix: `${pre}roof.`,
      gableFill: { left: 'daub', right: 'none' },
      rafter: [0.08, 0.11],
    }),
  );
  return wins.map((w) => window_(b, { wall: { side: 'front', face: d.y, thick: 0.16 }, u: w.u, w: w.w, h: w.h, z0: w.z0, name: w.name, shutters: w.shutters ?? 'none', stage: 'walls', flowers: w.flowers ?? false }));
}
