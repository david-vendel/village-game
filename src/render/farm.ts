// Farm fields, crops, the farmer and the grain store. Positions come from the
// simulation geometry in game/farm.ts (world y), shifted onto the building's
// screen base so the same art works in the street and in menu previews.
// Fields lie on the ground, so their x goes through the ground perspective
// (ground.ts), the same projection the land-grid overlay uses.

import { type FarmState, type FieldPlot, growth } from '../game/farm';
import { drawArm, drawHead, drawLegs, drawTorso, type Figure, HEAD, outfitOf, SHOULDER, swingHand } from './figure';
import { DOOR_TIME, WALK_SPEED, type Worker } from '../game/worker';
import { BACK_FIELD, BASE_Y, BASKET, FIELD_ROWS, FRONT_FIELD, SHEAF_SLOTS, STORE, VIEW_H } from '../game/layout';
import { groundX } from './ground';
import { circle, clamp01, type Ctx, ellipse, hash, lerp, line, mix, poly, rect } from './util';

const SOIL = '#7a5a3a';
const SOIL_DARK = '#5e4329';

interface Anchor {
  x: number;
  base: number;
  time: number;
  /** Vanishing point x (same units as `x`); defaults to the farm centre, e.g. in menu previews. */
  vpX?: number;
}

const toScreenY = (a: Anchor, y: number) => a.base + (y - BASE_Y);
/** Screen point of the ground at x offset u from the farm centre and world depth y. */
const ground = (a: Anchor, u: number, y: number): [number, number] => [groundX(a.x + u, y, a.vpX ?? a.x), toScreenY(a, y)];

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

// --- Plots ------------------------------------------------------------------
// A plot covers its row's depth band (FIELD_ROWS, world y) and its width; every
// point maps through the ground perspective, so plots line up with the grid.

/** Ground point u (x offset from the farm centre) at world depth y. */
const pt = (a: Anchor, u: number, y: number) => ground(a, u, y);

function quad(a: Anchor, u0: number, u1: number, yFar: number, yNear: number): number[] {
  return [...pt(a, u0, yFar), ...pt(a, u1, yFar), ...pt(a, u1, yNear), ...pt(a, u0, yNear)];
}

/** Crops are drawn bigger the nearer to the viewer they grow. */
const cropSize = (y: number) => lerp(0.8, 1.55, clamp01((y - BACK_FIELD.back) / (FRONT_FIELD.bottom - BACK_FIELD.back)));

/** One plot: soil, horizontal furrows, and crop rows drawn far-to-near. */
function fieldPlot(ctx: Ctx, a: Anchor, p: FieldPlot, seed: number): void {
  const { far, near } = FIELD_ROWS[p.zone][p.row];
  const rows = p.zone === 'back' ? 5 : 4;
  const u0 = p.dx - p.width / 2 + 2;
  const u1 = p.dx + p.width / 2 - 2;
  poly(ctx, quad(a, u0, u1, far + 1, near - 1), p.state === 'fallow' ? SOIL : '#6f5234');
  ctx.globalAlpha = 0.45;
  for (let k = 1; k < rows * 2; k++) {
    const y = lerp(far + 1, near - 1, k / (rows * 2));
    const [x0, sy] = pt(a, u0, y);
    const [x1] = pt(a, u1, y);
    line(ctx, x0, sy, x1, sy, SOIL_DARK, 0.8 + cropSize(y) * 0.4 * (k / (rows * 2)));
  }
  ctx.globalAlpha = 1;
  if (p.state === 'fallow') return;
  const g = growth(p);
  const look = cropLook(g);
  for (let r = 0; r < rows; r++) {
    const y = lerp(far, near, (r + 0.5) / rows);
    const persp = cropSize(y);
    const step = 4.5 * persp;
    for (let u = u0 + 2; u < u1 - 1; u += step) {
      const [x, sy] = pt(a, u + hash(seed + p.row * 97 + r * 31, Math.floor(u * 3)) * 1.5, y);
      const sway = g > 0.5 ? Math.sin(a.time * 1.8 + x * 0.05 + r) * 1.5 * g * persp : 0;
      stalk(ctx, x, sy, look.h * persp, g, sway, look.color, look.tip, 1.25 * persp);
    }
  }
}

/** Grass border, then the plots far row first so nearer crops overlap farther ones. */
function drawPlots(ctx: Ctx, a: Anchor, plots: FieldPlot[], seed: number, border: string, margin: number): void {
  for (const p of plots) {
    const { far, near } = FIELD_ROWS[p.zone][p.row];
    poly(ctx, quad(a, p.dx - p.width / 2 - margin, p.dx + p.width / 2 + margin, far - 3, near + 3), border);
  }
  for (const p of [...plots].sort((x, y) => x.row - y.row)) fieldPlot(ctx, a, p, seed);
}

// --- Back field (behind the farmstead) ----------------------------------------

export function drawBackField(ctx: Ctx, a: Anchor, farm: FarmState | undefined, seed: number): void {
  drawPlots(ctx, a, plotsOf(farm, 'back'), seed, '#7f9143', 2);
}

// --- Front field (between the road and the viewer) -----------------------------------

export function drawFrontField(ctx: Ctx, a: Anchor, farm: FarmState | undefined, seed: number): void {
  const plots = plotsOf(farm, 'front');
  drawPlots(ctx, a, plots, seed + 7, '#6f8338', 4);
  // a low wattle fence along the near edge, in front of every column with a field in it
  const y = FRONT_FIELD.bottom + 4;
  const columns = new Map(plots.map((p) => [`${p.dx}:${p.width}`, p]));
  for (const p of columns.values()) {
    const [fl, fy] = pt(a, p.dx - p.width / 2 - 4, y);
    const [fr] = pt(a, p.dx + p.width / 2 + 4, y);
    for (let x = fl; x <= fr; x += 16) line(ctx, x, fy + 6, x, fy - 12, '#5a4330', 3);
    line(ctx, fl, fy - 8, fr, fy - 8, '#7a5d43', 2.5);
    line(ctx, fl, fy - 1, fr, fy - 1, '#7a5d43', 2.5);
  }
}

/** Low fences along the road side of the back plots. */
export function drawBackFences(ctx: Ctx, a: Anchor, farm: FarmState | undefined): void {
  const y = FIELD_ROWS.back[0].near;
  for (const p of plotsOf(farm, 'back')) {
    const [s0] = pt(a, p.dx - p.width / 2, y);
    const e0 = pt(a, p.dx + p.width / 2, y)[0] - 3;
    for (let fx = s0; fx <= e0; fx += 16) rect(ctx, fx, a.base - 14, 3, 14, '#6b4f35');
    rect(ctx, s0, a.base - 12, e0 - s0 + 3, 2, '#7d5d3f');
    rect(ctx, s0, a.base - 6, e0 - s0 + 3, 2, '#7d5d3f');
  }
}

/** Plots of one zone that show as fields: only tilled ones, the rest is still grass. */
function plotsOf(farm: FarmState | undefined, zone: FieldPlot['zone']): FieldPlot[] {
  return farm?.plots.filter((p) => p.zone === zone && p.tilled) ?? [];
}

// --- Grain store -----------------------------------------------------------------------

/** A sheaf of grain standing at (x, y): how grain looks wherever it is, at the farm, carried, or in a store. */
export function sheaf(ctx: Ctx, x: number, y: number): void {
  // bundle of stalks tied at the waist, ears fanning out on top
  poly(ctx, [x - 5, y, x + 5, y, x + 3, y - 10, x + 7, y - 20, x - 7, y - 20, x - 3, y - 10], '#caa24a');
  poly(ctx, [x + 1, y, x + 5, y, x + 3, y - 10, x + 7, y - 20, x + 2, y - 20], '#a8832f');
  line(ctx, x - 4, y - 10, x + 4, y - 10, '#7a5a2a', 2);
  for (let i = -3; i <= 3; i++) ellipse(ctx, x + i * 2.2, y - 21 - Math.abs(i) * -0.6, 1.4, 3, '#e3c265', i * 0.15);
}

/**
 * A stook: three sheaves leaned together, standing at (x, y), drawn at scale s.
 * One stands for a store's item of grain (game/layout.ts SACK) where a farm's
 * sheaf is one.
 */
export function stook(ctx: Ctx, x: number, y: number, s = 0.75): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  for (const [dx, tilt] of [[-4, -0.18], [4, 0.18], [0, 0]] as const) {
    ctx.save();
    ctx.translate(dx, 0);
    ctx.rotate(tilt);
    sheaf(ctx, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

export function drawStore(ctx: Ctx, a: Anchor, sheaves: number): void {
  const cx = a.x + STORE.dx;
  const y = toScreenY(a, STORE.y) + 1;
  // wooden pallet the sheaves stand on
  poly(ctx, [cx - 24, y, cx + 24, y, cx + 28, y - 4, cx - 20, y - 4], '#6b4f35');
  line(ctx, cx - 24, y, cx + 24, y, '#4d3826', 1.5);
  // each sheaf in its own place (game/layout.ts), where the farmer put it down
  for (let i = 0; i < Math.min(sheaves, SHEAF_SLOTS.length); i++) sheaf(ctx, a.x + SHEAF_SLOTS[i].dx, y - 3 - SHEAF_SLOTS[i].lift);
}

// --- Farmer ------------------------------------------------------------------------------

/** Nearer to the viewer (larger y) = drawn bigger. */
export function farmerScale(y: number): number {
  return y < BASE_Y ? lerp(0.82, 1, clamp01((y - BACK_FIELD.back) / (BASE_Y - BACK_FIELD.back))) : 1 + ((y - BASE_Y) / (VIEW_H - BASE_Y)) * 0.45;
}

/** How far through the farmhouse door the farmer is: 0 outside … 1 inside. */
export function doorProgress(f: Worker): number {
  const t = f.task;
  if (t.kind === 'enter') return clamp01(t.t / DOOR_TIME);
  if (t.kind === 'exit') return 1 - clamp01(t.t / DOOR_TIME);
  return t.kind === 'home' || (t.kind === 'job' && t.indoors) ? 1 : 0;
}

/**
 * A villager at work — the farmer, a builder, the miller, the baker or a serf, dressed
 * for their trade — walking, sowing, scything, hammering, loading up, or
 * carrying a load.
 */
export function drawWorker(ctx: Ctx, f: Worker, fig: Figure, x: number, y: number, time: number): void {
  const inDoor = doorProgress(f);
  if (inDoor >= 1) return; // indoors
  const s = farmerScale(f.y) * (1 - 0.15 * inDoor); // a step back into the doorway
  const task = f.task;
  const o = outfitOf(fig);
  const stepping = task.kind === 'enter' || task.kind === 'exit';
  const walking = task.kind === 'walk' || stepping;
  const phase = (stepping ? time * WALK_SPEED : f.stride) * 0.22;
  const swing = walking ? Math.sin(phase) * 0.55 : 0;
  // fades into the dark doorway (all alpha below is relative to this)
  const alpha = 1 - inDoor;

  ctx.save();
  ctx.translate(x, y - inDoor * 5);
  ctx.scale(s * f.facing, s);
  ctx.globalAlpha = 0.25 * alpha;
  ellipse(ctx, 0.8, 0, 7.5, 2.2, '#2c2416');
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';

  // bending over while working
  const job = task.kind === 'job' ? task : null;
  // pulling down is hammering too
  const action = job?.job.action === 'demolish' ? 'build' : job?.job.action;
  const atOven = !!job?.carried && !job.indoors;
  const bend = !job
    ? 0
    : atOven
      ? 0.12
      : action === 'sow'
        ? 0.12
        : action === 'build' || action === 'chop'
          ? 0.08
          : action === 'cut'
            ? 0.18
            : action === 'harvest'
              ? 0.25 + Math.sin(time * 4) * 0.08
              : 0.4;

  const hipY = drawLegs(ctx, o, phase, walking);
  ctx.save();
  ctx.translate(0, hipY);
  ctx.rotate(bend);
  // the same clothes and head as on the street: nobody ever changes outfit
  const [sx, sy] = SHOULDER;
  const body = (farHand: [number, number]) => {
    drawArm(ctx, o, sx - 1.2, sy, farHand[0], farHand[1], true);
    drawTorso(ctx, o, walking ? Math.sin(phase) * 0.6 : 0, fig.seed);
    drawHead(ctx, o, HEAD[0], HEAD[1]);
  };

  if (job && action === 'sow') {
    // seed bag at the hip, held open; the other arm casts seed in an arc
    body([-2.5, -1.5]);
    ellipse(ctx, -4.5, 0, 3.8, 4.6, '#c9b48a');
    line(ctx, -6.5, -3.5, -2.5, -3.5, '#8a7a58', 1);
    const arm = Math.sin(time * 5) * 0.9;
    drawArm(ctx, o, sx, sy, 2 + Math.cos(arm - 0.3) * 9, -10 + Math.sin(arm - 0.3) * 6);
    ctx.restore();
    const cast = (time * 5) % (Math.PI * 2);
    for (let i = 0; i < 6; i++) {
      const t = ((cast / (Math.PI * 2)) + i / 6) % 1;
      ctx.globalAlpha = (1 - t) * alpha;
      circle(ctx, 8 + t * 16, -22 + t * 22 + t * t * 6, 1, '#e8d49a');
    }
    ctx.globalAlpha = alpha;
    drawProgressPips(ctx, job.t / job.duration);
  } else if (job && action === 'harvest') {
    // scythe held in both hands, sweeping low across the crop
    const rot = 0.6 + Math.sin(time * 4) * 0.7;
    const grip = (t: number): [number, number] => [2 - Math.sin(rot) * t, -8 + Math.cos(rot) * t];
    body(grip(3));
    ctx.save();
    ctx.translate(2, -8);
    ctx.rotate(rot);
    line(ctx, 0, -2, 0, 20, '#6b4a2c', 2);
    ctx.strokeStyle = '#c9c9c9';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(-8, 20, 8, 0, Math.PI * 0.6, false);
    ctx.stroke();
    ctx.restore();
    drawArm(ctx, o, sx, sy, ...grip(10));
    ctx.restore();
    drawProgressPips(ctx, job.t / job.duration);
  } else if (job && action === 'build') {
    // hammering at the work, the other hand steadying it
    body([7.5, -4]);
    const a = -0.9 + Math.abs(Math.sin(time * 6)) * 1.4;
    const hx = 1 + Math.cos(a) * 9;
    const hy = -11 + Math.sin(a) * 9;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(a);
    line(ctx, 0, 1.5, 0, -8, '#6b4a2c', 1.8);
    rect(ctx, -3, -10, 7, 3, '#8a8a8a');
    ctx.restore();
    drawArm(ctx, o, sx, sy, hx, hy);
    ctx.restore();
    drawProgressPips(ctx, job.t / job.duration);
  } else if (job && (action === 'chop' || action === 'cut')) {
    // an axe swung into the trunk, or a pick into the rock face: both hands on
    // the haft, raised over the shoulder and brought down hard
    const beat = (time * (action === 'chop' ? 1.4 : 1.1)) % 1;
    const a = beat < 0.7 ? -2.2 + (beat / 0.7) * 0.6 : -1.6 + ((beat - 0.7) / 0.3) * 2.1;
    const grip = (t: number): [number, number] => [2 + Math.cos(a) * t, -9 + Math.sin(a) * t];
    body(grip(4));
    ctx.save();
    ctx.translate(2, -9);
    ctx.rotate(a);
    line(ctx, 0, 0, 17, 0, '#6b4a2c', 1.8);
    if (action === 'chop') poly(ctx, [14, -1, 19, -4.5, 20, 3.5, 15, 1.5], '#9a9a9a');
    else line(ctx, 17, -5, 17, 5, '#8a8a8a', 2);
    ctx.restore();
    drawArm(ctx, o, sx, sy, ...grip(9));
    ctx.restore();
    drawProgressPips(ctx, job.t / job.duration);
  } else if (job && atOven) {
    // working the oven with a long peel: sliding the loaves in, turning them,
    // and drawing them out baked
    const p = clamp01(job.t / job.duration);
    const reach = 0.5 + 0.5 * Math.sin(time * 1.6);
    const hand: [number, number] = [4 + reach * 3, -5];
    body([hand[0] - 3, hand[1] + 0.5]);
    const tip = [hand[0] + 13 + reach * 5, 4] as const;
    line(ctx, hand[0] - 5, hand[1] - 0.5, tip[0], tip[1], '#8a6a44', 1.3);
    ellipse(ctx, tip[0] + 2, tip[1] + 0.3, 3.2, 1.1, '#a88a5a', 0.2);
    // a loaf on the blade going in (dough) and coming out (baked)
    if (p < 0.2 || p > 0.8) ellipse(ctx, tip[0] + 2, tip[1] - 1, 2.4, 1.4, p < 0.2 ? '#e8d6b0' : '#a8642e');
    drawArm(ctx, o, sx, sy, ...hand);
    ctx.restore();
  } else if (job) {
    // loading up at the warehouse, both hands down
    body([5, -1]);
    drawArm(ctx, o, sx, sy, 6.5, -0.5);
    ctx.restore();
  } else {
    const load = f.carrying?.resource;
    const onShoulder = load === 'flour' || load === 'grain' || load === 'wood';
    if (load === 'bread') {
      // a basket of loaves held in both arms
      body([6, -7.5]);
      ctx.save();
      ctx.translate(8, -4);
      breadBasket(ctx, 0, 0, 0.9, Math.ceil(((f.carrying?.amount ?? 0) / BASKET) * 5));
      ctx.restore();
      drawArm(ctx, o, sx, sy, 7, -7);
    } else if (load === 'stone') {
      // a block of stone held in both arms
      body([6, -7.5]);
      rect(ctx, 3, -12, 10, 7, '#aaa398');
      rect(ctx, 3, -12, 10, 2, '#c4beb3');
      drawArm(ctx, o, sx, sy, 7, -7);
    } else {
      body(swingHand(sx - 1.2, sy, swing + 0.05));
      if (!onShoulder) drawArm(ctx, o, sx, sy, ...swingHand(sx, sy, -swing + 0.05));
    }
    if (load === 'flour') {
      // a sack of flour over the shoulder
      ellipse(ctx, 1, -15.5, 6.5, 5.5, '#efe9da', -0.4);
      drawArm(ctx, o, sx, sy, 4.2, -15);
    } else if (load === 'grain') {
      // sheaves over the shoulder, ears behind: the same sheaves as at the farm, an armful for a store's batch
      const n = (f.carrying?.amount ?? 0) > 2 ? 3 : 1;
      ctx.save();
      ctx.translate(-1, -15);
      ctx.rotate(-1.25);
      for (let i = 0; i < n; i++) {
        ctx.save();
        ctx.translate(10, (i - (n - 1) / 2) * 3.2);
        ctx.scale(0.62, 0.62);
        sheaf(ctx, 0, 0);
        ctx.restore();
      }
      ctx.restore();
      drawArm(ctx, o, sx, sy, 3.8, -14);
    } else if (load === 'wood') {
      // two logs over the shoulder
      ctx.save();
      ctx.rotate(-0.25);
      for (const dy of [-15, -11]) {
        rect(ctx, -12, dy, 24, 4, '#8b6440');
        circle(ctx, 12, dy + 2, 2, '#c9a577');
      }
      ctx.restore();
      drawArm(ctx, o, sx, sy, 3.5, -12);
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

/** A wicker basket of loaves standing on the ground at x (fewer loaves when part-full, of 5). */
export function breadBasket(ctx: Ctx, x: number, base: number, s = 1, loaves = 5): void {
  const w = 12 * s;
  const h = 6 * s;
  for (let i = 0; i < Math.min(5, loaves); i++) {
    const lx = x + (i % 3 - 1) * 3.6 * s + (i >= 3 ? 1.8 * s : 0);
    ellipse(ctx, lx, base - h - (i >= 3 ? 2.6 : 0.6) * s, 2.6 * s, 1.9 * s, i % 2 ? '#b8743a' : '#c98a48', -0.2);
  }
  poly(ctx, [x - w / 2, base - h, x + w / 2, base - h, x + w / 2 - 1.5 * s, base, x - w / 2 + 1.5 * s, base], '#a07a46');
  line(ctx, x - w / 2, base - h, x + w / 2, base - h, '#7a5a30', 1.2 * s);
  line(ctx, x - w / 2 + 1, base - h / 2, x + w / 2 - 1, base - h / 2, '#8a6a3a', 0.8 * s);
}
