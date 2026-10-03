// npm run paint:apply -- <raw render dir> <painted dir> <seed> [--id building.house] [--looks-only]
//
// Puts a chosen painting into a copy of the harness's raw render, as its colour (the render's
// own alpha kept, so the outline is exact), so the packer makes the painted building a sprite
// asset (public/assets, ASSET_SPEC) the game draws. The other passes (normals, depth, shadow,
// night lights) stay the render's. --looks-only leaves the construction stages out (they
// aren't painted yet: the game builds the building its usual way meanwhile).

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { packRender } from '../art-pipeline/pack';
import { prep } from './prep';

const [raw, painted, seedArg] = process.argv.slice(2);
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
if (!raw || !painted || seedArg === undefined) {
  console.error('usage: npm run paint:apply -- <raw dir> <painted dir> <seed> [--id building.<type>] [--looks-only]');
  process.exit(2);
}
const meta = JSON.parse(readFileSync(join(raw, 'meta.json'), 'utf8'));
const id = arg('id') ?? meta.id;
const out = resolve('.art-raw', `${id}.painted`);
rmSync(out, { recursive: true, force: true });
cpSync(raw, out, { recursive: true });
meta.id = id;
meta.source = {
  method: 'render3d', // painted over: the image models are listed below
  models: [
    { name: 'Blender', version: '4.5 LTS', licence: 'GPL-3.0 (tool; output is ours)' },
    { name: 'DreamShaper XL Turbo v2.1', licence: 'CreativeML OpenRAIL++-M' },
    { name: 'ControlNet union SDXL promax (xinsir)', licence: 'Apache-2.0' },
  ],
  author: 'tools/paint (paint-over of tools/building-gen renders)',
  notes: 'Paint-over test of one house: not yet approved.',
  date: new Date().toISOString().slice(0, 10),
};
for (const [view, v] of Object.entries(meta.views as Record<string, { images: Record<string, { kind: string }> }>)) {
  for (const [key, img] of Object.entries(v.images)) {
    if (process.argv.includes('--looks-only') && img.kind !== 'look') {
      delete v.images[key];
      rmSync(join(out, view, key), { recursive: true, force: true });
      continue;
    }
    const paintedFull = join(painted, view, key, `seed${seedArg}-full.png`);
    if (!existsSync(paintedFull)) continue;
    // the painting is in prep's frame: back to the render's crop of the building, then into its full frame
    const dir = join(raw, view, key);
    const p = await prep(dir);
    const framed = await sharp(paintedFull).resize(p.width, p.height).png().toBuffer();
    const cut = await sharp(framed).extract({ left: p.place.left, top: p.place.top, width: p.place.w, height: p.place.h }).png().toBuffer();
    const src = await sharp(cut).resize(p.crop.w, p.crop.h, { kernel: 'lanczos3', fit: 'fill' }).removeAlpha().raw().toBuffer();
    const orig = sharp(join(dir, 'color.png')).ensureAlpha();
    const { width: W, height: H } = await orig.metadata();
    const rgba = await orig.raw().toBuffer();
    for (let y = 0; y < p.crop.h; y++) {
      for (let x = 0; x < p.crop.w; x++) {
        const i = ((y + p.crop.y) * W! + (x + p.crop.x)) * 4;
        const j = (y * p.crop.w + x) * 3;
        rgba[i] = src[j];
        rgba[i + 1] = src[j + 1];
        rgba[i + 2] = src[j + 2];
      }
    }
    // the painting's soft edge is mixed with the plain ground it was painted on: colour every pixel that
    // isn't solid from the solid paint next to it, growing outwards (no light halo, and the packer's
    // bleed then carries the true edge colour out into the transparency)
    const solid = new Uint8Array(W! * H!);
    for (let i = 0; i < W! * H!; i++) solid[i] = rgba[i * 4 + 3] >= 250 ? 1 : 0;
    for (let step = 0; step < 6; step++) {
      const fill: Array<[number, number, number, number]> = [];
      for (let y = 0; y < H!; y++) {
        for (let x = 0; x < W!; x++) {
          const i = y * W! + x;
          if (solid[i] || rgba[i * 4 + 3] === 0) continue;
          let r = 0, g = 0, bl = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W! || yy >= H! || !solid[yy * W! + xx]) continue;
            const j = (yy * W! + xx) * 4;
            r += rgba[j]; g += rgba[j + 1]; bl += rgba[j + 2]; n++;
          }
          if (n) fill.push([i, r / n, g / n, bl / n]);
        }
      }
      for (const [i, r, g, bl] of fill) {
        rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = bl;
        solid[i] = 1;
      }
    }
    for (let i = 0; i < W! * H!; i++) if (rgba[i * 4 + 3] === 0) rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 0;
    writeFileSync(join(out, view, key, 'color.png'), await sharp(rgba, { raw: { width: W!, height: H!, channels: 4 } }).png().toBuffer());
    console.log(`paint:apply ${view}/${key}: seed ${seedArg}`);
  }
}
writeFileSync(join(out, 'meta.json'), JSON.stringify(meta, null, 2));
await packRender(out, resolve('public/assets'), { log: console.log });
console.log(`paint:apply: packed ${id} into public/assets`);
