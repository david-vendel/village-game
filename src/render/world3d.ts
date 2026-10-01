// Buildings in real-time 3D (WebGL, three.js), seen through the game's own
// camera: the pinhole camera of plane.ts, EYE_DIST in front of the building
// line at the height that puts the horizon at HORIZON_Y. A building on the
// building line comes out exactly where its 2D art would, and as the camera
// moves with the rider it is seen from the side: left of the view, its right
// side shows. The sun follows the game's clock, so shading and cast shadows
// move through the day.
//
// Models are glTF files exported from the building generator
// (tools/art-pipeline/export_gltf.py): every mesh carries its tags (stage:,
// scaffold, variant:, novariant:, part:) and a random number. The 3D image of
// this street's buildings is rendered offscreen and composited into the 2D
// frame at the building pass (scene.ts), so 2D people still pass in front of
// and behind it.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BuildingType } from '../game/buildings';
import { BASE_Y, EYE_DIST, HORIZON_Y } from '../game/layout';
import type { ConstructionStage } from '../game/world';
import type { Ctx } from './util';

/** Units per metre (ASSET_SPEC §1): models are in metres, the game in world units. */
const U = 20;
/** The camera's height above the ground: the span from the horizon to the building line, seen EYE_DIST away. */
const EYE_H = BASE_Y - HORIZON_Y;

const MODELS: Partial<Record<BuildingType, string>> = { farm: 'models/building.farm.glb' };

interface Model {
  scene: THREE.Group;
  /** Named points (point:door …) in model space, metres. */
  points: Record<string, THREE.Vector3>;
}

const models = new Map<BuildingType, Model>();
let enabled = false;

export async function load3d(root = ''): Promise<void> {
  const loader = new GLTFLoader();
  const loaded = await Promise.all(
    Object.entries(MODELS).map(async ([type, path]) => {
      try {
        const gltf = await loader.loadAsync(root + path);
        return [type as BuildingType, prepare(gltf.scene)] as const;
      } catch {
        return null;
      }
    }),
  );
  for (const m of loaded) if (m) models.set(m[0], m[1]);
  enabled = models.size > 0;
}

export function has3d(type: BuildingType): boolean {
  return enabled && models.has(type);
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

function material(name: string, rand: number): THREE.MeshStandardMaterial {
  const look = LOOKS[name.replace(/\.\d+$/, '')] ?? LOOKS.planks;
  const k = 0.88 + 0.24 * rand; // each piece a little lighter or darker
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(look.color[0] * k, look.color[1] * k * (0.98 + 0.04 * rand), look.color[2] * k),
    roughness: look.rough,
    metalness: 0,
  });
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
      shader.uniforms.uSeed = { value: rand * 100 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vModelPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvModelPos = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vModelPos;
uniform vec3 uNoiseScale; uniform float uNoiseAmp; uniform float uSeed;
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
vec3 q = vModelPos * uNoiseScale + uSeed;
float n = 0.6 * vnoise(q) + 0.3 * vnoise(q * 2.7) + 0.1 * vnoise(q * 7.1);
diffuseColor.rgb *= 1.0 - uNoiseAmp * (n - 0.35);`,
        );
    };
    m.customProgramCacheKey = () => `vn-${look.noise.join(',')}`;
  }
  return m;
}

/** Give a loaded model the game's materials, shadows and tags. */
function prepare(scene: THREE.Group): Model {
  const points: Record<string, THREE.Vector3> = {};
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    // named points (the exporter puts the name in the extras: three.js strips ':' from node names)
    const point = (o.userData as { point?: string }).point;
    if (point) points[point] = o.getWorldPosition(new THREE.Vector3());
    if (!(o instanceof THREE.Mesh)) return;
    const extras = o.userData as { tags?: string; rand?: number };
    const name = Array.isArray(o.material) ? o.material[0].name : o.material.name;
    o.material = material(name, extras.rand ?? 0.5);
    o.castShadow = true;
    o.receiveShadow = true;
    o.userData.tagList = (extras.tags ?? '').split(',').filter(Boolean);
  });
  return { scene, points };
}

// --- what a building shows ------------------------------------------------------------

export interface Building3d {
  id: number;
  type: BuildingType;
  /** World x of its plot centre. */
  x: number;
  upgraded: boolean;
  /** Under construction: the stage reached; undefined when finished. */
  stage?: Exclude<ConstructionStage, 'done'>;
  /** State parts to show (doorOpen while someone steps through the door). */
  parts: string[];
}

const STAGES = ['staking', 'foundation', 'frame', 'walls', 'roof'];

/** The harness's visibility rule (tools/art-pipeline/harness/blender_render.py `visible`). */
function visible(tags: string[], b: Building3d): boolean {
  const variant = b.stage ? 'default' : b.upgraded ? 'upgraded' : 'default';
  let stage: string | undefined;
  for (const t of tags) {
    const [k, v] = t.split(':');
    if (k === 'variant' && v !== variant) return false;
    if (k === 'novariant' && v === variant) return false;
    if (k === 'part') return b.parts.includes(v);
    if (k === 'stage') stage = v;
  }
  if (b.stage) return stage === undefined || STAGES.indexOf(stage) <= STAGES.indexOf(b.stage);
  return !tags.includes('scaffold');
}

// --- the renderer -------------------------------------------------------------------------

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let sun: THREE.DirectionalLight;
let sky: THREE.HemisphereLight;
let groundShadow: THREE.ShadowMaterial;
const instances = new Map<number, THREE.Group>();

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

function instance(b: Building3d): THREE.Group {
  let g = instances.get(b.id);
  if (!g) {
    const model = models.get(b.type)!;
    g = model.scene.clone(true);
    // metres → world units; the model's front (+Z after glTF) faces the camera
    g.scale.setScalar(U);
    instances.set(b.id, g);
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

/** World point (x along the street, y up, z towards the camera from the building line) → screen point in world units. */
function project(p: THREE.Vector3, v: View3d): [number, number] {
  const cx = v.camX + v.viewW / 2;
  const z = EYE_DIST - p.z;
  return [v.viewW / 2 + ((p.x - cx) * EYE_DIST) / z, HORIZON_Y + ((EYE_H - p.y) * EYE_DIST) / z];
}

/**
 * Render these buildings and draw the image into ctx (under its world
 * transform). Returns where each building's named points came out on screen.
 */
export function draw3d(ctx: Ctx, buildings: Building3d[], v: View3d): Map<number, (name: string) => [number, number] | null> {
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
  camera.matrixWorld.makeTranslation(cx, EYE_H, EYE_DIST);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const near = 20;
  const f = EYE_DIST;
  camera.projectionMatrix.makePerspective(
    (near * (0 - v.viewW / 2)) / f,
    (near * (v.viewW - v.viewW / 2)) / f,
    (near * (HORIZON_Y - v.top)) / f,
    (near * (HORIZON_Y - v.bottom)) / f,
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
    const g = instance(b);
    g.position.set(b.x, 0, 0);
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.visible = visible(o.userData.tagList as string[], b);
    });
    if (!g.parent) scene.add(g);
    shown.add(g);
    const model = models.get(b.type)!;
    out.set(b.id, (name) => {
      const p = model.points[name];
      return p ? project(new THREE.Vector3(b.x + p.x * U, p.y * U, p.z * U), v) : null;
    });
  }
  for (const g of instances.values()) if (!shown.has(g)) g.removeFromParent();

  r.render(scene, camera);
  ctx.drawImage(r.domElement, 0, v.top, v.viewW, v.bottom - v.top);
  return out;
}
