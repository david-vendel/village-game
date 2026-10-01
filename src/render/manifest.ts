// The asset manifest (docs/art/ASSET_SPEC.md §8): its types, and the pure
// lookups the renderer and the asset tools share. No DOM here, so the Node
// tools (tools/assets) can use it too; loading and drawing live in assets.ts.

import type { ConstructionStage } from '../game/world';

export type Vec2 = [number, number];
export type Tier = 1 | 2 | 4;
export type LayerName = 'color' | 'shadow' | 'emissive' | 'normal' | 'albedo' | 'ao' | 'depth' | 'mask';
export type ViewId = 'street' | 'roadsideL' | 'roadsideR' | 'side' | 'backdrop';

/** One static image: size and anchor in world units (from its top-left), its layers, and named points. */
export interface ImageSet {
  size: Vec2;
  anchor: Vec2;
  tiers: Tier[];
  layers: Partial<Record<LayerName, string>> & { color: string };
  points?: Record<string, Vec2>;
  depthRange?: Vec2;
}

export type Views = Partial<Record<ViewId, ImageSet>>;

export type PartAnimation =
  | { type: 'rotate'; radPerSecond: number }
  | { type: 'swing'; amplitude: number; period: number }
  | { type: 'emissivePulse'; min: number; max: number; hz: number }
  | { type: 'loop'; clip: unknown }
  | { type: 'static' };

export interface Part {
  name: string;
  view?: 'street' | 'roadsideL' | 'roadsideR';
  image: ImageSet;
  /** Where the part's own anchor goes, in the body image's frame. */
  pivot: Vec2;
  z: 'behind' | 'front';
  animate: PartAnimation;
}

export interface Source {
  method: 'render3d' | 'gen2d' | 'photo' | 'video' | 'hand' | 'procedural-export';
  models?: Array<{ name: string; version?: string; licence: string }>;
  references?: Array<{ file: string; licence: string; attribution?: string }>;
  author?: string;
  approvedBy?: string;
  date?: string;
  notes?: string;
}

export interface BuildingAsset {
  kind: 'building';
  footprintWidth: number;
  views: Views & { street: ImageSet };
  variants?: Record<string, { views: Views }>;
  construction: { mode: 'reveal' } | { mode: 'stages'; stages: Partial<Record<Exclude<ConstructionStage, 'done'>, Views>> };
  parts?: Part[];
  behind?: ImageSet;
  front?: ImageSet;
  source: Source;
}

/** Kinds the runtime doesn't draw yet are kept as opaque records (the validator still checks them). */
export interface OtherAsset {
  kind: 'person' | 'rider' | 'animal' | 'item' | 'field' | 'nature' | 'backdrop' | 'ground';
  source: Source;
  [k: string]: unknown;
}

export type Asset = BuildingAsset | OtherAsset;

export interface Manifest {
  specVersion: 1;
  unitsPerMeter: 20;
  assets: Record<string, Asset>;
}

export const SPEC_VERSION = 1;
export const UNITS_PER_METER = 20;
export const EMPTY_MANIFEST: Manifest = { specVersion: 1, unitsPerMeter: 20, assets: {} };

/**
 * The tier to draw at for `pxPerU` screen pixels per world unit: the smallest
 * delivered tier at least that sharp, else the sharpest there is (§2).
 */
export function pickTier(pxPerU: number, tiers: readonly Tier[]): Tier {
  const sorted = [...tiers].sort((a, b) => a - b);
  return sorted.find((t) => t >= pxPerU - 1e-6) ?? sorted[sorted.length - 1];
}

/** A layer's file path at a tier, relative to the assets folder. */
export function tierPath(path: string, tier: Tier): string {
  return path.replace('{tier}', String(tier));
}

/** Every distinct file a layer path stands for, one per tier. */
export function layerFiles(img: ImageSet): Array<{ layer: LayerName; tier: Tier; file: string }> {
  const out: Array<{ layer: LayerName; tier: Tier; file: string }> = [];
  for (const [layer, path] of Object.entries(img.layers) as Array<[LayerName, string]>) {
    for (const tier of img.tiers) out.push({ layer, tier, file: tierPath(path, tier) });
  }
  return out;
}

export function isBuilding(a: Asset | undefined): a is BuildingAsset {
  return a?.kind === 'building';
}

/** A building's image for a look (variant), view and construction stage, if the manifest has it. */
export function buildingImage(
  asset: BuildingAsset,
  opts: { variant?: string; view?: ViewId; stage?: Exclude<ConstructionStage, 'done'> } = {},
): ImageSet | null {
  const view = opts.view ?? 'street';
  if (opts.stage) {
    if (asset.construction.mode !== 'stages') return null;
    return asset.construction.stages[opts.stage]?.[view] ?? null;
  }
  const variant = opts.variant && opts.variant !== 'default' ? asset.variants?.[opts.variant]?.views[view] : undefined;
  return variant ?? asset.views[view] ?? null;
}

/** Every image a manifest asset references, labelled, for the validator and the preview page. */
export function imagesOf(id: string, asset: Asset): Array<{ label: string; image: ImageSet }> {
  const out: Array<{ label: string; image: ImageSet }> = [];
  const views = (prefix: string, v: Views | undefined) => {
    for (const [name, image] of Object.entries(v ?? {})) if (image) out.push({ label: `${prefix}${name}`, image });
  };
  if (isBuilding(asset)) {
    views(`${id} `, asset.views);
    for (const [name, variant] of Object.entries(asset.variants ?? {})) views(`${id} [${name}] `, variant.views);
    if (asset.construction.mode === 'stages') {
      for (const [stage, v] of Object.entries(asset.construction.stages)) views(`${id} {${stage}} `, v);
    }
    for (const p of asset.parts ?? []) out.push({ label: `${id} part ${p.name}`, image: p.image });
    if (asset.behind) out.push({ label: `${id} behind`, image: asset.behind });
    if (asset.front) out.push({ label: `${id} front`, image: asset.front });
    return out;
  }
  const a = asset as Record<string, unknown>;
  if (a.image) out.push({ label: id, image: a.image as ImageSet });
  // backdrop variants are images; a person's `variants` is a count
  if (Array.isArray(a.variants)) (a.variants as ImageSet[]).forEach((image, i) => out.push({ label: `${id} #${i}`, image }));
  for (const key of ['states', 'crops'] as const) {
    for (const [state, list] of Object.entries((a[key] as Record<string, ImageSet[]> | undefined) ?? {})) {
      list.forEach((image, i) => out.push({ label: `${id} ${key === 'crops' ? 'crops ' : ''}${state} #${i}`, image }));
    }
  }
  return out;
}

/** Production builds ship only approved assets (ASSET_SPEC §13). */
export function approvedOnly(m: Manifest): Manifest {
  return { ...m, assets: Object.fromEntries(Object.entries(m.assets).filter(([, a]) => !!a.source?.approvedBy)) };
}
