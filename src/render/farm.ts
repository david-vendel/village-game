// Farm fields, crops, the farmer and the grain store. Positions come from the
// simulation geometry in game/farm.ts (world y), shifted onto the building's
// screen base so the same art works in the street and in menu previews.

import { type FarmState, type Farmer, type FieldPlot, growth, HARVEST_TIME, SOW_TIME } from '../game/farm';
import { BACK_DX, BACK_FIELD, BASE_Y, FRONT_DX, FRONT_FIELD, PLOT_W, STORE, VIEW_H } from '../game/layout';
import { circle, clamp01, type Ctx, ellipse, hash, lerp, line, mix, poly } from './util';

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

// --- Perspective ------------------------------------------------------------
// A gentle one-point perspective: rows are horizontal, far edges are only a
// little narrower than near ones, and depth is compressed on screen.

/** Back field point: u = x offset from the farm centre, t = 0 near edge … 1 far edge. */
function backPoint(a: Anchor, u: number, t: number): [number, number] {
  const near = toScreenY(a, BACK_FIELD.front);
  const far = toScreenY(a, BACK_FIELD.back);
  return [a.x + u * (1 - 0.06 * t), lerp(near, far, t)];
}

/** Front field point: t = 0 far (road side) … 1 near (viewer side). */
function frontPoint(a: Anchor, u: number, t: number): [number, number] {
  const far = toScreenY(a, FRONT_FIELD.top);
  const near = toScreenY(a, FRONT_FIELD.bottom);
  // rows spread out as they come closer
  return [a.x + u * (0.95 + 0.05 * t), lerp(far, near, t * t * 0.35 + t * 0.65)];
}

type PointFn = (a: Anchor, u: number, t: number) => [number, number];

function quad(a: Anchor, pt: PointFn, u0: number, u1: number, t0: number, t1: number): number[] {
  return [...pt(a, u0, t0), ...pt(a, u1, t0), ...pt(a, u1, t1), ...pt(a, u0, t1)];
}

/**
 * One plot: soil, horizontal furrows, and crop rows drawn far-to-near.
 * `farT`/`nearT` give the t of the far and near edge for the point function.
 */
function fieldPlot(ctx: Ctx, a: Anchor, p: FieldPlot, seed: number, pt: PointFn, farT: number, nearT: number, size: number, rows: number): void {
  const u0 = p.dx - p.width / 2 + 2;
  const u1 = p.dx + p.width / 2 - 2;
  poly(ctx, quad(a, pt, u0, u1, farT, nearT), p.state === 'fallow' ? SOIL : '#6f5234');
  ctx.globalAlpha = 0.45;
  for (let k = 1; k < rows * 2; k++) {
    const t = lerp(farT, nearT, k / (rows * 2));
    const [x0, y] = pt(a, u0, t);
    const [x1] = pt(a, u1, t);
    line(ctx, x0, y, x1, y, SOIL_DARK, 0.8 + size * 0.4 * (k / (rows * 2)));
  }
  ctx.globalAlpha = 1;
  if (p.state === 'fallow') return;
  const g = growth(p);
  const look = cropLook(g);
  for (let r = 0; r < rows; r++) {
    const k = (r + 0.5) / rows; // 0 far … 1 near
    const t = lerp(farT, nearT, k);
    const persp = size * (0.72 + 0.28 * k);
    const step = 4.5 * persp;
    for (let u = u0 + 2; u < u1 - 1; u += step) {
      const [x, y] = pt(a, u + hash(seed + r * 31, Math.floor(u * 3)) * 1.5, t);
      const sway = g > 0.5 ? Math.sin(a.time * 1.8 + x * 0.05 + r) * 1.5 * g * persp : 0;
      stalk(ctx, x, y, look.h * persp, g, sway, look.color, look.tip, 1.25 * persp);
    }
  }
}

// --- Back field (behind the farmstead) ----------------------------------------

export function drawBackField(ctx: Ctx, a: Anchor, farm: FarmState | undefined, seed: number): void {
  for (const p of plotsOf(farm, 'back')) {
    const u0 = p.dx - p.width / 2 - 2;
    const u1 = p.dx + p.width / 2 + 2;
    poly(ctx, quad(a, backPoint, u0, u1, 1.12, -0.08), '#7f9143'); // grass border
    fieldPlot(ctx, a, p, seed, backPoint, 1, 0, 0.8, 5);
  }
}

// --- Front field (between the road and the viewer) -----------------------------------

export function drawFrontField(ctx: Ctx, a: Anchor, farm: FarmState | undefined, seed: number): void {
  const plots = plotsOf(farm, 'front');
  const ext = Math.max(...plots.map((p) => Math.abs(p.dx) + p.width / 2)) + 4;
  poly(ctx, quad(a, frontPoint, -ext, ext, -0.08, 1.06), '#6f8338'); // grass border
  for (const p of plots) fieldPlot(ctx, a, p, seed + 7, frontPoint, 0, 1, 1.45, 7);
  // low wattle fence along the near edge
  const [fl, fy] = frontPoint(a, -ext, 1.06);
  const [fr] = frontPoint(a, ext, 1.06);
  for (let x = fl; x <= fr; x += 16) line(ctx, x, fy + 6, x, fy - 12, '#5a4330', 3);
  line(ctx, fl, fy - 8, fr, fy - 8, '#7a5d43', 2.5);
  line(ctx, fl, fy - 1, fr, fy - 1, '#7a5d43', 2.5);
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
