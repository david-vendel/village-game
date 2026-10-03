// Construction elements: what a building is made of, in the order it is built.
// The architecture rules (kit/, one file per building) produce a list of these,
// tests check them, geometry.ts turns them into meshes. Pure maths: no
// three.js, no DOM.
//
// Model space (docs/art/ASSET_SPEC.md §3): metres, +Z up, the front faces −Y
// (the street), x = 0 the middle of the plot, y = 0 the game's building line
// (BASE_Y). The plot's own cells run from plot.ts FRONT_Y back.
//
// Every element belongs to a construction stage (the game's ConstructionStage)
// and has an order within it: a building going up shows every element of the
// stages before, and of the stage it is in as many as its progress through that
// stage says, in order. So the generators add elements in the order they are
// really built (the trench dug run by run, the footing course by course, each
// timber of the frame, each course of thatch from the eaves up).

export const STAGES = ['staking', 'foundation', 'frame', 'walls', 'roof'] as const;
export type Stage = (typeof STAGES)[number];

export type Vec3 = [number, number, number];

/**
 * shape:
 * - `box`     a block of `size` about its centre `at`, turned by `rot` (radians, XYZ euler)
 * - `beam`    a squared timber from `a` to `b`, cross-section `size[1]` × `size[2]` (size/at/rot derived)
 * - `stone`   an irregular stone filling the box (fieldstone, rubble); `params.dressed` 1: squared ashlar
 * - `log`     a round timber from `a` to `b`, radius `params.r` (size/at/rot derived)
 * - `cyl`     an upright frustum: base centre `at`, radii `params.r0` (bottom) and `params.r1` (top),
 *             height `params.h`, `params.sides`; turned by `rot`
 * - `dome`    half an ellipsoid on its base at `at`, radii `size` (an oven, a heap of earth with `params.rough`)
 * - `slab`    a convex polygon `params.u0, v0, u1, v1, …` (x and z about `at`) extruded `size[1]` along y; turned by `rot`
 * - `course`  a band of roof covering along x: `params` x0, x1, lower edge (yl, zl), upper edge (yu, zu),
 *             thickness, `style` (ROOF_STYLES index), `lip` (how much the lower edge bulges); a `rot`
 *             turns the whole band about `at` (a dormer's roof, its ridge running back into the roof)
 * - `cone`    a band of covering round a vertical axis at `at`: radius params.r0 at z0 to r1 at z1,
 *             thickness, sides, style (a mill's cap, a spire, a tower's pyramid with sides 4)
 * - `patch`   a flat shape lying on the ground (a dug trench, a trodden yard): the box's top face only
 */
export type Shape = 'box' | 'beam' | 'stone' | 'log' | 'cyl' | 'dome' | 'slab' | 'course' | 'cone' | 'patch';

/** Roof coverings, as `params.style` of a course or cone. */
export const ROOF_STYLES = ['thatch', 'tile', 'shingle', 'slate', 'boards'] as const;
export type RoofStyle = (typeof ROOF_STYLES)[number];

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
  /**
   * variant:upgraded / novariant:upgraded (in one look only); until:<stage> (only while building, up
   * to the end of that stage: stakes, strings, the open trench, scaffolding); scaffold (= until:roof);
   * anim:<name> (a moving part: a door leaf, a shutter, sails; Model.anims says how it moves);
   * part:<name> (shown only with that state part).
   */
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
  if (rx) [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  if (ry) [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  if (rz) [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
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

/** Axis-aligned bounds [min, max] of an element (exact for boxes, beams and logs; the rest from their params). */
export function bounds(e: Element): [Vec3, Vec3] {
  const p = e.params;
  if (e.shape === 'course') {
    const zs = [p.zl, p.zu, p.zl - p.thickness * 1.6, p.zu - p.thickness];
    const box: [Vec3, Vec3] = [
      [p.x0, Math.min(p.yl, p.yu) - 0.02, Math.min(...zs) - p.lip],
      [p.x1, Math.max(p.yl, p.yu) + 0.02, Math.max(...zs) + 0.08],
    ];
    if (!e.rot.some(Boolean)) return box;
    // a turned course (a dormer's roof): its params are about `at` before the turn
    const pts: Vec3[] = [];
    for (const x of [box[0][0], box[1][0]]) for (const y of [box[0][1], box[1][1]]) for (const z of [box[0][2], box[1][2]]) pts.push(rotate([x - e.at[0], y - e.at[1], z - e.at[2]], e.rot));
    return spread(e.at, pts);
  }
  if (e.shape === 'cone') {
    const r = Math.max(p.r0, p.r1) + p.thickness;
    return [
      [e.at[0] - r, e.at[1] - r, e.at[2] + Math.min(p.z0, p.z1) - p.thickness],
      [e.at[0] + r, e.at[1] + r, e.at[2] + Math.max(p.z0, p.z1) + 0.05],
    ];
  }
  if (e.shape === 'cyl') {
    const r = Math.max(p.r0, p.r1);
    const pts: Vec3[] = [];
    for (const sx of [-r, r]) for (const sy of [-r, r]) for (const z of [0, p.h]) pts.push(rotate([sx, sy, z], e.rot));
    return spread(e.at, pts);
  }
  if (e.shape === 'dome') {
    return [
      [e.at[0] - e.size[0], e.at[1] - e.size[1], e.at[2]],
      [e.at[0] + e.size[0], e.at[1] + e.size[1], e.at[2] + e.size[2]],
    ];
  }
  if (e.shape === 'slab') {
    const pts: Vec3[] = [];
    for (let i = 0; p[`u${i}`] !== undefined; i++) for (const y of [-e.size[1] / 2, e.size[1] / 2]) pts.push(rotate([p[`u${i}`], y, p[`v${i}`]], e.rot));
    return spread(e.at, pts);
  }
  const corners: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(rotate([(sx * e.size[0]) / 2, (sy * e.size[1]) / 2, (sz * e.size[2]) / 2], e.rot));
  return spread(e.at, corners);
}

function spread(at: Vec3, pts: Vec3[]): [Vec3, Vec3] {
  const lo = [0, 1, 2].map((i) => at[i] + Math.min(...pts.map((c) => c[i]))) as Vec3;
  const hi = [0, 1, 2].map((i) => at[i] + Math.max(...pts.map((c) => c[i]))) as Vec3;
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
/** One of a list, from a random source. */
export const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];

type AddArgs = Omit<Element, 'order' | 'rand' | 'at' | 'size' | 'rot' | 'params' | 'on' | 'tags'> & Partial<Pick<Element, 'at' | 'size' | 'rot' | 'params' | 'on' | 'tags'>>;

/** Collects elements with running order numbers per stage and a seeded random number each. */
export class Builder {
  readonly out: Element[] = [];
  private counts = new Map<Stage, number>();
  /** Tags added to everything added while set (a moving part, a variant). */
  private extra: string[] = [];

  constructor(readonly seed: number) {}

  /** A random source for one element or decision: the same in every look, so shared elements stay identical. */
  rng(key: string): () => number {
    return rng(`${this.seed}:${key}`);
  }

  /** Run `fn` with `tags` added to every element it adds. */
  tagged<T>(tags: string[], fn: () => T): T {
    const before = this.extra;
    this.extra = [...before, ...tags];
    try {
      return fn();
    } finally {
      this.extra = before;
    }
  }

  add(e: AddArgs): Element {
    const n = (this.counts.get(e.stage) ?? 0) + 1;
    this.counts.set(e.stage, n);
    const full: Element = { at: [0, 0, 0], size: [0, 0, 0], rot: [0, 0, 0], params: {}, on: [], tags: [], ...e, order: n, rand: this.rng(e.id)() };
    if (this.extra.length) full.tags = [...full.tags, ...this.extra];
    if (full.shape === 'beam') Object.assign(full, beamTransform(full.a!, full.b!, full.size[1], full.size[2]));
    if (full.shape === 'log') Object.assign(full, beamTransform(full.a!, full.b!, full.params.r * 2, full.params.r * 2));
    this.out.push(full);
    return full;
  }

  beam(id: string, kind: string, a: Vec3, b: Vec3, wh: [number, number], stage: Stage, on: string[], material = 'oak', tags: string[] = []): Element {
    return this.add({ id, kind, material, stage, shape: 'beam', a, b, size: [0, wh[0], wh[1]], on, tags });
  }

  log(id: string, kind: string, a: Vec3, b: Vec3, r: number, stage: Stage, on: string[], material = 'logs', tags: string[] = []): Element {
    return this.add({ id, kind, material, stage, shape: 'log', a, b, params: { r }, on, tags });
  }

  box(id: string, kind: string, at: Vec3, size: Vec3, material: string, stage: Stage, on: string[], opts: { rot?: Vec3; shape?: Shape; tags?: string[]; params?: Record<string, number> } = {}): Element {
    return this.add({ id, kind, material, stage, shape: opts.shape ?? 'box', at, size, rot: opts.rot ?? [0, 0, 0], on, tags: opts.tags ?? [], params: opts.params ?? {} });
  }

  /** An upright frustum (a post's round, a drum, a cone with r1 = 0). */
  cyl(id: string, kind: string, at: Vec3, r0: number, r1: number, h: number, material: string, stage: Stage, on: string[], opts: { sides?: number; rot?: Vec3; tags?: string[] } = {}): Element {
    return this.add({ id, kind, material, stage, shape: 'cyl', at, rot: opts.rot ?? [0, 0, 0], params: { r0, r1, h, sides: opts.sides ?? 10 }, on, tags: opts.tags ?? [] });
  }

  /**
   * Add what `fn` builds, turned `yaw` radians about the upright through `pivot` (a dormer's roof,
   * built by the same rules as any roof and then swung round to run back into the main one).
   */
  turned(pivot: Vec3, yaw: number, fn: (sub: Builder) => void): void {
    const sub = new Builder(this.seed);
    fn(sub);
    const turn = (v: Vec3): Vec3 => {
      const r = rotate([v[0] - pivot[0], v[1] - pivot[1], v[2] - pivot[2]], [0, 0, yaw]);
      return [r[0] + pivot[0], r[1] + pivot[1], r[2] + pivot[2]];
    };
    for (const e of sub.out) {
      const { order: _o, rand: _r, ...rest } = e;
      if (e.shape === 'course') this.add({ ...rest, at: pivot, rot: [0, 0, yaw] });
      else if (e.shape === 'beam' || e.shape === 'log') this.add({ ...rest, a: turn(e.a!), b: turn(e.b!) });
      else this.add({ ...rest, at: turn(e.at), rot: [e.rot[0], e.rot[1], e.rot[2] + yaw] });
    }
  }

  /** A convex polygon in the x-z plane about `at` (points as [u, v] pairs), `thick` deep along y, turned by rot. */
  slab(id: string, kind: string, at: Vec3, pts: Array<[number, number]>, thick: number, material: string, stage: Stage, on: string[], opts: { rot?: Vec3; tags?: string[] } = {}): Element {
    const params: Record<string, number> = {};
    pts.forEach(([u, v], i) => ((params[`u${i}`] = u), (params[`v${i}`] = v)));
    return this.add({ id, kind, material, stage, shape: 'slab', at, size: [0, thick, 0], rot: opts.rot ?? [0, 0, 0], params, on, tags: opts.tags ?? [] });
  }
}

/** Index of a stage. */
export const stageIndex = (s: Stage) => STAGES.indexOf(s);

/** The stage an until:<stage> tag keeps an element to (scaffold: the roof), or null if it stays. */
export function untilOf(e: Element): Stage | null {
  for (const t of e.tags) {
    if (t === 'scaffold') return 'roof';
    if (t.startsWith('until:')) return t.slice(6) as Stage;
  }
  return null;
}

/** The moving part an element belongs to, or null. */
export function animOf(e: Element): string | null {
  const t = e.tags.find((x) => x.startsWith('anim:'));
  return t ? t.slice(5) : null;
}

export type Variant = 'default' | 'upgraded';

/** Whether an element belongs to a variant's look (both looks merged in one list: variant:/novariant: tags). */
export function inVariant(e: Element, variant: Variant): boolean {
  for (const t of e.tags) {
    if (t.startsWith('variant:') && t.slice(8) !== variant) return false;
    if (t.startsWith('novariant:') && t.slice(10) === variant) return false;
  }
  return true;
}

/** How far a building has got: a stage and 0..1 through it; undefined when it stands finished. */
export interface Progress {
  stage: Stage;
  t: number;
}

/** What a look shows: a variant, and while building, how far it has got; state parts it shows. */
export interface Look {
  variant: Variant;
  build?: Progress;
  parts?: readonly string[];
}

/** How many elements of each stage a look builds (temporary ones too): the last order number of each in a variant. */
export function stageCounts(elements: Element[], variant: Variant): Map<Stage, number> {
  const out = new Map<Stage, number>();
  for (const e of elements) if (inVariant(e, variant)) out.set(e.stage, Math.max(out.get(e.stage) ?? 0, e.order));
  return out;
}

/**
 * Whether an element is in the picture of a look. Building, everything of the stages done shows, and
 * of the stage under way the first ones in order, as far as it has got (temporary things, ordered
 * among them by their own order); the stakes, the open trench and the scaffolding only while building,
 * up to the stage they belong to.
 */
export function shows(e: Element, look: Look, rank?: (e: Element) => number, counts?: Map<Stage, number>): boolean {
  const variant = look.build ? 'default' : look.variant;
  if (!inVariant(e, variant)) return false;
  const part = e.tags.find((t) => t.startsWith('part:'));
  if (part && !(look.parts ?? []).includes(part.slice(5))) return false;
  const until = untilOf(e);
  if (!look.build) return !until;
  const s = stageIndex(look.build.stage);
  if (until && s > stageIndex(until)) return false;
  const own = stageIndex(e.stage);
  if (own < s) return true;
  if (own > s) return false;
  // of the stage under way, the first in order, as far as it has got
  const n = counts?.get(e.stage) ?? e.order;
  return (rank ? rank(e) : e.order) <= Math.floor(look.build.t * n + 1e-9);
}

/** Merge two looks' elements: shared ones once, the rest tagged by the look they belong to. */
export function mergeLooks(def: Element[], up: Element[]): Element[] {
  const same = (a: Element, b: Element) => JSON.stringify({ ...a, order: 0 }) === JSON.stringify({ ...b, order: 0 });
  const upById = new Map(up.map((e) => [e.id, e]));
  const defIds = new Set(def.map((e) => e.id));
  const out: Element[] = [];
  for (const e of def) {
    const u = upById.get(e.id);
    if (u && same(e, u)) {
      out.push(e);
      continue;
    }
    out.push({ ...e, tags: [...e.tags, 'novariant:upgraded'] });
    if (u) out.push({ ...u, id: `${e.id}@upgraded`, tags: [...u.tags, 'variant:upgraded'] });
  }
  for (const u of up) if (!defIds.has(u.id)) out.push({ ...u, tags: [...u.tags, 'variant:upgraded'] });
  return out;
}
