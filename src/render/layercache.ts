// Backdrop layers that only slide sideways as the view pans (the far ridges): drawn once into an
// image a little wider than the screen and slid across, instead of filling their long outlines at
// full resolution every frame (that was most of what the backdrop cost the GPU).

import type { Ctx } from './util';

/** How far past each side of the screen a layer is drawn (local units): it slides this far before it is drawn again. */
const MARGIN = 240;

interface Layer {
  canvas: HTMLCanvasElement;
  key: string;
  /** The pan offset it was drawn at. */
  off: number;
}
const layers = new Map<string, Layer>();

/**
 * Draw a layer that depends on nothing but its pan offset: `draw(g, off, width)` paints it as
 * `off` pans it, across local x 0..width, between local y `top` and `bottom`. The picture is kept
 * and slid while the pan stays within MARGIN of where it was drawn; a new zoom or screen size
 * draws it again. It lands on whole device pixels, so it stays as sharp as drawn.
 */
export function drawPanned(ctx: Ctx, name: string, off: number, width: number, top: number, bottom: number, draw: (g: Ctx, off: number, width: number) => void): void {
  const m = ctx.getTransform();
  const s = Math.hypot(m.a, m.b);
  const key = `${s.toFixed(4)}:${width.toFixed(1)}:${top}:${bottom}`;
  let layer = layers.get(name);
  if (!layer || layer.key !== key || Math.abs(off - layer.off) > MARGIN - 10) {
    const canvas = layer?.canvas ?? document.createElement('canvas');
    const w = Math.ceil((width + 2 * MARGIN) * s);
    const h = Math.ceil((bottom - top) * s);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(s, 0, 0, s, 0, -top * s);
    // its left edge MARGIN off the screen's
    draw(g, off - MARGIN, width + 2 * MARGIN);
    layer = { canvas, key, off };
    layers.set(name, layer);
  }
  // where its left edge is now, in device pixels
  const x = layer.off - off - MARGIN;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer.canvas, Math.round(m.a * x + m.c * top + m.e), Math.round(m.b * x + m.d * top + m.f));
  ctx.restore();
}
