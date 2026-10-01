// Construction elements → three.js meshes, merged into one mesh per material
// for a look (finished, Large, a construction stage, with its state parts):
// a farm of ~500 pieces draws in about ten calls. Each piece's colour
// variation rides in the vertex colours.
//
// Model space is the generator's (metres, +Z up, front towards −Y); the
// meshes come out in three.js axes (+Y up, front towards +Z): (x, y, z) → (x, z, −y).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type Element, rng, rotate, shows, type Stage, type Vec3 } from './elements';

/** Model space → three.js axes. */
const axes = (v: Vec3): Vec3 => [v[0], v[2], -v[1]];

interface Soup {
  pos: number[];
  nor: number[];
  /** A point inside the (convex) piece: every triangle is turned to face away from it. */
  centre: Vec3;
}

/** A triangle (model space) facing away from the piece's centre, with its flat normal. */
function tri(s: Soup, a: Vec3, b: Vec3, c: Vec3): void {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const out = (a[0] - s.centre[0]) * n[0] + (a[1] - s.centre[1]) * n[1] + (a[2] - s.centre[2]) * n[2];
  if (out < 0) {
    [b, c] = [c, b];
    n = [-n[0], -n[1], -n[2]];
  }
  const l = Math.hypot(...n) || 1;
  for (const p of [a, b, c]) {
    s.pos.push(...axes(p));
    s.nor.push(...axes([n[0] / l, n[1] / l, n[2] / l]));
  }
}

const quad = (s: Soup, a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
  tri(s, a, b, c);
  tri(s, a, c, d);
};

/** The 8 corners of a box (local ±size/2, turned and placed), indexed by bits x, y, z. */
function corners(e: Element): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    const local: Vec3 = [((i & 1 ? 1 : -1) * e.size[0]) / 2, ((i & 2 ? 1 : -1) * e.size[1]) / 2, ((i & 4 ? 1 : -1) * e.size[2]) / 2];
    const r = rotate(local, e.rot);
    out.push([e.at[0] + r[0], e.at[1] + r[1], e.at[2] + r[2]]);
  }
  return out;
}

function box(s: Soup, e: Element): void {
  const c = corners(e);
  s.centre = e.at;
  quad(s, c[0], c[2], c[6], c[4]); // −x
  quad(s, c[1], c[5], c[7], c[3]); // +x
  quad(s, c[0], c[4], c[5], c[1]); // −y
  quad(s, c[2], c[3], c[7], c[6]); // +y
  quad(s, c[0], c[1], c[3], c[2]); // −z
  quad(s, c[4], c[6], c[7], c[5]); // +z
}

/** A rough fieldstone: a rounded, jittered box with smooth normals. */
function stone(e: Element): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, 3, 3, 3);
  const r = rng(e.id);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const jitter = new Map<string, Vec3>(); // the same jitter for a corner shared by faces, so the stone stays closed
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!jitter.has(key)) jitter.set(key, [(r() * 2 - 1) * 0.06, (r() * 2 - 1) * 0.06, (r() * 2 - 1) * 0.06]);
    const j = jitter.get(key)!;
    v.lerp(v.clone().normalize().multiplyScalar(0.62), 0.35);
    const local: Vec3 = [(v.x + j[0]) * e.size[0], (v.y + j[1]) * e.size[1], (v.z + j[2]) * e.size[2]];
    const w = rotate(local, e.rot);
    p.setXYZ(i, ...axes([e.at[0] + w[0], e.at[1] + w[1], e.at[2] + w[2]]));
  }
  g.deleteAttribute('uv');
  const merged = mergeVertices(g);
  merged.computeVertexNormals();
  return merged.toNonIndexed();
}

/** Weld coincident vertices so smooth normals work across a box geometry's faces. */
function mergeVertices(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  const index = g.index!;
  const map = new Map<string, number>();
  const pos: number[] = [];
  const remap: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)}`;
    let k = map.get(key);
    if (k === undefined) {
      k = pos.length / 3;
      map.set(key, k);
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
    }
    remap.push(k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(Array.from(index.array, (i) => remap[i]));
  return out;
}

/** Smooth value noise in 3D (for the thatch's lumps). */
function noise3(x: number, y: number, z: number): number {
  const h = (i: number, j: number, k: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
    return s - Math.floor(s);
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

/** The thatch shell: a thick gable profile run along x, dense, with gentle lumps. */
function roof(e: Element): THREE.BufferGeometry {
  const p = e.params;
  const pitch = (p.pitchDeg * Math.PI) / 180;
  const drop = p.thickness / Math.cos(pitch);
  const tan = Math.tan(pitch);
  const steps = 14;
  const slope = (y0: number, z0: number, y1: number, z1: number) => Array.from({ length: steps }, (_, k) => [y0 + ((y1 - y0) * k) / steps, z0 + ((z1 - z0) * k) / steps]);
  const round = 0.18; // the ridge rounded over this far down each slope
  const shoulder = p.ridgeZ - round * tan;
  const outer = [
    ...slope(p.yFront, p.eaveZ, p.ridgeY - round, shoulder),
    [p.ridgeY - round, p.ridgeZ - round * tan * 0.55],
    [p.ridgeY, p.ridgeZ],
    [p.ridgeY + round, p.ridgeZ - round * tan * 0.55],
    ...slope(p.ridgeY + round, shoulder, p.yBack, p.eaveZ).slice(1),
    [p.yBack, p.eaveZ],
  ];
  const under = [...slope(p.yBack + 0.05, p.eaveZ - drop, p.ridgeY, p.ridgeZ - drop), ...slope(p.ridgeY, p.ridgeZ - drop, p.yFront - 0.05, p.eaveZ - drop), [p.yFront - 0.05, p.eaveZ - drop]];
  const profile = [...outer, ...under];
  const n = profile.length;
  const segs = 40;
  const pos: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const x = p.x0 + ((p.x1 - p.x0) * i) / segs;
    for (const [y, z] of profile) pos.push(...axes([x, y, z]));
  }
  const idx: number[] = [];
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < n; k++) {
      const a = i * n + k;
      const b = i * n + ((k + 1) % n);
      // the profile runs eave → ridge → eave (y up the slope, over and down): this order faces out
      idx.push(a, a + n, b, b, a + n, b + n);
    }
  }
  // the gable ends: fans from the ridge (the profile is star-shaped about a point under the ridge)
  const capCentre = (x: number) => axes([x, p.ridgeY, (p.eaveZ + p.ridgeZ) / 2 - drop / 2]);
  const c0 = pos.length / 3;
  pos.push(...capCentre(p.x0));
  const c1 = c0 + 1;
  pos.push(...capCentre(p.x1));
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    idx.push(c0, k2, k);
    idx.push(c1, segs * n + k, segs * n + k2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // lumps: push the surface in and out along its normal
  const P = g.attributes.position as THREE.BufferAttribute;
  const N = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < P.count; i++) {
    const d = (noise3(P.getX(i) * 0.7, P.getY(i) * 0.7, P.getZ(i) * 0.7) - 0.5) * 0.14;
    P.setXYZ(i, P.getX(i) + N.getX(i) * d, P.getY(i) + N.getY(i) * d, P.getZ(i) + N.getZ(i) * d);
  }
  g.computeVertexNormals();
  return g.toNonIndexed();
}

function gable(s: Soup, e: Element): void {
  const p = e.params;
  const [x0, x1] = [p.x - p.thickness / 2, p.x + p.thickness / 2];
  const ym = (p.y0 + p.y1) / 2;
  const t = (x: number): Vec3[] => [
    [x, p.y0 + 0.3, p.z0],
    [x, p.y1 - 0.3, p.z0],
    [x, ym, p.zRidge],
  ];
  const [a, b] = [t(x0), t(x1)];
  s.centre = [p.x, ym, (2 * p.z0 + p.zRidge) / 3];
  tri(s, a[0], a[2], a[1]); // −x face
  tri(s, b[0], b[1], b[2]); // +x face
  quad(s, a[0], a[1], b[1], b[0]); // bottom
  quad(s, a[1], a[2], b[2], b[1]);
  quad(s, a[2], a[0], b[0], b[2]);
}

/** The barn's mono-pitch roof slab, as a box from the house down to the outer wall. */
function leanto(s: Soup, e: Element): void {
  const p = e.params;
  const yc = (p.y0 + p.y1) / 2;
  const d: Vec3 = [p.x1 - p.x0, 0, p.z1 - p.z0];
  const pitch = Math.atan2(d[2], d[0]);
  box(s, { ...e, at: [(p.x0 + p.x1) / 2, yc, (p.z0 + p.z1) / 2], size: [Math.hypot(d[0], d[2]), p.y1 - p.y0, p.thickness], rot: [0, -pitch, 0] });
}

/** One element's geometry (non-indexed, position + normal), in three.js axes, metres. */
export function elementGeometry(e: Element): THREE.BufferGeometry {
  if (e.shape === 'stone') return stone(e);
  if (e.shape === 'roof') return roof(e);
  const s: Soup = { pos: [], nor: [], centre: e.at };
  if (e.shape === 'gable') gable(s, e);
  else if (e.shape === 'leanto') leanto(s, e);
  else box(s, e);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(s.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(s.nor, 3));
  return g;
}

export interface Look {
  variant: 'default' | 'upgraded';
  stage?: Stage;
  parts: readonly string[];
}

/** The elements of a look merged by material, each piece tinted by its random number. */
export function mergedByMaterial(elements: Element[], look: Look): Map<string, THREE.BufferGeometry> {
  const groups = new Map<string, THREE.BufferGeometry[]>();
  for (const e of elements) {
    if (!shows(e, look)) continue;
    const g = elementGeometry(e);
    const k = 0.88 + 0.24 * e.rand; // each piece a little lighter or darker, a touch warmer or cooler
    const tint = [k, k * (0.98 + 0.04 * e.rand), k * (1.02 - 0.04 * e.rand)];
    const count = g.attributes.position.count;
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) col.set(tint, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const list = groups.get(e.material) ?? [];
    list.push(g);
    groups.set(e.material, list);
  }
  const out = new Map<string, THREE.BufferGeometry>();
  for (const [m, list] of groups) out.set(m, mergeGeometries(list)!);
  return out;
}
