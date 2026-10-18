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
import { backdropShift, HORIZON_Y } from './ground';
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
  return [v.width * (0.06 + 0.88 * across) - v.camX * 0.01, HORIZON_Y + 10 - altitude * 230];
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
  // the sky meets the backdrop's hills (ground.ts backdropShift)
  sky.translate(0, backdropShift());
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
  const at = (y: number) => (y - top) / (HORIZON_Y - top);
  const g = ctx.createLinearGradient(0, top, 0, HORIZON_Y);
  g.addColorStop(0, top < 0 ? shade(zenith, -0.2) : zenith);
  g.addColorStop(at(0), zenith);
  g.addColorStop(at(HORIZON_Y * 0.35), high);
  g.addColorStop(at(HORIZON_Y * 0.7), low);
  g.addColorStop(1, horizon);
  ctx.fillStyle = g;
  ctx.fillRect(0, top, v.width, VIEW_H - top);

  drawStars(ctx, v, light);

  // moon: opposite the sun, a big pale disc with its seas, a halo round it and a wide glow
  const moonPhase = (light.phase + 0.5) % 1;
  const moonAlt = -light.sun;
  if (moonAlt > -0.15) {
    const [mx, my] = bodyPos(v, moonPhase, moonAlt);
    const R = 21;
    const glow = ctx.createRadialGradient(mx, my, 0, mx, my, 260);
    glow.addColorStop(0, `rgba(205,220,255,${0.42 * light.night})`);
    glow.addColorStop(0.18, `rgba(170,190,240,${0.16 * light.night})`);
    glow.addColorStop(1, 'rgba(160,180,240,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(mx - 260, my - 260, 520, 520);
    // a faint ring of ice crystals
    ctx.globalAlpha = 0.12 * light.night;
    ctx.strokeStyle = '#dfe6ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mx, my, R * 3.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.3 + 0.7 * light.night;
    const disc = ctx.createRadialGradient(mx - R * 0.3, my - R * 0.3, 0, mx, my, R);
    disc.addColorStop(0, '#fffdf2');
    disc.addColorStop(0.75, '#efecd8');
    disc.addColorStop(1, '#d8d4bf');
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(mx, my, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha *= 0.32;
    for (const [dx, dy, r] of [
      [-6, -5, 5],
      [6, 4, 4],
      [3, -9, 2.6],
      [-3, 8, 3],
      [9, -3, 2],
    ])
      circle(ctx, mx + dx, my + dy, r, '#b9b49e');
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

/** The star field, made once: places in a repeating tile, size, colour, brightness, twinkle; the Milky Way's denser. */
const STARS: Array<{ x: number; y: number; r: number; c: string; a: number; tw: number }> = [];
const STAR_TILE = 1400;
const STAR_COLOURS = ['#f4f1ff', '#f4f1ff', '#f4f1ff', '#dfe7ff', '#fff1d8', '#ffe2c4', '#cfdcff'];
/** The Milky Way: a band from low on the left up across the sky (y = a + b·x in the tile, half-width w). */
const BAND = { a: 150, b: -0.085, w: 70 };
function makeStars(): void {
  if (STARS.length) return;
  for (let i = 0; i < 1400; i++) {
    const x = hash(i, 101) * STAR_TILE;
    // most stars anywhere; a third gathered into the band
    const inBand = i % 2 === 0;
    const y = inBand ? BAND.a + BAND.b * x + (hash(i, 106) - 0.5) * 2 * BAND.w * hash(i, 107) : hash(i, 102) * HORIZON_Y;
    const big = hash(i, 105);
    STARS.push({ x, y, r: big > 0.985 ? 2.2 : big > 0.9 ? 1.5 : inBand ? 0.7 : 1, c: STAR_COLOURS[Math.floor(hash(i, 108) * STAR_COLOURS.length)], a: 0.35 + 0.65 * hash(i, 104), tw: 1 + hash(i, 103) * 2.5 });
  }
}

function drawStars(ctx: Ctx, v: View, light: Light): void {
  if (light.night <= 0) return;
  makeStars();
  const top = Math.min(0, v.top);
  const off = v.camX * 0.005; // drifting very slowly with the camera
  for (let tile = Math.floor(off / STAR_TILE) - 1; tile * STAR_TILE - off < v.width; tile++) {
    const ox = tile * STAR_TILE - off;
    if (ox > v.width || ox + STAR_TILE < 0) continue;
    // the Milky Way's glow: soft clouds along the band, a darker lane of dust down its middle
    for (let k = 0; k <= 28; k++) {
      const x = (STAR_TILE * k) / 28;
      const y = BAND.a + BAND.b * x + (hash(k + tile * 31, 121) - 0.5) * 20;
      // a wide faint haze, and a brighter, warmer core of clouds along it
      for (const [rad, alpha, col] of [
        [BAND.w * (1.3 + 0.6 * hash(k + tile * 31, 120)), 0.14, '185,200,255'],
        [BAND.w * (0.45 + 0.35 * hash(k + tile * 31, 122)), 0.2, '235,225,255'],
      ] as const) {
        const g = ctx.createRadialGradient(ox + x, y, 0, ox + x, y, rad);
        g.addColorStop(0, `rgba(${col},${alpha * light.night})`);
        g.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(ox + x - rad, y - rad, rad * 2, rad * 2);
      }
    }
    // the dark lane of dust down its middle: soft, a few wide faint strokes
    ctx.strokeStyle = '#0b1028';
    ctx.lineCap = 'round';
    for (const [lw, al] of [
      [18, 0.05],
      [10, 0.07],
      [4, 0.08],
    ] as const) {
      ctx.globalAlpha = al * light.night;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(ox, BAND.a + 6);
      for (let x = 0; x <= STAR_TILE; x += 70) ctx.lineTo(ox + x, BAND.a + BAND.b * x + 6 + Math.sin(x * 0.017) * 9);
      ctx.stroke();
    }
    for (const st of STARS) {
      const x = ox + st.x;
      if (x < -3 || x > v.width + 3 || st.y < top) continue;
      const twinkle = 0.65 + 0.35 * Math.sin(v.time * st.tw + st.x);
      ctx.globalAlpha = light.night * st.a * twinkle * clamp01((HORIZON_Y - st.y) / 60);
      ctx.fillStyle = st.c;
      ctx.fillRect(x - st.r / 2, st.y - st.r / 2, st.r, st.r);
      // the brightest with a little cross of light
      if (st.r > 2) {
        ctx.globalAlpha *= 0.5;
        ctx.fillRect(x - 3, st.y - 0.3, 6, 0.6);
        ctx.fillRect(x - 0.3, st.y - 3, 0.6, 6);
      }
    }
  }
  // now and then a shooting star
  const n = Math.floor(v.time / 9);
  const t = (v.time % 9) / 0.8;
  if (t < 1 && hash(n, 130) < 0.5) {
    const sx = hash(n, 131) * v.width;
    const sy = 20 + hash(n, 132) * (HORIZON_Y * 0.5);
    ctx.globalAlpha = light.night * (1 - t) * 0.9;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(sx + t * 90, sy + t * 30);
    ctx.lineTo(sx + t * 90 - 40, sy + t * 30 - 13);
    ctx.stroke();
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
    const y = 30 + hash(i, 2) * 100 + Math.min(0, v.top) * hash(i, 5) * 0.8;
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
