// npm run paint:tile -- <painted.png> <name> [--size 512]
//
// Makes a painted texture seamless and puts it in the game: the picture is blended
// with a copy of itself shifted by half (whose middle runs on across the edges), the
// copy taking over towards the edges, so the texture repeats without seams. Writes
// public/textures/<name>.webp and records its mean colour in
// public/textures/manifest.json (the renderer keeps a material's own colour as the
// mean and takes only the texture's variation: build3d/materials.ts).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const [src, name] = process.argv.slice(2);
const sizeArg = process.argv.indexOf('--size');
const SIZE = sizeArg >= 0 ? Number(process.argv[sizeArg + 1]) : 512;
if (!src || !name) {
  console.error('usage: npm run paint:tile -- <painted.png> <name> [--size 512]');
  process.exit(2);
}
const N = 1024;
const img = await sharp(readFileSync(src)).resize(N, N, { fit: 'cover' }).removeAlpha().raw().toBuffer();
const out = Buffer.alloc(N * N * 3);
const band = N * 0.28;
const smooth = (t: number) => t * t * (3 - 2 * t);
let sum = [0, 0, 0];
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    // weight of the shifted copy: 1 at the edges, 0 over the middle lines (where the copy has its seams)
    const d = Math.min(x, N - 1 - x, y, N - 1 - y);
    const m = 1 - smooth(Math.min(1, d / band));
    const i = (y * N + x) * 3;
    const j = (((y + N / 2) % N) * N + ((x + N / 2) % N)) * 3;
    for (let c = 0; c < 3; c++) {
      const v = img[i + c] * (1 - m) + img[j + c] * m;
      out[i + c] = v;
      sum[c] += v;
    }
  }
}
sum = sum.map((v) => v / (N * N));
const dir = 'public/textures';
mkdirSync(dir, { recursive: true });
await sharp(out, { raw: { width: N, height: N, channels: 3 } }).resize(SIZE, SIZE).webp({ quality: 90 }).toFile(join(dir, `${name}.webp`));
const mf = join(dir, 'manifest.json');
const manifest: Record<string, { file: string; mean: [number, number, number]; source: string }> = existsSync(mf) ? JSON.parse(readFileSync(mf, 'utf8')) : {};
manifest[name] = { file: `${name}.webp`, mean: sum.map((v) => Math.round(v)) as [number, number, number], source: src };
writeFileSync(mf, JSON.stringify(manifest, null, 2));
console.log(`tile: ${name} from ${src}, mean ${manifest[name].mean.join(',')}`);
