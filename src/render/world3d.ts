// Buildings in real-time 3D (WebGL, three.js), seen through the game's own
// camera: the pinhole camera of plane.ts, the drawing camera's distance (ground.ts) in front of the building
// line at the height that puts the horizon at HORIZON_Y. A building on the
// building line comes out exactly where its 2D art would, and as the camera
// moves with the rider it is seen from the side: left of the view, its right
// side shows. The sun follows the game's clock, so shading and cast shadows
// move through the day.
//
// The buildings are generated here, piece by piece (build3d/): no model files.
// Each building's seed varies its stones and boards, and each look (finished,
// Large, a construction stage, its door open) is merged into one mesh per
// material, so a farm draws in about ten calls. The 3D image of this street's
// buildings is rendered offscreen and composited into the 2D frame at the
// building pass (scene.ts), so 2D people still pass in front of and behind it.

import * as THREE from 'three';
import type { BuildingType } from '../game/buildings';
import type { ConstructionStage } from '../game/world';
import type { Element, Vec3 } from './build3d/elements';
import { farm, farmPoints } from './build3d/farm';
import { type Look as MeshLook, mergedByMaterial } from './build3d/geometry';
import { cameraDistance, cameraHeight, viewHorizon } from './ground';
import type { Ctx } from './util';

/** Units per metre (ASSET_SPEC §1): models are in metres, the game in world units. */
const U = 20;

/** What can be built in 3D: its pieces for a seed, and its named points (model space, metres). */
const GENERATORS: Partial<Record<BuildingType, { elements: (seed: number) => Element[]; points: Record<string, Vec3> }>> = {
  farm: { elements: farm, points: farmPoints() },
};

/** A 3D model's named points (model space, metres), or undefined for a type drawn in 2D: tests hold its `door` to BuildingDef.door. */
export function points3d(type: BuildingType): Record<string, Vec3> | undefined {
  return GENERATORS[type]?.points;
}

let enabled = false;

/** Draw buildings that have a generator in 3D (true) or keep everything 2D (false). */
export function set3d(on: boolean): void {
  enabled = on;
}

export function has3d(type: BuildingType): boolean {
  return enabled && !!GENERATORS[type];
}

const heights = new Map<BuildingType, number>();

/** How tall a 3D building stands (world units, its highest piece in any look), for labels above it. */
export function height3d(type: BuildingType): number {
  let h = heights.get(type);
  if (h === undefined) {
    h = Math.max(...GENERATORS[type]!.elements(7).map((e) => (e.shape === 'roof' || e.shape === 'leanto' || e.shape === 'gable' ? e.params.maxZ : e.at[2] + e.size[2] / 2))) * U;
    heights.set(type, h);
  }
  return h;
}

// --- materials ---------------------------------------------------------------------

interface Look {
  color: [number, number, number];
  rough: number;
  /** Surface noise: scale per axis (1/m, model x, y-up, z) and how much it darkens. */
  noise: [number, number, number];
  amp: number;
  emissive?: [number, number, number];
}

/** The building generator's material library (tools/building-gen/blender/materials.py), as base colours (linear). */
const LOOKS: Record<string, Look> = {
  oak: { color: [0.1, 0.07, 0.048], rough: 0.8, noise: [1.5, 20, 20], amp: 0.35 },
  daub: { color: [0.74, 0.69, 0.58], rough: 0.92, noise: [2.5, 2.5, 2.5], amp: 0.18 },
  fieldstone: { color: [0.24, 0.21, 0.17], rough: 0.9, noise: [6, 6, 6], amp: 0.45 },
  'clay-stone': { color: [0.26, 0.22, 0.18], rough: 0.9, noise: [6, 6, 6], amp: 0.4 },
  thatch: { color: [0.47, 0.34, 0.14], rough: 1, noise: [60, 3, 3], amp: 0.4 },
  planks: { color: [0.18, 0.13, 0.08], rough: 0.8, noise: [20, 1.5, 20], amp: 0.3 },
  boards: { color: [0.22, 0.18, 0.14], rough: 0.8, noise: [20, 1.5, 20], amp: 0.3 },
  shingles: { color: [0.15, 0.13, 0.1], rough: 0.85, noise: [9, 9, 9], amp: 0.35 },
  pole: { color: [0.2, 0.14, 0.08], rough: 0.8, noise: [10, 2, 10], amp: 0.2 },
  rope: { color: [0.4, 0.33, 0.2], rough: 0.9, noise: [1, 1, 1], amp: 0 },
  doorway: { color: [0.008, 0.006, 0.005], rough: 1, noise: [1, 1, 1], amp: 0 },
  window: { color: [0.012, 0.01, 0.008], rough: 1, noise: [1, 1, 1], amp: 0, emissive: [1, 0.42, 0.12] },
};

/** Night windows: shared so the frame can turn them up at dusk. */
const lit: THREE.MeshStandardMaterial[] = [];

const materials = new Map<string, THREE.MeshStandardMaterial>();

/** The material of that name, shared by every building: base colour × each piece's vertex colour, with surface noise. */
function material(name: string): THREE.MeshStandardMaterial {
  const known = materials.get(name);
  if (known) return known;
  const look = LOOKS[name] ?? LOOKS.planks;
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(...look.color), roughness: look.rough, metalness: 0, vertexColors: true });
  if (look.emissive) {
    m.emissive = new THREE.Color(...look.emissive);
    m.emissiveIntensity = 0;
    lit.push(m);
  }
  if (look.amp > 0) {
    // value noise in model space breaks up flat colour: grain along timbers, strands down the thatch
    const scale = new THREE.Vector3(...look.noise);
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uNoiseScale = { value: scale };
      shader.uniforms.uNoiseAmp = { value: look.amp };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vModelPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvModelPos = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vModelPos;
uniform vec3 uNoiseScale; uniform float uNoiseAmp;
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
vec3 q = vModelPos * uNoiseScale;
float n = 0.6 * vnoise(q) + 0.3 * vnoise(q * 2.7) + 0.1 * vnoise(q * 7.1);
diffuseColor.rgb *= 1.0 - uNoiseAmp * (n - 0.35);`,
        );
    };
    m.customProgramCacheKey = () => `vn-${look.noise.join(',')}`;
  }
  materials.set(name, m);
  return m;
}

// --- what a building shows ------------------------------------------------------------

export interface Building3d {
  id: number;
  type: BuildingType;
  /** Varies its stones, boards and colours. */
  seed: number;
  /** World x of its plot centre. */
  x: number;
  upgraded: boolean;
  /** Under construction: the stage reached; undefined when finished. */
  stage?: Exclude<ConstructionStage, 'done'>;
  /** State parts to show (doorOpen while someone steps through the door). */
  parts: string[];
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
  sun.shadow.normalBias = 1.2;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  sky = new THREE.HemisphereLight(new THREE.Color().setRGB(0.78, 0.8, 0.88), new THREE.Color().setRGB(0.42, 0.36, 0.24), 1.1);
  scene.add(sky);

  // the ground takes the shadows only; the 2D land under it shows through
  groundShadow = new THREE.ShadowMaterial({ opacity: 0.38, color: 0x1a1408 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), groundShadow);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

interface Built {
  seed: number;
  elements: Element[];
  looks: Map<string, THREE.Group>;
}
const built = new Map<number, Built>();

/** The building's group for its current look, built (and merged) the first time it is needed. */
function lookOf(b: Building3d): THREE.Group {
  let bt = built.get(b.id);
  if (!bt || bt.seed !== b.seed) {
    bt = { seed: b.seed, elements: GENERATORS[b.type]!.elements(b.seed), looks: new Map() };
    built.set(b.id, bt);
  }
  const look: MeshLook = { variant: b.upgraded ? 'upgraded' : 'default', stage: b.stage, parts: b.parts };
  const key = `${look.variant}|${look.stage ?? ''}|${[...look.parts].sort().join()}`;
  let g = bt.looks.get(key);
  if (!g) {
    g = new THREE.Group();
    for (const [name, geo] of mergedByMaterial(bt.elements, look)) {
      const mesh = new THREE.Mesh(geo, material(name));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    g.scale.setScalar(U); // metres -> world units
    bt.looks.set(key, g);
  }
  return g;
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
}

/**
 * The screen y (world units) of a 3D building's footprint where it comes nearest the camera: how it
 * sorts among 2D people and pictures (scene.ts), so one reaching towards the camera is drawn after
 * whatever stands behind its near end.
 */
export function nearestFootY(b: Building3d, v: View3d): number {
  const g = lookOf(b);
  g.position.set(b.at?.x ?? b.x, 0, b.at?.z ?? 0);
  g.rotation.y = b.at?.rot ?? 0;
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
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

/**
 * Render these buildings and draw the image into ctx (under its world
 * transform). Returns where each building's named points came out on screen.
 */
export function draw3d(ctx: Ctx, buildings: Building3d[], v: View3d, opts: { clip?: boolean } = {}): Map<number, (name: string) => [number, number] | null> {
  const out = new Map<number, (name: string) => [number, number] | null>();
  if (!buildings.length) return out;
  if (!renderer) setup();
  const r = renderer!;
  const w = Math.max(1, Math.round(v.viewW * v.pxPerU));
  const h = Math.max(1, Math.round((v.bottom - v.top) * v.pxPerU));
  const size = r.getSize(new THREE.Vector2());
  if (size.x !== w || size.y !== h) r.setSize(w, h, false);

  // the game's camera: at the middle of the view, EYE_DIST in front of the building line, looking level
  const cx = v.camX + v.viewW / 2;
  const cam = cameraDistance();
  camera.matrixWorld.makeTranslation(cx, cameraHeight(), cam);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const near = 20;
  const f = cam;
  camera.projectionMatrix.makePerspective(
    (near * (0 - v.viewW / 2)) / f,
    (near * (v.viewW - v.viewW / 2)) / f,
    (near * (viewHorizon() - v.top)) / f,
    (near * (viewHorizon() - v.bottom)) / f,
    near,
    30000,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

  // the sun crosses from left (morning) to right (evening) as the 2D sky draws it, a little towards the viewer
  const across = (v.phase - 0.25) / 0.5; // 0 at sunrise … 1 at sunset
  // it never stands overhead (at most ~45°) and leans towards the viewer, so fronts stay sunlit (the AoE2 look)
  const az = Math.PI * (1 - across); // π: from the left, 0: from the right
  // no lower than ~12°: shadows fade out before they'd stretch across the land (see below)
  const elev = THREE.MathUtils.degToRad(12 + 33 * THREE.MathUtils.clamp(v.sunHeight, 0, 1));
  const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), 0.55 * Math.cos(elev) + 0.35).normalize();
  const day = THREE.MathUtils.smoothstep(v.sunHeight, -0.05, 0.25);
  sun.intensity = 3.2 * day;
  // shadows only while the sun is well up: they fade as it nears the horizon and are gone at sunset
  const shadows = THREE.MathUtils.smoothstep(v.sunHeight, 0.06, 0.3);
  sun.castShadow = shadows > 0.01;
  groundShadow.opacity = 0.38 * shadows;
  sun.color.setRGB(1, 0.72 + 0.16 * Math.min(1, v.sunHeight * 2), 0.5 + 0.22 * Math.min(1, v.sunHeight * 2));
  sky.intensity = 0.35 + 0.8 * day;
  sun.position.set(cx + dir.x * 3000, dir.y * 3000, dir.z * 3000);
  sun.target.position.set(cx, 0, 0);
  const sc = sun.shadow.camera;
  const reach = v.viewW / 2 + 500;
  sc.left = -reach;
  sc.right = reach;
  sc.top = reach;
  sc.bottom = -reach;
  sc.near = 100;
  sc.far = 7000;
  sc.updateProjectionMatrix();
  // windows light up as it gets dark (brighter than they look: the land tint dims them again)
  for (const m of lit) m.emissiveIntensity = 6 * v.night;

  const shown = new Set<THREE.Object3D>();
  for (const b of buildings) {
    const g = lookOf(b);
    g.position.set(b.at?.x ?? b.x, 0, b.at?.z ?? 0);
    g.rotation.y = b.at?.rot ?? 0;
    if (g.parent !== scene) scene.add(g);
    shown.add(g);
    const points = GENERATORS[b.type]!.points;
    out.set(b.id, (name) => {
      const p = points[name];
      // model space (x, y back, z up), metres -> world (x, y up, z towards the camera)
      return p ? project(new THREE.Vector3(b.x + p[0] * U, p[2] * U, -p[1] * U), v) : null;
    });
  }
  for (const c of [...scene.children]) if (c instanceof THREE.Group && !shown.has(c)) c.removeFromParent();

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
