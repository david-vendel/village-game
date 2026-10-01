// The bootstrap test of the asset format
// (docs/art/PLAN.md WP2). Renders today's procedural art into ASSET_SPEC
// assets, PNG/WebP layers plus manifest entries, so the format, the loader
// and the validator are proven end to end before any real art exists.
//
// Exported: buildings whose art is split into a static body and live details
// (BuildingArt.body/overlay in src/render/buildings.ts), so the game looks the
// same on the sprites. Today that's the farm. The output is marked
// `procedural-export` and unapproved, so production builds leave it out.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { BUILDINGS, type BuildingType } from '../../src/game/buildings';
import { demoFarm } from '../../src/game/farm';
import { BUILDING_ART, type DrawArgs } from '../../src/render/buildings';
import { type BuildingAsset, EMPTY_MANIFEST, type ImageSet, type Manifest, type Tier, type Vec2 } from '../../src/render/manifest';
import type { Ctx } from '../../src/render/util';
import { bleed, writeWebp } from './images';

const TIERS: Tier[] = [2, 4];
/** Transparent margin round the art, in u (≤ 8 px at @4x). */
const MARGIN = 2;
/** How far colour is dilated into transparency (§6 alpha bleed), in px. */
const BLEED = 6;

type Draw = (ctx: Ctx, a: DrawArgs) => void;

/** Args for a still: the building alone, at a fixed time, anchored at the origin. */
function still(type: BuildingType, upgraded: boolean): DrawArgs {
  return { x: 0, base: 0, time: 0, seed: 7, upgraded, farm: type === 'farm' ? demoFarm() : undefined };
}

/** Raw RGBA of a drawing at `tier` px/u, with the anchor (origin) at (ax, ay) u in a w×h u image. */
function rasterise(draw: Draw, a: DrawArgs, tier: number, w: number, h: number, ax: number, ay: number, background?: string): Uint8ClampedArray {
  const canvas = createCanvas(Math.round(w * tier), Math.round(h * tier));
  const ctx = canvas.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.setTransform(tier, 0, 0, tier, ax * tier, ay * tier);
  draw(ctx as unknown as Ctx, a);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

/** Bounds of the visible pixels of drawings, in u from the anchor: [left, top, right, bottom]. */
function bounds(draws: Array<{ draw: Draw; a: DrawArgs }>): [number, number, number, number] {
  const R = 4; // measure at @4x
  const S = 320; // generous canvas round the origin, in u
  let [l, t, r, b] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { draw, a } of draws) {
    const px = rasterise(draw, a, R, S * 2, S * 2, S, S);
    const W = S * 2 * R;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] === 0) continue;
      const x = ((i - 3) / 4) % W;
      const y = Math.floor((i - 3) / 4 / W);
      l = Math.min(l, x);
      r = Math.max(r, x + 1);
      t = Math.min(t, y);
      b = Math.max(b, y + 1);
    }
  }
  if (l === Infinity) throw new Error('nothing drawn');
  return [l / R - S, t / R - S, r / R - S, b / R - S];
}

/** Export one building type: street view, its upgraded variant if it has one, reveal construction. */
async function exportBuilding(type: BuildingType, out: string): Promise<BuildingAsset> {
  const art = BUILDING_ART[type];
  if (!art.body) throw new Error(`${type}: art has no static body to export`);
  const looks: Array<{ variant: string; a: DrawArgs }> = [{ variant: 'default', a: still(type, false) }];
  if (BUILDINGS[type].upgrade) looks.push({ variant: 'upgraded', a: still(type, true) });
  // one frame for all looks, so the upgrade reveal lines up
  const [l, t, r, b] = bounds(looks.map(({ a }) => ({ draw: art.body!, a })));
  const left = Math.floor(l) - MARGIN;
  const top = Math.floor(t) - MARGIN;
  const size: Vec2 = [Math.ceil(r) + MARGIN - left, Math.ceil(b) + MARGIN - top];
  const anchor: Vec2 = [-left, -top];
  const points = Object.fromEntries(Object.entries(art.points ?? {}).map(([k, [x, y]]) => [k, [x + anchor[0], y + anchor[1]] as Vec2]));

  const views: Record<string, ImageSet> = {};
  for (const { variant, a } of looks) {
    const dir = `building/${type}/street/${variant}`;
    const layers: ImageSet['layers'] = { color: `${dir}/color@{tier}x.webp` };
    if (art.lights) layers.emissive = `${dir}/emissive@{tier}x.webp`;
    for (const tier of TIERS) {
      const w = Math.round(size[0] * tier);
      const h = Math.round(size[1] * tier);
      const color = rasterise(art.body, a, tier, size[0], size[1], anchor[0], anchor[1]);
      bleed(color, w, h, BLEED);
      await writeWebp(join(out, `${dir}/color@${tier}x.webp`), color, w, h);
      if (art.lights) await writeWebp(join(out, `${dir}/emissive@${tier}x.webp`), rasterise(art.lights, a, tier, size[0], size[1], anchor[0], anchor[1], '#000000'), w, h);
    }
    views[variant] = { size, anchor, tiers: TIERS, layers, points };
  }
  const asset: BuildingAsset = {
    kind: 'building',
    footprintWidth: BUILDINGS[type].width,
    views: { street: views.default },
    construction: { mode: 'reveal' },
    source: {
      method: 'procedural-export',
      author: 'tools/assets/export.ts',
      date: new Date().toISOString().slice(0, 10),
      notes: 'Placeholder: today’s procedural art (src/render/buildings.ts) exported to test the asset format end to end.',
    },
  };
  if (views.upgraded) asset.variants = { upgraded: { views: { street: views.upgraded } } };
  return asset;
}

/**
 * Export every split building into `out` (an assets folder), merging into its
 * manifest. Real art already there (any other source method) is kept.
 */
export async function exportProcedural(out: string, log: (line: string) => void = () => {}): Promise<Manifest> {
  const manifestPath = join(out, 'manifest.json');
  const manifest: Manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : structuredClone(EMPTY_MANIFEST);
  const types = (Object.keys(BUILDING_ART) as BuildingType[]).filter((t) => BUILDING_ART[t].body);
  for (const type of types) {
    const id = `building.${type}`;
    const existing = manifest.assets[id];
    if (existing && existing.source.method !== 'procedural-export') {
      log(`${id}: kept (the manifest has real art for it, ${existing.source.method})`);
      continue;
    }
    manifest.assets[id] = await exportBuilding(type, out);
    log(`${id}: exported`);
  }
  mkdirSync(out, { recursive: true });
  // short number arrays ([x, y], tiers) on one line, as in docs/art/example-manifest.json
  const json = JSON.stringify(manifest, null, 2).replace(/\[\s+(-?[\d.]+(?:,\s+-?[\d.]+)*)\s+\]/g, (_, xs: string) => `[${xs.split(/,\s+/).join(', ')}]`);
  writeFileSync(manifestPath, json + '\n');
  log(`wrote ${manifestPath}`);
  return manifest;
}
