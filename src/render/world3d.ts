// Buildings in real-time 3D (WebGL, three.js), seen through the game's own
// camera: the pinhole camera of plane.ts, the drawing camera's distance
// (ground.ts) in front of the building line at the height that puts the
// horizon at HORIZON_Y. A building on the building line comes out exactly where
// its 2D art would, and as the camera moves with the rider it is seen from the
// side. The sun follows the game's clock across the sky, so shading and cast
// shadows move through the day.
//
// The buildings are generated here, piece by piece (build3d/): no model files.
// Each building's seed makes it its own; its look is merged into one mesh per
// material, its pieces in build order, so a building going up is the same
// meshes drawn up to where its builders have got (a draw range), plus the
// temporary things of the moment (the stakes, the open trench and its spoil,
// the scaffolding). Doors, shutters, sails and the bell are moving parts, each
// turning about its hinge; windows, lamps and the rooms inside glow with the
// building's light, embers with its fire; its stock lies about in front of it.
// Materials weather with the building's age (build3d/materials.ts).
//
// The 3D image of this street's buildings is rendered offscreen and composited
// into the 2D frame at the building pass (scene.ts), so 2D people still pass
// in front of and behind it. From above (topview.ts) the same models are drawn
// looking straight down.

import * as THREE from 'three';
import type { BuildingType } from '../game/buildings';
import type { Element, Progress, Stage, Variant } from './build3d/elements';
import { animOf, inVariant, shows, stageCounts, stageIndex, untilOf } from './build3d/elements';
import { mergeByMaterial, type Merged } from './build3d/geometry';
import { hasModel, modelOf, pointsOf } from './build3d/index';
import { AGE_STEPS, glowOf, type Mat, material, ownMaterial } from './build3d/materials';
import { paletteOf, STYLES, type Style, styleNow } from './build3d/style';
import type { Anim, Model } from './build3d/model';
import type { Sides } from './build3d/plot';
import { U } from './build3d/plot';
import { stockElements, type StockKind } from './build3d/stock';
import { cameraDistance, cameraHeight, viewHorizon } from './ground';
import type { Ctx } from './util';

/** A type's named points (model space, metres), or undefined for one drawn in 2D: tests hold its `door` to BuildingDef.door. */
export function points3d(type: BuildingType): Record<string, [number, number, number]> | undefined {
  return pointsOf(type);
}

let enabled = false;

/** Draw buildings that have a generator in 3D (true) or keep everything 2D (false). */
export function set3d(on: boolean): void {
  enabled = on;
}

export function has3d(type: BuildingType): boolean {
  return enabled && hasModel(type);
}


/** How tall a 3D building stands (world units), for labels above it. */
export function height3d(type: BuildingType, seed = 7, size: 1 | 2 | 3 = 1): number {
  const model = modelOf(type, seed, size);
  let h = 0;
  for (const e of model.elements) {
    if (untilOf(e)) continue;
    const top = topOf(e);
    if (top > h) h = top;
  }
  return h * U;
}

function topOf(e: Element): number {
  const p = e.params;
  switch (e.shape) {
    case 'course':
      return Math.max(p.zl, p.zu) + 0.05;
    case 'cone':
      return e.at[2] + Math.max(p.z0, p.z1);
    case 'cyl':
      return e.at[2] + p.h;
    case 'dome':
      return e.at[2] + e.size[2];
    case 'beam':
    case 'log':
      return Math.max(e.a![2], e.b![2]) + 0.1;
    default:
      return e.at[2] + e.size[2] / 2;
  }
}

// --- what a building shows ------------------------------------------------------------

export interface Building3d {
  id: number;
  type: BuildingType;
  /** Varies everything about it within its type. */
  seed: number;
  /** World x of its plot centre. */
  x: number;
  /** A merged house or yard: one, two or three blocks wide. */
  size: 1 | 2 | 3;
  /** Which sides another building's walls touch. */
  sides: Sides;
  upgraded: boolean;
  /** Going up (or coming down): how far it has got; undefined when it stands finished. */
  build?: Progress;
  /** 0 new … 1 old and weathered. */
  age: number;
  /** 0 shut … 1 open: its door(s) and its shutters (eased here). */
  door: number;
  shutters: number;
  /** 0..1: lamps and firelight in the windows; a fire burning inside (a forge's coals, an oven's mouth). */
  light: number;
  fire: number;
  /** 0..1: the lanterns by its doors. */
  lantern?: number;
  /** The chapel bell's swing (radians). */
  bell?: number;
  /** What lies in its store, for the piles in front of it. */
  stock?: Partial<Record<StockKind, number>>;
  /**
   * Where it stands, for a building on another street: x along this street, z towards the camera
   * from the building line (world units), and its turn about the vertical. Else at (x, 0) facing the camera.
   */
  at?: { x: number; z: number; rot: number };
}

// --- the renderer -------------------------------------------------------------------------

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let sun: THREE.DirectionalLight;
let sky: THREE.HemisphereLight;
let groundShadow: THREE.ShadowMaterial;

function setup(): void {
  const canvas = document.createElement('canvas');
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera();
  camera.matrixAutoUpdate = false;

  sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1, 0.86, 0.68), 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.9;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  sky = new THREE.HemisphereLight(new THREE.Color().setRGB(0.78, 0.8, 0.88), new THREE.Color().setRGB(0.42, 0.36, 0.24), 1.1);
  scene.add(sky);

  // the ground takes the shadows only; the 2D land under it shows through
  groundShadow = new THREE.ShadowMaterial({ opacity: 0.38, color: 0x1a1408 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), groundShadow);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);
}

// --- a building's meshes ----------------------------------------------------------------

/** One variant's static meshes: its pieces in build order, merged by material. */
interface Static {
  /** The pieces, sorted by stage and order. */
  sorted: Element[];
  /** How many of `sorted` come before each stage. */
  before: number[];
  meshes: Array<{ mesh: THREE.Mesh; merged: Merged }>;
}

interface Part {
  anim: Anim;
  /** The pivot (turned each frame) and the meshes under it, per variant. */
  pivot: THREE.Group;
  byVariant: Map<Variant, { group: THREE.Group; first: Element }>;
}

interface Entry {
  key: string;
  seed: number;
  /** The style its materials are in now. */
  style: Style;
  /** Decorations a style may show (flower boxes, ivy): a group per part and variant. */
  deco: Map<string, { part: string; variant: Variant; group: THREE.Group }>;
  model: Model;
  root: THREE.Group;
  statics: Map<Variant, Static>;
  temp: { sig: string; group: THREE.Group };
  parts: Map<string, Part>;
  stock: { sig: string; group: THREE.Group };
  /** Its own glowing materials (light and fire are its own). */
  own: Map<string, Mat>;
  ageStep: number;
  door: number;
  shutters: number;
  seen: number;
  counts: Map<Variant, Map<Stage, number>>;
}

const entries = new Map<number, Entry>();
let frame = 0;
/** Milliseconds of building new models allowed per frame (the rest wait for the next frames). */
const BUILD_BUDGET_MS = 14;
let budgetLeft = BUILD_BUDGET_MS;
let budgetFrame = -1;

const toThree = (v: [number, number, number]) => new THREE.Vector3(v[0], v[2], -v[1]);

function geometryOf(m: Merged): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(m.col, 3));
  g.computeBoundingSphere();
  return g;
}

function meshFor(e: Entry, name: string, merged: Merged): THREE.Mesh {
  const mesh = new THREE.Mesh(geometryOf(merged), materialFor(e, name));
  mesh.castShadow = !glowOf(name) || name === 'lamp';
  mesh.receiveShadow = true;
  mesh.userData.material = name;
  return mesh;
}

function materialFor(e: Entry, name: string): Mat {
  if (glowOf(name)) {
    let m = e.own.get(name);
    if (!m) e.own.set(name, (m = ownMaterial(name, e.ageStep, e.style)));
    return m;
  }
  // a colour of its own from the style's palette (each house its walls, shutters, roof)
  const pal = paletteOf(e.style, name);
  const colour = pal ? pal[Math.floor(pick01(e.seed, name) * pal.length) % pal.length] : undefined;
  return material(name, e.ageStep, e.style, colour);
}

/** A number 0..1 that stays the same for a building and a name. */
function pick01(seed: number, name: string): number {
  let h = seed * 2654435761;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 2246822519);
  h ^= h >>> 15;
  return ((h >>> 0) % 10007) / 10007;
}

/** Repaint a building's meshes for its style and age now. */
function repaint(e: Entry): void {
  for (const m of e.own.values()) m.dispose();
  e.own.clear();
  e.root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.material) o.material = materialFor(e, o.userData.material);
  });
}

const sortKey = (e: Element) => stageIndex(e.stage) * 1e6 + e.order;
const partOf = (e: Element) => e.tags.find((t) => t.startsWith('part:'))?.slice(5) ?? null;

function buildStatic(e: Entry, variant: Variant): Static {
  const sorted = e.model.elements.filter((x) => inVariant(x, variant) && !untilOf(x) && !animOf(x) && !partOf(x)).sort((a, b) => sortKey(a) - sortKey(b));
  // the decorations a style may put out, a group each
  const byPart = new Map<string, Element[]>();
  for (const x of e.model.elements) {
    const p = partOf(x);
    if (p && inVariant(x, variant) && !animOf(x)) (byPart.get(p) ?? byPart.set(p, []).get(p)!).push(x);
  }
  for (const [part, els] of byPart) {
    const group = new THREE.Group();
    for (const [name, merged] of mergeByMaterial(els)) group.add(meshFor(e, name, merged));
    e.root.add(group);
    e.deco.set(`${part}|${variant}`, { part, variant, group });
  }
  const before = [0, 0, 0, 0, 0, 0];
  for (const x of sorted) for (let s = stageIndex(x.stage) + 1; s < before.length; s++) before[s]++;
  const meshes: Static['meshes'] = [];
  for (const [name, merged] of mergeByMaterial(sorted)) {
    const mesh = meshFor(e, name, merged);
    meshes.push({ mesh, merged });
    e.root.add(mesh);
  }
  return { sorted, before, meshes };
}

function buildParts(e: Entry): void {
  const byName = new Map<string, Element[]>();
  for (const x of e.model.elements) {
    const a = animOf(x);
    if (a) (byName.get(a) ?? byName.set(a, []).get(a)!).push(x);
  }
  for (const [name, els] of byName) {
    const anim = e.model.anims[name];
    if (!anim) continue;
    const pivot = new THREE.Group();
    pivot.position.copy(toThree(anim.pivot));
    e.root.add(pivot);
    const part: Part = { anim, pivot, byVariant: new Map() };
    for (const variant of ['default', 'upgraded'] as const) {
      const mine = els.filter((x) => inVariant(x, variant)).sort((a, b) => sortKey(a) - sortKey(b));
      if (!mine.length) continue;
      const group = new THREE.Group();
      group.position.copy(toThree(anim.pivot)).multiplyScalar(-1);
      for (const [mat, merged] of mergeByMaterial(mine)) group.add(meshFor(e, mat, merged));
      pivot.add(group);
      part.byVariant.set(variant, { group, first: mine[0] });
    }
    e.parts.set(name, part);
  }
}

function makeEntry(b: Building3d, style: Style): Entry {
  const model = modelOf(b.type, b.seed, b.size, b.sides);
  const root = new THREE.Group();
  root.scale.setScalar(U);
  const e: Entry = {
    key: keyOf(b),
    seed: b.seed,
    style,
    deco: new Map(),
    model,
    root,
    statics: new Map(),
    temp: { sig: '', group: new THREE.Group() },
    parts: new Map(),
    stock: { sig: '', group: new THREE.Group() },
    own: new Map(),
    ageStep: ageStepOf(b.age),
    door: b.door,
    shutters: b.shutters,
    seen: frame,
    counts: new Map(),
  };
  root.add(e.temp.group, e.stock.group);
  e.statics.set('default', buildStatic(e, 'default'));
  buildParts(e);
  return e;
}

const keyOf = (b: Building3d) => `${b.type}|${b.seed}|${b.size}|${+b.sides.left}${+b.sides.right}`;
const ageStepOf = (age: number) => Math.max(0, Math.min(AGE_STEPS - 1, Math.round(age * (AGE_STEPS - 1))));

function dispose(e: Entry): void {
  e.root.removeFromParent();
  e.root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
  for (const m of e.own.values()) m.dispose();
}

/**
 * Whether a building's model is ready to draw: made now if this frame's budget allows (new models
 * cost a few milliseconds each), else on a later frame. A building whose model has changed (a
 * neighbour built against it) keeps showing the old one until the new one is made.
 */
export function ready3d(b: Building3d, style: Style = styleNow()): boolean {
  if (budgetFrame !== frame) {
    budgetFrame = frame;
    budgetLeft = BUILD_BUDGET_MS;
  }
  const e = entries.get(b.id);
  if (e && e.key === keyOf(b)) return true;
  if (budgetLeft <= 0) return !!e;
  const t0 = performance.now();
  const fresh = makeEntry(b, style);
  if (e) dispose(e);
  entries.set(b.id, fresh);
  budgetLeft -= performance.now() - t0;
  return true;
}

/** Bring a building's meshes to its current look: variant, how far built, moving parts, stock, glow, age. */
function update(e: Entry, b: Building3d, time: number, dt: number, night: number, style: Style): void {
  e.seen = frame;
  if (e.style !== style) {
    e.style = style;
    repaint(e);
  }
  const variant: Variant = b.build ? 'default' : b.upgraded ? 'upgraded' : 'default';
  if (!e.statics.has(variant)) e.statics.set(variant, buildStatic(e, variant));
  // age: swap materials when it has weathered another step
  const step = ageStepOf(b.age);
  if (step !== e.ageStep) {
    e.ageStep = step;
    repaint(e);
  }
  // the static meshes: this variant's, drawn as far as it is built
  let counts = e.counts.get(variant) as Map<Stage, number> | undefined;
  if (!counts) e.counts.set(variant, (counts = stageCounts(e.model.elements, variant)));
  for (const [v, st] of e.statics) {
    const on = v === variant;
    let shown = st.sorted.length;
    if (on && b.build) {
      const s = stageIndex(b.build.stage);
      const k = Math.floor(b.build.t * (counts.get(b.build.stage) ?? 0) + 1e-9);
      // the pieces of the stages done, and of this stage those whose order has come
      shown = st.before[s];
      const lo = st.before[s];
      const hi = s + 1 < st.before.length ? st.before[s + 1] : st.sorted.length;
      let a = lo;
      let c = Math.min(hi, st.sorted.length);
      while (a < c) {
        const mid = (a + c) >> 1;
        if (st.sorted[mid].order <= k) a = mid + 1;
        else c = mid;
      }
      shown = a;
    }
    for (const { mesh, merged } of st.meshes) {
      mesh.visible = on;
      if (!on) continue;
      // the material's pieces among the first `shown`: binary search its list of indices
      let a = 0;
      let c = merged.index.length;
      while (a < c) {
        const mid = (a + c) >> 1;
        if (merged.index[mid] < shown) a = mid + 1;
        else c = mid;
      }
      mesh.geometry.setDrawRange(0, a === 0 ? 0 : merged.ends[a - 1]);
      mesh.visible = a > 0;
    }
  }
  // decorations: on a finished building, if the style puts them out
  for (const d of e.deco.values()) d.group.visible = d.variant === variant && !b.build && style.parts.includes(d.part);
  // the temporary things of the moment, merged afresh when they change
  const look = { variant, build: b.build };
  const temps = b.build ? e.model.elements.filter((x) => untilOf(x) && shows(x, look, undefined, counts)) : [];
  const sig = temps.length ? `${temps.length}:${temps[temps.length - 1].id}:${b.build?.stage}` : '';
  if (sig !== e.temp.sig) {
    e.temp.sig = sig;
    for (const c of [...e.temp.group.children]) {
      (c as THREE.Mesh).geometry.dispose();
      c.removeFromParent();
    }
    for (const [name, merged] of mergeByMaterial(temps)) e.temp.group.add(meshFor(e, name, merged));
  }
  // moving parts
  const ease = (cur: number, target: number, rate: number) => cur + (target - cur) * Math.min(1, dt * rate);
  e.door = ease(e.door, b.door, 5);
  e.shutters = ease(e.shutters, b.shutters, 2.2);
  for (const part of e.parts.values()) {
    let shownPart = false;
    for (const [v, { group, first }] of part.byVariant) {
      const on = v === variant && shows(first, look, undefined, counts);
      group.visible = on;
      shownPart ||= on;
    }
    if (!shownPart) continue;
    const a = part.anim;
    let angle = 0;
    if (a.kind === 'door') angle = (a.open ?? 0) * smooth(e.door);
    else if (a.kind === 'shutter') angle = (a.open ?? 0) * smooth(b.build ? 1 : e.shutters);
    else if (a.kind === 'spin') angle = b.build ? 0 : time * (a.speed ?? 1);
    else if (a.kind === 'swing') angle = b.bell ?? 0;
    else if (a.kind === 'sway') angle = Math.sin(time * 1.1 + b.seed) * 0.09 + Math.sin(time * 2.7 + b.seed * 3) * 0.03;
    const axis = toThree(a.axis as [number, number, number]).normalize();
    part.pivot.quaternion.setFromAxisAngle(axis, angle);
  }
  // glow: lamps and firelight behind the windows, embers in a fire (brighter than they look: the
  // land tint dims them again at night)
  const boost = 1 + 2.6 * night;
  const flicker = 1 + 0.12 * Math.sin(time * 9.3 + b.seed) + 0.08 * Math.sin(time * 23.1 + b.seed * 2);
  for (const [name, m] of e.own) {
    const g = glowOf(name)!;
    const level = g.by === 'fire' ? b.fire * flicker : name === 'interior' ? Math.max(b.light, b.fire * 0.6) * (0.85 + 0.15 * flicker) : name === 'lamp' ? (b.lantern ?? b.light) * (0.9 + 0.1 * flicker) : b.light;
    m.emissiveIntensity = g.k * level * boost;
  }
  // the stock lying in front of it
  const sig2 = b.build ? '' : JSON.stringify(b.stock ?? {});
  if (sig2 !== e.stock.sig) {
    e.stock.sig = sig2;
    for (const c of [...e.stock.group.children]) {
      (c as THREE.Mesh).geometry.dispose();
      c.removeFromParent();
    }
    if (!b.build && b.stock) for (const [name, merged] of mergeByMaterial(stockElements(b.type, b.stock, b.size, b.seed))) e.stock.group.add(meshFor(e, name, merged));
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Drop the models of buildings not drawn for a while. */
function sweep(): void {
  if (frame % 120 !== 0) return;
  for (const [id, e] of entries) {
    if (frame - e.seen > 600) {
      dispose(e);
      entries.delete(id);
    }
  }
}

export interface View3d {
  camX: number;
  viewW: number;
  top: number;
  bottom: number;
  /** Canvas pixels per world unit. */
  pxPerU: number;
  /** 0..1 through the day and sun height -1..1 (game/daynight.ts), and 0..1 night. */
  phase: number;
  sunHeight: number;
  night: number;
  /** World time (s): moving parts. */
  time: number;
  /** A style to draw in (STYLES), else the one chosen now. */
  style?: string;
}

function place(e: Entry, b: Building3d): void {
  e.root.matrixAutoUpdate = true;
  e.root.position.set(b.at?.x ?? b.x, 0, b.at?.z ?? 0);
  e.root.rotation.set(0, b.at?.rot ?? 0, 0);
  e.root.updateMatrixWorld(true);
}

/**
 * The screen y (world units) of a 3D building's footprint where it comes nearest the camera: how it
 * sorts among 2D people and pictures (scene.ts), so one reaching towards the camera is drawn after
 * whatever stands behind its near end.
 */
export function nearestFootY(b: Building3d, v: View3d): number {
  if (!renderer) setup();
  if (!ready3d(b)) return 0;
  const e = entries.get(b.id)!;
  place(e, b);
  const box = new THREE.Box3().setFromObject(e.root);
  let y = -Infinity;
  for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) y = Math.max(y, project(new THREE.Vector3(x, 0, z), v)[1]);
  return y;
}

/** World point (x along the street, y up, z towards the camera from the building line) → screen point in world units. */
function project(p: THREE.Vector3, v: View3d): [number, number] {
  const cx = v.camX + v.viewW / 2;
  const cam = cameraDistance();
  const z = cam - p.z;
  return [v.viewW / 2 + ((p.x - cx) * cam) / z, viewHorizon() + ((cameraHeight() - p.y) * cam) / z];
}

let lastTime = 0;

/** The sun: across the sky from the left in the morning to the right at evening, as the 2D sky draws it. */
function light(v: View3d, cx: number, reach: number, style: Style): THREE.Vector3 {
  /** A body's direction: it crosses from the left (rising) to the right (setting), a little in front of the street. */
  const towards = (phase: number, height: number): THREE.Vector3 => {
    const across = (phase - 0.25) / 0.5; // 0 rising … 1 setting
    const az = Math.PI * (1 - THREE.MathUtils.clamp(across, -0.1, 1.1)); // π: from the left, 0: from the right
    const elev = THREE.MathUtils.degToRad(8 + 50 * THREE.MathUtils.clamp(height, 0, 1));
    return new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), 0.5 * Math.cos(elev) + 0.3).normalize();
  };
  const day = THREE.MathUtils.smoothstep(v.sunHeight, -0.05, 0.25);
  renderer!.toneMappingExposure = style.exposure;
  // by day the sun; by night the moon (opposite it), cool and softer. The land around is drawn as by
  // day and darkened by the night tint (sky.ts tintLand), and so are these buildings: so the moon
  // lights them about as the 2D land is lit, and the tint takes both down together
  const moon = 1 - day;
  const sunDir = towards(v.phase, v.sunHeight);
  const moonDir = towards((v.phase + 0.5) % 1, Math.max(0.35, -v.sunHeight));
  const dir = day >= 0.5 ? sunDir : moonDir;
  sun.intensity = style.sun * day + style.sun * 0.55 * moon;
  // shadows: long and fading at sunset, soft moon shadows at night
  const shadows = Math.max(THREE.MathUtils.smoothstep(v.sunHeight, 0.02, 0.22), 0.55 * THREE.MathUtils.smoothstep(-v.sunHeight, 0.1, 0.35));
  sun.castShadow = shadows > 0.01;
  groundShadow.opacity = style.shadow * shadows;
  // the sun's colour: golden low down, whiter high up, as warm as the style likes it; the moon's silver-blue
  const low = 1 - Math.min(1, Math.max(0, v.sunHeight) * 2.2);
  const sunCol = new THREE.Color().setRGB(1, 0.96 - style.warmth * (0.06 + 0.24 * low), 0.92 - style.warmth * (0.14 + 0.4 * low));
  sun.color.copy(sunCol).lerp(new THREE.Color().setRGB(0.72, 0.8, 1), moon);
  // the sky's fill: bright by day, a deep blue glow by night (still enough to read the buildings)
  sky.intensity = (0.3 + 0.85 * day + 0.55 * moon) * (style.sky / 1.1);
  sky.color.setRGB(0.78 - 0.3 * moon, 0.8 - 0.2 * moon, 0.88 + 0.05 * moon);
  sun.position.set(cx + dir.x * 3000, dir.y * 3000, dir.z * 3000);
  sun.target.position.set(cx, 0, 0);
  const sc = sun.shadow.camera;
  sc.left = -reach;
  sc.right = reach;
  sc.top = reach;
  sc.bottom = -reach;
  sc.near = 100;
  sc.far = 8000;
  sc.updateProjectionMatrix();
  return dir;
}

/**
 * Render these buildings and draw the image into ctx (under its world transform). Returns where
 * each building's named points came out on screen (null for a point it doesn't have).
 */
export function draw3d(ctx: Ctx, buildings: Building3d[], v: View3d, opts: { clip?: boolean } = {}): Map<number, (name: string) => [number, number] | null> {
  const out = new Map<number, (name: string) => [number, number] | null>();
  if (!buildings.length) return out;
  if (!renderer) setup();
  const r = renderer!;
  if (v.time !== lastTime) {
    frame++;
    sweep();
  }
  const dt = Math.max(0, Math.min(0.1, v.time - lastTime));
  lastTime = v.time;
  const w = Math.max(1, Math.round(v.viewW * v.pxPerU));
  const h = Math.max(1, Math.round((v.bottom - v.top) * v.pxPerU));
  const size = r.getSize(new THREE.Vector2());
  if (size.x !== w || size.y !== h) r.setSize(w, h, false);

  // the game's camera: at the middle of the view, in front of the building line, looking level
  const cx = v.camX + v.viewW / 2;
  const cam = cameraDistance();
  camera.matrixWorld.makeTranslation(cx, cameraHeight(), cam);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const near = 20;
  const f = cam;
  camera.projectionMatrix.makePerspective((near * (0 - v.viewW / 2)) / f, (near * (v.viewW - v.viewW / 2)) / f, (near * (viewHorizon() - v.top)) / f, (near * (viewHorizon() - v.bottom)) / f, near, 40000);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  const style = v.style ? (STYLES[v.style] ?? styleNow()) : styleNow();
  const dir = light(v, cx, v.viewW / 2 + 500, style);

  const shown = new Set<THREE.Object3D>();
  for (const b of buildings) {
    if (!ready3d(b, style)) continue;
    const e = entries.get(b.id)!;
    update(e, b, v.time, dt, v.night, style);
    place(e, b);
    if (e.root.parent !== scene) scene.add(e.root);
    shown.add(e.root);
    const root = e.root;
    const points = e.model.points;
    out.set(b.id, (name) => {
      const p = points[name];
      return p ? project(toThree(p).applyMatrix4(root.matrixWorld), v) : null;
    });
  }
  for (const c of [...scene.children]) if (c instanceof THREE.Group && !shown.has(c)) c.removeFromParent();
  if (!shown.size) return out;

  if (!opts.clip) {
    r.render(scene, camera);
    ctx.drawImage(r.domElement, 0, v.top, v.viewW, v.bottom - v.top);
    return out;
  }
  // clipped: only the screen rectangle these buildings and their shadows cover is rendered and copied,
  // so a building can be drawn on its own at its place in the far-to-near order (scene.ts) cheaply
  const box = new THREE.Box3();
  for (const g of shown) box.expandByObject(g);
  const pts: Array<[number, number]> = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        pts.push(project(new THREE.Vector3(x, y, z), v));
        // where that corner's shadow falls on the ground
        if (y > 0 && dir.y > 0.01) pts.push(project(new THREE.Vector3(x - (dir.x * y) / dir.y, 0, z - (dir.z * y) / dir.y), v));
      }
    }
  }
  const k = v.pxPerU;
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])) * k) - 2);
  const x1 = Math.min(w, Math.ceil(Math.max(...pts.map((p) => p[0])) * k) + 2);
  const y0 = Math.max(0, Math.floor((Math.min(...pts.map((p) => p[1])) - v.top) * k) - 2);
  const y1 = Math.min(h, Math.ceil((Math.max(...pts.map((p) => p[1])) - v.top) * k) + 2);
  if (x1 <= x0 || y1 <= y0) return out;
  r.setScissorTest(true);
  r.setScissor(x0, h - y1, x1 - x0, y1 - y0); // WebGL counts from the bottom
  r.render(scene, camera);
  r.setScissorTest(false);
  ctx.drawImage(r.domElement, x0, y0, x1 - x0, y1 - y0, x0 / k, v.top + y0 / k, (x1 - x0) / k, (y1 - y0) / k);
  return out;
}

// --- from above ---------------------------------------------------------------------------

/** A building seen from above: where its plot's middle (on the building line) lies on the map, and which way it faces. */
export interface Top3d {
  b: Building3d;
  /** Map point of the model's origin, and the map direction of its +x (along its street) and +y (back from it). */
  ox: number;
  oy: number;
  along: { x: number; y: number };
  back: { x: number; y: number };
}

let topCam: THREE.OrthographicCamera | null = null;

/**
 * Draw buildings from straight above into a view of the map (north up): screen = (w/2 + (p.x − cx)·S,
 * h/2 − (p.y − cy)·S). The sun casts their shadows on the ground as it does in the street.
 */
export function drawTop3d(ctx: Ctx, items: Top3d[], view: { cx: number; cy: number; S: number; w: number; h: number; px: number; phase: number; sunHeight: number; night: number; time: number }): void {
  if (!items.length) return;
  if (!renderer) setup();
  const r = renderer!;
  topCam ??= new THREE.OrthographicCamera();
  const w = Math.max(1, Math.round(view.w * view.px));
  const h = Math.max(1, Math.round(view.h * view.px));
  const size = r.getSize(new THREE.Vector2());
  if (size.x !== w || size.y !== h) r.setSize(w, h, false);
  if (view.time !== lastTime) frame++;
  const dt = Math.max(0, Math.min(0.1, view.time - lastTime));
  lastTime = view.time;
  // three.js world here: x = map x, z = −map y (north away), y up; the camera above looking down, north up
  const halfW = view.w / 2 / view.S;
  const halfH = view.h / 2 / view.S;
  topCam.left = -halfW;
  topCam.right = halfW;
  topCam.top = halfH;
  topCam.bottom = -halfH;
  topCam.near = 1;
  topCam.far = 20000;
  topCam.position.set(view.cx, 5000, -view.cy);
  topCam.up.set(0, 0, -1);
  topCam.lookAt(view.cx, 0, -view.cy);
  topCam.updateProjectionMatrix();
  topCam.updateMatrixWorld(true);
  const style = styleNow();
  const dir = light({ camX: view.cx, viewW: 0, top: 0, bottom: 0, pxPerU: 1, phase: view.phase, sunHeight: view.sunHeight, night: view.night, time: view.time }, view.cx, Math.max(halfW, halfH) + 400, style);
  // from above, the slopes facing away from the sun still take the open sky's light
  sky.intensity += 0.45;
  // in the top view the sun's "towards the camera" is towards the south
  sun.position.set(view.cx + dir.x * 3000, dir.y * 3000, -view.cy + dir.z * 3000);
  sun.target.position.set(view.cx, 0, -view.cy);
  sun.target.updateMatrixWorld();
  const shown = new Set<THREE.Object3D>();
  for (const it of items) {
    if (!ready3d(it.b)) continue;
    const e = entries.get(it.b.id)!;
    update(e, it.b, view.time, dt, view.night, style);
    // model (x along, y back, z up) → map (along, back) → three.js (x, −y)
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(it.along.x, 0, -it.along.y), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-it.back.x, 0, it.back.y));
    m.setPosition(it.ox, 0, -it.oy);
    e.root.matrixAutoUpdate = false;
    e.root.matrix.copy(m).multiply(new THREE.Matrix4().makeScale(U, U, U));
    e.root.updateMatrixWorld(true);
    if (e.root.parent !== scene) scene.add(e.root);
    shown.add(e.root);
  }
  for (const c of [...scene.children]) if (c instanceof THREE.Group && !shown.has(c)) c.removeFromParent();
  r.render(scene, topCam);
  ctx.drawImage(r.domElement, 0, 0, view.w, view.h);
  // back to street placement next time (place() sets the matrix from position and rotation again)
  for (const g of shown) g.matrixAutoUpdate = true;
}
