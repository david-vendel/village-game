// pack.ts without Blender: synthetic raw passes (what the harness writes) go
// in, valid ASSET_SPEC layers and a manifest entry come out.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/game/buildings';
import type { BuildingAsset, Manifest } from '../src/render/manifest';
import { packRender, type RawMeta } from '../tools/art-pipeline/pack';
import { formatReport, validateAssets } from '../tools/assets/validate';

const work = mkdtempSync(join(tmpdir(), 'village-pack-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A float32 .npy file, as numpy's np.save writes it. */
function npy(file: string, shape: number[], data: Float32Array): void {
  let header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`;
  const pad = 64 - ((10 + header.length + 1) % 64);
  header += ' '.repeat(pad % 64) + '\n';
  const head = Buffer.alloc(10);
  head.write('\x93NUMPY', 0, 'latin1');
  head[6] = 1;
  head[7] = 0;
  head.writeUInt16LE(header.length, 8);
  writeFileSync(file, Buffer.concat([head, Buffer.from(header, 'latin1'), Buffer.from(data.buffer)]));
}

describe('pack', () => {
  it('turns raw passes into every layer at @2x and @4x that pass the validator', async () => {
    // a 60×40 u image at 4 px/u: a lit box (a "wall") standing on the anchor, its shadow to the right
    const size: [number, number] = [60, 40];
    const W = 240;
    const H = 160;
    const raw = join(work, 'raw');
    const dir = join(raw, 'street/default');
    mkdirSync(dir, { recursive: true });
    const color = new Uint16Array(W * H * 4);
    const normal = new Float32Array(W * H * 3);
    const depth = new Float32Array(W * H);
    const shadow = new Float32Array(W * H);
    const emissive = new Float32Array(W * H * 3);
    const inside = (x: number, y: number) => x >= 40 && x < 160 && y >= 40 && y < 140;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (inside(x, y)) {
          // two faces: the left one turned towards the sun (on the left), the right one away; lit accordingly
          const n = x < 100 ? [-0.5, 0.2, Math.sqrt(1 - 0.29)] : [0.6, 0.1, Math.sqrt(1 - 0.37)];
          normal.set(n, i * 3);
          const lit = Math.max(0, n[0] * -0.71 + n[1] * 0.57 + n[2] * 0.41);
          color.set([Math.round(lit * 60000), Math.round(lit * 55000), Math.round(lit * 48000), 65535], i * 4);
          depth[i] = 10;
          if (x >= 60 && x < 80 && y >= 70 && y < 90) emissive.set([1, 0.6, 0.2], i * 3);
        }
        if (x >= 160 && x < 220 && y >= 120 && y < 140) shadow[i] = 0.6;
      }
    }
    writeFileSync(join(dir, 'color.png'), await sharp(color, { raw: { width: W, height: H, channels: 4 } }).toColourspace('rgb16').png().toBuffer());
    npy(join(dir, 'normal.npy'), [H, W, 3], normal);
    npy(join(dir, 'depth.npy'), [H, W], depth);
    npy(join(dir, 'shadow.npy'), [H, W], shadow);
    npy(join(dir, 'emissive.npy'), [H, W, 3], emissive);
    const meta: RawMeta = {
      id: 'building.farm',
      tier: 4,
      views: {
        street: {
          size,
          anchor: [10, 35],
          points: { door: [20, 35] },
          images: { default: { kind: 'look', name: 'default', dir: 'street/default', files: { color: 'color.png', normal: 'normal.npy', depth: 'depth.npy', shadow: 'shadow.npy', emissive: 'emissive.npy' } } },
        },
      },
    };
    writeFileSync(join(raw, 'meta.json'), JSON.stringify(meta));

    const assets = join(work, 'assets');
    await packRender(raw, assets);
    const report = await validateAssets(assets);
    expect(report.errors, formatReport(report)).toEqual([]);
    expect(report.warnings.filter((w) => /light|unit length/.test(w.message)), formatReport(report)).toEqual([]);
    expect(report.files).toBe(10); // 5 layers × 2 tiers

    const farm = (JSON.parse(readFileSync(join(assets, 'manifest.json'), 'utf8')) as Manifest).assets['building.farm'] as BuildingAsset;
    expect(farm.footprintWidth).toBe(BUILDINGS.farm.width);
    expect(farm.construction).toEqual({ mode: 'reveal' });
    expect(farm.views.street.points).toEqual({ door: [20, 35] });
    expect(farm.views.street.depthRange).toEqual([10, 11]);
    expect(Object.keys(farm.views.street.layers).sort()).toEqual(['color', 'depth', 'emissive', 'normal', 'shadow']);
    // @2x colour of the box is the box's colour, straight alpha, and opaque
    const { data, info } = await sharp(readFileSync(join(assets, 'building/farm/street/default/color@2x.webp'))).raw().toBuffer({ resolveWithObject: true });
    const i = (45 * info.width + 50) * info.channels;
    expect(info.width).toBe(120);
    expect(data[i + 3]).toBe(255);
    expect(data[i]).toBeGreaterThan(data[i + 2]);
  });
});
