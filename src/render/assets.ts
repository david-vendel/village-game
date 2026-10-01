// Sprite assets (docs/art/ASSET_SPEC.md) at run time, Canvas 2D tier: loads
// the manifest, decodes images lazily at the tier the screen needs, and draws
// an image's layers at its anchor. Anything without a ready sprite is drawn by
// the procedural art instead, so assets can replace it one at a time.
//
// Loading never touches game state: callers pass what they draw.

import {
  approvedOnly,
  buildingImage,
  EMPTY_MANIFEST,
  isBuilding,
  type BuildingAsset,
  type ImageSet,
  type LayerName,
  type Manifest,
  type Part,
  pickTier,
  type Tier,
  tierPath,
  type Vec2,
} from './manifest';
import type { Ctx } from './util';

/** `auto`: sprites where the manifest has them. `procedural`: ignore assets. `preview`: the contact sheet page. */
export type ArtMode = 'auto' | 'procedural' | 'preview';

let manifest: Manifest = EMPTY_MANIFEST;
let mode: ArtMode = 'auto';
let root = 'assets/';

type Picture = HTMLImageElement | HTMLCanvasElement;
type Slot = Picture | 'loading' | 'failed';
const files = new Map<string, Slot>();

export interface LoadOptions {
  mode?: ArtMode;
  /** Folder holding manifest.json, relative to the page. */
  root?: string;
  /** Drop assets without `source.approvedBy` (production builds, §13). */
  approvedOnly?: boolean;
}

/** Fetch the manifest. Without one (or on any error) everything stays procedural. */
export async function loadArt(opts: LoadOptions = {}): Promise<void> {
  mode = opts.mode ?? 'auto';
  root = opts.root ?? 'assets/';
  if (mode === 'procedural') return;
  try {
    const res = await fetch(root + 'manifest.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const m = (await res.json()) as Manifest;
    if (m.specVersion !== 1 || !m.assets) {
      console.warn('assets: manifest specVersion', m.specVersion, 'not supported; using procedural art');
      return;
    }
    manifest = opts.approvedOnly ? approvedOnly(m) : m;
  } catch {
    // no assets deployed: procedural art
  }
}

export function artMode(): ArtMode {
  return mode;
}

/** Run `fn` with sprites switched off (the preview's procedural column). */
export function forceProcedural<T>(fn: () => T): T {
  const was = mode;
  mode = 'procedural';
  try {
    return fn();
  } finally {
    mode = was;
  }
}

export function artManifest(): Manifest {
  return manifest;
}

export function artRoot(): string {
  return root;
}

const isPicture = (s: Slot | undefined): s is Picture => s instanceof HTMLImageElement || s instanceof HTMLCanvasElement;

/**
 * An emissive layer comes as light on black (§6). Drawn additively, its black
 * would still add alpha and blacken the sky behind it, so light becomes alpha:
 * each pixel's alpha is its brightest channel, its colour scaled to match.
 */
function lightToAlpha(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const k = (Math.max(d[i], d[i + 1], d[i + 2]) * d[i + 3]) / 255;
    if (k === 0) {
      d[i + 3] = 0;
      continue;
    }
    const f = 255 / Math.max(d[i], d[i + 1], d[i + 2]);
    d[i] *= f;
    d[i + 1] *= f;
    d[i + 2] *= f;
    d[i + 3] = k;
  }
  g.putImageData(data, 0, 0);
  return c;
}

/** Start loading a file if it isn't yet; the picture once it has decoded. */
function file(path: string, emissive = false): Picture | null {
  const slot = files.get(path);
  if (isPicture(slot)) return slot;
  if (slot) return null;
  files.set(path, 'loading');
  const img = new Image();
  img.decoding = 'async';
  img.src = root + path;
  img.decode().then(
    () => files.set(path, emissive ? lightToAlpha(img) : img),
    () => {
      files.set(path, 'failed');
      console.warn('assets: could not load', root + path);
    },
  );
  return null;
}

/** Screen pixels per world unit under the current transform. */
function pxPerUnit(ctx: Ctx): number {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b);
}

/**
 * A layer's image at the tier this transform needs. While that tier is still
 * loading, any tier already decoded stands in, so zooming never falls back to
 * the procedural art.
 */
export function layerImage(ctx: Ctx, img: ImageSet, layer: LayerName): Picture | null {
  const path = img.layers[layer];
  if (!path) return null;
  const want: Tier = pickTier(pxPerUnit(ctx), img.tiers);
  const best = file(tierPath(path, want), layer === 'emissive');
  if (best) return best;
  for (const t of [...img.tiers].sort((a, b) => b - a)) {
    const slot = files.get(tierPath(path, t));
    if (isPicture(slot)) return slot;
  }
  return null;
}

/** Whether the colour layer is ready to draw (and starts it loading if not). */
export function ready(ctx: Ctx, img: ImageSet): boolean {
  return layerImage(ctx, img, 'color') !== null;
}

// --- emissive: added after the night tint --------------------------------------

interface Glow {
  m: DOMMatrix;
  img: Picture;
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
}
const glows: Glow[] = [];

/**
 * Add the emissive layers queued this frame, lit by `strength` (0 by day, 1 at
 * night). The scene calls it after tinting the land, so lights aren't darkened.
 */
export function flushEmissive(ctx: Ctx, strength: number): void {
  if (strength > 0.001 && glows.length) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const g of glows) {
      ctx.setTransform(g.m);
      ctx.globalAlpha = Math.min(1, strength * g.alpha);
      ctx.drawImage(g.img, g.x, g.y, g.w, g.h);
    }
    ctx.restore();
  }
  glows.length = 0;
}

/** Run `fn` without queueing emissive layers (screen UI drawn over the lit-up world). */
export function withoutEmissive(fn: () => void): void {
  const mark = glows.length;
  fn();
  glows.length = mark;
}

// --- drawing -------------------------------------------------------------------

export interface DrawOptions {
  /** Opacity of the whole image (construction crossfades). */
  alpha?: number;
  /** Skip the ground shadow (e.g. a stage drawn over another). */
  noShadow?: boolean;
  /** Emissive brightness factor (emissivePulse parts). */
  glow?: number;
}

/**
 * Draw an image set with its anchor at (x, base): shadow under it, colour,
 * and its emissive queued for after the night tint. False if the colour layer
 * isn't decoded yet (the caller then draws the procedural art).
 */
export function drawImageSet(ctx: Ctx, img: ImageSet, x: number, base: number, opts: DrawOptions = {}): boolean {
  const color = layerImage(ctx, img, 'color');
  if (!color) return false;
  const [w, h] = img.size;
  const left = x - img.anchor[0];
  const top = base - img.anchor[1];
  const alpha = opts.alpha ?? 1;
  const before = ctx.globalAlpha;
  ctx.globalAlpha = before * alpha;
  if (!opts.noShadow) {
    const shadow = layerImage(ctx, img, 'shadow');
    if (shadow) ctx.drawImage(shadow, left, top, w, h);
  }
  ctx.drawImage(color, left, top, w, h);
  ctx.globalAlpha = before;
  const emissive = layerImage(ctx, img, 'emissive');
  if (emissive) glows.push({ m: ctx.getTransform(), img: emissive, x: left, y: top, w, h, alpha: alpha * before * (opts.glow ?? 1) });
  return true;
}

/** A named point of an image, on screen, with the image's anchor at (x, base). */
export function pointOf(img: ImageSet, name: string, x: number, base: number): Vec2 | null {
  const p = img.points?.[name];
  return p ? [x - img.anchor[0] + p[0], base - img.anchor[1] + p[1]] : null;
}

/** Names of an image's points with a prefix, e.g. every `smoke:*`. */
export function pointsWith(img: ImageSet, prefix: string): string[] {
  return Object.keys(img.points ?? {}).filter((k) => k.startsWith(prefix));
}

/**
 * Parts drawn only while the building is in some state, when its art asks for
 * them (`Surface.part`), not always: the farmhouse door standing open.
 */
export const STATE_PARTS = new Set(['doorOpen']);

/** Draw one part at its pivot in the body image (anchored at x, base), animated by time. */
export function drawPart(ctx: Ctx, body: ImageSet, part: Part, x: number, base: number, time: number): boolean {
  const px = x - body.anchor[0] + part.pivot[0];
  const py = base - body.anchor[1] + part.pivot[1];
  const an = part.animate;
  let angle = 0;
  let glow = 1;
  if (an.type === 'rotate') angle = time * an.radPerSecond;
  else if (an.type === 'swing') angle = an.amplitude * Math.sin((time * 2 * Math.PI) / an.period);
  else if (an.type === 'emissivePulse') glow = an.min + (an.max - an.min) * (0.5 + 0.5 * Math.sin(time * 2 * Math.PI * an.hz));
  if (!angle) return drawImageSet(ctx, part.image, px, py, { noShadow: true, glow });
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);
  const ok = drawImageSet(ctx, part.image, 0, 0, { noShadow: true, glow });
  ctx.restore();
  return ok;
}

/** The building asset for a building type, unless the art mode says to ignore assets. */
export function buildingAsset(type: string): BuildingAsset | null {
  if (mode === 'procedural') return null;
  const a = manifest.assets[`building.${type}`];
  return isBuilding(a) ? a : null;
}

export { buildingImage };
