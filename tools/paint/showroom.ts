// npm run paint:showroom -- [spec.json]
//
// Gathers the art experiments into the game's showroom (render/showroom.ts): each
// picture from the spec (default tools/paint/showroom.json) becomes
// public/showroom/<n>.webp, a building cut out of its plain background (flood fill
// from the edges, edges softened, trimmed) or a scene kept whole to hang framed,
// and public/showroom/manifest.json lists them with their labels and sizes.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

interface Item {
  /** Its number in the showroom (#n): kept when others are added or dropped. */
  n: number;
  src: string;
  label: string;
  /** cutout: a building on a plain background; framed: a whole scene. */
  kind: 'cutout' | 'framed';
  /** How wide it stands in the street (metres; a farm's plot is 7.5). */
  width?: number;
  /** A crop of the source first: [left, top, width, height] in its pixels. */
  crop?: [number, number, number, number];
}

const specFile = process.argv[2] ?? 'tools/paint/showroom.json';
const items: Item[] = JSON.parse(readFileSync(specFile, 'utf8'));
const out = 'public/showroom';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/** Make the plain background round a building transparent: flood fill from the border by colour distance. */
async function cutout(img: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  // a picture with a transparent background already (a render, a cut-out): keep its own alpha
  let clear = 0;
  for (let x = 0; x < w; x++) if (data[x * 4 + 3] < 250 || data[((h - 1) * w + x) * 4 + 3] < 250) clear++;
  if (clear > w * 0.5) return sharp(data, { raw: { width: w, height: h, channels: 4 } }).trim({ threshold: 1 }).png().toBuffer();
  const px = (i: number) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
  const median = (list: number[][]) => [0, 1, 2].map((c) => list.map((p) => p[c]).sort((a, b) => a - b)[list.length >> 1]);
  const TOL = 34;
  const bg = new Uint8Array(w * h);
  let med = [0, 0, 0];
  const dist = (i: number) => {
    const p = px(i);
    return Math.hypot(p[0] - med[0], p[1] - med[1], p[2] - med[2]);
  };
  /** Fill from these seeds everything within TOL of `med`, connected. */
  const fill = (seeds: number[]) => {
    const stack: number[] = [];
    const push = (i: number) => {
      if (!bg[i] && dist(i) < TOL) {
        bg[i] = 1;
        stack.push(i);
      }
    };
    seeds.forEach(push);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i / w) | 0;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w);
      if (y < h - 1) push(i + w);
    }
  };
  // the background: the border's colour; then, layer by layer (black bars round a pale ground), the
  // colour just inside what's been taken, while that is a uniform band
  let seeds: number[] = [];
  for (let x = 0; x < w; x++) seeds.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) seeds.push(y * w, y * w + w - 1);
  for (let pass = 0; pass < 3 && seeds.length; pass++) {
    const cols = seeds.filter((_, k) => k % 3 === 0).map(px);
    med = median(cols);
    // a uniform band: most seeds near the median
    const near = cols.filter((c) => Math.hypot(c[0] - med[0], c[1] - med[1], c[2] - med[2]) < TOL).length;
    if (pass > 0 && near < cols.length * 0.6) break;
    fill(seeds);
    // the next layer: pixels just inside the filled region
    const next: number[] = [];
    for (let i = 0; i < w * h; i++) {
      if (bg[i]) continue;
      const x = i % w;
      const y = (i / w) | 0;
      if ((x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (y > 0 && bg[i - w]) || (y < h - 1 && bg[i + w])) next.push(i);
    }
    seeds = next;
  }
  // alpha: background out; a soft edge where background meets the building (by colour distance)
  for (let i = 0; i < w * h; i++) {
    if (bg[i]) data[i * 4 + 3] = 0;
    else {
      const x = i % w;
      const y = (i / w) | 0;
      const nearBg = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (y > 0 && bg[i - w]) || (y < h - 1 && bg[i + w]);
      if (nearBg) data[i * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0.25, dist(i) / (TOL * 2.2))));
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).trim({ threshold: 1 }).png().toBuffer();
}

const manifest: Array<{ n: number; file: string; label: string; kind: string; width: number; aspect: number }> = [];
for (const [n, it] of items.entries()) {
  let img = readFileSync(it.src);
  if (it.crop) img = await sharp(img).extract({ left: it.crop[0], top: it.crop[1], width: it.crop[2], height: it.crop[3] }).png().toBuffer();
  // black bars round a painting (FLUX keeps them from a padded starting image) come off first
  if (it.kind === 'cutout') img = await sharp(img).trim({ background: '#000000', threshold: 40 }).png().toBuffer().catch(() => img);
  const pic = it.kind === 'cutout' ? await cutout(img) : await sharp(img).png().toBuffer();
  const meta = await sharp(pic).metadata();
  const file = `${n}.webp`;
  await sharp(pic).resize({ width: Math.min(meta.width!, 900) }).webp({ quality: 88, alphaQuality: 95 }).toFile(join(out, file));
  manifest.push({ n: it.n, file, label: it.label, kind: it.kind, width: it.width ?? (it.kind === 'framed' ? 9 : 7.5), aspect: meta.height! / meta.width! });
  console.log(`showroom: ${file} ${it.label}`);
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`showroom: ${manifest.length} pictures in ${out}`);
