// One material library for every building, so they all sit in the same light
// and read as one village: each material a base colour (sRGB), roughness, a
// surface noise that breaks up flat colour (grain, strands of thatch, the
// mottling of stone), and how it weathers with age: roofs grow moss on their
// upper faces and darken, timber greys, walls take rising damp at their foot
// and rain streaks. Glass, lamps, the rooms inside and fires glow with the
// building's own light and fire (set per building each frame).

import * as THREE from 'three';
import type { Style } from './style';

export type Weather = 'none' | 'roof' | 'wood' | 'wall';

export interface MatDef {
  color: string;
  rough: number;
  metal?: number;
  /** Surface noise: scale per axis (1/m, three.js axes: x along, y up, z towards the camera) and how much it darkens. */
  noise?: [number, number, number];
  amp?: number;
  weather?: Weather;
  /** Glows: by the building's light (glass, lamps, the rooms inside) or its fire (coals, an oven's mouth). */
  glow?: { by: 'light' | 'fire'; color: string; k: number };
}

const WOOD_NOISE: [number, number, number] = [9, 9, 9];

export const MATERIALS: Record<string, MatDef> = {
  oak: { color: '#5b4331', rough: 0.85, noise: WOOD_NOISE, amp: 0.3, weather: 'wood' },
  'oak-end': { color: '#9a7a54', rough: 0.9 },
  daub: { color: '#e9e0c9', rough: 0.95, noise: [2.2, 2.2, 2.2], amp: 0.14, weather: 'wall' },
  'daub-ochre': { color: '#e4c68e', rough: 0.95, noise: [2.2, 2.2, 2.2], amp: 0.14, weather: 'wall' },
  'daub-pink': { color: '#e8cbb6', rough: 0.95, noise: [2.2, 2.2, 2.2], amp: 0.14, weather: 'wall' },
  wattle: { color: '#7a5c3a', rough: 1, noise: [30, 30, 30], amp: 0.5 },
  brick: { color: '#9c5539', rough: 0.9, noise: [6, 12, 6], amp: 0.3, weather: 'wall' },
  boards: { color: '#6f5338', rough: 0.85, noise: [14, 2, 14], amp: 0.3, weather: 'wood' },
  planks: { color: '#5f4229', rough: 0.85, noise: [14, 2, 14], amp: 0.3, weather: 'wood' },
  'roof-boards': { color: '#5d4a38', rough: 0.9, noise: [14, 3, 14], amp: 0.3, weather: 'roof' },
  thatch: { color: '#b48d4c', rough: 1, noise: [40, 3, 3], amp: 0.42, weather: 'roof' },
  'thatch-old': { color: '#91764a', rough: 1, noise: [40, 3, 3], amp: 0.42, weather: 'roof' },
  tile: { color: '#a54a2d', rough: 0.8, noise: [5, 5, 5], amp: 0.22, weather: 'roof' },
  shingle: { color: '#6d5843', rough: 0.9, noise: [12, 4, 12], amp: 0.28, weather: 'roof' },
  slate: { color: '#4b505b', rough: 0.7, noise: [8, 8, 8], amp: 0.2, weather: 'roof' },
  fieldstone: { color: '#7f7463', rough: 0.92, noise: [5, 5, 5], amp: 0.4, weather: 'wall' },
  rubble: { color: '#a5998a', rough: 0.92, noise: [5, 5, 5], amp: 0.36, weather: 'wall' },
  limewash: { color: '#ebe6da', rough: 0.95, noise: [3, 3, 3], amp: 0.12, weather: 'wall' },
  ashlar: { color: '#cbbfa6', rough: 0.88, noise: [4, 4, 4], amp: 0.22, weather: 'wall' },
  mortar: { color: '#9d9383', rough: 1, noise: [8, 8, 8], amp: 0.2 },
  pole: { color: '#6e5438', rough: 0.85, noise: WOOD_NOISE, amp: 0.25, weather: 'wood' },
  logs: { color: '#6b4b30', rough: 0.95, noise: [18, 18, 18], amp: 0.4, weather: 'wood' },
  'end-grain': { color: '#cfa978', rough: 0.9, noise: [20, 20, 20], amp: 0.25 },
  hazel: { color: '#6a5030', rough: 0.9 },
  rope: { color: '#a28c62', rough: 1 },
  iron: { color: '#2f2d2b', rough: 0.55, metal: 0.6 },
  bronze: { color: '#8f6c33', rough: 0.4, metal: 0.85 },
  gold: { color: '#c9a24a', rough: 0.35, metal: 0.9 },
  earth: { color: '#6f5739', rough: 1, noise: [6, 6, 6], amp: 0.35 },
  'earth-dark': { color: '#3b2d1d', rough: 1, noise: [6, 6, 6], amp: 0.35 },
  soot: { color: '#0d0b09', rough: 1 },
  barrel: { color: '#7b5635', rough: 0.8, noise: [30, 3, 30], amp: 0.3, weather: 'wood' },
  crate: { color: '#8b6b45', rough: 0.85, noise: [14, 2, 14], amp: 0.3, weather: 'wood' },
  linen: { color: '#e8e0cc', rough: 1, noise: [10, 10, 10], amp: 0.12 },
  sacking: { color: '#a3875f', rough: 1, noise: [20, 20, 20], amp: 0.2 },
  wicker: { color: '#a27c42', rough: 1, noise: [30, 30, 30], amp: 0.4 },
  bread: { color: '#c48544', rough: 0.9 },
  straw: { color: '#c9a558', rough: 1, noise: [30, 3, 30], amp: 0.35 },
  wheat: { color: '#d9ba62', rough: 1, noise: [30, 30, 30], amp: 0.3 },
  'straw-band': { color: '#8f7136', rough: 1 },
  water: { color: '#24343a', rough: 0.08 },
  clay: { color: '#b46c4a', rough: 0.9, noise: [6, 6, 6], amp: 0.25, weather: 'wall' },
  'cloth-red': { color: '#a8343a', rough: 1, noise: [8, 8, 8], amp: 0.1 },
  'cloth-white': { color: '#e8dcc0', rough: 1, noise: [8, 8, 8], amp: 0.1 },
  'cloth-blue': { color: '#2f5d8a', rough: 1, noise: [8, 8, 8], amp: 0.1 },
  'cloth-yellow': { color: '#d8b24a', rough: 1, noise: [8, 8, 8], amp: 0.1 },
  'cloth-green': { color: '#4f6f3c', rough: 1, noise: [8, 8, 8], amp: 0.1 },
  'sign-mug': { color: '#d9a92f', rough: 0.8 },
  'sign-loaf': { color: '#c58742', rough: 0.8 },
  'sign-anvil': { color: '#3b3a3a', rough: 0.6 },
  'sign-axe': { color: '#9aa0a4', rough: 0.6 },
  produce: { color: '#9a3a2a', rough: 0.8 },
  apples: { color: '#b8402a', rough: 0.6 },
  greens: { color: '#5a7a34', rough: 0.9 },
  // painted shutters, doors and window boxes (a style gives each building its own colour)
  paint: { color: '#6e4a2c', rough: 0.75, noise: [14, 2, 14], amp: 0.2, weather: 'wood' },
  leaves: { color: '#5c8a3a', rough: 0.95, noise: [14, 14, 14], amp: 0.35 },
  'leaves-dark': { color: '#3f6a2e', rough: 0.95, noise: [14, 14, 14], amp: 0.35 },
  'flower-red': { color: '#d8323c', rough: 0.8 },
  'flower-pink': { color: '#ec86a8', rough: 0.8 },
  'flower-yellow': { color: '#f2cc3c', rough: 0.8 },
  'flower-white': { color: '#f6f2ea', rough: 0.8 },
  // things that glow
  interior: { color: '#140e0a', rough: 1, glow: { by: 'light', color: '#c8501a', k: 0.16 } },
  glass: { color: '#3a3832', rough: 0.3, glow: { by: 'light', color: '#ff9a3c', k: 0.75 } },
  'stained-red': { color: '#5a1e22', rough: 0.25, glow: { by: 'light', color: '#ff4a3a', k: 1 } },
  'stained-blue': { color: '#1e2a5a', rough: 0.25, glow: { by: 'light', color: '#4a6aff', k: 1 } },
  'stained-gold': { color: '#5a4a1e', rough: 0.25, glow: { by: 'light', color: '#ffc040', k: 1 } },
  stained: { color: '#3a2a4a', rough: 0.25, glow: { by: 'light', color: '#d080ff', k: 1 } },
  lamp: { color: '#6a5a3a', rough: 0.4, glow: { by: 'light', color: '#ffc070', k: 1.1 } },
  fire: { color: '#3a1206', rough: 1, glow: { by: 'fire', color: '#ff6a1a', k: 1.6 } },
};

const WEATHER_CODE: Record<Weather, number> = { none: 0, roof: 1, wood: 2, wall: 3 };

const NOISE_GLSL = `
varying vec3 vModelPos;
varying vec3 vModelNor;
uniform vec3 uNoiseScale; uniform float uNoiseAmp; uniform float uAge; uniform int uWeather; uniform float uSat;
uniform sampler2D uTex; uniform vec3 uTexMean; uniform float uTexScale; uniform float uTexOn; uniform float uGrade;
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

const SURFACE_GLSL = `
{
  // a painted texture laid on from three sides by the surface's facing (no UVs needed); it brings the
  // brushwork and grain, the material's own colour stays the average
  if (uTexOn > 0.0) {
    vec3 tw = pow(abs(normalize(vModelNor)), vec3(4.0));
    tw /= (tw.x + tw.y + tw.z);
    vec3 tp = vModelPos * uTexScale;
    // at two scales, so its repeat doesn't show
    vec3 tq = tp * 0.37 + vec3(0.31, 0.57, 0.13);
    vec3 tc = 0.5 * (texture2D(uTex, tp.zy).rgb * tw.x + texture2D(uTex, tp.xz).rgb * tw.y + texture2D(uTex, tp.xy).rgb * tw.z)
            + 0.5 * (texture2D(uTex, tq.zy).rgb * tw.x + texture2D(uTex, tq.xz).rgb * tw.y + texture2D(uTex, tq.xy).rgb * tw.z);
    diffuseColor.rgb *= mix(vec3(1.0), tc / max(uTexMean, vec3(0.02)), uTexOn);
  }
  vec3 q = vModelPos * uNoiseScale;
  float n = 0.6 * vnoise(q) + 0.3 * vnoise(q * 2.7) + 0.1 * vnoise(q * 7.1);
  diffuseColor.rgb *= 1.0 - uNoiseAmp * (n - 0.35);
  float hgt = vModelPos.y;
  // the ground darkens what stands on it
  diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 0.5, hgt));
  float age = uAge;
  if (uWeather == 1) {
    // roofs: moss and lichen on the upper faces, the covering darkening
    float up = smoothstep(0.3, 0.8, vModelNor.y);
    float mz = smoothstep(0.5, 0.8, vnoise(vModelPos * 1.4) * 0.7 + vnoise(vModelPos * 6.0) * 0.3 + age * 0.25);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.085, 0.035), mz * up * age * 0.85);
    diffuseColor.rgb *= 1.0 - 0.28 * age;
  } else if (uWeather == 2) {
    // timber silvers in the weather
    float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(l * 1.08, l * 1.06, l * 1.02), 0.6 * age);
  } else if (uWeather == 3) {
    // walls: damp rising from the ground, rain streaks down from the eaves
    float damp = (1.0 - smoothstep(0.0, 0.7 + 0.5 * vnoise(vModelPos * 2.3), hgt)) * age;
    float streak = smoothstep(0.62, 0.92, vnoise(vec3(vModelPos.x * 7.0 + vModelPos.z * 7.0, hgt * 0.35, 0.5))) * age;
    diffuseColor.rgb *= 1.0 - 0.38 * damp - 0.16 * streak;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.86, 0.92, 0.74), damp * 0.6);
  }
  // the style's colour push
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  diffuseColor.rgb = max(vec3(0.0), mix(vec3(lum), diffuseColor.rgb, uSat));
}`;

/** A painter's grading of the lit colour: sunlit parts warmer, shadows lifted a little and cooled (sky-lit). */
const GRADE_GLSL = `
if (uGrade > 0.0) {
  float gl = dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(1.07, 1.0, 0.86), smoothstep(0.25, 0.85, gl) * uGrade);
  gl_FragColor.rgb += vec3(0.018, 0.024, 0.048) * (1.0 - smoothstep(0.0, 0.3, gl)) * uGrade;
}`;

/** How old a building looks, in steps (materials are made per step and shared). */
export const AGE_STEPS = 6;

export type Mat = THREE.MeshStandardMaterial;

/** Which painted texture each material takes (public/textures), and how big one tile is (metres). */
const TEXTURE_OF: Record<string, { tex: string; size: number; k?: number }> = {
  daub: { tex: 'plaster', size: 1.6 },
  'daub-ochre': { tex: 'plaster', size: 1.6 },
  'daub-pink': { tex: 'plaster', size: 1.6 },
  limewash: { tex: 'plaster', size: 1.6 },
  oak: { tex: 'oak', size: 1.0 },
  pole: { tex: 'oak', size: 1.0 },
  rubble: { tex: 'stone', size: 2.4, k: 0.7 },
  fieldstone: { tex: 'stone', size: 2.4, k: 0.7 },
  ashlar: { tex: 'stone', size: 3, k: 0.6 },
  tile: { tex: 'tile', size: 1.6, k: 0.35 },
  brick: { tex: 'bricks', size: 1.0 },
  clay: { tex: 'bricks', size: 1.0 },
  thatch: { tex: 'thatch', size: 1.2 },
  'thatch-old': { tex: 'thatch', size: 1.2 },
  shingle: { tex: 'shingle', size: 1.0 },
  slate: { tex: 'slate', size: 1.0 },
  planks: { tex: 'planks', size: 1.2 },
  boards: { tex: 'planks', size: 1.2 },
  'roof-boards': { tex: 'planks', size: 1.2 },
  paint: { tex: 'planks', size: 1.2 },
  crate: { tex: 'planks', size: 0.8 },
  barrel: { tex: 'planks', size: 0.8 },
  earth: { tex: 'earth', size: 2.0 },
  'earth-dark': { tex: 'earth', size: 2.0 },
  logs: { tex: 'bark', size: 0.8 },
};

/** The painted textures, loaded once (their list from public/textures/manifest.json); white until they arrive. */
const textures = new Map<string, { tex: THREE.Texture; mean: THREE.Vector3; ready: boolean; users: Array<{ mean: { value: THREE.Vector3 }; on: { value: number }; k: number }> }>();
let texManifest: Promise<Record<string, { file: string; mean: [number, number, number] }>> | null = null;
const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE.needsUpdate = true;

function textureFor(name: string) {
  let t = textures.get(name);
  if (t) return t;
  t = { tex: WHITE, mean: new THREE.Vector3(1, 1, 1), ready: false, users: [] };
  textures.set(name, t);
  const entry = t;
  texManifest ??= typeof fetch === 'function' ? fetch('textures/manifest.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})) : Promise.resolve({});
  void texManifest.then((list) => {
    const info = list[name];
    if (!info) return;
    new THREE.TextureLoader().load(`textures/${info.file}`, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      entry.tex = tex;
      // the mean in the same (linear) space the shader samples in
      const c = new THREE.Color().setRGB(info.mean[0] / 255, info.mean[1] / 255, info.mean[2] / 255, THREE.SRGBColorSpace);
      entry.mean.set(c.r, c.g, c.b);
      entry.ready = true;
      for (const u of entry.users) {
        u.mean.value = entry.mean;
        u.on.value = u.k;
      }
      for (const m of matsUsing.get(name) ?? []) m.uniforms.uTex.value = tex;
    });
  });
  return t;
}
const matsUsing = new Map<string, Array<{ uniforms: { uTex: { value: THREE.Texture } } }>>();

const shared = new Map<string, Mat>();

function make(name: string, ageStep: number, style: Style, colour?: string): Mat {
  const def = MATERIALS[name] ?? MATERIALS.planks;
  const color = new THREE.Color(colour ?? style.colors[name] ?? def.color);
  const m: Mat = new THREE.MeshStandardMaterial({ color, roughness: def.rough, metalness: def.metal ?? 0, vertexColors: true });
  if (def.glow) {
    m.emissive = new THREE.Color(def.glow.color);
    m.emissiveIntensity = 0;
  }
  const texOf = style.textures ? TEXTURE_OF[name] : undefined;
  const t = texOf ? textureFor(texOf.tex) : null;
  const uniforms = {
    uNoiseScale: { value: new THREE.Vector3(...(def.noise ?? [1, 1, 1])) },
    // the painted texture brings its own grain: less of the noise
    uNoiseAmp: { value: (def.amp ?? 0) * style.grain * (texOf ? 0.35 : 1) },
    uTex: { value: t?.tex ?? WHITE },
    uTexMean: { value: t?.mean ?? new THREE.Vector3(1, 1, 1) },
    uTexScale: { value: texOf ? 1 / texOf.size : 1 },
    uTexOn: { value: t?.ready ? (texOf?.k ?? 1) : 0 },
    uGrade: { value: style.grade },
    uAge: { value: (ageStep / (AGE_STEPS - 1)) * style.weather },
    uWeather: { value: WEATHER_CODE[def.weather ?? 'none'] },
    uSat: { value: style.saturation },
  };
  if (t && texOf) {
    t.users.push({ mean: uniforms.uTexMean, on: uniforms.uTexOn, k: texOf.k ?? 1 });
    (matsUsing.get(texOf.tex) ?? matsUsing.set(texOf.tex, []).get(texOf.tex)!).push({ uniforms });
  }
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vModelPos;\nvarying vec3 vModelNor;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvModelPos = position;\nvModelNor = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${SURFACE_GLSL}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${GRADE_GLSL}`)
      // a glow takes each piece's own tint (stained glass, embers)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif');
  };
  m.customProgramCacheKey = () => 'village-surface-v2';
  return m;
}

/** A shared material: the library's, in a style, at an age step, in a colour of its own if given. */
export function material(name: string, ageStep: number, style: Style, colour?: string): Mat {
  const key = `${style.name}|${name}|${ageStep}|${colour ?? ''}`;
  let m = shared.get(key);
  if (!m) shared.set(key, (m = make(name, ageStep, style, colour)));
  return m;
}

/** A building's own copy of a glowing material (its light and fire are its own). */
export function ownMaterial(name: string, ageStep: number, style: Style): Mat {
  return make(name, ageStep, style);
}

/** Whether a material glows, and by what. */
export const glowOf = (name: string) => MATERIALS[name]?.glow;
