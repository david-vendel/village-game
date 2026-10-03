// npx tsx tools/paint/style.ts --server <ComfyUI url> --jobs <jobs.json>
//
// Runs a small style experiment: a list of paintings, each with its own settings
// (FLUX from text, FLUX img2img, FLUX + LoRAs, FLUX + Redux image prompt, SDXL +
// IP-Adapter style transfer), saves each as <out>/<name>.png and a labelled contact
// sheet <out>/sheet.png. Pictures already on disk are not painted again.
//
// jobs.json: { "out": dir, "cols": 2, "jobs": [ { "name", "label"?, "kind"?: "flux"|"sdxl-ip",
//   "prompt", "negative"?, "seed"?, "steps"?, "guidance"?, "size"?: "1344x768",
//   "loras"?: [{ "name", "strength" }], "init"?: png, "denoise"?,
//   "redux"?: { "image": png, "strength": 1, "type"?: "multiply" },
//   "ip"?: { "image": png, "weight": 0.9, "weightType"?: "style transfer", "ckpt"? } } ] }

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { Comfy } from './comfy';

interface Job {
  name: string;
  label?: string;
  kind?: 'flux' | 'sdxl-ip';
  prompt: string;
  negative?: string;
  seed?: number;
  steps?: number;
  guidance?: number;
  size?: string;
  loras?: Array<{ name: string; strength: number }>;
  init?: string;
  denoise?: number;
  redux?: { image: string; strength: number; type?: string };
  ip?: { image: string; weight: number; weightType?: string; ckpt?: string };
}

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const server = arg('server', process.env.COMFY_URL);
const jobsFile = arg('jobs');
if (!server || !jobsFile) {
  console.error('usage: npx tsx tools/paint/style.ts --server URL --jobs jobs.json');
  process.exit(2);
}
const spec = JSON.parse(readFileSync(jobsFile, 'utf8')) as { out: string; cols?: number; jobs: Job[] };
mkdirSync(spec.out, { recursive: true });
const comfy = new Comfy(server);
const uploaded = new Map<string, string>();

async function up(path: string, W?: number, H?: number): Promise<string> {
  const key = `${path}@${W}x${H}`;
  if (!uploaded.has(key)) {
    let img = sharp(readFileSync(path));
    if (W && H) img = img.resize(W, H, { fit: 'cover' });
    const name = `style-${uploaded.size}-${Date.now()}.png`;
    uploaded.set(key, await comfy.upload(name, await img.png().toBuffer()));
  }
  return uploaded.get(key)!;
}

async function fluxGraph(j: Job, W: number, H: number): Promise<Record<string, unknown>> {
  const g: Record<string, unknown> = {
    ckpt: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'flux1-dev-fp8.safetensors' } },
  };
  let model: [string, number] = ['ckpt', 0];
  (j.loras ?? []).forEach((l, i) => {
    g[`lora${i}`] = { class_type: 'LoraLoaderModelOnly', inputs: { model, lora_name: l.name, strength_model: l.strength } };
    model = [`lora${i}`, 0];
  });
  g.pos = { class_type: 'CLIPTextEncode', inputs: { clip: ['ckpt', 1], text: j.prompt } };
  let cond: [string, number] = ['pos', 0];
  if (j.redux) {
    g.rimg = { class_type: 'LoadImage', inputs: { image: await up(j.redux.image) } };
    g.cvl = { class_type: 'CLIPVisionLoader', inputs: { clip_name: 'sigclip_vision_patch14_384.safetensors' } };
    g.cve = { class_type: 'CLIPVisionEncode', inputs: { clip_vision: ['cvl', 0], image: ['rimg', 0], crop: 'center' } };
    g.sml = { class_type: 'StyleModelLoader', inputs: { style_model_name: 'flux1-redux-dev.safetensors' } };
    g.redux = { class_type: 'StyleModelApply', inputs: { conditioning: cond, style_model: ['sml', 0], clip_vision_output: ['cve', 0], strength: j.redux.strength, strength_type: j.redux.type ?? 'multiply' } };
    cond = ['redux', 0];
  }
  g.guided = { class_type: 'FluxGuidance', inputs: { conditioning: cond, guidance: j.guidance ?? 3.5 } };
  g.neg = { class_type: 'CLIPTextEncode', inputs: { clip: ['ckpt', 1], text: '' } };
  if (j.init) {
    g.img = { class_type: 'LoadImage', inputs: { image: await up(j.init, W, H) } };
    g.latent = { class_type: 'VAEEncode', inputs: { pixels: ['img', 0], vae: ['ckpt', 2] } };
  } else g.latent = { class_type: 'EmptySD3LatentImage', inputs: { width: W, height: H, batch_size: 1 } };
  g.sample = {
    class_type: 'KSampler',
    inputs: { model, positive: ['guided', 0], negative: ['neg', 0], latent_image: ['latent', 0], seed: j.seed ?? 4242, steps: j.steps ?? 28, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: j.init ? (j.denoise ?? 0.7) : 1 },
  };
  g.decode = { class_type: 'VAEDecode', inputs: { samples: ['sample', 0], vae: ['ckpt', 2] } };
  g.save = { class_type: 'SaveImage', inputs: { images: ['decode', 0], filename_prefix: 'village/style' } };
  return g;
}

async function sdxlIpGraph(j: Job, W: number, H: number): Promise<Record<string, unknown>> {
  const ip = j.ip!;
  const ckpt = ip.ckpt ?? 'DreamShaperXL_Turbo_v2_1.safetensors';
  const turbo = /turbo|lightning/i.test(ckpt);
  const g: Record<string, unknown> = {
    ckpt: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    anchor: { class_type: 'LoadImage', inputs: { image: await up(ip.image) } },
    ipLoader: { class_type: 'IPAdapterUnifiedLoader', inputs: { model: ['ckpt', 0], preset: 'PLUS (high strength)' } },
    ip: { class_type: 'IPAdapterAdvanced', inputs: { model: ['ipLoader', 0], ipadapter: ['ipLoader', 1], image: ['anchor', 0], weight: ip.weight, weight_type: ip.weightType ?? 'style transfer', combine_embeds: 'concat', start_at: 0, end_at: 1, embeds_scaling: 'V only' } },
    pos: { class_type: 'CLIPTextEncode', inputs: { clip: ['ckpt', 1], text: j.prompt } },
    neg: { class_type: 'CLIPTextEncode', inputs: { clip: ['ckpt', 1], text: j.negative ?? 'photo, 3d render, cartoon, anime, text, watermark, blurry, lowres, deformed' } },
    latent: { class_type: 'EmptyLatentImage', inputs: { width: W, height: H, batch_size: 1 } },
    sample: {
      class_type: 'KSampler',
      inputs: { model: ['ip', 0], positive: ['pos', 0], negative: ['neg', 0], latent_image: ['latent', 0], seed: j.seed ?? 4242, steps: j.steps ?? (turbo ? 10 : 32), cfg: turbo ? 2.2 : 6, sampler_name: turbo ? 'dpmpp_sde' : 'dpmpp_2m_sde', scheduler: 'karras', denoise: 1 },
    },
    decode: { class_type: 'VAEDecode', inputs: { samples: ['sample', 0], vae: ['ckpt', 2] } },
    save: { class_type: 'SaveImage', inputs: { images: ['decode', 0], filename_prefix: 'village/style-ip' } },
  };
  return g;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A tile with its label in a dark band underneath. */
export async function labelled(png: Buffer, label: string, tw: number): Promise<Buffer> {
  const img = await sharp(png).resize({ width: tw }).png().toBuffer();
  const { height = 0 } = await sharp(img).metadata();
  const band = 34;
  const svg = Buffer.from(`<svg width="${tw}" height="${band}"><rect width="100%" height="100%" fill="#1b1612"/><text x="8" y="23" font-family="Arial" font-size="17" fill="#f0e6d2">${esc(label)}</text></svg>`);
  return sharp({ create: { width: tw, height: height + band, channels: 3, background: '#1b1612' } })
    .composite([{ input: img, left: 0, top: 0 }, { input: svg, left: 0, top: height }])
    .png()
    .toBuffer();
}

export async function sheet(tiles: Buffer[], cols: number, file: string): Promise<void> {
  const metas = await Promise.all(tiles.map((t) => sharp(t).metadata()));
  const tw = Math.max(...metas.map((m) => m.width ?? 0));
  const th = Math.max(...metas.map((m) => m.height ?? 0));
  const rows = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: cols * tw + (cols + 1) * 8, height: rows * th + (rows + 1) * 8, channels: 3, background: '#0e0b09' } })
    .composite(tiles.map((t, i) => ({ input: t, left: 8 + (i % cols) * (tw + 8), top: 8 + Math.floor(i / cols) * (th + 8) })))
    .png()
    .toFile(file);
}

const tiles: Buffer[] = [];
for (const j of spec.jobs) {
  const [W, H] = (j.size ?? '1344x768').split('x').map(Number);
  const file = join(spec.out, `${j.name}.png`);
  let img: Buffer;
  if (existsSync(file)) img = readFileSync(file);
  else {
    const t0 = Date.now();
    const g = j.kind === 'sdxl-ip' ? await sdxlIpGraph(j, W, H) : await fluxGraph(j, W, H);
    // A LoRA on the fp8 FLUX checkpoint re-patches its weights while the unpatched copy
    // is still on the GPU, which can run a 24 GB card out of memory; ComfyUI unloads
    // everything after an OOM, so one more try usually fits.
    try {
      [img] = await comfy.run(g, 30 * 60_000);
    } catch (e) {
      if (!/OutOfMemory|Allocation on device/.test(String(e))) throw e;
      console.log(`style: ${j.name} ran out of GPU memory, trying once more`);
      await new Promise((r) => setTimeout(r, 3000));
      [img] = await comfy.run(g, 30 * 60_000);
    }
    writeFileSync(file, img);
    console.log(`style: ${j.name} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  tiles.push(await labelled(img, j.label ?? j.name, 640));
}
await sheet(tiles, spec.cols ?? 2, join(spec.out, 'sheet.png'));
console.log(`style: done, see ${join(spec.out, 'sheet.png')}`);
