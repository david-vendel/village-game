// Construction elements → triangles, merged into one buffer per material: a
// building of a few thousand pieces draws in about a dozen calls. Each piece's
// colour variation (and some per-face shading, like a log's lighter end grain
// or one shingle a little darker than the next) rides in the vertex colours.
//
// Model space is the generator's (metres, +Z up, front towards −Y); the
// buffers come out in three.js axes (+Y up, front towards +Z): (x, y, z) → (x, z, −y).
// No three.js here: plain typed arrays, so tests and tools can use it too.

import { type Element, rng, rotate, ROOF_STYLES, type Vec3 } from './elements';

/** A growing triangle soup: positions and normals (three.js axes) and colours per vertex. */
export class Soup {
  pos: Float32Array;
  nor: Float32Array;
  col: Float32Array;
  n = 0;
  /** Colour of what is added next. */
  tint: Vec3 = [1, 1, 1];

  constructor(capacity = 4096) {
    this.pos = new Float32Array(capacity * 3);
    this.nor = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
  }

  private grow(): void {
    const cap = this.pos.length * 2;
    for (const k of ['pos', 'nor', 'col'] as const) {
      const a = new Float32Array(cap);
      a.set(this[k]);
      this[k] = a;
    }
  }

  /** One vertex: model-space point and normal. */
  vert(p: Vec3, n: Vec3, c: Vec3 = this.tint): void {
    if ((this.n + 1) * 3 > this.pos.length) this.grow();
    const i = this.n * 3;
    // model (x, y, z) → three.js (x, z, −y)
    this.pos[i] = p[0];
    this.pos[i + 1] = p[2];
    this.pos[i + 2] = -p[1];
    this.nor[i] = n[0];
    this.nor[i + 1] = n[2];
    this.nor[i + 2] = -n[1];
    this.col[i] = c[0];
    this.col[i + 1] = c[1];
    this.col[i + 2] = c[2];
    this.n++;
  }

  /** A flat triangle, wound so its normal points along `out` (any vector on the outer side). */
  tri(a: Vec3, b: Vec3, c: Vec3, out?: Vec3, col?: Vec3): void {
    let n = cross(sub(b, a), sub(c, a));
    if (out && dot(n, out) < 0) {
      [b, c] = [c, b];
      n = [-n[0], -n[1], -n[2]];
    }
    const nn = norm(n);
    this.vert(a, nn, col);
    this.vert(b, nn, col);
    this.vert(c, nn, col);
  }

  /** A flat quad a-b-c-d (in order round it), facing `out`. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, out?: Vec3, col?: Vec3): void {
    this.tri(a, b, c, out, col);
    this.tri(a, c, d, out, col);
  }

  /** A triangle with its own vertex normals (smooth shading), in the given winding. */
  smooth(a: Vec3, b: Vec3, c: Vec3, na: Vec3, nb: Vec3, nc: Vec3, col?: Vec3): void {
    this.vert(a, na, col);
    this.vert(b, nb, col);
    this.vert(c, nc, col);
  }
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mulc = (a: Vec3, k: Vec3): Vec3 => [a[0] * k[0], a[1] * k[1], a[2] * k[2]];

/** A piece's local → model transform. */
const place = (e: Element) => (v: Vec3): Vec3 => add(e.at, rotate(v, e.rot));

// --- shapes -----------------------------------------------------------------------

/** A convex solid from its corners in local space: faces as corner-index lists, wound either way. */
function convex(s: Soup, pts: Vec3[], faces: number[][], centre: Vec3): void {
  for (const f of faces) {
    const mid = scale(f.reduce((acc, i) => add(acc, pts[i]), [0, 0, 0] as Vec3), 1 / f.length);
    const out = sub(mid, centre);
    for (let k = 1; k + 1 < f.length; k++) s.tri(pts[f[0]], pts[f[k]], pts[f[k + 1]], out);
  }
}

const BOX_FACES = [
  [0, 2, 6, 4],
  [1, 3, 7, 5],
  [0, 1, 5, 4],
  [2, 3, 7, 6],
  [0, 1, 3, 2],
  [4, 5, 7, 6],
];

/** The 8 corners of a box of `size` (local, about its centre), indexed by bits x, y, z. */
function boxCorners(size: Vec3, jitter?: (i: number) => Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    const c: Vec3 = [((i & 1 ? 1 : -1) * size[0]) / 2, ((i & 2 ? 1 : -1) * size[1]) / 2, ((i & 4 ? 1 : -1) * size[2]) / 2];
    out.push(jitter ? add(c, jitter(i)) : c);
  }
  return out;
}

function box(s: Soup, e: Element): void {
  const T = place(e);
  convex(s, boxCorners(e.size).map(T), BOX_FACES, e.at);
}

/**
 * A stone: a block with its corners knocked about and each face swelling a little in the middle
 * (fieldstone, rubble), or a squared ashlar block with just a hint of that (`params.dressed`).
 */
function stone(s: Soup, e: Element): void {
  const r = rng(e.id);
  const dressed = !!e.params.dressed;
  const j = dressed ? 0.012 : 0.07;
  const sz = e.size;
  const corners = boxCorners(sz, () => [(r() * 2 - 1) * j * sz[0], (r() * 2 - 1) * j * sz[1], (r() * 2 - 1) * j * sz[2]]);
  // rounder: pull the corners in towards the middle a little
  const round = dressed ? 0.04 : 0.16;
  for (const c of corners) for (let k = 0; k < 3; k++) c[k] *= 1 - round * (0.6 + 0.4 * r());
  const T = place(e);
  const pts = corners.map(T);
  const swell = dressed ? 0.012 : 0.05;
  for (const f of BOX_FACES) {
    const mid = scale(f.reduce((acc, i) => add(acc, corners[i]), [0, 0, 0] as Vec3), 0.25);
    // swell along the face's outward direction, by the box's smallest side
    const out = norm(mid);
    const bulge = add(mid, scale(out, swell * Math.min(sz[0], sz[1], sz[2]) * (0.6 + 0.8 * r())));
    const c = T(bulge);
    const outM = sub(c, e.at);
    for (let k = 0; k < 4; k++) s.tri(pts[f[k]], pts[f[(k + 1) % 4]], c, outM);
  }
}

/** A round timber along local x: `sides` facets with smooth normals, lighter end grain. */
function log(s: Soup, e: Element): void {
  const T = place(e);
  const R = (v: Vec3) => rotate(v, e.rot);
  const r = e.params.r;
  const L = e.size[0] / 2;
  const sides = e.params.sides ?? 8;
  const rr = rng(e.id);
  const wob = Array.from({ length: sides }, () => 1 + (rr() - 0.5) * 0.12);
  const ring = (x: number) => Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [x, Math.cos(a) * r * wob[i], Math.sin(a) * r * wob[i]] as Vec3;
  });
  const [a0, a1] = [ring(-L), ring(L)];
  for (let i = 0; i < sides; i++) {
    const k = (i + 1) % sides;
    const n0 = R(norm([0, a0[i][1], a0[i][2]]));
    const n1 = R(norm([0, a0[k][1], a0[k][2]]));
    s.smooth(T(a0[i]), T(a1[i]), T(a1[k]), n0, n0, n1);
    s.smooth(T(a0[i]), T(a1[k]), T(a0[k]), n0, n1, n1);
  }
  const grain = mulc(s.tint, [1.9, 1.75, 1.5]);
  for (const [ring_, x] of [
    [a0, -L],
    [a1, L],
  ] as const) {
    const c = T([x, 0, 0]);
    const out = R([x, 0, 0]);
    for (let i = 0; i < sides; i++) s.tri(c, T(ring_[i]), T(ring_[(i + 1) % sides]), out, grain);
  }
}

/** An upright frustum: smooth sides, flat caps (none on top if it comes to a point). */
function cyl(s: Soup, e: Element): void {
  const T = place(e);
  const R = (v: Vec3) => rotate(v, e.rot);
  const { r0, r1, h } = e.params;
  const sides = e.params.sides ?? 10;
  const off = e.params.turn ?? 0;
  const slope = (r0 - r1) / h;
  const at = (r: number, z: number, i: number): Vec3 => {
    const a = off + (i / sides) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r, z];
  };
  const nAt = (i: number): Vec3 => {
    const a = off + (i / sides) * Math.PI * 2;
    return R(norm([Math.cos(a), Math.sin(a), slope]));
  };
  const flat = sides <= 6; // a squared post or a four-sided spire: crisp edges
  for (let i = 0; i < sides; i++) {
    const k = i + 1;
    const [p0, p1, q0, q1] = [T(at(r0, 0, i)), T(at(r0, 0, k)), T(at(r1, h, i)), T(at(r1, h, k))];
    if (flat) {
      const out = R(at(1, slope, i + 0.5));
      if (r1 > 1e-6) s.quad(p0, p1, q1, q0, out);
      else s.tri(p0, p1, q0, out);
    } else {
      s.smooth(p0, p1, q1, nAt(i), nAt(k), nAt(k));
      if (r1 > 1e-6) s.smooth(p0, q1, q0, nAt(i), nAt(k), nAt(i));
    }
  }
  const bottom = T([0, 0, 0]);
  const top = T([0, 0, h]);
  for (let i = 0; i < sides; i++) {
    s.tri(bottom, T(at(r0, 0, i)), T(at(r0, 0, i + 1)), R([0, 0, -1]));
    if (r1 > 1e-6) s.tri(top, T(at(r1, h, i)), T(at(r1, h, i + 1)), R([0, 0, 1]));
  }
}

/** Half an ellipsoid on its base (an oven's dome; with params.rough, a heap of earth or sand). */
function dome(s: Soup, e: Element): void {
  const [rx, ry, rz] = e.size;
  const rough = e.params.rough ?? 0;
  const rings = 6;
  const segs = 14;
  const r = rng(e.id);
  const bump = Array.from({ length: (rings + 1) * segs }, () => 1 + (r() - 0.5) * rough);
  const p = (i: number, j: number): Vec3 => {
    const th = (i / rings) * (Math.PI / 2);
    const ph = (j / segs) * Math.PI * 2;
    const k = i === rings ? 1 : bump[i * segs + (j % segs)];
    return [e.at[0] + Math.cos(th) * Math.cos(ph) * rx * k, e.at[1] + Math.cos(th) * Math.sin(ph) * ry * k, e.at[2] + Math.sin(th) * rz * (i === 0 ? 0 : k)];
  };
  const n = (q: Vec3): Vec3 => norm([(q[0] - e.at[0]) / (rx * rx), (q[1] - e.at[1]) / (ry * ry), (q[2] - e.at[2]) / (rz * rz)]);
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const [a, b, c, d] = [p(i, j), p(i, j + 1), p(i + 1, j + 1), p(i + 1, j)];
      if (rough) {
        s.tri(a, b, c, sub(a, e.at));
        s.tri(a, c, d, sub(a, e.at));
      } else {
        s.smooth(a, b, c, n(a), n(b), n(c));
        s.smooth(a, c, d, n(a), n(c), n(d));
      }
    }
  }
}

/** A convex polygon (params u_i, v_i: x and z) extruded along y, turned and placed. */
function slab(s: Soup, e: Element): void {
  const p = e.params;
  const uv: Array<[number, number]> = [];
  for (let i = 0; p[`u${i}`] !== undefined; i++) uv.push([p[`u${i}`], p[`v${i}`]]);
  const t = e.size[1] / 2;
  const T = place(e);
  const front = uv.map(([u, v]) => T([u, -t, v]));
  const back = uv.map(([u, v]) => T([u, t, v]));
  const cu = uv.reduce((a, [u]) => a + u, 0) / uv.length;
  const cv = uv.reduce((a, [, v]) => a + v, 0) / uv.length;
  const centre = T([cu, 0, cv]);
  const n = uv.length;
  for (let k = 1; k + 1 < n; k++) {
    s.tri(front[0], front[k], front[k + 1], sub(front[0], back[0]));
    s.tri(back[0], back[k], back[k + 1], sub(back[0], front[0]));
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const mid = scale(add(front[i], front[j]), 0.5);
    s.quad(front[i], front[j], back[j], back[i], sub(mid, centre));
  }
}

/** Smooth value noise in 3D (thatch lumps, earth heaps). */
function noise3(x: number, y: number, z: number): number {
  const h = (i: number, j: number, k: number) => {
    const v = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const [xi, yi, zi] = [Math.floor(x), Math.floor(y), Math.floor(z)];
  const f = (t: number) => t * t * (3 - 2 * t);
  const [u, v, w] = [f(x - xi), f(y - yi), f(z - zi)];
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(
    lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u), lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    lerp(lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

/**
 * A course of roof covering: a band along x from its lower edge up the slope to its upper edge,
 * `thickness` deep under the outer surface. Thatch is thick and gently lumpy with a rounded lip;
 * tiles are pantiles, waved across; shingles, slates and boards are laid side by side, each a little
 * different, their butts standing proud of the course below.
 */
function course(s: Soup, e: Element): void {
  const p = e.params;
  const style = ROOF_STYLES[p.style ?? 0];
  const lo: [number, number] = [p.yl, p.zl];
  const hi: [number, number] = [p.yu, p.zu];
  const up = norm([0, hi[0] - lo[0], hi[1] - lo[1]]);
  // the outer normal: perpendicular to the slope, pointing up
  let out: Vec3 = [0, -up[2], up[1]];
  if (out[2] < 0) out = [0, -out[1], -out[2]];
  const t = p.thickness;
  // a smooth triangle wound to face the way its normal does (the back slope runs the other way
  // round, and a turned course, a dormer's, shows it)
  const sm = (a: Vec3, b: Vec3, c: Vec3, na: Vec3, nb: Vec3, nc: Vec3) => (dot(cross(sub(b, a), sub(c, a)), na) < 0 ? s.smooth(a, c, b, na, nc, nb) : s.smooth(a, b, c, na, nb, nc));
  const r = rng(e.id);
  const base = s.tint;
  const at = (x: number, w: number, d: number, lift = 0): Vec3 => {
    // w: 0 at the lower edge, 1 at the upper; d: depth below the outer surface; lift: along the normal
    const y = lo[0] + (hi[0] - lo[0]) * w;
    const z = lo[1] + (hi[1] - lo[1]) * w;
    return [x, y - out[1] * (d - lift), z - out[2] * (d - lift)];
  };
  const down: Vec3 = [-out[0], -out[1], -out[2]];
  const ends = (x: number, side: -1 | 1, wave = (_w: number) => 0) => {
    const steps = 3;
    for (let k = 0; k < steps; k++) {
      const w0 = k / steps;
      const w1 = (k + 1) / steps;
      s.quad(at(x, w0, 0, wave(w0)), at(x, w1, 0, wave(w1)), at(x, w1, t), at(x, w0, t), [side, 0, 0]);
    }
  };

  if (style === 'thatch') {
    const segs = Math.max(2, Math.round((p.x1 - p.x0) / 0.22));
    const rows = 4;
    const lip = p.lip ?? 0;
    // the outer surface on a grid, gently lumpy; normals from the neighbouring grid points
    const xs = Array.from({ length: segs + 1 }, (_, i) => p.x0 + ((p.x1 - p.x0) * i) / segs);
    const grid: Vec3[][] = xs.map((x) => Array.from({ length: rows + 1 }, (_, j) => at(x, j / rows, 0, (noise3(x * 1.7, (j / rows) * 2.3 + p.zl, p.zl * 3.1) - 0.5) * 0.07)));
    const nGrid: Vec3[][] = grid.map((col, i) =>
      col.map((_, j) => {
        const a = grid[Math.max(0, i - 1)][j];
        const c = grid[Math.min(segs, i + 1)][j];
        const d = grid[i][Math.max(0, j - 1)];
        const e2 = grid[i][Math.min(rows, j + 1)];
        let n = norm(cross(sub(c, a), sub(e2, d)));
        if (dot(n, out) < 0) n = scale(n, -1);
        return n;
      }),
    );
    for (let i = 0; i < segs; i++) {
      const x0 = xs[i];
      const x1 = xs[i + 1];
      // straws catch the light differently course to course, bundle to bundle
      const k = 0.93 + 0.14 * noise3(x0 * 2.1, p.zl * 5, 1.3);
      s.tint = scale(base, k);
      for (let j = 0; j < rows; j++) {
        const [a, b2, c, d] = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]];
        sm(a, b2, c, nGrid[i][j], nGrid[i + 1][j], nGrid[i + 1][j + 1]);
        sm(a, c, d, nGrid[i][j], nGrid[i + 1][j + 1], nGrid[i][j + 1]);
      }
      // the butt end: the cut straw ends, darker, rolling under to the underside
      const butt = scale(base, 0.72 * k);
      const l0 = grid[i][0];
      const l1 = grid[i + 1][0];
      const m0 = add(at(x0, 0, t * 0.55), scale(down, lip * 0.2));
      const m1 = add(at(x1, 0, t * 0.55), scale(down, lip * 0.2));
      const b0 = at(x0, 0.08, t);
      const b1 = at(x1, 0.08, t);
      const dn = add(scale(up, -1), scale(down, 0.4));
      s.quad(l0, l1, m1, m0, dn, butt);
      s.quad(m0, m1, b1, b0, dn, butt);
      // underside
      s.quad(b0, b1, at(x1, 1, t), at(x0, 1, t), down, scale(base, 0.5));
    }
    s.tint = base;
    ends(p.x0, -1);
    ends(p.x1, 1);
    return;
  }

  if (style === 'tile') {
    // pantiles: an S-wave across, each tile a little different in colour
    const tw = 0.21;
    const n = Math.max(2, Math.round((p.x1 - p.x0) / tw));
    const w = (p.x1 - p.x0) / n;
    const amp = 0.035;
    const wave = (x: number) => amp * Math.sin(((x - p.x0) / w) * Math.PI * 2);
    const sub_ = 4;
    for (let i = 0; i < n; i++) {
      const k = 0.86 + 0.28 * r();
      s.tint = scale(base, k);
      for (let q = 0; q < sub_; q++) {
        const x0 = p.x0 + w * (i + q / sub_);
        const x1 = p.x0 + w * (i + (q + 1) / sub_);
        const [a, b, c, d] = [at(x0, 0, 0, wave(x0)), at(x1, 0, 0, wave(x1)), at(x1, 1, 0, wave(x1) * 0.6), at(x0, 1, 0, wave(x0) * 0.6)];
        const sl = Math.cos(((x0 + x1) / 2 - p.x0) / w * Math.PI * 2) * amp * ((Math.PI * 2) / w);
        // the wave's slope tilts the normal across
        const nn = norm(add(out, [-sl, 0, 0]));
        sm(a, b, c, nn, nn, nn);
        sm(a, c, d, nn, nn, nn);
        // the tile's lower edge, seen from below the eaves
        s.quad(a, b, at(x1, 0, t), at(x0, 0, t), scale(up, -1), scale(base, k * 0.6));
      }
    }
    s.tint = base;
    s.quad(at(p.x0, 0, t), at(p.x1, 0, t), at(p.x1, 1, t), at(p.x0, 1, t), down, scale(base, 0.5));
    ends(p.x0, -1);
    ends(p.x1, 1);
    return;
  }

  // shingles, slates, boards: pieces side by side, butts proud, each its own tone
  const pw = style === 'slate' ? [0.2, 0.32] : style === 'boards' ? [0.22, 0.3] : [0.1, 0.19];
  const gap = style === 'boards' ? 0.012 : 0.006;
  const vary = style === 'slate' ? 0.22 : 0.3;
  for (let x = p.x0; x < p.x1 - 1e-6; ) {
    const wpc = Math.min(p.x1 - x, pw[0] + (pw[1] - pw[0]) * r());
    const x0 = x + (x > p.x0 ? gap / 2 : 0);
    const x1 = x + wpc - (x + wpc < p.x1 - 1e-6 ? gap / 2 : 0);
    const k = 1 - vary / 2 + vary * r();
    const kick = (r() - 0.5) * 0.012; // not quite flat
    s.tint = scale(base, k);
    const [a, b, c, d] = [at(x0, 0, 0, 0.012 + kick), at(x1, 0, 0, 0.012 - kick), at(x1, 1, 0), at(x0, 1, 0)];
    s.quad(a, b, c, d, out);
    // the butt
    s.quad(a, b, at(x1, 0, t), at(x0, 0, t), scale(up, -1), scale(base, k * 0.55));
    // the sides of each piece, so the gaps read
    s.quad(a, d, at(x0, 1, t), at(x0, 0, t), [-1, 0, 0], scale(base, k * 0.7));
    s.quad(b, c, at(x1, 1, t), at(x1, 0, t), [1, 0, 0], scale(base, k * 0.7));
    x += wpc;
  }
  s.tint = base;
  s.quad(at(p.x0, 0, t), at(p.x1, 0, t), at(p.x1, 1, t), at(p.x0, 1, t), down, scale(base, 0.5));
}

/**
 * A band of covering round a vertical axis (a mill's cap, a spire, with 4 sides a hipped roof):
 * from radius r0 at height z0 up to r1 at z1, `thickness` deep, scaled by params sx, sy.
 */
function cone(s: Soup, e: Element): void {
  const p = e.params;
  const sides = p.sides ?? 12;
  const style = ROOF_STYLES[p.style ?? 0];
  const sx = p.sx ?? 1;
  const sy = p.sy ?? 1;
  const off = p.turn ?? (sides === 4 ? Math.PI / 4 : 0);
  const r = rng(e.id);
  const base = s.tint;
  const pt = (rad: number, z: number, a: number): Vec3 => [e.at[0] + Math.cos(a) * rad * sx, e.at[1] + Math.sin(a) * rad * sy, e.at[2] + z];
  const t = p.thickness;
  const slope = Math.atan2(p.r0 - p.r1, p.z1 - p.z0);
  const pieces = style === 'thatch' ? 1 : style === 'slate' ? 5 : 7;
  for (let i = 0; i < sides; i++) {
    const a0 = off + (i / sides) * Math.PI * 2;
    const a1 = off + ((i + 1) / sides) * Math.PI * 2;
    for (let q = 0; q < pieces; q++) {
      const b0 = a0 + ((a1 - a0) * q) / pieces;
      const b1 = a0 + ((a1 - a0) * (q + 1)) / pieces;
      const k = style === 'thatch' ? 0.95 + 0.1 * noise3(i * 1.3, p.z0 * 4, 0.5) : 0.85 + 0.3 * r();
      s.tint = scale(base, k);
      // along the face's straight edge between its corners (a pyramid's faces are flat)
      const f0 = q / pieces;
      const f1 = (q + 1) / pieces;
      const edge = (rad: number, z: number, f: number): Vec3 => {
        if (sides >= 10) return pt(rad, z, a0 + (a1 - a0) * f);
        const c0 = pt(rad, z, a0);
        const c1 = pt(rad, z, a1);
        return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, z + e.at[2]];
      };
      const [lo0, lo1, hi1, hi0] = [edge(p.r0, p.z0, f0), edge(p.r0, p.z0, f1), edge(p.r1, p.z1, f1), edge(p.r1, p.z1, f0)];
      const mid = (b0 + b1) / 2;
      const outward: Vec3 = [Math.cos(mid) * sy * Math.cos(slope), Math.sin(mid) * sx * Math.cos(slope), Math.sin(slope)];
      if (sides >= 10) {
        const n0: Vec3 = norm([Math.cos(b0) * Math.cos(slope), Math.sin(b0) * Math.cos(slope), Math.sin(slope)]);
        const n1: Vec3 = norm([Math.cos(b1) * Math.cos(slope), Math.sin(b1) * Math.cos(slope), Math.sin(slope)]);
        s.smooth(lo0, lo1, hi1, n0, n1, n1);
        if (p.r1 > 1e-6) s.smooth(lo0, hi1, hi0, n0, n1, n0);
      } else if (p.r1 > 1e-6) s.quad(lo0, lo1, hi1, hi0, outward);
      else s.tri(lo0, lo1, hi1, outward);
      // the lower edge's thickness
      const [u0, u1] = [edge(p.r0 - t * 0.6, p.z0 - t, f0), edge(p.r0 - t * 0.6, p.z0 - t, f1)];
      s.quad(lo0, lo1, u1, u0, [Math.cos(mid), Math.sin(mid), -1], scale(base, k * 0.6));
    }
  }
  s.tint = base;
}

/** A shape lying flat on the ground: the top of its box, its corners rounded off if params.round. */
function patch(s: Soup, e: Element): void {
  const T = place(e);
  const [hx, hy] = [e.size[0] / 2, e.size[1] / 2];
  const z = e.size[2] / 2;
  if (!e.params.round) {
    s.quad(T([-hx, -hy, z]), T([hx, -hy, z]), T([hx, hy, z]), T([-hx, hy, z]), [0, 0, 1]);
    return;
  }
  const r = rng(e.id);
  const n = 16;
  const c = T([0, 0, z]);
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = 0.85 + 0.25 * r();
    return T([Math.cos(a) * hx * k, Math.sin(a) * hy * k, z]);
  });
  for (let i = 0; i < n; i++) s.tri(c, pts[i], pts[(i + 1) % n], [0, 0, 1]);
}

/** Turn the vertices a soup got since vertex n0 about `at` (model space) by XYZ euler angles. */
function turnSince(s: Soup, n0: number, at: Vec3, rot: Vec3): void {
  for (let i = n0; i < s.n; i++) {
    const k = i * 3;
    // three.js (x, y, z) is model (x, −z, y)
    const p = rotate([s.pos[k] - at[0], -s.pos[k + 2] - at[1], s.pos[k + 1] - at[2]], rot);
    const n = rotate([s.nor[k], -s.nor[k + 2], s.nor[k + 1]], rot);
    s.pos[k] = p[0] + at[0];
    s.pos[k + 1] = p[2] + at[2];
    s.pos[k + 2] = -(p[1] + at[1]);
    s.nor[k] = n[0];
    s.nor[k + 1] = n[2];
    s.nor[k + 2] = -n[1];
  }
}

/** How much a material's pieces vary in tone from one to the next. */
const TONE: Record<string, number> = { fieldstone: 0.5, rubble: 0.45, ashlar: 0.22, daub: 0.1, plaster: 0.08, thatch: 0.18, oak: 0.3, logs: 0.3, earth: 0.25 };

/** The colour a piece is tinted: lighter or darker, a touch warmer or cooler, by its random number. */
export function tintOf(e: Element): Vec3 {
  const v = TONE[e.material] ?? 0.24;
  const k = 1 - v / 2 + v * e.rand;
  const warm = (e.rand - 0.5) * 0.06;
  return [k * (1 + warm), k, k * (1 - warm)];
}

/** Add one element's triangles to a soup, tinted. */
export function addElement(s: Soup, e: Element): void {
  s.tint = tintOf(e);
  switch (e.shape) {
    case 'stone':
      return stone(s, e);
    case 'log':
      return log(s, e);
    case 'cyl':
      return cyl(s, e);
    case 'dome':
      return dome(s, e);
    case 'slab':
      return slab(s, e);
    case 'course': {
      if (!e.rot.some(Boolean)) return course(s, e);
      // a turned course: laid as if along x, then every vertex turned about `at`
      const n0 = s.n;
      course(s, e);
      return turnSince(s, n0, e.at, e.rot);
    }
    case 'cone':
      return cone(s, e);
    case 'patch':
      return patch(s, e);
    default:
      return box(s, e);
  }
}

/** Merged buffers for one material: positions, normals, colours, and where each element's vertices start. */
export interface Merged {
  pos: Float32Array;
  nor: Float32Array;
  col: Float32Array;
  /** Vertex count after each element of the list it was made from (in that list's order): drawRange ends. */
  ends: Int32Array;
  /** Index into that list of each element merged here. */
  index: Int32Array;
}

/**
 * Merge elements (in the order given) into one set of buffers per material. `ends[k]` is the number of
 * vertices of the first k + 1 of this material's elements, so showing the first n of a build order
 * is a draw range.
 */
export function mergeByMaterial(elements: Element[]): Map<string, Merged> {
  const soups = new Map<string, { s: Soup; ends: number[]; index: number[] }>();
  elements.forEach((e, i) => {
    let m = soups.get(e.material);
    if (!m) soups.set(e.material, (m = { s: new Soup(), ends: [], index: [] }));
    addElement(m.s, e);
    m.ends.push(m.s.n);
    m.index.push(i);
  });
  const out = new Map<string, Merged>();
  for (const [name, { s, ends, index }] of soups) {
    out.set(name, { pos: s.pos.slice(0, s.n * 3), nor: s.nor.slice(0, s.n * 3), col: s.col.slice(0, s.n * 3), ends: Int32Array.from(ends), index: Int32Array.from(index) });
  }
  return out;
}

/** One element's triangles alone (tests). */
export function elementSoup(e: Element): Soup {
  const s = new Soup(256);
  addElement(s, e);
  return s;
}
