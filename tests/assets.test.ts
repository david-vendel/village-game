// The asset format end to end (docs/art/ASSET_SPEC.md, PLAN.md WP2): today's
// procedural art exports into valid assets, the validator rejects each kind of
// broken asset with a message that says what is wrong, and the assets the
// game ships (public/assets) pass.

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildingImage, type BuildingAsset, type Manifest, pickTier } from '../src/render/manifest';
import { exportProcedural } from '../tools/assets/procedural';
import { formatReport, validateAssets } from '../tools/assets/validate';

const work = mkdtempSync(join(tmpdir(), 'village-assets-'));
const clean = join(work, 'clean');
let n = 0;

/** A copy of the clean export, changed by `mutate`, validated. */
async function broken(mutate: (dir: string, m: Manifest) => Promise<void> | void) {
  const dir = join(work, `case-${n++}`);
  cpSync(clean, dir, { recursive: true });
  const m: Manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  await mutate(dir, m);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
  return validateAssets(dir);
}

const farm = (m: Manifest) => m.assets['building.farm'] as BuildingAsset;
const COLOR2 = 'building/farm/street/default/color@2x.webp';
const messages = (r: { errors: Array<{ where: string; message: string }> }) => r.errors.map((e) => `${e.where}: ${e.message}`).join('\n');

beforeAll(async () => {
  await exportProcedural(clean);
}, 60_000);
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('procedural export (bootstrap)', () => {
  it('produces the farm, with its Large-farm variant, that passes the validator', async () => {
    const m: Manifest = JSON.parse(readFileSync(join(clean, 'manifest.json'), 'utf8'));
    const a = farm(m);
    expect(a.footprintWidth).toBe(150);
    expect(a.variants?.upgraded).toBeDefined();
    expect(a.views.street.points?.door).toBeDefined();
    expect(a.source.approvedBy).toBeUndefined();
    const r = await validateAssets(clean);
    expect(r.errors, formatReport(r)).toEqual([]);
    expect(r.files).toBe(8);
  }, 30_000);
});

describe('validator rejects', () => {
  it('a missing file', async () => {
    const r = await broken((dir) => unlinkSync(join(dir, 'building/farm/street/default/color@4x.webp')));
    expect(messages(r)).toMatch(/building\.farm street color@4x: file missing: building\/farm\/street\/default\/color@4x\.webp/);
  });

  it('an image of the wrong pixel size', async () => {
    const r = await broken(async (dir) => {
      const f = join(dir, COLOR2);
      const buf = await sharp(readFileSync(f)).resize({ width: 300, height: 200, fit: 'fill' }).webp().toBuffer();
      writeFileSync(f, buf);
    });
    expect(messages(r)).toMatch(/color@2x: image is 300×200 px, expected 354×210/);
  });

  it('a footprint that differs from the building’s width', async () => {
    const r = await broken((_, m) => void (farm(m).footprintWidth = 225));
    expect(messages(r)).toMatch(/footprintWidth 225 u differs from BUILDINGS\.farm\.width 150 u/);
  });

  it('an anchor outside the image', async () => {
    const r = await broken((_, m) => void (farm(m).views.street.anchor = [500, 98]));
    expect(messages(r)).toMatch(/anchor \[500, 98\] lies outside the image/);
  });

  it('a manifest that breaks the schema', async () => {
    const r = await broken((_, m) => void ((farm(m).views.street.layers as Record<string, string>).colour = 'x.webp'));
    expect(messages(r)).toMatch(/building\.farm: schema: views\.street\.layers must NOT have additional properties \(“colour”\)/);
  });

  it('a colour layer without alpha', async () => {
    const r = await broken(async (dir) => {
      const f = join(dir, COLOR2);
      writeFileSync(f, await sharp(readFileSync(f)).removeAlpha().webp().toBuffer());
    });
    expect(messages(r)).toMatch(/color@2x: colour layer has no alpha channel/);
  });

  it('missing alpha bleed (black under transparent pixels)', async () => {
    const r = await broken(async (dir) => {
      const f = join(dir, COLOR2);
      const { data, info } = await sharp(readFileSync(f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] === 0) data[i] = data[i + 1] = data[i + 2] = 0;
      writeFileSync(f, await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).webp({ lossless: true, exact: true }).toBuffer());
    });
    expect(messages(r)).toMatch(/@2x: alpha bleed missing/);
  });

  it('a lossy normal layer, and normals that aren’t unit length', async () => {
    const r = await broken(async (dir, m) => {
      const { width, height } = await sharp(readFileSync(join(dir, COLOR2))).metadata();
      const grey = { create: { width: width!, height: height!, channels: 3 as const, background: { r: 128, g: 128, b: 128 } } };
      writeFileSync(join(dir, 'n@2x.webp'), await sharp(grey).webp({ quality: 80 }).toBuffer());
      const { width: w4, height: h4 } = await sharp(readFileSync(join(dir, 'building/farm/street/default/color@4x.webp'))).metadata();
      writeFileSync(join(dir, 'n@4x.webp'), await sharp({ create: { ...grey.create, width: w4!, height: h4! } }).webp({ quality: 80 }).toBuffer());
      farm(m).views.street.layers.normal = 'n@{tier}x.webp';
    });
    expect(messages(r)).toMatch(/normal@2x: normal must be lossless/);
    expect(messages(r)).toMatch(/normal@2x: \d+% of visible normals aren't unit length/);
  });

  it('a seamless strip whose edges don’t match', async () => {
    const r = await broken(async (dir, m) => {
      for (const tier of [1, 2]) {
        const w = 100 * tier;
        const h = 20 * tier;
        const px = Buffer.alloc(w * h * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            px[i] = x < w / 2 ? 220 : 30;
            px[i + 1] = 60;
            px[i + 2] = x < w / 2 ? 30 : 220;
            px[i + 3] = 255;
          }
        }
        writeFileSync(join(dir, `hills@${tier}x.webp`), await sharp(px, { raw: { width: w, height: h, channels: 4 } }).webp({ lossless: true }).toBuffer());
      }
      m.assets['backdrop.farHills'] = {
        kind: 'backdrop',
        parallax: 0.24,
        tileWidth: 100,
        anchorY: 420,
        image: { size: [100, 20], anchor: [0, 20], tiers: [1, 2], layers: { color: 'hills@{tier}x.webp' } },
        source: { method: 'hand' },
      };
    });
    expect(messages(r)).toMatch(/backdrop\.farHills @1x: seamless strip's left and right edges differ/);
  });

  it('a person outside 34–38 u, and a sheet whose frames don’t fit its grid', async () => {
    const r = await broken((_, m) => {
      const sheet = { frameSize: [40, 44], anchor: [20, 42], tiers: [2], frames: 20, grid: [8, 1], layers: { color: 'p@{tier}x.webp' } };
      m.assets['person.peasant.farmer'] = {
        kind: 'person',
        height: 30,
        clips: {
          idle: { driver: { type: 'time', fps: 8 }, loop: true, facings: { right: sheet } },
          walk: { driver: { type: 'distance', uPerCycle: 40 }, loop: true, facings: { right: sheet } },
        },
        source: { method: 'render3d' },
      };
    });
    expect(messages(r)).toMatch(/person\.peasant\.farmer: a person must stand 34–38 u tall \(height 30\)/);
    expect(messages(r)).toMatch(/person\.peasant\.farmer idle right: 20 frames don't match the grid 8×1/);
  });

  it('a walk clip driven by distance without uPerCycle', async () => {
    const r = await broken((_, m) => {
      const sheet = { frameSize: [40, 44], anchor: [20, 42], tiers: [2], frames: 8, grid: [8, 1], layers: { color: 'p@{tier}x.webp' } };
      m.assets['person.woman.none'] = {
        kind: 'person',
        height: 35,
        clips: {
          idle: { driver: { type: 'time', fps: 8 }, loop: true, facings: { right: sheet } },
          walk: { driver: { type: 'distance' }, loop: true, facings: { right: sheet } },
        },
        source: { method: 'render3d' },
      };
    });
    expect(messages(r)).toMatch(/person\.woman\.none: schema: clips\.walk\.driver must have required property 'uPerCycle'/);
  });
});

describe('shipped assets', () => {
  const dir = resolve(__dirname, '../public/assets');
  it.skipIf(!existsSync(join(dir, 'manifest.json')))('public/assets passes the validator', async () => {
    const r = await validateAssets(dir);
    expect(r.errors, formatReport(r)).toEqual([]);
  }, 60_000);
});

describe('manifest lookups', () => {
  it('picks the smallest tier at least as sharp as the screen, else the sharpest', () => {
    expect(pickTier(1.8, [2, 4])).toBe(2);
    expect(pickTier(2, [4, 2])).toBe(2);
    expect(pickTier(3, [2, 4])).toBe(4);
    expect(pickTier(6, [2, 4])).toBe(4);
    expect(pickTier(0.8, [1, 2])).toBe(1);
  });

  it('finds a building’s variant, falling back to its default look, and its stages', () => {
    const img = (tag: string) => ({ size: [10, 10] as [number, number], anchor: [5, 10] as [number, number], tiers: [2 as const], layers: { color: `${tag}.webp` } });
    const a: BuildingAsset = {
      kind: 'building',
      footprintWidth: 200,
      views: { street: img('default') },
      variants: { upgraded: { views: { street: img('upgraded') } } },
      construction: { mode: 'stages', stages: { roof: { street: img('roof') } } },
      source: { method: 'hand' },
    };
    expect(buildingImage(a, { variant: 'upgraded' })?.layers.color).toBe('upgraded.webp');
    expect(buildingImage(a, { variant: 'ruined' })?.layers.color).toBe('default.webp');
    expect(buildingImage(a, { view: 'roadsideL' })).toBeNull();
    expect(buildingImage(a, { stage: 'roof' })?.layers.color).toBe('roof.webp');
    expect(buildingImage(a, { stage: 'frame' })).toBeNull();
  });
});
