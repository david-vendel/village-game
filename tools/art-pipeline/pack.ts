// Packs the Blender harness's raw output (meta.json, colour PNG and float
// passes per image) into ASSET_SPEC assets: every layer at every tier,
// encoded as the spec says, and the asset's manifest entry.
//
// Tiers below the render tier are box-filtered from it, colour premultiplied
// and the data passes weighted by coverage, so all layers of an image stay
// pixel-consistent (normals are renormalised).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { BUILDINGS, type BuildingType } from '../../src/game/buildings';
import { type BuildingAsset, EMPTY_MANIFEST, type ImageSet, type LayerName, type Manifest, type Part, type Source, type Tier, type Vec2 } from '../../src/render/manifest';
import { bleed, readNpy, writeGrey16, writeLossless, writeWebp } from '../assets/images';

sharp.cache(false);

interface RawImage {
  kind: 'look' | 'stage' | 'part';
  name: string;
  dir: string;
  files: Partial<Record<LayerName, string>>;
  pivot?: Vec2;
}

interface RawView {
  size: Vec2;
  anchor: Vec2;
  points: Record<string, Vec2>;
  images: Record<string, RawImage>;
}

export interface RawMeta {
  id: string;
  tier: number;
  views: Record<string, RawView>;
  source?: Source;
}

/** Box-filter `c`-channel float pixels down by an integer factor, weighting by `weight` (coverage) if given. */
function down(src: Float32Array, w: number, h: number, c: number, f: number, weight?: Float32Array): Float32Array {
  if (f === 1) return src;
  const W = w / f;
  const H = h / f;
  const out = new Float32Array(W * H * c);
  const acc = new Float64Array(c);
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      acc.fill(0);
      let wsum = 0;
      for (let dy = 0; dy < f; dy++) {
        let i = (Y * f + dy) * w + X * f;
        for (let dx = 0; dx < f; dx++, i++) {
          const k = weight ? weight[i] : 1;
          if (k === 0) continue;
          wsum += k;
          for (let j = 0; j < c; j++) acc[j] += src[i * c + j] * k;
        }
      }
      if (wsum > 0) for (let j = 0; j < c; j++) out[(Y * W + X) * c + j] = acc[j] / wsum;
    }
  }
  return out;
}

const to8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

/** One image's layers at one tier, written under `base` (…/<view>/<key>/); returns layer → manifest path. */
async function packImage(rawDir: string, img: RawImage, size: Vec2, renderTier: number, tiers: Tier[], assetsDir: string, base: string): Promise<{ layers: ImageSet['layers']; depthRange?: Vec2 }> {
  const dir = join(rawDir, img.dir);
  const W = size[0] * renderTier;
  const H = size[1] * renderTier;
  // rgb16: without it sharp returns 8-bit values in the 16-bit buffer
  const { data: rgba16, info } = await sharp(readFileSync(join(dir, img.files.color!))).ensureAlpha().toColourspace('rgb16').raw({ depth: 'ushort' }).toBuffer({ resolveWithObject: true });
  if (info.width !== W || info.height !== H) throw new Error(`${img.dir}: colour is ${info.width}×${info.height} px, meta says ${W}×${H}`);
  const px16 = new Uint16Array(rgba16.buffer, rgba16.byteOffset, rgba16.byteLength / 2);
  // straight → premultiplied float, and coverage
  const premul = new Float32Array(W * H * 4);
  const alpha = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = px16[i * 4 + 3] / 65535;
    alpha[i] = a;
    for (let j = 0; j < 3; j++) premul[i * 4 + j] = (px16[i * 4 + j] / 65535) * a;
    premul[i * 4 + 3] = a;
  }
  const npy = (layer: LayerName) => (img.files[layer] ? readNpy(join(dir, img.files[layer]!)) : null);
  const normal = npy('normal');
  const depth = npy('depth');
  const ao = npy('ao');
  const albedo = npy('albedo');
  const shadow = npy('shadow');
  const emissive = npy('emissive');
  const mask = npy('mask');

  // depth range over what was drawn, whole units
  let depthRange: Vec2 | undefined;
  if (depth) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < W * H; i++) {
      if (alpha[i] <= 0) continue;
      lo = Math.min(lo, depth.data[i]);
      hi = Math.max(hi, depth.data[i]);
    }
    depthRange = lo <= hi ? [Math.floor(lo), Math.ceil(hi) === Math.floor(lo) ? Math.floor(lo) + 1 : Math.ceil(hi)] : undefined;
  }

  const layers: Partial<Record<LayerName, string>> = {};
  const path = (layer: LayerName, ext: string) => `${base}/${layer}@{tier}x.${ext}`;
  for (const tier of tiers) {
    const f = renderTier / tier;
    if (!Number.isInteger(f)) throw new Error(`tier ${tier} doesn't divide the render tier ${renderTier}`);
    const w = W / f;
    const h = H / f;
    const file = (layer: LayerName, ext: string) => join(assetsDir, path(layer, ext).replace('{tier}', String(tier)));
    const a = down(alpha, W, H, 1, f);

    // colour: premultiplied box filter, back to straight alpha, bleed (§6)
    const pm = down(premul, W, H, 4, f);
    const color = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const al = pm[i * 4 + 3];
      color[i * 4 + 3] = to8(al);
      // a pixel that rounds to fully transparent is left for the bleed to fill
      if (color[i * 4 + 3] === 0) continue;
      for (let j = 0; j < 3; j++) color[i * 4 + j] = to8(pm[i * 4 + j] / al);
    }
    bleed(color, w, h, 6);
    await writeWebp(file('color', 'webp'), color, w, h);
    layers.color = path('color', 'webp');

    if (shadow) {
      const s = down(shadow.data, W, H, 1, f);
      const out = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h; i++) out[i * 4 + 3] = to8(s[i]);
      await writeLossless(file('shadow', 'webp'), out, w, h, 4);
      layers.shadow = path('shadow', 'webp');
    }
    if (emissive) {
      const e = down(emissive.data, W, H, 3, f);
      const out = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        for (let j = 0; j < 3; j++) out[i * 4 + j] = to8(e[i * 3 + j]);
        out[i * 4 + 3] = 255; // light on black (§6)
      }
      await writeWebp(file('emissive', 'webp'), out, w, h);
      layers.emissive = path('emissive', 'webp');
    }
    if (normal) {
      const n = down(normal.data, W, H, 3, f, alpha);
      const out = new Uint8Array(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        const len = Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
        if (len < 1e-6 || color[i * 4 + 3] === 0) {
          out[i * 3] = 128;
          out[i * 3 + 1] = 128;
          out[i * 3 + 2] = 255;
          continue;
        }
        for (let j = 0; j < 3; j++) out[i * 3 + j] = to8((n[i * 3 + j] / len) * 0.5 + 0.5);
      }
      await writeLossless(file('normal', 'webp'), out, w, h, 3);
      layers.normal = path('normal', 'webp');
    }
    if (ao) {
      const o = down(ao.data, W, H, 1, f, alpha);
      const out = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) out[i] = a[i] > 0 ? to8(o[i]) : 255;
      await writeLossless(file('ao', 'webp'), out, w, h, 1);
      layers.ao = path('ao', 'webp');
    }
    if (albedo) {
      const al = down(albedo.data, W, H, 3, f, alpha);
      const out = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        for (let j = 0; j < 3; j++) out[i * 4 + j] = to8(al[i * 3 + j]);
        out[i * 4 + 3] = color[i * 4 + 3];
      }
      bleed(out, w, h, 6);
      await writeWebp(file('albedo', 'webp'), out, w, h);
      layers.albedo = path('albedo', 'webp');
    }
    if (depth && depthRange) {
      const d = down(depth.data, W, H, 1, f, alpha);
      const out = new Uint16Array(w * h);
      const [lo, hi] = depthRange;
      for (let i = 0; i < w * h; i++) out[i] = a[i] > 0 ? Math.round(Math.max(0, Math.min(1, (d[i] - lo) / (hi - lo))) * 65535) : 0;
      await writeGrey16(file('depth', 'png'), out, w, h);
      layers.depth = path('depth', 'png');
    }
    if (mask) {
      const m = down(mask.data, W, H, 4, f);
      const out = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h * 4; i++) out[i] = to8(m[i]);
      await writeLossless(file('mask', 'webp'), out, w, h, 4);
      layers.mask = path('mask', 'webp');
    }
  }
  return { layers: layers as ImageSet['layers'], depthRange };
}

/** Pack a building render (meta.json in rawDir) into assetsDir and its manifest. */
export async function packRender(rawDir: string, assetsDir: string, opts: { tiers?: Tier[]; log?: (s: string) => void } = {}): Promise<BuildingAsset> {
  const meta: RawMeta = JSON.parse(readFileSync(join(rawDir, 'meta.json'), 'utf8'));
  const tiers = opts.tiers ?? [2, 4];
  const log = opts.log ?? (() => {});
  const [kind, name] = [meta.id.slice(0, meta.id.indexOf('.')), meta.id.slice(meta.id.indexOf('.') + 1)];
  if (kind !== 'building') throw new Error(`${meta.id}: only buildings can be packed so far`);
  const def = BUILDINGS[name as BuildingType];
  if (!def) throw new Error(`${meta.id}: no building type “${name}” in src/game/buildings.ts`);

  const views: Record<string, ImageSet> = {};
  const variants: Record<string, Record<string, ImageSet>> = {};
  const stages: Record<string, { street: ImageSet }> = {};
  const parts: Part[] = [];
  for (const [view, raw] of Object.entries(meta.views)) {
    for (const [key, img] of Object.entries(raw.images)) {
      const base = `building/${name}/${view}/${key}`;
      const { layers, depthRange } = await packImage(rawDir, img, raw.size, meta.tier, tiers, assetsDir, base);
      const set: ImageSet = { size: raw.size, anchor: raw.anchor, tiers, layers };
      if (depthRange) set.depthRange = depthRange;
      log(`${meta.id} ${view} ${key}: ${Object.keys(layers).join(', ')}`);
      if (img.kind === 'look') {
        if (Object.keys(raw.points).length) set.points = raw.points;
        if (img.name === 'default') views[view] = set;
        else (variants[img.name] ??= {})[view] = set;
      } else if (img.kind === 'stage') {
        stages[img.name] = { street: set };
      } else {
        // the part image shares the body's frame: its anchor is the pivot, which goes on the pivot
        parts.push({ name: img.name, image: { ...set, anchor: img.pivot! }, pivot: img.pivot!, z: 'front', animate: { type: 'static' } });
      }
    }
  }
  if (!views.street) throw new Error(`${meta.id}: no street view rendered`);
  const asset: BuildingAsset = {
    kind: 'building',
    footprintWidth: def.width,
    views: views as BuildingAsset['views'],
    construction: Object.keys(stages).length ? { mode: 'stages', stages } : { mode: 'reveal' },
    source: meta.source ?? {
      method: 'render3d',
      models: [{ name: 'Blender', version: '4.5 LTS', licence: 'GPL-3.0 (tool; output is ours)' }],
      author: 'tools/art-pipeline',
      date: new Date().toISOString().slice(0, 10),
    },
  };
  if (Object.keys(variants).length) asset.variants = Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, { views: v }]));
  if (parts.length) asset.parts = parts;

  const manifestPath = join(assetsDir, 'manifest.json');
  const manifest: Manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : structuredClone(EMPTY_MANIFEST);
  manifest.assets[meta.id] = asset;
  mkdirSync(assetsDir, { recursive: true });
  writeManifest(manifestPath, manifest);
  return asset;
}

/** The manifest, with short number arrays ([x, y], tiers) on one line as in docs/art/example-manifest.json. */
export function writeManifest(path: string, manifest: Manifest): void {
  const json = JSON.stringify(manifest, null, 2).replace(/\[\s+(-?[\d.]+(?:,\s+-?[\d.]+)*)\s+\]/g, (_, xs: string) => `[${xs.split(/,\s+/).join(', ')}]`);
  writeFileSync(path, json + '\n');
}
