// Inputs for the paint-over, from a harness render (.art-raw/<id>/<view>/<config>/):
// - colour.png: the render on a plain warm ground, sized for the image model
//   (the longest side SIZE, both sides multiples of 64), the building centred;
// - depth.png: near white, far black, the background black (ControlNet depth);
// - lines.png: the outline and the edges where the surface folds or steps back
//   (from the normal and depth passes; ControlNet line art keeps every timber and
//   window where the model has it);
// - mask.png: the building's alpha, to cut the painting back out exactly.
// All four share one frame, so the painting lands on the render pixel for pixel.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

/** A NumPy .npy array (float32, little-endian): its shape and data. */
export function readNpy(file: string): { shape: number[]; data: Float32Array } {
  const buf = readFileSync(file);
  const major = buf[6];
  const headerLen = major === 1 ? buf.readUInt16LE(8) : buf.readUInt32LE(8);
  const start = major === 1 ? 10 : 12;
  const header = buf.subarray(start, start + headerLen).toString('latin1');
  if (!/'descr':\s*'<f4'/.test(header)) throw new Error(`${file}: only little-endian float32 (got ${header})`);
  const shape = header.match(/'shape':\s*\(([^)]*)\)/)![1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const off = start + headerLen;
  const data = new Float32Array(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + buf.length));
  return { shape, data };
}

export const SIZE = 1024;

export interface Prepped {
  width: number;
  height: number;
  colour: Buffer;
  depth: Buffer;
  lines: Buffer;
  mask: Buffer;
  /** Where the render sits in the frame (to map the painting back to the render's size). */
  place: { left: number; top: number; scale: number; w: number; h: number };
  /** The building's crop of the render's own frame (render pixels). */
  crop: { x: number; y: number; w: number; h: number };
}

/** Prepare one render (a config folder of the harness's raw output) for painting. */
export async function prep(dir: string, ground = '#d9cdb4'): Promise<Prepped> {
  const colourImg = sharp(join(dir, 'color.png'));
  const meta = await colourImg.metadata();
  const W0 = meta.width!;
  const H0 = meta.height!;
  const full = await colourImg.ensureAlpha().raw().toBuffer();
  const depth0 = readNpy(join(dir, 'depth.npy')).data;
  const normal0 = readNpy(join(dir, 'normal.npy')).data;
  // crop to the building (the harness frame also holds the ground shadow and every stage)
  let bx0 = W0;
  let by0 = H0;
  let bx1 = 0;
  let by1 = 0;
  for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) if (full[(y * W0 + x) * 4 + 3] > 8) ((bx0 = Math.min(bx0, x)), (bx1 = Math.max(bx1, x)), (by0 = Math.min(by0, y)), (by1 = Math.max(by1, y)));
  const w = bx1 - bx0 + 1;
  const h = by1 - by0 + 1;
  const rgba = Buffer.alloc(w * h * 4);
  const depth = new Float32Array(w * h);
  const normal = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const j = (y + by0) * W0 + (x + bx0);
      full.copy(rgba, i * 4, j * 4, j * 4 + 4);
      depth[i] = depth0[j];
      normal.set(normal0.subarray(j * 3, j * 3 + 3), i * 3);
    }
  }

  // the frame: longest side SIZE, a margin round the building, multiples of 64
  const margin = 0.06;
  const scale = (SIZE * (1 - 2 * margin)) / Math.max(w, h);
  const sw = Math.round(w * scale);
  const sh = Math.round(h * scale);
  const W = Math.ceil((sw / (1 - 2 * margin)) / 64) * 64;
  const H = Math.ceil((sh / (1 - 2 * margin)) / 64) * 64;
  const left = Math.round((W - sw) / 2);
  const top = Math.round((H - sh) / 2);

  // depth: near white, normalised over the building (2nd to 98th percentile: a few stray pixels don't flatten it)
  const ds: number[] = [];
  for (let i = 0; i < w * h; i++) if (rgba[i * 4 + 3] >= 8 && Number.isFinite(depth[i])) ds.push(depth[i]);
  ds.sort((a, b) => a - b);
  const lo = ds[Math.floor(ds.length * 0.02)] ?? 0;
  const hi = ds[Math.floor(ds.length * 0.98)] ?? 1;
  const dImg = Buffer.alloc(w * h);
  const lImg = Buffer.alloc(w * h);
  const aImg = Buffer.alloc(w * h);
  const d = (i: number) => (rgba[i * 4 + 3] < 8 ? NaN : depth[i]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = rgba[i * 4 + 3];
      aImg[i] = a;
      if (a < 8) continue;
      // depth is "towards the camera": nearer is larger
      dImg[i] = Math.round(40 + 215 * Math.min(1, Math.max(0, (depth[i] - lo) / Math.max(1e-6, hi - lo))));
      // lines: the silhouette, and folds (normals turning) and steps (depth jumping)
      let edge = 0;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ]) {
        const j = (y + dy) * w + (x + dx);
        if (x + dx >= w || y + dy >= h) continue;
        if (Number.isNaN(d(j))) {
          edge = 1;
          continue;
        }
        const dot = normal[i * 3] * normal[j * 3] + normal[i * 3 + 1] * normal[j * 3 + 1] + normal[i * 3 + 2] * normal[j * 3 + 2];
        // sharp folds (a wall turning a corner, the eaves) and steps of more than 0.2 m (depth is in world units, 20 a metre)
        if (dot < 0.45) edge = Math.max(edge, 0.8);
        if (Math.abs(depth[i] - depth[j]) > 4) edge = 1;
      }
      if (x > 0 && Number.isNaN(d(i - 1))) edge = 1;
      if (y > 0 && Number.isNaN(d(i - w))) edge = 1;
      lImg[i] = Math.round(edge * 255);
    }
  }

  const place = async (img: ReturnType<typeof sharp>, channels: 1 | 3 | 4, bg: { r: number; g: number; b: number; alpha?: number }) =>
    img
      .resize(sw, sh, { kernel: channels === 1 ? 'lanczos3' : 'lanczos3' })
      .extend({ left, top, right: W - sw - left, bottom: H - sh - top, background: bg })
      .png()
      .toBuffer();
  const g = sharp({ create: { width: 1, height: 1, channels: 3, background: ground } });
  const gc = (await g.raw().toBuffer()) as Buffer;
  const groundRGB = { r: gc[0], g: gc[1], b: gc[2] };
  // the render flattened onto the plain ground
  const flat = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).flatten({ background: groundRGB }).toBuffer();
  const colour = await place(sharp(flat, { raw: { width: w, height: h, channels: 3 } }), 3, groundRGB);
  const depthPng = await place(sharp(dImg, { raw: { width: w, height: h, channels: 1 } }), 1, { r: 0, g: 0, b: 0 });
  // thicken the lines a touch for the bigger frame
  const linesPng = await place(sharp(lImg, { raw: { width: w, height: h, channels: 1 } }).dilate(1), 1, { r: 0, g: 0, b: 0 });
  const maskPng = await place(sharp(aImg, { raw: { width: w, height: h, channels: 1 } }), 1, { r: 0, g: 0, b: 0 });
  return { width: W, height: H, colour, depth: depthPng, lines: linesPng, mask: maskPng, place: { left, top, scale, w: sw, h: sh }, crop: { x: bx0, y: by0, w, h } };
}

/** Cut a painting (same frame as prep's) back out with the mask, cropped to the building. */
export async function cutOut(painting: Buffer, p: Prepped): Promise<Buffer> {
  const rgb = await sharp(painting).resize(p.width, p.height).removeAlpha().raw().toBuffer();
  const a = await sharp(p.mask).extractChannel(0).raw().toBuffer();
  const rgba = Buffer.alloc(p.width * p.height * 4);
  for (let i = 0; i < p.width * p.height; i++) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = a[i];
  }
  return sharp(rgba, { raw: { width: p.width, height: p.height, channels: 4 } }).extract({ left: p.place.left, top: p.place.top, width: p.place.w, height: p.place.h }).png().toBuffer();
}
