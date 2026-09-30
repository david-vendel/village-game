// Shared drawing helpers and scene constants.

/** Logical view height; the canvas is scaled so this always fills the screen. */
export const VIEW_H = 540;
/** Top of the road; buildings stand just behind it. */
export const GROUND_Y = 432;
/** Rider / villager foot line on the road. */
export const ROAD_Y = 474;

export type Ctx = CanvasRenderingContext2D;

/** Stable pseudo-random 0..1 from an integer (and optional salt). */
export function hash(n: number, salt = 0): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x27d4eb2f, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Mix two #rrggbb colours. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

/** Darken (t<0) or lighten (t>0) a #rrggbb colour. */
export function shade(c: string, t: number): string {
  return t < 0 ? mix(c, '#000000', -t) : mix(c, '#ffffff', t);
}

export function poly(ctx: Ctx, pts: number[], fill?: string, stroke?: string, lw = 1): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

export function circle(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, stroke: string, lw = 1): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}

/** Rising, drifting chimney smoke — stateless, driven by time. */
export function smoke(ctx: Ctx, x: number, y: number, time: number, seed: number, strength = 1): void {
  for (let i = 0; i < 7; i++) {
    const t = (time * 0.18 + i / 7 + hash(seed, i) * 0.05) % 1;
    const px = x + Math.sin(t * 5 + seed) * 5 + t * 28;
    const py = y - t * 70;
    const r = 3 + t * 11;
    ctx.globalAlpha = (1 - t) * 0.35 * strength * clamp01(t * 6);
    circle(ctx, px, py, r, '#d9d4cc');
  }
  ctx.globalAlpha = 1;
}
