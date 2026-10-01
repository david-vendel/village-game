// The Blender render harness end to end (docs/art/PLAN.md WP3): the test cube
// house goes in, valid assets come out. Slow (Blender renders a dozen images),
// so it runs only with ART_INTEGRATION=1 and a Blender install:
//   ART_INTEGRATION=1 npx vitest run tests/art-pipeline.test.ts

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { BuildingAsset, Manifest } from '../src/render/manifest';
import { packRender } from '../tools/art-pipeline/pack';
import { formatReport, validateAssets } from '../tools/assets/validate';

const BLENDER = process.env.BLENDER ?? 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe';
const run = process.env.ART_INTEGRATION === '1' && existsSync(BLENDER);
const work = mkdtempSync(join(tmpdir(), 'village-art-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe.skipIf(!run)('render harness', () => {
  it('renders the cube house into a valid farm asset: looks, stages, part, points, all passes', async () => {
    const job = join(work, 'job.json');
    writeFileSync(job, JSON.stringify({ id: 'building.farm', views: ['street', 'roadsideL'], samples: 16, emissive_samples: 8 }));
    const raw = join(work, 'raw');
    const r = spawnSync(BLENDER, ['-b', '--python-exit-code', '1', '-P', resolve('tools/art-pipeline/render.py'), '--', '--scene', resolve('tools/art-pipeline/fixtures/cube_house.py'), '--job', job, '--out', raw], { encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);

    const assets = join(work, 'assets');
    await packRender(raw, assets);
    const report = await validateAssets(assets);
    expect(report.errors, formatReport(report)).toEqual([]);
    expect(report.warnings.filter((w) => /light|unit length|ground contact|lowest/.test(w.message)), formatReport(report)).toEqual([]);

    const farm = (JSON.parse(readFileSync(join(assets, 'manifest.json'), 'utf8')) as Manifest).assets['building.farm'] as BuildingAsset;
    const street = farm.views.street;
    expect(Object.keys(street.layers).sort()).toEqual(['albedo', 'ao', 'color', 'depth', 'emissive', 'normal', 'shadow']);
    expect(Object.keys(street.points ?? {}).sort()).toEqual(['door', 'sleep:0', 'smoke:0']);
    expect(farm.views.roadsideL).toBeDefined();
    expect(farm.variants?.upgraded.views.street).toBeDefined();
    expect(farm.construction.mode).toBe('stages');
    if (farm.construction.mode === 'stages') expect(Object.keys(farm.construction.stages).sort()).toEqual(['foundation', 'frame', 'roof', 'staking', 'walls']);
    expect(farm.parts?.map((p) => p.name)).toEqual(['doorOpen']);
    // the door point sits on the ground line (the anchor's row)
    expect(Math.abs(street.points!.door[1] - street.anchor[1])).toBeLessThan(3);
  }, 900_000);
});
