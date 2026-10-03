// npm run paint -- <raw render dir> [--server <ComfyUI url>] [--look painted|kingdom]
//   [--mode paintover|repaint] [--seeds 3] [--anchor <png>] [--only default,stage-walls]
//   [--subject "a bakery with a domed bread oven"] [--dry]
//
// Paints a building's harness renders (.art-raw/<id>/, from npm run art:render) on the
// ComfyUI server of the rented GPU (tools/paint/README.md): every view and config
// (finished looks, construction stages), a few seeds each, cut back out with the render's
// own outline. Writes .art-raw/painted/<id>/<look>/<view>/<config>/seed<n>.png and a
// contact sheet per config to choose from. --dry writes only the prepared inputs
// (colour, depth, lines, mask), no server needed.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import sharp from 'sharp';
import { Comfy } from './comfy';
import { cutOut, prep } from './prep';
import { LOOKS, paintGraph } from './workflows';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const raw = process.argv[2];
if (!raw || !existsSync(raw)) {
  console.error('usage: npm run paint -- <raw render dir> [--server URL] [--look painted|kingdom] [--mode paintover|repaint] [--seeds N] [--anchor png] [--only cfg,…] [--dry]');
  process.exit(2);
}
const dry = process.argv.includes('--dry');
const look = LOOKS[arg('look', 'painted')!];
const mode = (arg('mode', 'paintover') as 'paintover' | 'repaint') ?? 'paintover';
const seeds = Number(arg('seeds', '3'));
const only = arg('only')?.split(',');
const server = arg('server', process.env.COMFY_URL);
const id = basename(resolve(raw));
const outRoot = join('.art-raw', 'painted', id, look.name);
const comfy = dry ? null : new Comfy(server ?? '');
if (!dry) {
  if (!server) throw new Error('no --server (or COMFY_URL): the ComfyUI address of the GPU machine');
  const s = await comfy!.stats();
  console.log(`paint: server ${server}, ${s.devices.map((d) => `${d.name} ${(d.vram_total / 2 ** 30).toFixed(0)} GB`).join(', ')}`);
}
const anchorFile = arg('anchor');
const anchor = anchorFile && comfy ? await comfy.upload(`anchor-${basename(anchorFile)}`, await sharp(anchorFile).png().toBuffer()) : undefined;

for (const view of readdirSync(raw, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
  for (const config of readdirSync(join(raw, view), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    if (only && !only.includes(config)) continue;
    const dir = join(raw, view, config);
    const p = await prep(dir);
    const out = join(outRoot, view, config);
    mkdirSync(out, { recursive: true });
    for (const [n, buf] of Object.entries({ colour: p.colour, depth: p.depth, lines: p.lines, mask: p.mask })) writeFileSync(join(out, `in-${n}.png`), buf);
    if (dry) {
      console.log(`paint: prepared ${out} (${p.width}×${p.height})`);
      continue;
    }
    const key = `${id}-${view}-${config}`;
    const [colour, depth, lines] = await Promise.all([comfy!.upload(`${key}-colour.png`, p.colour), comfy!.upload(`${key}-depth.png`, p.depth), comfy!.upload(`${key}-lines.png`, p.lines)]);
    const results: Buffer[] = [];
    for (let k = 0; k < seeds; k++) {
      const t0 = Date.now();
      const [img] = await comfy!.run(paintGraph({ look, mode, colour, depth, lines, width: p.width, height: p.height, seed: 1000 + k * 7919, anchor, subject: arg('subject') }));
      let cut = await cutOut(img, p);
      if (look.pixelate > 0) {
        const m = await sharp(cut).metadata();
        const sw = Math.max(1, Math.round(m.width! / look.pixelate));
        const sh = Math.max(1, Math.round(m.height! / look.pixelate));
        const small = await sharp(cut).resize(sw, sh, { kernel: 'nearest' }).png({ palette: true, colours: 48, dither: 0 }).toBuffer();
        cut = await sharp(small).resize(m.width!, m.height!, { kernel: 'nearest' }).png().toBuffer();
      }
      writeFileSync(join(out, `seed${k}.png`), cut);
      writeFileSync(join(out, `seed${k}-full.png`), img);
      results.push(cut);
      console.log(`paint: ${view}/${config} seed ${k} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
    // a contact sheet: the render, then each painting, side by side on a dark ground
    const metas = await Promise.all(results.map((r) => sharp(r).metadata()));
    const w = metas[0].width!;
    const h = metas[0].height!;
    const base = await cutOut(p.colour, p);
    const tiles = [base, ...results];
    const sheet = await sharp({ create: { width: w * tiles.length + 16 * (tiles.length + 1), height: h + 32, channels: 4, background: '#1b1612' } })
      .composite(tiles.map((t, i) => ({ input: t, left: 16 + i * (w + 16), top: 16 })))
      .png()
      .toBuffer();
    writeFileSync(join(out, 'sheet.png'), sheet);
  }
}
console.log(`paint: done, see ${outRoot}`);
