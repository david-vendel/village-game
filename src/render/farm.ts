// Farm fields, crops, the farmer and the grain store. Positions come from the
// simulation geometry in game/farm.ts (world y), shifted onto the building's
// screen base so the same art works in the street and in menu previews.

import {
  BACK_DX,
  BACK_FIELD,
  type FarmState,
  type Farmer,
  type FieldPlot,
  FRONT_DX,
  FRONT_FIELD,
  growth,
  HARVEST_TIME,
  PLOT_W,
  SOW_TIME,
  STORE,
} from '../game/farm';
import { BASE_Y, VIEW_H } from '../game/layout';
import { circle, clamp01, type Ctx, ellipse, hash, lerp, line, mix, poly } from './util';

/** Back-field rows lean right as they recede (matches the oblique buildings). */
const SKEW = 30;
const SOIL = '#7a5a3a';
const SOIL_DARK = '#5e4329';

interface Anchor {
  x: number;
  base: number;
  time: number;
}

const toScreenY = (a: Anchor, y: number) => a.base + (y - BASE_Y);

// --- Crops -----------------------------------------------------------------

/** Colour and height of a crop at growth g (0..1). */
function cropLook(g: number): { color: string; tip: string; h: number } {
  if (g < 0.2) return { color: '#8fbf4a', tip: '#a9d060', h: 1.5 + g * 12 };
  if (g < 0.7) {
    const t = (g - 0.2) / 0.5;
    return { color: mix('#6f9a3a', '#5f8a30', t), tip: '#8fbf4a', h: lerp(4, 12, t) };
  }
  const t = (g - 0.7) / 0.3;
  return { color: mix('#7f9a3a', '#c9a445', t), tip: mix('#9fb04a', '#e8c86a', t), h: lerp(12, 16, t) };
}

/** One stalk, with a grain head once nearly ripe. */
function stalk(ctx: Ctx, x: number, y: number, h: number, g: number, sway: number, color: string, tip: string, lw: number): void {
  line(ctx, x, y, x + sway, y - h, color, lw);
  if (g >= 0.85) ellipse(ctx, x + sway, y - h - lw, lw * 0.9, lw * 2.2, tip, sway * 0.08);
  else if (g >= 0.2) line(ctx, x, y - h * 0.5, x + sway * 0.5 + h * 0.3, y - h * 0.75, color, lw * 0.8); // leaf
}

// --- Back field (behind the farmstead) --------------------------------------------

function backPoint(a: Anchor, u: number, t: number): [number, number] {
  const front = toScreenY(a, BACK_FIELD.front);
  const back = toScreenY(a, BACK_FIELD.back);
  return [a.x + u * (1 - 0.1 * t) + SKEW * t, lerp(front, back, t)];
}

function backPlot(ctx: Ctx, a: Anchor, p: FieldPlot, seed: number): void {
  const u0 = p.dx - p.width / 2 + 2;
  const u1 = p.dx + p.width / 2 - 2;
  // grass border, then the tilled soil
  const m = 5;
  poly(ctx, [...backPoint(a, u0 - m, -0.06), ...backPoint(a, u1 + m, -0.06), ...backPoint(a, u1 + m, 1.08), ...backPoint(a, u0 - m, 1.08)], '#7f9143');
  const pts = [...backPoint(a, u0, 0), ...backPoint(a, u1, 0), ...backPoint(a, u1, 1), ...backPoint(a, u0, 1)];
  poly(ctx, pts, p.state === 'fallow' ? SOIL : '#6f5234');
  // furrows run away from the viewer
  ctx.globalAlpha = 0.45;
  for (let u = u0 + 4; u < u1; u += 6) {
    const [x1, y1] = backPoint(a, u, 0);
    const [x2, y2] = backPoint(a, u, 1);
    line(ctx, x1, y1, x2, y2, SOIL_DARK, 1.2);
  }
  ctx.globalAlpha = 1;
  if (p.state === 'fallow') return;
  const g = growth(p);
  const look = cropLook(g);
  // rows from the back forward so nearer plants overlap farther ones
  for (let r = 8; r >= 0; r--) {
    const t = 0.06 + r * 0.11;
    const persp = 1 - 0.35 * t;
    for (let u = u0 + 3; u < u1 - 1; u += 5) {
      const [x, y] = backPoint(a, u + hash(seed + r, u) * 2, t);
      const sway = g > 0.5 ? Math.sin(a.time * 1.8 + x * 0.05) * 1.4 * g : 0;
      stalk(ctx, x, y, look.h * persp, g, sway, look.color, look.tip, 1.3 * persp);
    }
  }
}

export function drawBackField(ctx: Ctx, a: Anchor, farm: FarmState | undefined, seed: number): void {
  for (const p of plotsOf(farm, 'back')) backPlot(ctx, a, p, seed);
}

// --- Front field (between the road and the viewer) -------------------------------------

function frontPlot(ctx: Ctx, a: Anchor, p: FieldPlot, seed: number): void {
  const top = toScreenY(a, FRONT_FIELD.top);
  const bottom = toScreenY(a, FRONT_FIELD.bottom);
  const x0 = a.x + p.dx - p.width / 2 + 2;
  const x1 = a.x + p.dx + p.width / 2 - 2;
  const g0 = ctx.createLinearGradient(0, top, 0, bottom);
  g0.addColorStop(0, p.state === 'fallow' ? SOIL : '#6f5234');
  g0.addColorStop(1, p.state === 'fallow' ? '#6a4c30' : '#5f4429');
  ctx.fillStyle = g0;
  ctx.fillRect(x0, top, x1 - x0, bottom - top);
  // furrows run across, getting further apart as they come closer
  ctx.globalAlpha = 0.5;
  for (let k = 0; k < 9; k++) {
    const t = (k + 0.5) / 9;
    const y = lerp(top, bottom, t * t * 0.4 + t * 0.6);
    line(ctx, x0, y, x1, y, SOIL_DARK, 1 + t);
  }
  ctx.globalAlpha = 1;
  if (p.state === 'fallow') return;
  const g = growth(p);
  const look = cropLook(g);
  for (let r = 0; r < 7; r++) {
    const t = (r + 0.6) / 7;
    const y = lerp(top, bottom, t * t * 0.4 + t * 0.6);
    const persp = 1 + 0.6 * t; // closer to the viewer: bigger
    const step = 5 + 2 * t;
    for (let x = x0 + 3; x < x1 - 1; x += step) {
      const px = x + hash(seed + r * 31, Math.floor(x)) * 2;
      const sway = g > 0.5 ? Math.sin(a.time * 1.8 + px * 0.05 + r) * 1.8 * g * persp : 0;
      stalk(ctx, px, y, look.h * persp * 1.15, g, sway, look.color, look.tip, 1.4 * persp);
    }
  }
}

export function drawFrontField(ctx: Ctx, a: Anchor, farm: FarmState | undefined, seed: number): void {
  const top = toScreenY(a, FRONT_FIELD.top);
  const bottom = toScreenY(a, FRONT_FIELD.bottom);
  // grass margin and a trodden path from the road into the field
  ctx.fillStyle = '#6f8338';
  ctx.fillRect(a.x - 126, top - 6, 252, bottom - top + 12);
  poly(ctx, [a.x - 8, toScreenY(a, 500), a.x + 8, toScreenY(a, 500), a.x + 10, top, a.x - 10, top], '#9c7c52');
  for (const p of plotsOf(farm, 'front')) frontPlot(ctx, a, p, seed + 7);
  // low wattle fence along the near edge
  for (let x = a.x - 124; x <= a.x + 124; x += 16) line(ctx, x, bottom + 8, x, bottom - 10, '#5a4330', 3);
  line(ctx, a.x - 124, bottom - 6, a.x + 124, bottom - 6, '#7a5d43', 2.5);
  line(ctx, a.x - 124, bottom + 1, a.x + 124, bottom + 1, '#7a5d43', 2.5);
}

/** Plots of one zone; with no farm state (e.g. under construction) all fallow. */
function plotsOf(farm: FarmState | undefined, zone: FieldPlot['zone']): FieldPlot[] {
  if (farm) return farm.plots.filter((p) => p.zone === zone);
  const dxs = zone === 'back' ? BACK_DX : FRONT_DX;
  return dxs.map((dx) => ({ zone, dx, width: PLOT_W[zone], state: 'fallow', age: 0 }));
}

// --- Grain store -----------------------------------------------------------------------

const SHEAF_SLOTS: Array<[number, number]> = [
  [-15, 0],
  [0, 0],
  [15, 0],
  [-7.5, -13],
  [7.5, -13],
];

function sheaf(ctx: Ctx, x: number, y: number): void {
  // bundle of stalks tied at the waist, ears fanning out on top
  poly(ctx, [x - 5, y, x + 5, y, x + 3, y - 10, x + 7, y - 20, x - 7, y - 20, x - 3, y - 10], '#caa24a');
  poly(ctx, [x + 1, y, x + 5, y, x + 3, y - 10, x + 7, y - 20, x + 2, y - 20], '#a8832f');
  line(ctx, x - 4, y - 10, x + 4, y - 10, '#7a5a2a', 2);
  for (let i = -3; i <= 3; i++) ellipse(ctx, x + i * 2.2, y - 21 - Math.abs(i) * -0.6, 1.4, 3, '#e3c265', i * 0.15);
}

export function drawStore(ctx: Ctx, a: Anchor, farm: FarmState | undefined): void {
  const cx = a.x + STORE.dx;
  const y = toScreenY(a, STORE.y) + 1;
  // wooden pallet the sheaves stand on
  poly(ctx, [cx - 24, y, cx + 24, y, cx + 28, y - 4, cx - 20, y - 4], '#6b4f35');
  line(ctx, cx - 24, y, cx + 24, y, '#4d3826', 1.5);
  const n = farm?.storage ?? 0;
  for (let i = 0; i < n; i++) sheaf(ctx, cx + SHEAF_SLOTS[i][0], y - 3 + SHEAF_SLOTS[i][1]);
}

// --- Farmer ------------------------------------------------------------------------------

/** Nearer to the viewer (larger y) = drawn bigger. */
export function farmerScale(y: number): number {
  return y < BASE_Y ? lerp(0.82, 1, clamp01((y - BACK_FIELD.back) / (BASE_Y - BACK_FIELD.back))) : 1 + ((y - BASE_Y) / (VIEW_H - BASE_Y)) * 0.45;
}

export function drawFarmer(ctx: Ctx, f: Farmer, x: number, y: number, time: number): void {
  const s = farmerScale(f.y);
  const task = f.task;
  const walking = task.kind === 'walk';
  const phase = f.stride * 0.22;
  const swing = walking ? Math.sin(phase) * 0.5 : 0;
  const bob = walking ? Math.abs(Math.cos(phase)) * 1.2 : 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * f.facing, s);
  ctx.globalAlpha = 0.25;
  ellipse(ctx, 0, 0, 9, 2.5, '#2c2416');
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';

  // bending over while working
  const working = task.kind === 'work';
  const bend = working ? (task.action === 'sow' ? 0.12 : 0.25 + Math.sin(time * 4) * 0.08) : 0;

  line(ctx, 0, -14 - bob, Math.sin(swing) * 9, 0, '#3d3128', 3);
  line(ctx, 0, -14 - bob, Math.sin(-swing) * 9, 0, '#4d3f33', 3);
  ctx.save();
  ctx.translate(0, -14 - bob);
  ctx.rotate(bend);
  poly(ctx, [-6, 2, 6, 2, 5, -13, -5, -13], '#8a6a3c'); // smock
  line(ctx, -6, -1, 6, -1, '#5a4330', 1.5); // belt
  circle(ctx, 0, -17, 4.5, '#e0b48e');
  ellipse(ctx, 0, -20, 8, 2.2, '#d8bf6a'); // straw hat
  ellipse(ctx, 0, -22, 4, 3, '#d8bf6a');

  if (working && task.action === 'sow') {
    // seed bag at the hip; the arm casts seed in an arc
    ellipse(ctx, -5, -2, 4, 5, '#c9b48a');
    const arm = Math.sin(time * 5) * 0.9;
    const hx = 2 + Math.cos(arm - 0.3) * 9;
    const hy = -10 + Math.sin(arm - 0.3) * 6;
    line(ctx, 1, -11, hx, hy, '#e0b48e', 2.5);
    ctx.restore();
    const cast = (time * 5) % (Math.PI * 2);
    for (let i = 0; i < 6; i++) {
      const t = ((cast / (Math.PI * 2)) + i / 6) % 1;
      ctx.globalAlpha = 1 - t;
      circle(ctx, 8 + t * 16, -22 + t * 22 + t * t * 6, 1, '#e8d49a');
    }
    ctx.globalAlpha = 1;
    drawProgressPips(ctx, task.t / SOW_TIME);
  } else if (working && task.action === 'harvest') {
    // scythe sweeping low across the crop
    const sweep = Math.sin(time * 4) * 0.7;
    ctx.save();
    ctx.translate(2, -8);
    ctx.rotate(0.6 + sweep);
    line(ctx, 0, 0, 0, 20, '#6b4a2c', 2);
    ctx.strokeStyle = '#c9c9c9';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(-8, 20, 8, 0, Math.PI * 0.6, false);
    ctx.stroke();
    ctx.restore();
    line(ctx, 1, -11, 5, -5, '#e0b48e', 2.5);
    ctx.restore();
    drawProgressPips(ctx, task.t / HARVEST_TIME);
  } else {
    line(ctx, 1, -11, 1 + Math.sin(-swing) * 6, -2, '#8a6a3c', 3);
    if (f.carrying) {
      // a sheaf over the shoulder
      ctx.rotate(-0.9);
      poly(ctx, [8, -8, 12, -8, 14, -26, 6, -26], '#caa24a');
      line(ctx, 7, -16, 13, -16, '#7a5a2a', 2);
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Tiny progress ring above the farmer while he works a plot. */
function drawProgressPips(ctx: Ctx, t: number): void {
  ctx.strokeStyle = 'rgba(40,30,20,0.5)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, -44, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#e8c872';
  ctx.beginPath();
  ctx.arc(0, -44, 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp01(t));
  ctx.stroke();
}
