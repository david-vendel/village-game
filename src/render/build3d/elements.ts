// Construction elements: what a building is made of, in the order it is built.
// The architecture rules (farm.ts, …) produce a list of these, tests check
// them, geometry.ts turns them into meshes. Pure maths: no three.js, no DOM.
//
// Model space (docs/art/ASSET_SPEC.md §3): metres, +Z up, the front faces −Y
// (the street), origin at the centre of the building's front on the ground.

export const STAGES = ['staking', 'foundation', 'frame', 'walls', 'roof'] as const;
export type Stage = (typeof STAGES)[number];

export type Vec3 = [number, number, number];

/**
 * shape:
 * - `box`    a block of `size` about its centre `at`, turned by `rot` (radians, XYZ euler)
 * - `beam`   a squared timber from `a` to `b`, cross-section `size[1]` × `size[2]` (size/at/rot derived)
 * - `stone`  an irregular fieldstone filling the box
 * - `roof`   a thatch shell, from `params`
 * - `leanto` a mono-pitch roof slab, from `params`
 * - `gable`  the board triangle of a gable, from `params`
 */
export type Shape = 'box' | 'beam' | 'stone' | 'roof' | 'leanto' | 'gable';

export interface Element {
  id: string;
  /** footing-stone, sill, post, girt, brace, plate, tie-beam, rafter, collar, batten, daub, thatch, … */
  kind: string;
  material: string;
  stage: Stage;
  shape: Shape;
  at: Vec3;
  size: Vec3;
  rot: Vec3;
  a?: Vec3;
  b?: Vec3;
  params: Record<string, number>;
  /** Ids of what this rests on or is fixed to (structural sanity, construction order). */
  on: string[];
  /** variant:upgraded, novariant:upgraded, scaffold, part:doorOpen */
  tags: string[];
  /** Order within its stage. */
  order: number;
  /** Per-piece random 0..1: colour and shape variation. */
  rand: number;
}

/** Rotate v by XYZ euler angles (X first, then Y, then Z: Blender's default). */
export function rotate(v: Vec3, rot: Vec3): Vec3 {
  let [x, y, z] = v;
  const [rx, ry, rz] = rot;
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return [x, y, z];
}

/** Centre, size and rotation of a squared timber from a to b: local X along it, Y its width, Z its height. */
export function beamTransform(a: Vec3, b: Vec3, w: number, h: number): { at: Vec3; size: Vec3; rot: Vec3 } {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(...d);
  const yaw = Math.atan2(d[1], d[0]);
  const pitch = Math.atan2(d[2], Math.hypot(d[0], d[1]));
  return { at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], size: [length, w, h], rot: [0, -pitch, yaw] };
}

/** Axis-aligned bounds [min, max] of an element (exact for boxes and beams; roofs from their params). */
export function bounds(e: Element): [Vec3, Vec3] {
  if (e.shape === 'roof' || e.shape === 'leanto' || e.shape === 'gable') {
    const p = e.params;
    return [
      [p.minX, p.minY, p.minZ],
      [p.maxX, p.maxY, p.maxZ],
    ];
  }
  const corners: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(rotate([(sx * e.size[0]) / 2, (sy * e.size[1]) / 2, (sz * e.size[2]) / 2], e.rot));
  const lo = [0, 1, 2].map((i) => e.at[i] + Math.min(...corners.map((c) => c[i]))) as Vec3;
  const hi = [0, 1, 2].map((i) => e.at[i] + Math.max(...corners.map((c) => c[i]))) as Vec3;
  return [lo, hi];
}

/** A seeded random source (mulberry32 over a string hash): the same key gives the same numbers. */
export function rng(key: string): () => number {
  let h = 1779033703 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform in [lo, hi) from a random source. */
export const uniform = (r: () => number, lo: number, hi: number) => lo + (hi - lo) * r();

/** Collects elements with running order numbers per stage and a seeded random number each. */
export class Builder {
  readonly out: Element[] = [];
  private counts = new Map<Stage, number>();

  constructor(readonly seed: number) {}

  /** A random source for one element: the same in both looks, so shared elements stay identical. */
  rng(key: string): () => number {
    return rng(`${this.seed}:${key}`);
  }

  add(e: Omit<Element, 'order' | 'rand' | 'at' | 'size' | 'rot' | 'params' | 'on' | 'tags'> & Partial<Pick<Element, 'at' | 'size' | 'rot' | 'params' | 'on' | 'tags'>>): Element {
    const n = (this.counts.get(e.stage) ?? 0) + 1;
    this.counts.set(e.stage, n);
    const full: Element = { at: [0, 0, 0], size: [0, 0, 0], rot: [0, 0, 0], params: {}, on: [], tags: [], ...e, order: n, rand: this.rng(e.id)() };
    if (full.shape === 'beam') Object.assign(full, beamTransform(full.a!, full.b!, full.size[1], full.size[2]));
    this.out.push(full);
    return full;
  }

  beam(id: string, kind: string, a: Vec3, b: Vec3, wh: [number, number], stage: Stage, on: string[], material = 'oak', tags: string[] = []): Element {
    return this.add({ id, kind, material, stage, shape: 'beam', a, b, size: [0, wh[0], wh[1]], on, tags });
  }

  box(id: string, kind: string, at: Vec3, size: Vec3, material: string, stage: Stage, on: string[], opts: { rot?: Vec3; shape?: Shape; tags?: string[] } = {}): Element {
    return this.add({ id, kind, material, stage, shape: opts.shape ?? 'box', at, size, rot: opts.rot ?? [0, 0, 0], on, tags: opts.tags ?? [] });
  }
}

/** Whether an element is in the picture of a look / construction stage / with these state parts. */
export function shows(e: Element, look: { variant: string; stage?: Stage; parts: readonly string[] }): boolean {
  // a building going up is the default look; what's built by the end of the stage shows (scaffolding too)
  const variant = look.stage ? 'default' : look.variant;
  for (const t of e.tags) {
    const [k, v] = t.split(':');
    if (k === 'variant' && v !== variant) return false;
    if (k === 'novariant' && v === variant) return false;
    if (k === 'part') return look.parts.includes(v);
  }
  if (look.stage) return STAGES.indexOf(e.stage) <= STAGES.indexOf(look.stage);
  return !e.tags.includes('scaffold');
}
