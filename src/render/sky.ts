// Sky and daylight. The time of day comes from the game (daynight.ts); this
// turns it into how the world looks: the sky's colours, the sun crossing it
// from dawn to dusk, the moon and stars at night, cloud colours, and a tint
// that darkens the land at night and warms it at dawn and dusk.
//
// Draw order: the land is drawn first, then tinted (source-atop, so only land
// pixels are touched), then the sky is composited *behind* it. That keeps the
// night sky, moon and stars bright while the land around them darkens.

import { dayPhase, sunNow } from '../game/daynight';
import type { World } from '../game/world';
import type { View } from './background';
import { circle, clamp01, type Ctx, ellipse, hash, lerp, mix, shade, VIEW_H } from './util';

export interface Light {
  /** 0..1 through the day (0 midnight, 0.5 noon). */
  phase: number;
  /** Sun height: -1 midnight … 1 noon. */
  sun: number;
  /** 0 by day … 1 at full night. */
  night: number;
  /** 0 … 1 around sunrise and sunset. */
  dusk: number;
}

export function lightAt(world: World): Light {
  const phase = dayPhase(world);
  const sun = sunNow(world);
  return {
    phase,
    sun,
    night: clamp01((0.1 - sun) / 0.3),
    dusk: clamp01(1 - Math.abs(sun - 0.02) / 0.22),
  };
}

// Sky gradients (zenith → horizon) for key sun heights; blended in between.
type Palette = [string, string, string, string];
const PALETTES: Array<[number, Palette]> = [
  [-0.2, ['#070b1c', '#0f1733', '#1c2645', '#252e4d']], // night
  [0, ['#3c4a82', '#8c6f93', '#e9a07a', '#f4b27c']], // sunrise / sunset
  [0.2, ['#5f7fb3', '#9fb3c9', '#ecd3a6', '#f6ddb0']], // low golden sun
  [0.55, ['#4a78bd', '#86acd6', '#c9dbe6', '#e6ebe2']], // midday
];

function skyPalette(sun: number): Palette {
  if (sun <= PALETTES[0][0]) return PALETTES[0][1];
  for (let i = 1; i < PALETTES.length; i++) {
    const [s1, p1] = PALETTES[i];
    if (sun <= s1) {
      const [s0, p0] = PALETTES[i - 1];
      const t = (sun - s0) / (s1 - s0);
      return p0.map((c, k) => mix(c, p1[k], t)) as Palette;
    }
  }
  return PALETTES[PALETTES.length - 1][1];
}

/**
 * Where a body stands: it crosses the view left to right over half a day
 * (from phase 0.25 to 0.75 for the sun), as high as its altitude.
 */
function bodyPos(v: View, phase: number, altitude: number): [number, number] {
  const across = (phase - 0.25) / 0.5;
  return [v.width * (0.06 + 0.88 * across) - v.camX * 0.01, 350 - altitude * 250];
}

// --- Drawing -------------------------------------------------------------------

let skyCanvas: HTMLCanvasElement | null = null;

/** Paint the sky behind everything drawn so far (see the draw order note above). */
export function drawSkyBehind(ctx: Ctx, v: View, light: Light): void {
  const { width, height } = ctx.canvas;
  skyCanvas ??= document.createElement('canvas');
  if (skyCanvas.width !== width || skyCanvas.height !== height) {
    skyCanvas.width = width;
    skyCanvas.height = height;
  }
  const sky = skyCanvas.getContext('2d')!;
  sky.setTransform(1, 0, 0, 1, 0, 0);
  sky.clearRect(0, 0, width, height);
  sky.setTransform(ctx.getTransform());
  drawSky(sky, v, light);
  drawClouds(sky, v, light);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.drawImage(skyCanvas, 0, 0);
  ctx.restore();
}

/** Darken the land at night and warm it at dawn and dusk (only where land is drawn). */
export function tintLand(ctx: Ctx, v: View, light: Light): void {
  const h = Math.max(VIEW_H, v.bottom) - v.top;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  if (light.dusk > 0) {
    ctx.fillStyle = `rgba(255,130,60,${0.16 * light.dusk})`;
    ctx.fillRect(0, v.top, v.width, h);
  }
  if (light.night > 0) {
    ctx.fillStyle = `rgba(10,16,44,${0.62 * light.night})`;
    ctx.fillRect(0, v.top, v.width, h);
  }
  ctx.restore();
}

function drawSky(ctx: Ctx, v: View, light: Light): void {
  // Stops are defined in world y so the horizon stays put; extra sky above y=0
  // (when zoomed out) deepens towards the zenith.
  const [zenith, high, low, horizon] = skyPalette(light.sun);
  const top = Math.min(0, v.top);
  const at = (y: number) => (y - top) / (380 - top);
  const g = ctx.createLinearGradient(0, top, 0, 380);
  g.addColorStop(0, top < 0 ? shade(zenith, -0.2) : zenith);
  g.addColorStop(at(0), zenith);
  g.addColorStop(at(133), high);
  g.addColorStop(at(266), low);
  g.addColorStop(1, horizon);
  ctx.fillStyle = g;
  ctx.fillRect(0, top, v.width, VIEW_H - top);

  drawStars(ctx, v, light);

  // moon: opposite the sun
  const moonPhase = (light.phase + 0.5) % 1;
  const moonAlt = -light.sun;
  if (moonAlt > -0.15) {
    const [mx, my] = bodyPos(v, moonPhase, moonAlt);
    const glow = ctx.createRadialGradient(mx, my, 0, mx, my, 120);
    glow.addColorStop(0, `rgba(220,228,255,${0.35 * light.night})`);
    glow.addColorStop(1, 'rgba(220,228,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(mx - 120, my - 120, 240, 240);
    ctx.globalAlpha = 0.25 + 0.75 * light.night;
    circle(ctx, mx, my, 15, '#f4f1e0');
    ctx.globalAlpha *= 0.35;
    circle(ctx, mx - 4, my - 3, 3.5, '#c9c4b0');
    circle(ctx, mx + 5, my + 4, 2.5, '#c9c4b0');
    circle(ctx, mx + 2, my - 6, 1.8, '#c9c4b0');
    ctx.globalAlpha = 1;
  }

  // sun: warmer and redder the lower it stands
  if (light.sun > -0.15) {
    const [sx, sy] = bodyPos(v, light.phase, light.sun);
    const warm = clamp01(1 - light.sun / 0.35);
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 380);
    glow.addColorStop(0, 'rgba(255,244,214,0.95)');
    glow.addColorStop(0.08, warm > 0.5 ? 'rgba(255,200,130,0.8)' : 'rgba(255,230,170,0.75)');
    glow.addColorStop(0.35, `rgba(255,${Math.round(lerp(205, 150, warm))},${Math.round(lerp(140, 90, warm))},${0.25 + 0.15 * warm})`);
    glow.addColorStop(1, 'rgba(255,200,140,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, top, v.width, VIEW_H - top);
    circle(ctx, sx, sy, 22, mix('#fff6de', '#ffb070', warm));
  }
}

function drawStars(ctx: Ctx, v: View, light: Light): void {
  if (light.night <= 0) return;
  const top = Math.min(0, v.top);
  const T = 900; // the star field repeats every T px, drifting very slowly with the camera
  const off = v.camX * 0.005;
  for (let tile = Math.floor(off / T) - 1; tile * T - off < v.width; tile++) {
    for (let i = 0; i < 70; i++) {
      const x = tile * T + hash(i, 101) * T - off;
      if (x < -2 || x > v.width + 2) continue;
      const y = top + hash(i, 102) * (330 - top);
      const twinkle = 0.7 + 0.3 * Math.sin(v.time * (1 + hash(i, 103) * 2) + i);
      ctx.globalAlpha = light.night * twinkle * (0.4 + 0.6 * hash(i, 104)) * clamp01((330 - y) / 120);
      const r = hash(i, 105) < 0.9 ? 0.9 : 1.6;
      ctx.fillStyle = '#f4f1ff';
      ctx.fillRect(x - r / 2, y - r / 2, r, r);
    }
  }
  ctx.globalAlpha = 1;
}

function drawClouds(ctx: Ctx, v: View, light: Light): void {
  // lit top and shaded underside follow the light: pale by day, pink at dusk, slate at night
  const litTop = mix(mix('#fbead6', '#ffc6a0', light.dusk), '#39426a', light.night);
  const underside = mix(mix('#d8b9a5', '#b98a8a', light.dusk), '#262d4d', light.night);
  const T = 520;
  const off = v.camX * 0.03 - v.time * 3;
  const i0 = Math.floor(off / T) - 1;
  for (let i = i0; i < i0 + v.width / T + 3; i++) {
    const x = i * T - off + hash(i, 1) * 200;
    // when zoomed out, some clouds drift higher into the extra sky
    const y = 50 + hash(i, 2) * 110 + Math.min(0, v.top) * hash(i, 5) * 0.8;
    const s = 0.6 + hash(i, 3) * 0.8;
    ctx.globalAlpha = 0.55 + hash(i, 4) * 0.3;
    for (let k = 0; k < 6; k++) {
      const cx = x + (k - 2.5) * 26 * s + hash(i, 10 + k) * 12;
      const cy = y + Math.abs(k - 2.5) * 4 * s;
      ellipse(ctx, cx, cy + 6 * s, 30 * s, 12 * s, underside);
    }
    for (let k = 0; k < 5; k++) {
      const cx = x + (k - 2) * 24 * s + hash(i, 20 + k) * 10;
      const cy = y - 4 * s - hash(i, 30 + k) * 10 * s;
      ellipse(ctx, cx, cy, 26 * s, 14 * s, litTop);
    }
  }
  ctx.globalAlpha = 1;
}
