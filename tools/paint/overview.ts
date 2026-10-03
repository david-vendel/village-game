// npx tsx tools/paint/overview.ts --list <list.json>
//
// One labelled comparison sheet from pictures already painted.
// list.json: { "out": "file.png", "cols": 3, "tile": 640, "items": [ { "file", "label" } ] }

import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const i = process.argv.indexOf('--list');
if (i < 0) {
  console.error('usage: npx tsx tools/paint/overview.ts --list list.json');
  process.exit(2);
}
const spec = JSON.parse(readFileSync(process.argv[i + 1], 'utf8')) as { out: string; cols?: number; tile?: number; items: Array<{ file: string; label: string }> };
const tw = spec.tile ?? 640;
const cols = spec.cols ?? 3;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const band = 34;

const tiles = await Promise.all(
  spec.items.map(async (it) => {
    const img = await sharp(readFileSync(it.file)).resize({ width: tw }).png().toBuffer();
    const { height = 0 } = await sharp(img).metadata();
    return { img, height, label: it.label };
  }),
);
const th = Math.max(...tiles.map((t) => t.height)) + band;
const rows = Math.ceil(tiles.length / cols);
const parts: Array<{ input: Buffer; left: number; top: number }> = [];
tiles.forEach((t, k) => {
  const left = 8 + (k % cols) * (tw + 8);
  const top = 8 + Math.floor(k / cols) * (th + 8);
  parts.push({ input: t.img, left, top });
  const svg = `<svg width="${tw}" height="${band}"><rect width="100%" height="100%" fill="#1b1612"/><text x="8" y="23" font-family="Arial" font-size="17" fill="#f0e6d2">${esc(t.label)}</text></svg>`;
  parts.push({ input: Buffer.from(svg), left, top: top + th - band });
});
await sharp({ create: { width: cols * tw + (cols + 1) * 8, height: rows * th + (rows + 1) * 8, channels: 3, background: '#0e0b09' } })
  .composite(parts)
  .png()
  .toFile(spec.out);
console.log(`overview: ${spec.out}`);
