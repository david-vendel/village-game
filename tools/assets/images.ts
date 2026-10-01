// Image helpers shared by the asset tools: alpha bleed, encoding, and reading
// the raw float passes the Blender harness writes (.npy).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import sharp from 'sharp';

sharp.cache(false);

/**
 * Dilate colour into fully transparent pixels (§6), `steps` px: each
 * transparent pixel next to a coloured one takes their mean colour, alpha
 * staying 0, so filtering a scaled sprite never pulls in black.
 */
export function bleed(px: Uint8ClampedArray, w: number, h: number, steps: number): void {
  const filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) filled[i] = px[i * 4 + 3] > 0 ? 1 : 0;
  for (let s = 0; s < steps; s++) {
    const next: Array<[number, number, number, number]> = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (filled[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h || !filled[yy * w + xx]) continue;
            const j = (yy * w + xx) * 4;
            r += px[j];
            g += px[j + 1];
            b += px[j + 2];
            n++;
          }
        }
        if (n) next.push([i, r / n, g / n, b / n]);
      }
    }
    if (!next.length) break;
    for (const [i, r, g, b] of next) {
      px[i * 4] = r;
      px[i * 4 + 1] = g;
      px[i * 4 + 2] = b;
      filled[i] = 1;
    }
  }
}

export async function writeWebp(file: string, px: Uint8ClampedArray, w: number, h: number): Promise<void> {
  mkdirSync(dirname(file), { recursive: true });
  // `exact` keeps the colour under transparent pixels (the bleed) instead of letting the encoder drop it
  await sharp(Buffer.from(px.buffer, px.byteOffset, px.byteLength), { raw: { width: w, height: h, channels: 4 } })
    .webp({ quality: 90, alphaQuality: 100, exact: true, effort: 4 })
    .toFile(file);
}

/** A float32 array saved by numpy (np.save): shape and data. Little-endian '<f4' only. */
export function readNpy(file: string): { shape: number[]; data: Float32Array } {
  const buf = readFileSync(file);
  if (buf.toString('latin1', 1, 6) !== 'NUMPY') throw new Error(`${file}: not a .npy file`);
  const major = buf[6];
  const headerLen = major === 1 ? buf.readUInt16LE(8) : buf.readUInt32LE(8);
  const start = major === 1 ? 10 : 12;
  const header = buf.toString('latin1', start, start + headerLen);
  if (!/'descr':\s*'<f4'/.test(header)) throw new Error(`${file}: expected float32 data, header ${header.trim()}`);
  if (/'fortran_order':\s*True/.test(header)) throw new Error(`${file}: Fortran order not supported`);
  const shape = /'shape':\s*\(([^)]*)\)/.exec(header)![1].split(',').map((x) => x.trim()).filter(Boolean).map(Number);
  const off = start + headerLen;
  const bytes = buf.subarray(off, off + shape.reduce((a, b) => a * b, 1) * 4);
  return { shape, data: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) };
}

/** Write raw 8-bit pixels (1-4 channels) as lossless WebP. */
export async function writeLossless(file: string, px: Uint8Array | Uint8ClampedArray, w: number, h: number, channels: 1 | 3 | 4): Promise<void> {
  mkdirSync(dirname(file), { recursive: true });
  await sharp(Buffer.from(px.buffer, px.byteOffset, px.byteLength), { raw: { width: w, height: h, channels } })
    .webp({ lossless: true, exact: true, effort: 4 })
    .toFile(file);
}

/** Write 16-bit greyscale as PNG. */
export async function writeGrey16(file: string, px: Uint16Array, w: number, h: number): Promise<void> {
  mkdirSync(dirname(file), { recursive: true });
  // a Uint16Array (not a Buffer) tells sharp the samples are 16-bit
  const png = await sharp(px, { raw: { width: w, height: h, channels: 1 } })
    .toColourspace('grey16')
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(file, png);
}
