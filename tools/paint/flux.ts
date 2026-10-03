// npm run paint:flux -- --server <ComfyUI url> --prompt "<text>" [--n 4] [--size 1344x768]
//   [--init <png> --denoise 0.7] [--out .art-raw/flux/<name>] [--steps 28] [--guidance 3.5]
//
// Paints with FLUX.1-dev (fp8, one checkpoint with its text encoders and VAE: pod-setup.sh)
// from a prompt alone, or over a starting image (a game screenshot, a render) at a given
// denoise: the composition kept loosely, the rest painted anew. Saves each picture and a
// contact sheet.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { Comfy } from './comfy';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const server = arg('server', process.env.COMFY_URL);
const prompt = arg('prompt');
if (!server || !prompt) {
  console.error('usage: npm run paint:flux -- --server URL --prompt "…" [--n 4] [--size WxH] [--init png --denoise 0.7] [--out dir]');
  process.exit(2);
}
const n = Number(arg('n', '4'));
const [W, H] = arg('size', '1344x768')!.split('x').map(Number);
const out = arg('out', join('.art-raw', 'flux', 'run'))!;
const steps = Number(arg('steps', '28'));
const guidance = Number(arg('guidance', '3.5'));
const init = arg('init');
const denoise = Number(arg('denoise', '0.7'));
mkdirSync(out, { recursive: true });
const comfy = new Comfy(server);

let initName: string | undefined;
if (init) initName = await comfy.upload(`init-${Date.now()}.png`, await sharp(readFileSync(init)).resize(W, H, { fit: 'cover' }).png().toBuffer());

const shots: Buffer[] = [];
for (let k = 0; k < n; k++) {
  const g: Record<string, unknown> = {
    ckpt: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'flux1-dev-fp8.safetensors' } },
    pos: { class_type: 'CLIPTextEncode', inputs: { clip: ['ckpt', 1], text: prompt } },
    guided: { class_type: 'FluxGuidance', inputs: { conditioning: ['pos', 0], guidance } },
    neg: { class_type: 'CLIPTextEncode', inputs: { clip: ['ckpt', 1], text: '' } },
    latent: initName
      ? { class_type: 'VAEEncode', inputs: { pixels: ['img', 0], vae: ['ckpt', 2] } }
      : { class_type: 'EmptySD3LatentImage', inputs: { width: W, height: H, batch_size: 1 } },
    sample: {
      class_type: 'KSampler',
      inputs: { model: ['ckpt', 0], positive: ['guided', 0], negative: ['neg', 0], latent_image: ['latent', 0], seed: 4242 + k * 7919, steps, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: initName ? denoise : 1 },
    },
    decode: { class_type: 'VAEDecode', inputs: { samples: ['sample', 0], vae: ['ckpt', 2] } },
    save: { class_type: 'SaveImage', inputs: { images: ['decode', 0], filename_prefix: 'village/flux' } },
  };
  if (initName) g.img = { class_type: 'LoadImage', inputs: { image: initName } };
  const t0 = Date.now();
  const [img] = await comfy.run(g, 30 * 60_000);
  writeFileSync(join(out, `flux${k}.png`), img);
  shots.push(img);
  console.log(`flux: ${k + 1}/${n} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
// a contact sheet, two across
const tw = Math.round(W / 2);
const th = Math.round(H / 2);
const cols = 2;
const rows = Math.ceil(shots.length / cols);
const tiles = await Promise.all(shots.map((s) => sharp(s).resize(tw, th).png().toBuffer()));
await sharp({ create: { width: cols * tw + (cols + 1) * 8, height: rows * th + (rows + 1) * 8, channels: 3, background: '#1b1612' } })
  .composite(tiles.map((t, i) => ({ input: t, left: 8 + (i % cols) * (tw + 8), top: 8 + Math.floor(i / cols) * (th + 8) })))
  .png()
  .toFile(join(out, 'sheet.png'));
console.log(`flux: done, see ${out}`);
