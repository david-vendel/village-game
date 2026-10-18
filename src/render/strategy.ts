// The strategy view (Tab): the village in 3D, looked down on at an angle by a
// camera that follows the rider and turns about them (Q / E, or a drag), like a
// strategy game. Zoomed out it looks down more steeply and sees further.
//
// The land is the map painted from straight above (mapground.ts) into two
// textures laid on the ground: a sharp one round the camera's target, and a
// coarser one reaching out to the haze; beyond them plain grass. On it stand
// the buildings' own 3D models (world3d.ts), the trees, the people, the
// chickens and the rider, simply modelled here and moved every frame from the
// game state. Buildings' names float over them; with the grid on, the cell
// under the mouse is outlined and named.
//
// three.js world: x = map x, z = −map y (north away), y up; map px are world units.

import * as THREE from 'three';
import { BUILDINGS, type BuildingType } from '../game/buildings';
import { cellName, footprintOf } from '../game/grid';
import { BASE_Y, behindRoad, CELL_W, rowFar, rowNear } from '../game/layout';
import { treeGrowth } from '../game/nature';
import type { Load } from '../game/resources';
import { backOf, groundPoint, mapPoint, streetOf, type Vec } from '../game/streets';
import { getBuilding, type World } from '../game/world';
import { hasModel } from './build3d/index';
import { doorProgress } from './farm';
import { figureOf, outfitOf } from './figure';
import { building3d } from './life3d';
import { GRASS, paintGround, RESOURCE_COLOUR } from './mapground';
import { beingFelled } from './nature';
import { lightAt } from './sky';
import { type Ctx, hash } from './util';
import { drawStrategy3d, height3d, type Top3d } from './world3d';

const SERIF = 'Georgia, "Times New Roman", serif';
const DEG = Math.PI / 180;
/** Vertical field of view (degrees). */
const FOV = 38;
/** The camera's distance from the rider at zoom 1 (map px), and the nearest and furthest it goes. */
const DIST = 820;
const DIST_MIN = 160;
const DIST_MAX = 4200;
/** How far the camera looks down: close in, and far out. */
const PITCH_NEAR = 32 * DEG;
const PITCH_FAR = 62 * DEG;
/** Rider and villagers drawn a little larger than life, to be seen from up here. */
const FIGURE_SCALE = 1.2;

export interface StrategyView {
  /** The screen in UI units, and canvas px per UI unit. */
  uiW: number;
  uiH: number;
  px: number;
  /** The view's own zoom (1 by default) and its turn about the rider (radians, 0 looking north). */
  zoom: number;
  yaw: number;
  grid: boolean;
  /** The mouse in UI units, if over the canvas. */
  hover: { x: number; y: number } | null;
}

// --- the camera -------------------------------------------------------------------------------

const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 60000);
/** Where the camera looks (map), and its turn, eased towards the rider and the asked turn. */
let target: Vec | null = null;
let yawNow = 0;
let lastTime = -1;

/** The camera's distance from its target and how far it looks down, at a zoom. */
function framing(zoom: number): { dist: number; pitch: number } {
  const dist = Math.max(DIST_MIN, Math.min(DIST_MAX, DIST / zoom));
  const t = THREE.MathUtils.smoothstep(Math.log(dist), Math.log(300), Math.log(3000));
  return { dist, pitch: PITCH_NEAR + (PITCH_FAR - PITCH_NEAR) * t };
}

/** Map direction the camera faces at a turn: north at 0, east at a quarter turn. */
const forwardOf = (yaw: number): Vec => ({ x: Math.sin(yaw), y: Math.cos(yaw) });

function aim(c: Vec, yaw: number, dist: number, pitch: number, aspect: number): void {
  const f = forwardOf(yaw);
  const back = Math.cos(pitch) * dist;
  camera.position.set(c.x - f.x * back, Math.sin(pitch) * dist, -(c.y - f.y * back));
  camera.up.set(0, 1, 0);
  camera.lookAt(c.x, 0, -c.y);
  camera.aspect = aspect;
  camera.near = Math.max(5, dist * 0.05);
  camera.far = dist * 12;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

/** Screen point (UI units) of a three.js world point, or null behind the camera. */
function toScreen(p: THREE.Vector3, w: number, h: number): [number, number] | null {
  const q = p.clone().project(camera);
  if (q.z > 1) return null;
  return [((q.x + 1) / 2) * w, ((1 - q.y) / 2) * h];
}

/** The map point on the ground under a screen point (UI units), if the ground is there. */
function groundUnder(x: number, y: number, w: number, h: number): Vec | null {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, 1 - (y / h) * 2), camera);
  const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  return hit ? { x: hit.x, y: -hit.z } : null;
}

// --- the land --------------------------------------------------------------------------------

/** One painted texture of the map, laid flat on the ground. */
interface Layer {
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  mesh: THREE.Mesh;
  /** What it shows now: its middle (map), half its side (map px), when it was painted, with the grid or not. */
  c: Vec;
  r: number;
  at: number;
  grid: boolean;
}

function layer(size: number, y: number, order: number): Layer {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.receiveShadow = true;
  mesh.renderOrder = order;
  return { canvas, tex, mesh, c: { x: NaN, y: NaN }, r: 0, at: -Infinity, grid: false };
}

/**
 * Paint a layer afresh when the view has moved off it, zoomed well in or out, the grid was turned on
 * or off, or `every` seconds have passed (fields grow, piles come and go).
 */
function refresh(l: Layer, world: World, c: Vec, r: number, grid: boolean, every: number): void {
  const moved = Math.hypot(c.x - l.c.x, c.y - l.c.y) > r * 0.2 || !(Math.abs(Math.log(r / l.r)) < 0.15);
  if (!moved && grid === l.grid && world.time - l.at < every && world.time >= l.at) return;
  if (moved) {
    // snapped, so the land doesn't shimmer as the texture follows the camera
    const step = (2 * r) / l.canvas.width;
    l.c = { x: Math.round(c.x / step) * step, y: Math.round(c.y / step) * step };
    l.r = r;
  }
  l.at = world.time;
  l.grid = grid;
  const n = l.canvas.width;
  paintGround(l.canvas.getContext('2d')!, world, { cx: l.c.x, cy: l.c.y, S: n / (2 * l.r), w: n, h: n, grid }, hasModel);
  l.tex.needsUpdate = true;
  l.mesh.position.set(l.c.x, l.mesh.position.y, -l.c.y);
  l.mesh.scale.set(2 * l.r, 2 * l.r, 1);
}

// --- trees, people, animals, the rider ---------------------------------------------------------

const lambert = (opts: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color: 0xffffff, ...opts });

/** An instanced mesh with a colour per instance, casting shadows. */
function crowd(geo: THREE.BufferGeometry, max: number, colour?: string): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, lambert(colour ? { color: colour } : {}), max);
  m.castShadow = true;
  m.receiveShadow = true;
  m.frustumCulled = false;
  m.count = 0;
  return m;
}

/** Geometry standing on its base: from y = 0 up to y = 1. */
const standing = (g: THREE.BufferGeometry) => g.translate(0, 0.5, 0);

let world3dScene: {
  root: THREE.Group;
  near: Layer;
  far: Layer;
  trunks: THREE.InstancedMesh;
  crowns: THREE.InstancedMesh;
  bodies: THREE.InstancedMesh;
  heads: THREE.InstancedMesh;
  legs: THREE.InstancedMesh;
  loads: THREE.InstancedMesh;
  hens: THREE.InstancedMesh;
  rider: THREE.Group;
  horseLegs: THREE.Mesh[];
  ring: THREE.Mesh;
} | null = null;

function build(): NonNullable<typeof world3dScene> {
  const root = new THREE.Group();
  root.name = 'strategy';
  // the plain land out to the horizon, then the far and near paintings over it
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(400000, 400000), lambert({ color: GRASS }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.5;
  grass.receiveShadow = true;
  const far = layer(1024, 0, 1);
  const near = layer(2048, 0, 2);
  root.add(grass, far.mesh, near.mesh);

  const trunks = crowd(standing(new THREE.CylinderGeometry(0.7, 1, 1, 6)), 4000, '#5b4130');
  const crowns = crowd(new THREE.IcosahedronGeometry(1, 1), 8000);
  const bodies = crowd(standing(new THREE.CylinderGeometry(0.62, 1, 1, 8)), 800);
  const heads = crowd(new THREE.SphereGeometry(1, 10, 8), 800);
  const legs = crowd(standing(new THREE.BoxGeometry(1, 1, 1)), 1600, '#3e3226');
  const loads = crowd(new THREE.BoxGeometry(1, 1, 1), 800);
  const hens = crowd(new THREE.SphereGeometry(1, 8, 6), 400);
  root.add(trunks, crowns, bodies, heads, legs, loads, hens);

  // the rider: the horse along +x, the king on its back, a golden crown
  const rider = new THREE.Group();
  const part = (geo: THREE.BufferGeometry, colour: string, x: number, y: number, z = 0) => {
    const m = new THREE.Mesh(geo, lambert({ color: colour }));
    m.position.set(x, y, z);
    m.castShadow = true;
    rider.add(m);
    return m;
  };
  part(new THREE.BoxGeometry(26, 11, 10), '#8b5a34', 0, 22);
  const neck = part(new THREE.BoxGeometry(6, 14, 6), '#8b5a34', 13, 30);
  neck.rotation.z = -0.5;
  part(new THREE.BoxGeometry(11, 5.5, 5.5), '#6b4226', 20, 36);
  part(new THREE.BoxGeometry(4, 9, 3), '#2a221c', -14, 22).rotation.z = 0.5; // tail
  const horseLegs = [
    [10, 3.5],
    [10, -3.5],
    [-10, 3.5],
    [-10, -3.5],
  ].map(([x, z]) => {
    const m = part(standing(new THREE.BoxGeometry(3, 18, 3)), '#5a3a22', x, 0, z);
    m.geometry.translate(0, -18, 0);
    m.position.y = 18;
    return m;
  });
  part(standing(new THREE.CylinderGeometry(4, 5.5, 1, 10)).scale(1, 14, 1), '#9a2a2e', -1, 27);
  part(new THREE.SphereGeometry(3.6, 10, 8), '#e3b893', -1, 45);
  part(standing(new THREE.CylinderGeometry(3.4, 3.4, 1, 8, 1, true)).scale(1, 2.6, 1), '#e8c14a', -1, 47.5);
  rider.scale.setScalar(FIGURE_SCALE);
  // a golden ring on the ground round the rider, to find them by
  const ring = new THREE.Mesh(new THREE.RingGeometry(28, 33, 40), new THREE.MeshBasicMaterial({ color: '#f2cf6a', transparent: true, opacity: 0.7, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.6;
  ring.renderOrder = 3;
  root.add(rider, ring);
  return { root, near, far, trunks, crowns, bodies, heads, legs, loads, hens, rider, horseLegs, ring };
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v3 = new THREE.Vector3();
const s3 = new THREE.Vector3();
const colour = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function put(mesh: THREE.InstancedMesh, x: number, y: number, z: number, sx: number, sy: number, sz: number, turn: number, col?: string | THREE.Color, tilt?: THREE.Quaternion): void {
  const i = mesh.count;
  if (i >= mesh.instanceMatrix.count) return;
  q.setFromAxisAngle(UP, turn);
  if (tilt) q.premultiply(tilt);
  m4.compose(v3.set(x, y, z), q, s3.set(sx, sy, sz));
  mesh.setMatrixAt(i, m4);
  if (col) mesh.setColorAt(i, typeof col === 'string' ? colour.set(col) : col);
  mesh.count = i + 1;
}

/** Where each person was last frame (map), which way they face, and how far they have walked: their step. */
const walked = new Map<number, { x: number; y: number; heading: number; step: number; moving: number }>();

function stepOf(id: number, p: Vec, dt: number): { heading: number; step: number; moving: boolean } {
  let w = walked.get(id);
  if (!w) walked.set(id, (w = { x: p.x, y: p.y, heading: 0, step: 0, moving: 0 }));
  const dx = p.x - w.x;
  const dy = p.y - w.y;
  const d = Math.hypot(dx, dy);
  if (d > 0.05 && d < 200) {
    w.heading = Math.atan2(dy, dx);
    w.step += d;
    w.moving = 0.15;
  } else w.moving -= dt;
  w.x = p.x;
  w.y = p.y;
  return { heading: w.heading, step: w.step, moving: w.moving > 0 };
}

function placeTrees(s: NonNullable<typeof world3dScene>, world: World, c: Vec, reach: number): void {
  const felling = beingFelled(world);
  const tilt = new THREE.Quaternion();
  for (const t of world.trees) {
    const p = groundPoint(world, t.x, t.y);
    if (Math.abs(p.x - c.x) > reach || Math.abs(p.y - c.y) > reach) continue;
    const X = p.x;
    const Z = -p.y;
    if (t.state === 'stump') {
      put(s.trunks, X, 0, Z, 5, 5, 5, 0, '#a98a62');
      continue;
    }
    const g = 0.3 + 0.7 * treeGrowth(t);
    const tall = (95 + hash(t.id, 91) * 55) * g;
    const r = (24 + hash(t.id, 92) * 12) * g;
    const turn = hash(t.id, 93) * Math.PI * 2;
    // a tree being felled shakes, and leans more the further the axe has got
    const f = felling.get(t.id);
    if (f !== undefined) tilt.setFromAxisAngle(v3.set(Math.cos(turn), 0, Math.sin(turn)), 0.04 * Math.sin(world.time * 18) + 0.12 * f * f);
    const lean = f !== undefined ? tilt : undefined;
    put(s.trunks, X, 0, Z, 3.4 * g + 1, tall * 0.55, 3.4 * g + 1, turn, undefined, lean);
    const green = colour.setHSL(0.24 + hash(t.id, 94) * 0.06, 0.38, 0.27 + hash(t.id, 95) * 0.06).clone();
    // two blobs of leaves: a broad one low, a smaller one on top
    const up = (h: number) => (lean ? v3.set(0, h, 0).applyQuaternion(lean) : v3.set(0, h, 0)).clone();
    const a = up(tall * 0.62);
    put(s.crowns, X + a.x, a.y, Z + a.z, r, r * 0.85, r, turn, green, lean);
    const b = up(tall * 0.86);
    put(s.crowns, X + b.x + r * 0.15, b.y, Z + b.z, r * 0.68, r * 0.62, r * 0.68, turn + 1, green.clone().offsetHSL(0, 0, 0.05), lean);
  }
}

function placePerson(s: NonNullable<typeof world3dScene>, id: number, p: Vec, top: string, skin: string, load: Load | null, dt: number): void {
  const { heading, step, moving } = stepOf(id, p, dt);
  const k = FIGURE_SCALE;
  const X = p.x;
  const Z = -p.y;
  const fx = Math.cos(heading);
  const fz = -Math.sin(heading);
  const swing = moving ? Math.sin(step * 0.28) * 4 * k : 0;
  const bob = moving ? Math.abs(Math.cos(step * 0.28)) * 1.2 * k : 0;
  for (const side of [-1, 1]) {
    const o = side * swing;
    put(s.legs, X + fx * o - fz * side * 2.2 * k, 0, Z + fz * o + fx * side * 2.2 * k, 3 * k, 10 * k, 3.2 * k, heading);
  }
  put(s.bodies, X, 9 * k + bob, Z, 6.5 * k, 18 * k, 6.5 * k, heading, top);
  put(s.heads, X + fx * 0.6 * k, 31 * k + bob, Z + fz * 0.6 * k, 4.4 * k, 4.6 * k, 4.4 * k, heading, skin);
  if (load) put(s.loads, X + fx * 7 * k, 20 * k + bob, Z + fz * 7 * k, 8 * k, 6 * k, 8 * k, heading, RESOURCE_COLOUR[load.resource]);
}

function placeLife(s: NonNullable<typeof world3dScene>, world: World, c: Vec, reach: number, dt: number): void {
  const near = (p: Vec) => Math.abs(p.x - c.x) < reach && Math.abs(p.y - c.y) < reach;
  for (const p of world.people) {
    const o = outfitOf(figureOf(p));
    const b = p.job && getBuilding(world, p.job.buildingId);
    let at: Vec;
    let load: Load | null = null;
    if (p.job && b) {
      const w = p.job.worker;
      if (doorProgress(w) >= 1) {
        walked.delete(p.id); // indoors
        continue;
      }
      at = groundPoint(world, b.x + w.dx, w.y);
      load = w.carrying;
    } else if (!p.job) at = groundPoint(world, p.stroll.x, p.stroll.y);
    else continue;
    if (near(at)) placePerson(s, p.id, at, o.top, o.skin, load, dt);
  }
  for (const a of world.animals) {
    const p = groundPoint(world, a.stroll.x, a.stroll.y);
    if (!near(p)) continue;
    const { heading } = stepOf(-1 - a.id, p, dt);
    const hop = a.stroll.idle <= 0 ? Math.abs(Math.sin(world.time * 8 + a.seed)) * 1.5 : 0;
    const hen = hash(a.seed, 3) < 0.5 ? '#efe9dc' : '#a86a3a';
    put(s.hens, p.x, 4 + hop, -p.y, 5, 4, 3.6, heading, hen);
    put(s.hens, p.x + Math.cos(heading) * 4.5, 8 + hop, -p.y - Math.sin(heading) * 4.5, 2.2, 2.2, 2.2, heading, hen);
  }
}

function placeRider(s: NonNullable<typeof world3dScene>, world: World): Vec {
  const r = world.rider;
  const p = groundPoint(world, r.x, 474);
  const d = (world.streets[streetOf(r.x)] ?? world.streets[0]).dir;
  s.rider.position.set(p.x, 0, -p.y);
  s.rider.rotation.y = Math.atan2(d.y * r.facing, d.x * r.facing);
  const moving = Math.abs(r.vx) > 5;
  s.horseLegs.forEach((leg, i) => (leg.rotation.z = moving ? Math.sin(r.gait / 8 + i * 1.6) * 0.5 : 0));
  s.ring.position.set(p.x, 0.6, -p.y);
  return p;
}

// --- drawing -------------------------------------------------------------------------------

const heights = new Map<string, number>();
/** How tall a building stands (map px), remembered: making its model to measure is slow. */
function heightOf(type: BuildingType, seed: number, size: 1 | 2 | 3): number {
  const key = `${type}|${seed}|${size}`;
  let h = heights.get(key);
  if (h === undefined) heights.set(key, (h = height3d(type, seed, size)));
  return h;
}

const fog = new THREE.Fog(0xb4b99a, 1, 2);

export function drawStrategyView(ctx: Ctx, world: World, v: StrategyView): void {
  world3dScene ??= build();
  const s = world3dScene;
  const dt = lastTime < 0 ? 0 : Math.max(0, Math.min(0.1, world.time - lastTime));
  lastTime = world.time;
  const { dist, pitch } = framing(v.zoom);

  // the rider, and the camera following them: eased, but never left far behind
  const rp = placeRider(s, world);
  if (!target || Math.hypot(rp.x - target.x, rp.y - target.y) > dist * 2) target = { ...rp };
  target.x += (rp.x - target.x) * Math.min(1, dt * 5);
  target.y += (rp.y - target.y) * Math.min(1, dt * 5);
  yawNow = dt ? yawNow + (v.yaw - yawNow) * Math.min(1, dt * 8) : v.yaw;
  aim(target, yawNow, dist, pitch, v.uiW / v.uiH);

  // the land: sharp round the target (a little ahead of it, where the view is), coarse out to the haze
  const f = forwardOf(yawNow);
  const reach = dist * 5;
  refresh(s.near, world, { x: target.x + f.x * dist * 0.4, y: target.y + f.y * dist * 0.4 }, dist * 1.5, v.grid, 0.5);
  refresh(s.far, world, { x: target.x + f.x * dist * 1.5, y: target.y + f.y * dist * 1.5 }, reach, v.grid, 8);
  fog.near = dist * 2;
  fog.far = dist * 4.6;

  // what stands and moves on it
  for (const m of [s.trunks, s.crowns, s.bodies, s.heads, s.legs, s.loads, s.hens]) m.count = 0;
  placeTrees(s, world, target, reach);
  placeLife(s, world, target, Math.min(reach, dist * 3), dt);
  for (const m of [s.trunks, s.crowns, s.bodies, s.heads, s.legs, s.loads, s.hens]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  // the buildings with a model, near enough to be seen
  const items: Top3d[] = [];
  for (const b of world.buildings) {
    if (!hasModel(b.type)) continue;
    const st = world.streets[streetOf(b.x)];
    if (!st) continue;
    const p = mapPoint(world, b.x);
    const back = backOf(st.dir);
    const d = behindRoad(BASE_Y);
    const o = { x: p.x + back.x * d, y: p.y + back.y * d };
    if (Math.abs(o.x - target.x) > reach || Math.abs(o.y - target.y) > reach) continue;
    items.push({ b: building3d(world, b), ox: o.x, oy: o.y, along: st.dir, back });
  }

  const light = lightAt(world);
  drawStrategy3d(ctx, items, s.root, camera, { cx: target.x, cy: target.y, reach: Math.min(3200, dist * 2.2), w: v.uiW, h: v.uiH, px: v.px, phase: light.phase, sunHeight: light.sun, night: light.night, time: world.time, fog });

  // dusk and night over the land, as in the street (sky.ts tintLand)
  ctx.save();
  if (light.dusk > 0) {
    ctx.fillStyle = `rgba(255,130,60,${0.14 * light.dusk})`;
    ctx.fillRect(0, 0, v.uiW, v.uiH);
  }
  if (light.night > 0) {
    ctx.fillStyle = `rgba(10,16,44,${0.55 * light.night})`;
    ctx.fillRect(0, 0, v.uiW, v.uiH);
  }
  ctx.restore();

  drawLabels(ctx, world, items, v, dist);
  if (v.grid && v.hover) drawHoverCell(ctx, v);

  ctx.font = `bold 13px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(243,234,216,0.9)';
  ctx.fillText('Q / E or drag to turn the view · wheel or - + to zoom · Tab, or “Back to the street”, to return', v.uiW / 2, v.uiH - 14);
  ctx.textAlign = 'left';
}

/** Each building's name over its roof, while close enough to read. */
function drawLabels(ctx: Ctx, world: World, items: Top3d[], v: StrategyView, dist: number): void {
  if (dist > 1700) return;
  ctx.save();
  ctx.font = `${dist < 700 ? 13 : 11}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  for (const it of items) {
    const b = getBuilding(world, it.b.id);
    if (!b) continue;
    const top = it.b.build ? 30 : heightOf(it.b.type, it.b.seed, it.b.size);
    // over the middle of its lot
    const f = footprintOf(b);
    const depth = f ? (rowNear(f.j0) + rowFar(f.j1)) / 2 - behindRoad(BASE_Y) : CELL_W;
    const at = toScreen(new THREE.Vector3(it.ox + it.back.x * depth, top + 14, -(it.oy + it.back.y * depth)), v.uiW, v.uiH);
    if (!at || at[0] < -50 || at[0] > v.uiW + 50 || at[1] < 0 || at[1] > v.uiH) continue;
    const name = BUILDINGS[b.type].name + (b.status === 'done' ? '' : ' (building)');
    ctx.strokeStyle = 'rgba(20,14,8,0.75)';
    ctx.strokeText(name, at[0], at[1]);
    ctx.fillStyle = '#f6ecd4';
    ctx.fillText(name, at[0], at[1]);
  }
  ctx.restore();
}

/** With the grid on: the cell under the mouse outlined on the ground, and its name. */
function drawHoverCell(ctx: Ctx, v: StrategyView): void {
  const h = v.hover!;
  const p = groundUnder(h.x, h.y, v.uiW, v.uiH);
  if (!p) return;
  const c = Math.floor(p.x / CELL_W);
  const r = Math.floor(p.y / CELL_W);
  const corners = [
    [c, r],
    [c + 1, r],
    [c + 1, r + 1],
    [c, r + 1],
  ].map(([i, j]) => toScreen(new THREE.Vector3(i * CELL_W, 0, -j * CELL_W), v.uiW, v.uiH));
  if (corners.some((k) => !k)) return;
  ctx.save();
  ctx.beginPath();
  corners.forEach((k, i) => (i ? ctx.lineTo(k![0], k![1]) : ctx.moveTo(k![0], k![1])));
  ctx.closePath();
  ctx.strokeStyle = '#fff4dc';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const name = cellName(c, r);
  ctx.font = 'bold 11px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  const w = ctx.measureText(name).width + 8;
  ctx.fillStyle = 'rgba(30,22,12,0.7)';
  ctx.fillRect(h.x - w / 2, h.y - 26, w, 15);
  ctx.fillStyle = '#fff4dc';
  ctx.fillText(name, h.x, h.y - 15);
  ctx.restore();
}
