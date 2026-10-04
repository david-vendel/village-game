// Buildings drawn from sprite assets where the manifest has them, else by
// their procedural art (buildings.ts). Everything that draws a finished
// building goes through `drawBuilding`, so a sprite replaces the art
// everywhere at once: on this street, on the others, in reveals and upgrades.

import type { ConstructionStage } from '../game/world';
import { buildingAsset, buildingImage, drawImageSet, drawPart, pointOf, pointsWith, ready, STATE_PARTS, withoutEmissive } from './assets';
import { BUILDING_ART, type DrawArgs, type Surface } from './buildings';
import type { BuildingType } from '../game/buildings';
import { demoFarm } from '../game/farm';
import { stockOf } from '../game/resources';
import type { ImageSet, Part, ViewId } from './manifest';
import { type Ctx, smoke } from './util';

/** The sprite a finished building would be drawn with, if any, and the parts that go with that view. */
function spriteFor(type: BuildingType, a: DrawArgs, view: ViewId): { img: ImageSet; parts: Part[] } | null {
  const asset = buildingAsset(type);
  if (!asset) return null;
  const variant = a.upgraded ? 'upgraded' : 'default';
  // a building seen up a side road without its own roadside view shows its street view
  const exact = buildingImage(asset, { variant, view });
  const img = exact ?? buildingImage(asset, { variant });
  const used = exact ? view : 'street';
  return img ? { img, parts: (asset.parts ?? []).filter((p) => (p.view ?? 'street') === used) } : null;
}

/**
 * Draw a finished building at a.x, a.base: its sprite (with parts, smoke and
 * its live details) when one is ready, else the procedural art.
 * `view` is a roadside view for a building seen up a side road.
 */
export function drawBuilding(ctx: Ctx, type: BuildingType, a: DrawArgs, view: ViewId = 'street'): void {
  const art = BUILDING_ART[type];
  const sprite = spriteFor(type, a, view);
  if (!sprite || !ready(ctx, sprite.img)) {
    art.draw(ctx, a);
    return;
  }
  const { img, parts } = sprite;
  const always = parts.filter((p) => !STATE_PARTS.has(p.name));
  for (const p of always) if (p.z === 'behind') drawPart(ctx, img, p, a.x, a.base, a.time);
  drawImageSet(ctx, img, a.x, a.base);
  for (const p of always) if (p.z === 'front') drawPart(ctx, img, p, a.x, a.base, a.time);
  for (const name of pointsWith(img, 'smoke:')) {
    const at = pointOf(img, name, a.x, a.base)!;
    smoke(ctx, at[0], at[1], a.time, a.seed + name.length);
  }
  const surface: Surface = {
    at: (name) => pointOf(img, name, a.x, a.base),
    part: (name) => {
      const p = parts.find((q) => q.name === name);
      return !!p && drawPart(ctx, img, p, a.x, a.base, a.time);
    },
  };
  art.overlay?.(ctx, a, surface);
}

const STAGES = ['staking', 'foundation', 'frame', 'walls', 'roof'] as const;

/** Whether this building is built in drawn stages (ASSET_SPEC §7.1 `stages`) with every stage ready to draw. */
export function hasStageSprites(ctx: Ctx, type: BuildingType): boolean {
  const asset = buildingAsset(type);
  if (!asset || asset.construction.mode !== 'stages') return false;
  return STAGES.every((s) => {
    const img = buildingImage(asset, { stage: s });
    return img !== null && ready(ctx, img);
  });
}

/**
 * A building under construction from its stage sprites: the stage before
 * stays, this stage fades in over it by its progress `t`. False when the
 * sprites aren't there (draw the procedural construction instead).
 */
export function drawStageSprites(ctx: Ctx, type: BuildingType, a: DrawArgs, stage: Exclude<ConstructionStage, 'done'>, t: number): boolean {
  if (!hasStageSprites(ctx, type)) return false;
  const asset = buildingAsset(type)!;
  const i = STAGES.indexOf(stage);
  if (i > 0) drawImageSet(ctx, buildingImage(asset, { stage: STAGES[i - 1] })!, a.x, a.base);
  drawImageSet(ctx, buildingImage(asset, { stage })!, a.x, a.base, { alpha: t, noShadow: i > 0 });
  return true;
}

const DEMO_FARM = demoFarm();
/** Menu previews show a half-full store. */
const DEMO_STOCK = stockOf({ grain: 3, wood: 60, stone: 50, flour: 20, bread: 25 });

/** Small icon-sized preview for the build menu (draws the real art, or its sprite, scaled; no night glow). */
export function drawBuildingIcon(ctx: Ctx, type: BuildingType, x: number, base: number, scale: number, time: number, like: Partial<DrawArgs> = {}): void {
  ctx.save();
  ctx.translate(x, base);
  ctx.scale(scale, scale);
  const art = BUILDING_ART[type];
  // `like`: a particular building as it stands (its look, width, store), else a showpiece
  const args: DrawArgs = { seed: 7, farm: type === 'farm' ? DEMO_FARM : undefined, stock: DEMO_STOCK, ...like, x: 0, base: 0, time };
  if (art.behind) art.behind(ctx, args);
  withoutEmissive(() => drawBuilding(ctx, type, args));
  ctx.restore();
}

/** Building pictures drawn once each (per type, size, resolution and colour) and kept. */
const iconImages = new Map<string, HTMLCanvasElement>();

/**
 * A building's showpiece picture as an image, drawn once at `k` canvas px per unit: in colour, or
 * without colour (`grey`). Null while its sprite is still loading (the picture would be the
 * procedural stand-in, kept for good).
 */
function iconImage(ctx: Ctx, type: BuildingType, k: number, grey: boolean): { img: HTMLCanvasElement; W: number; H: number; foot: number } | null {
  const key = `${type}:${k.toFixed(3)}:${grey ? 'g' : 'c'}`;
  const W = Math.ceil(320 * k);
  const H = Math.ceil((BUILDING_ART[type].height + 70) * k);
  const foot = Math.ceil(30 * k);
  let img = iconImages.get(key);
  if (!img) {
    const sprite = spriteFor(type, { seed: 7, x: 0, base: 0, time: 0 }, 'street');
    if (sprite && !ready(ctx, sprite.img)) return null;
    // zooming and a growing village keep asking for new sizes: start over now and then
    if (iconImages.size > 300) iconImages.clear();
    img = document.createElement('canvas');
    img.width = W;
    img.height = H;
    const g = img.getContext('2d')!;
    drawBuildingIcon(g, type, W / 2, H - foot, k, 0);
    if (grey) {
      const data = g.getImageData(0, 0, W, H);
      const p = data.data;
      for (let i = 0; i < p.length; i += 4) {
        const l = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
        p[i] = p[i + 1] = p[i + 2] = l;
      }
      g.putImageData(data, 0, 0);
    }
    iconImages.set(key, img);
  }
  return { img, W, H, foot };
}

/**
 * A small building icon (the minimap's) from a picture drawn once: the full art is far too
 * much to draw for every building every frame, and at this size its motion doesn't show.
 */
export function drawBuildingIconCached(ctx: Ctx, type: BuildingType, x: number, base: number, scale: number, time: number): void {
  const f = Math.max(1, Math.abs(ctx.getTransform().a));
  const icon = iconImage(ctx, type, scale * f, false);
  if (!icon) return drawBuildingIcon(ctx, type, x, base, scale, time);
  ctx.drawImage(icon.img, x - icon.W / 2 / f, base - (icon.H - icon.foot) / f, icon.W / f, icon.H / f);
}

/**
 * A building's menu picture without colour and faded: one that can't be
 * built here. Drawn once into an image and turned grey there (the art sets
 * its own transparency as it draws, so fading it in place doesn't hold, and
 * a canvas filter every frame is far too slow).
 */
export function drawBuildingIconGrey(ctx: Ctx, type: BuildingType, x: number, base: number, scale: number, alpha = 0.35): void {
  const f = Math.max(1, Math.abs(ctx.getTransform().a));
  const icon = iconImage(ctx, type, scale * f, true);
  if (!icon) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(icon.img, x - icon.W / 2 / f, base - (icon.H - icon.foot) / f, icon.W / f, icon.H / f);
  ctx.restore();
}
