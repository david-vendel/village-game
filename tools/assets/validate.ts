// The asset validator (docs/art/ASSET_SPEC.md §12): schema, files, pixel
// sizes, alpha, anchors, scale, sheets, seamless strips, normals, encodings
// and alpha bleed. Errors reject an asset; warnings are for a person to review.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import sharp from 'sharp';
import { BUILDINGS, type BuildingType } from '../../src/game/buildings';
import { imagesOf, isBuilding, type ImageSet, type LayerName, type Manifest, type Tier, tierPath } from '../../src/render/manifest';

export interface Issue {
  level: 'error' | 'warning';
  /** Asset id and which image/layer, e.g. "building.farm street [upgraded] color@2x". */
  where: string;
  message: string;
}

export interface Report {
  errors: Issue[];
  warnings: Issue[];
  /** Assets checked. */
  assets: number;
  /** Image files checked. */
  files: number;
}

const SCHEMA = fileURLToPath(new URL('../../docs/art/asset-manifest.schema.json', import.meta.url));
/** Sun direction of the lighting key (§4), camera space: x right, y up, z towards the camera. */
const SUN: [number, number, number] = [-0.71, 0.57, 0.41];
const LOSSLESS_ONLY: LayerName[] = ['normal', 'mask', 'ao'];
const MAX_DIM = 4096;

interface Pixels {
  width: number;
  height: number;
  channels: number;
  data: Buffer;
  hasAlpha: boolean;
  format: string;
  bitDepth: string;
  /** WebP only: lossless (VP8L) or lossy (VP8) bitstream. */
  webp?: 'lossless' | 'lossy';
}

// read through buffers with libvips' cache off: on Windows an open file can't be replaced or deleted
sharp.cache(false);

async function readPixels(file: string): Promise<Pixels> {
  const bytes = readFileSync(file);
  const img = sharp(bytes);
  const meta = await img.metadata();
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const webp = meta.format === 'webp' ? webpEncoding(bytes) : undefined;
  return { width: info.width, height: info.height, channels: info.channels, data, hasAlpha: !!meta.hasAlpha, format: meta.format ?? '?', bitDepth: String(meta.depth ?? ''), webp };
}

/** Whether a WebP file holds a lossless (VP8L) or lossy (VP8) image: walk its RIFF chunks. */
function webpEncoding(buf: Buffer): 'lossless' | 'lossy' {
  for (let at = 12; at + 8 <= buf.length; ) {
    const tag = buf.toString('latin1', at, at + 4);
    if (tag === 'VP8 ') return 'lossy';
    if (tag === 'VP8L') return 'lossless';
    if (tag === 'ANMF') at += 8 + 16; // an animation frame's chunks follow its header
    else at += 8 + buf.readUInt32LE(at + 4) + (buf.readUInt32LE(at + 4) & 1);
  }
  return 'lossy';
}

/** sRGB 0–255 → CIE Lab (D65). */
function lab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Mean ΔE (CIE76) between the left and right edge columns, over rows where either is visible. */
function edgeDeltaE(p: Pixels): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < p.height; y++) {
    const l = y * p.width * 4;
    const r = (y * p.width + p.width - 1) * 4;
    const al = p.data[l + 3] / 255;
    const ar = p.data[r + 3] / 255;
    if (al < 0.05 && ar < 0.05) continue;
    // compare as composited over mid grey, so a transparent edge against an opaque one counts
    const over = (i: number, a: number, c: number) => p.data[i + c] * a + 128 * (1 - a);
    const L1 = lab(over(l, al, 0), over(l, al, 1), over(l, al, 2));
    const L2 = lab(over(r, ar, 0), over(r, ar, 1), over(r, ar, 2));
    sum += Math.hypot(L1[0] - L2[0], L1[1] - L2[1], L1[2] - L2[2]);
    n++;
  }
  return n ? sum / n : 0;
}

/**
 * Alpha bleed (§6): transparent pixels next to the visible edge must carry the
 * edge's colour, not black or garbage, or scaling makes halos. The share of
 * such pixels whose colour is far from their visible neighbours'.
 */
function haloShare(p: Pixels): number {
  const { width: w, height: h, data: d } = p;
  let edge = 0;
  let bad = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] !== 0) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = (yy * w + xx) * 4;
          if (d[j + 3] < 128) continue;
          r += d[j];
          g += d[j + 1];
          b += d[j + 2];
          n++;
        }
      }
      if (!n) continue;
      edge++;
      if (Math.hypot(d[i] - r / n, d[i + 1] - g / n, d[i + 2] - b / n) > 60) bad++;
    }
  }
  return edge ? bad / edge : 0;
}

/** Share of visible pixels whose decoded normal isn't unit length within ±5%. */
function badNormalShare(normal: Pixels, color: Pixels): number {
  let n = 0;
  let bad = 0;
  for (let i = 0; i < normal.width * normal.height; i++) {
    if (color.data[i * 4 + 3] === 0) continue;
    const x = (normal.data[i * 4] / 255) * 2 - 1;
    const y = (normal.data[i * 4 + 1] / 255) * 2 - 1;
    const z = (normal.data[i * 4 + 2] / 255) * 2 - 1;
    n++;
    // 8-bit quantisation alone is worth about ±1%
    if (Math.abs(Math.hypot(x, y, z) - 1) > 0.05) bad++;
  }
  return n ? bad / n : 0;
}

/**
 * How well the colour pass's brightness follows the key light: Pearson
 * correlation of luminance with N·L over opaque pixels (§4). Near zero or
 * negative means the image is lit from elsewhere, or mirrored.
 */
function lightCorrelation(normal: Pixels, color: Pixels): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < color.width * color.height; i++) {
    if (color.data[i * 4 + 3] < 250) continue;
    const nx = (normal.data[i * 4] / 255) * 2 - 1;
    const ny = (normal.data[i * 4 + 1] / 255) * 2 - 1;
    const nz = (normal.data[i * 4 + 2] / 255) * 2 - 1;
    xs.push(Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]));
    ys.push(0.2126 * color.data[i * 4] + 0.7152 * color.data[i * 4 + 1] + 0.0722 * color.data[i * 4 + 2]);
  }
  if (xs.length < 50) return 1;
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 1;
}

/** Lowest row with a visible pixel (alpha ≥ 50%), or -1. */
function lowestVisibleRow(p: Pixels): number {
  for (let y = p.height - 1; y >= 0; y--) {
    for (let x = 0; x < p.width; x++) if (p.data[(y * p.width + x) * 4 + 3] >= 128) return y;
  }
  return -1;
}

/** Transparent margin (px) round the visible pixels of one or more same-sized images: [left, top, right, bottom]. */
function margins(images: Pixels[]): [number, number, number, number] {
  const { width: w, height: h } = images[0];
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (const p of images) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (p.data[(y * w + x) * 4 + 3] === 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? [w, h, w, h] : [x0, y0, w - 1 - x1, h - 1 - y1];
}

export async function validateAssets(dir: string): Promise<Report> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (where: string, message: string) => errors.push({ level: 'error', where, message });
  const warn = (where: string, message: string) => warnings.push({ level: 'warning', where, message });
  const report = (assets: number, files: number): Report => ({ errors, warnings, assets, files });

  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    err('manifest.json', `not found in ${dir}`);
    return report(0, 0);
  }
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    err('manifest.json', `not valid JSON: ${(e as Error).message}`);
    return report(0, 0);
  }

  // 1. schema
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  const validate = ajv.compile(JSON.parse(readFileSync(SCHEMA, 'utf8')));
  if (!validate(manifest as unknown)) {
    for (const e of validate.errors ?? []) {
      // `if/then` and `oneOf` wrappers repeat what their branches already said
      if (e.keyword === 'if' || e.keyword === 'oneOf') continue;
      const path = e.instancePath.split('/').slice(1).map((p) => p.replace(/~1/g, '/'));
      const where = path[0] === 'assets' && path[1] ? path[1] : 'manifest.json';
      const field = path[0] === 'assets' ? path.slice(2).join('.') : path.join('.');
      const extra = e.keyword === 'additionalProperties' ? ` (“${(e.params as { additionalProperty: string }).additionalProperty}”)` : e.keyword === 'enum' ? ` (one of ${(e.params as { allowedValues: unknown[] }).allowedValues.join(', ')})` : '';
      err(where, `schema: ${field || '(asset)'} ${e.message}${extra}`);
    }
    return report(Object.keys(manifest.assets ?? {}).length, 0);
  }

  const used = new Set<string>();
  let files = 0;

  /** Check one image set: files, sizes, alpha, anchor, layers' encodings and contents. */
  const checkImage = async (where: string, img: ImageSet, opts: { seamless?: boolean; kind: string; method: string; sheet?: { cols: number; rows: number } }) => {
    const [ax, ay] = img.anchor;
    const fw = img.size[0] * (opts.sheet?.cols ?? 1);
    const fh = img.size[1] * (opts.sheet?.rows ?? 1);
    if (!opts.sheet && (ax < 0 || ay < 0 || ax > img.size[0] || ay > img.size[1])) err(where, `anchor [${ax}, ${ay}] lies outside the image (size ${img.size[0]}×${img.size[1]} u)`);
    if (opts.method === 'render3d') {
      if (!img.layers.shadow && ['building', 'person', 'rider'].includes(opts.kind)) warn(where, 'no shadow layer');
      if (!img.layers.normal) warn(where, 'no normal layer (route B assets should deliver one)');
    }
    for (const tier of img.tiers as Tier[]) {
      const loaded: Partial<Record<LayerName, Pixels>> = {};
      for (const [layer, path] of Object.entries(img.layers) as Array<[LayerName, string]>) {
        const rel = tierPath(path, tier);
        const at = `${where} ${layer}@${tier}x`;
        const file = join(dir, rel);
        used.add(rel.split('/').join(sep));
        if (!existsSync(file)) {
          err(at, `file missing: ${rel}`);
          continue;
        }
        files++;
        let p: Pixels;
        try {
          p = await readPixels(file);
        } catch (e) {
          err(at, `can't decode ${rel}: ${(e as Error).message}`);
          continue;
        }
        loaded[layer] = p;
        const ew = Math.round(fw * tier);
        const eh = Math.round(fh * tier);
        if (Math.abs(p.width - ew) > 1 || Math.abs(p.height - eh) > 1) err(at, `image is ${p.width}×${p.height} px, expected ${ew}×${eh} (${fw}×${fh} u at ${tier} px/u)`);
        if (p.width > MAX_DIM || p.height > MAX_DIM) err(at, `image is ${p.width}×${p.height} px; the limit is ${MAX_DIM} px a side (split the sheet)`);
        if (LOSSLESS_ONLY.includes(layer) && (p.webp === 'lossy' || p.format === 'heif' || p.format === 'jpeg')) err(at, `${layer} must be lossless (PNG or lossless WebP); ${rel} is lossy`);
        if (layer === 'depth' && !(p.format === 'png' && p.bitDepth === 'ushort')) err(at, 'depth must be a 16-bit greyscale PNG');
        if (layer === 'color' && !p.hasAlpha) err(at, 'colour layer has no alpha channel');
      }
      const color = loaded.color;
      if (!color) continue;
      const at = `${where} @${tier}x`;
      for (const [layer, p] of Object.entries(loaded) as Array<[LayerName, Pixels]>) {
        if (p.width !== color.width || p.height !== color.height) err(`${where} ${layer}@${tier}x`, `layer is ${p.width}×${p.height} px but colour is ${color.width}×${color.height}: layers must be pixel-aligned`);
      }
      if (color.hasAlpha) {
        const share = haloShare(color);
        if (share > 0.2) err(at, `alpha bleed missing: ${Math.round(share * 100)}% of the transparent pixels at the edge don't carry the edge colour (dilate colour ≥ 4 px into transparency)`);
        if (!opts.sheet) {
          const m = margins([color, ...(loaded.shadow ? [loaded.shadow] : [])]);
          const big = Math.max(...m);
          if (big > 8 + tier) warn(at, `transparent margin up to ${big} px (left, top, right, bottom = ${m.join(', ')}); keep it ≤ 8 px`);
        }
        if (opts.kind === 'building' && !opts.sheet && where.includes(' street')) {
          const low = lowestVisibleRow(color);
          const anchorRow = ay * tier;
          if (low >= 0 && Math.abs(low - anchorRow) > 3 * tier) warn(at, `lowest visible row is ${(low / tier).toFixed(1)} u from the top but the anchor (ground contact) is at ${ay} u`);
        }
      }
      const normal = loaded.normal;
      if (normal && normal.width === color.width && normal.height === color.height) {
        const bad = badNormalShare(normal, color);
        if (bad > 0.02) err(`${where} normal@${tier}x`, `${Math.round(bad * 100)}% of visible normals aren't unit length (±5%)`);
        else if (tier === Math.max(...img.tiers)) {
          const r = lightCorrelation(normal, color);
          if (r < 0.1) warn(at, `colour shading doesn't follow the key light from the left (correlation ${r.toFixed(2)} with N·L): relit or mirrored?`);
        }
      }
      if (opts.seamless) {
        const dE = edgeDeltaE(color);
        if (dE > 2) err(at, `seamless strip's left and right edges differ (mean ΔE ${dE.toFixed(1)} > 2)`);
      }
    }
  };

  const ids = Object.keys(manifest.assets);
  for (const id of ids) {
    const asset = manifest.assets[id];
    const method = asset.source.method;
    if (isBuilding(asset)) {
      const type = id.slice('building.'.length) as BuildingType;
      const def = BUILDINGS[type];
      if (!def) err(id, `no building type “${type}” in src/game/buildings.ts`);
      else if (Math.abs(asset.footprintWidth - def.width) > 10) err(id, `footprintWidth ${asset.footprintWidth} u differs from BUILDINGS.${type}.width ${def.width} u by more than 10 u`);
      if (asset.construction.mode === 'stages') {
        const missing = ['staking', 'foundation', 'frame', 'walls', 'roof'].filter((s) => !(asset.construction as { stages: Record<string, unknown> }).stages[s]);
        if (missing.length) err(id, `construction stages missing: ${missing.join(', ')}`);
        for (const [stage, views] of Object.entries(asset.construction.stages)) {
          const img = views?.street;
          const done = asset.views.street;
          if (img && (img.size[0] !== done.size[0] || img.size[1] !== done.size[1] || img.anchor[0] !== done.anchor[0] || img.anchor[1] !== done.anchor[1])) err(`${id} {${stage}} street`, 'a stage must use the finished view’s size and anchor, so the building doesn’t jump');
        }
      }
      for (const p of asset.parts ?? []) {
        if (p.animate.type === 'loop') warn(`${id} part ${p.name}`, 'loop parts are not drawn by the Canvas 2D renderer yet');
      }
    }
    for (const { label, image } of imagesOf(id, asset)) {
      const a = asset as unknown as Record<string, unknown>;
      await checkImage(label, image, { kind: asset.kind, method, seamless: label === id && typeof a.tileWidth === 'number' });
    }
    // people, the rider and animals: clips of sprite sheets
    if (asset.kind === 'person' || asset.kind === 'rider' || asset.kind === 'animal') {
      const a = asset as unknown as { height?: number; variants?: number; clips: Record<string, { facings: Record<string, SheetSpec> }> };
      if (asset.kind === 'person' && (a.height === undefined || a.height < 34 || a.height > 38)) err(id, `a person must stand 34–38 u tall (height ${a.height ?? 'missing'})`);
      const variants = a.variants ?? 1;
      for (const [clipName, clip] of Object.entries(a.clips)) {
        if (!clip.facings.left) warn(`${id} ${clipName}`, 'no left facing: the game will mirror right, lit from the wrong side');
        for (const [facing, sheet] of Object.entries(clip.facings)) {
          const where = `${id} ${clipName} ${facing}`;
          const [cols, rows] = sheet.grid;
          if (rows % variants) err(where, `grid has ${rows} rows, not a whole number of rows for each of ${variants} variants`);
          const perVariant = cols * Math.max(1, Math.floor(rows / variants));
          if (sheet.frames > perVariant || sheet.frames <= perVariant - cols) err(where, `${sheet.frames} frames don't match the grid ${cols}×${rows} (${variants} variant${variants > 1 ? 's' : ''}: ${perVariant - cols + 1}–${perVariant} frames)`);
          for (const [name, pts] of Object.entries(sheet.points ?? {})) if (pts.length !== sheet.frames) err(where, `points.${name} has ${pts.length} entries for ${sheet.frames} frames`);
          if (sheet.contact && sheet.contact.length !== sheet.frames) err(where, `contact has ${sheet.contact.length} entries for ${sheet.frames} frames`);
          const img: ImageSet = { size: sheet.frameSize, anchor: sheet.anchor, tiers: sheet.tiers, layers: sheet.layers };
          const [ax, ay] = sheet.anchor;
          if (ax < 0 || ay < 0 || ax > sheet.frameSize[0] || ay > sheet.frameSize[1]) err(where, `anchor [${ax}, ${ay}] lies outside the frame (${sheet.frameSize[0]}×${sheet.frameSize[1]} u)`);
          await checkImage(where, img, { kind: asset.kind, method, sheet: { cols, rows } });
        }
      }
    }
    if (!asset.source.approvedBy) warn(id, 'not approved (source.approvedBy): kept out of production builds');
  }

  // files in the folder nothing refers to
  for (const f of walk(dir)) {
    const rel = relative(dir, f);
    if (rel === 'manifest.json' || used.has(rel)) continue;
    warn(rel.split(sep).join('/'), 'file not referenced by the manifest');
  }
  return report(ids.length, files);
}

interface SheetSpec {
  frameSize: [number, number];
  anchor: [number, number];
  tiers: Tier[];
  frames: number;
  grid: [number, number];
  layers: ImageSet['layers'];
  points?: Record<string, Array<[number, number]>>;
  contact?: string[];
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** One line per issue, errors first. */
export function formatReport(r: Report): string {
  const lines = [...r.errors, ...r.warnings].map((i) => `${i.level === 'error' ? 'ERROR' : 'warn '}  ${i.where}: ${i.message}`);
  lines.push(`${r.assets} asset${r.assets === 1 ? '' : 's'}, ${r.files} image file${r.files === 1 ? '' : 's'}: ${r.errors.length} error${r.errors.length === 1 ? '' : 's'}, ${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'}`);
  return lines.join('\n');
}
