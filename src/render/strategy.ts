// The strategy view (Tab): the village in 3D, looked down on at an angle by a
// camera that moves freely over it (the app moves it: WASD, a drag) and turns
// about the spot it looks at (Q / E, a right drag), like a strategy game. Zoomed
// out it looks down more steeply and sees further.
//
// Building from here: the chosen building follows the mouse as a ghost, set on
// the lots of the street its door would face (game/world.ts planAt), green where
// it can go and red where not, its door marked and an arrow pointing to its
// road. A planned site shows its outline as a blueprint until it is built.
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
import { BUILDINGS, doorOf, type BuildingType } from '../game/buildings';
import { buildShortfall } from '../game/economy';
import { cellName, footprintAt, footprintOf } from '../game/grid';
import { BASE_Y, behindRoad, CELL_W, rowFar, rowNear } from '../game/layout';
import { treeGrowth } from '../game/nature';
import type { Load } from '../game/resources';
import { backOf, groundPoint, mapPoint, streetOf, streetStart, type Vec, streetAt } from '../game/streets';
import { buildingOn, FACINGS, getBuilding, planAt, type World } from '../game/world';
import { outdoors } from '../game/people';
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
  /** The map point the camera looks at (the app moves it), the view's own zoom (1 by default) and its turn about that point (radians, 0 looking north). */
  center: Vec;
  zoom: number;
  yaw: number;
  grid: boolean;
  /** The mouse in UI units, if over the canvas (on a touch screen, the last tap). */
  hover: { x: number; y: number } | null;
  /** The building being placed, and which of FACINGS its door faces. */
  ghost: { type: BuildingType; facing: number } | null;
  /** The bottom line: how to move the view, or how to place the ghost. */
  hint: string;
}

// --- the camera -------------------------------------------------------------------------------

const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 60000);
/** Where the camera looks (map), and its turn, eased towards the asked turn. */
let target: Vec = { x: 0, y: 0 };
let yawNow = 0;
let lastTime = -1;
/** The screen (UI units) the camera last drew, for strategyGround. */
let screenW = 1;
let screenH = 1;

/** The camera's distance from the point it looks at, at a zoom (map px). */
export const strategyDistance = (zoom: number) => framing(zoom).dist;

/** The map point on the ground under a screen point (UI units) in the strategy view as last drawn. */
export const strategyGround = (x: number, y: number): Vec | null => groundUnder(x, y, screenW, screenH);

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

/** The map point under a screen point (UI units) at height h above the ground (the ground itself by default), if it is there. */
function groundUnder(x: number, y: number, w: number, h: number, height = 0): Vec | null {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, 1 - (y / h) * 2), camera);
  const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -height), new THREE.Vector3());
  return hit ? { x: hit.x, y: -hit.z } : null;
}

/**
 * What is under a screen point (UI units) in the strategy view as last drawn: going down the line of
 * sight from above the roofs, the first point within a building's walls (its lot, up to its height),
 * else the ground there. A map point on that building's land, or on the ground.
 */
export function strategyPick(world: World, x: number, y: number): Vec | null {
  for (let h = 150; h > 0; h -= 6) {
    const p = groundUnder(x, y, screenW, screenH, h);
    const b = p && buildingOn(world, p, false);
    if (!b) continue;
    // (a site as tall as its blueprint)
    const tall = b.type === 'road' || b.type === 'intersection' ? 4 : heightOf(b.type, 7, b.size ?? 1);
    if (h <= tall) return p;
  }
  return strategyGround(x, y);
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
  ghost: Ghost;
  plans: Ghost[];
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
  const ghost = makeGhost('ghost');
  root.add(ghost.group);
  return { root, near, far, trunks, crowns, bodies, heads, legs, loads, hens, rider, horseLegs, ring, ghost, plans: [] };
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
    } else if (!p.job && outdoors(p)) at = groundPoint(world, p.stroll.x, p.stroll.y);
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
  const d = (streetAt(world, streetOf(r.x)) ?? world.streets[0]).dir;
  s.rider.position.set(p.x, 0, -p.y);
  s.rider.rotation.y = Math.atan2(d.y * r.facing, d.x * r.facing);
  const moving = Math.abs(r.vx) > 5;
  s.horseLegs.forEach((leg, i) => (leg.rotation.z = moving ? Math.sin(r.gait / 8 + i * 1.6) * 0.5 : 0));
  s.ring.position.set(p.x, 0.6, -p.y);
  return p;
}


// --- the ghost of a building being placed, and the blueprints of planned sites ------------------

/** A box of walls with a gable roof, outlined, plus its door and an arrow from the door to the road. */
interface Ghost {
  group: THREE.Group;
  body: THREE.Mesh;
  roof: THREE.Mesh;
  bodyEdges: THREE.LineSegments;
  roofEdges: THREE.LineSegments;
  door: THREE.Mesh;
  arrow: THREE.Mesh;
  fill: THREE.MeshBasicMaterial;
  line: THREE.LineBasicMaterial;
}

/** A gable roof over x −½..½, z 0..1, from y 0 at the eaves to 1 at the ridge (along x). */
function roofGeometry(): THREE.BufferGeometry {
  const v = (x: number, y: number, z: number) => [x, y, z];
  const a = v(-0.5, 0, 0), b = v(0.5, 0, 0), c = v(0.5, 0, 1), d = v(-0.5, 0, 1), e = v(-0.5, 1, 0.5), f = v(0.5, 1, 0.5);
  const tris = [a, b, f, a, f, e, d, e, f, d, f, c, a, e, d, b, c, f, a, d, c, a, c, b];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

/** An arrow lying flat, pointing towards −z from z 0, a unit long. */
function arrowGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  [[-0.18, 0], [0.18, 0], [0.18, -0.55], [0.42, -0.55], [0, -1], [-0.42, -0.55], [-0.18, -0.55]].forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  // the shape is drawn in x / y; laid on the ground its y becomes z
  return new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
}

function makeGhost(kind: 'ghost' | 'plan'): Ghost {
  const ghost = kind === 'ghost';
  const fill = new THREE.MeshBasicMaterial({ color: '#7fe08a', transparent: true, opacity: ghost ? 0.38 : 0.1, depthWrite: false, side: THREE.DoubleSide });
  const line = new THREE.LineBasicMaterial({ color: ghost ? '#eaffea' : '#cfe6ff', transparent: true, opacity: ghost ? 0.9 : 0.75, depthWrite: false });
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0.5);
  const roofGeo = roofGeometry();
  const body = new THREE.Mesh(box, fill);
  const roof = new THREE.Mesh(roofGeo, fill);
  const bodyEdges = new THREE.LineSegments(new THREE.EdgesGeometry(box), line);
  const roofEdges = new THREE.LineSegments(new THREE.EdgesGeometry(roofGeo), line);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: '#ffd76a', transparent: true, opacity: ghost ? 0.95 : 0.6, depthWrite: false }));
  const arrow = new THREE.Mesh(arrowGeometry(), new THREE.MeshBasicMaterial({ color: '#ffd76a', transparent: true, opacity: ghost ? 0.9 : 0.45, depthWrite: false, side: THREE.DoubleSide }));
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  group.add(body, roof, bodyEdges, roofEdges, door, arrow);
  group.traverse((o) => (o.renderOrder = ghost ? 6 : 5));
  group.visible = false;
  return { group, body, roof, bodyEdges, roofEdges, door, arrow, fill, line };
}

/** Where and how big a ghost stands: its middle on the road (map), the way along its street and back from it, and its box in those terms (px). */
interface GhostPose {
  o: Vec;
  along: Vec;
  back: Vec;
  /** Along: −w/2..w/2; back from the middle of the road: z0..z1; walls h high under a roof r high. */
  w: number;
  z0: number;
  z1: number;
  h: number;
  r: number;
  /** The door along its front (px from the middle), if it has one. */
  door: number | null;
}

const basis = new THREE.Matrix4();
function poseGhost(g: Ghost, p: GhostPose, colour: string): void {
  basis.makeBasis(v3.set(p.along.x, 0, -p.along.y), UP, s3.set(p.back.x, 0, -p.back.y));
  basis.setPosition(p.o.x, 0, -p.o.y);
  g.group.matrix.copy(basis);
  g.group.matrixWorldNeedsUpdate = true;
  const d = p.z1 - p.z0;
  for (const m of [g.body, g.bodyEdges]) {
    m.scale.set(p.w, p.h, d);
    m.position.set(0, 0, p.z0);
  }
  for (const m of [g.roof, g.roofEdges]) {
    m.visible = p.r > 0;
    m.scale.set(p.w, p.r, d);
    m.position.set(0, p.h, p.z0);
  }
  const at = p.door ?? 0;
  g.door.visible = p.door !== null && p.h > 10;
  g.door.scale.set(12, Math.min(22, p.h * 0.8), 3);
  g.door.position.set(at, 0, p.z0 - 0.5);
  // the arrow from the door across the grass to the road
  const reach = Math.max(14, Math.min(p.z0 - 4, 34));
  g.arrow.visible = p.h > 10;
  g.arrow.scale.set(22, 1, reach);
  g.arrow.position.set(at, 1.2, p.z0 - 2);
  g.fill.color.set(colour);
  g.group.visible = true;
}

/** The pose of a building of this type and size standing at world x (as footprintAt lays it out). */
function poseAt(world: World, type: BuildingType, x: number, size: 1 | 2 | 3 = 1): GhostPose | null {
  const st = streetAt(world, streetOf(x));
  if (!st) return null;
  const f = footprintAt(type, x, size);
  const start = streetStart(st.index);
  const mid = start + ((f.i0 + f.i1 + 1) / 2) * CELL_W;
  const flat = type === 'road' || type === 'intersection';
  const tall = flat ? 3 : Math.min(140, heightOf(type, 7, size));
  const door = doorOf(type, size);
  return {
    o: mapPoint(world, mid),
    along: st.dir,
    back: backOf(st.dir),
    w: (f.i1 - f.i0 + 1) * CELL_W,
    z0: (f.j0 - 0.5) * CELL_W,
    z1: (f.j1 + 0.5) * CELL_W,
    h: flat ? 3 : tall * 0.55,
    r: flat ? 0 : tall * 0.45,
    door: flat ? null : door ? x + door.dx - mid : 0,
  };
}

/** What the ghost under the mouse says: where it would go, and why it can't, if it can't. */
interface GhostAt {
  type: BuildingType;
  at: Vec;
  why: string | null;
}

/** Pose the ghost where the mouse points: on the lots it would face, or loose on the land when no road is that way. */
function placeGhost(s: NonNullable<typeof world3dScene>, world: World, v: StrategyView): GhostAt | null {
  s.ghost.group.visible = false;
  if (!v.ghost || !v.hover) return null;
  const p = groundUnder(v.hover.x, v.hover.y, v.uiW, v.uiH);
  if (!p) return null;
  const { type, facing } = v.ghost;
  const plan = planAt(world, type, p, facing);
  if (plan) {
    const pose = poseAt(world, type, plan.x);
    if (!pose) return null;
    const lack = buildShortfall(world, type);
    const why = plan.why ?? (Object.keys(lack).length ? `Not enough ${Object.keys(lack).join(' and ')}` : null);
    poseGhost(s.ghost, pose, why ? '#e8604c' : '#7fe08a');
    return { type, at: p, why };
  }
  // no road this way: the ghost stands loose where the mouse is, its door the way it is turned
  const f = FACINGS[facing];
  const back = { x: -f.x, y: -f.y };
  const pose = poseAt(world, type, 0) ?? null;
  if (!pose) return null;
  const depth = pose.z1 - pose.z0;
  pose.along = { x: back.y, y: -back.x };
  pose.back = back;
  pose.o = { x: p.x - back.x * (pose.z0 + depth / 2), y: p.y - back.y * (pose.z0 + depth / 2) };
  poseGhost(s.ghost, pose, '#e8604c');
  return { type, at: p, why: 'Its door must face a road: move it next to one, or turn it with R' };
}

/** A blueprint over every planned site near the view, until it is built. */
function placePlans(s: NonNullable<typeof world3dScene>, world: World, c: Vec, reach: number): void {
  let n = 0;
  for (const b of world.buildings) {
    if (b.status !== 'constructing') continue;
    const p = mapPoint(world, b.x);
    if (Math.abs(p.x - c.x) > reach || Math.abs(p.y - c.y) > reach) continue;
    const pose = poseAt(world, b.type, b.x, b.size ?? 1);
    if (!pose) continue;
    if (!s.plans[n]) {
      s.plans[n] = makeGhost('plan');
      s.root.add(s.plans[n].group);
    }
    poseGhost(s.plans[n++], pose, '#9cc8ff');
  }
  for (let i = n; i < s.plans.length; i++) s.plans[i].group.visible = false;
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

  // the rider where they stand, and the camera where the app has moved it
  placeRider(s, world);
  target = { ...v.center };
  yawNow = dt ? yawNow + (v.yaw - yawNow) * Math.min(1, dt * 8) : v.yaw;
  aim(target, yawNow, dist, pitch, v.uiW / v.uiH);
  screenW = v.uiW;
  screenH = v.uiH;

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

  placePlans(s, world, target, reach);
  const ghost = placeGhost(s, world, v);

  // the buildings with a model, near enough to be seen
  const items: Top3d[] = [];
  for (const b of world.buildings) {
    if (!hasModel(b.type)) continue;
    const st = streetAt(world, streetOf(b.x));
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
  if (ghost && v.hover) drawGhostLabel(ctx, ghost, v.hover);

  if (v.hint) {
    ctx.font = `bold 13px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(243,234,216,0.9)';
    ctx.fillText(v.hint, v.uiW / 2, v.uiH - 14);
    ctx.textAlign = 'left';
  }
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
    if (b.status === 'constructing') {
      // how far it is built
      ctx.fillStyle = 'rgba(30,22,12,0.75)';
      ctx.fillRect(at[0] - 36, at[1] + 5, 72, 7);
      ctx.fillStyle = '#f2cf6a';
      ctx.fillRect(at[0] - 35, at[1] + 6, 70 * b.progress, 5);
    }
  }
  ctx.restore();
}

/** By the mouse: the building being placed, and why it can't go there (or that a click places it). */
function drawGhostLabel(ctx: Ctx, g: GhostAt, at: { x: number; y: number }): void {
  const name = BUILDINGS[g.type].name;
  const line = g.why ?? 'Click to plan it here · R to turn it';
  ctx.save();
  ctx.font = `bold 13px ${SERIF}`;
  const w = Math.max(ctx.measureText(name).width, (ctx.font = `12px ${SERIF}`, ctx.measureText(line).width)) + 16;
  const x = at.x + 18;
  const y = at.y + 18;
  ctx.fillStyle = 'rgba(30,22,12,0.78)';
  ctx.fillRect(x, y, w, 38);
  ctx.textAlign = 'left';
  ctx.font = `bold 13px ${SERIF}`;
  ctx.fillStyle = '#f2cf6a';
  ctx.fillText(name, x + 8, y + 15);
  ctx.font = `12px ${SERIF}`;
  ctx.fillStyle = g.why ? '#f0a08a' : '#d6f0c8';
  ctx.fillText(line, x + 8, y + 31);
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
