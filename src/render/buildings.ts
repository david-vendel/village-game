// Procedural building art. Each building is a 2D picture of a 3D building:
// a sunlit front face, a shaded side face receding up-right, and a pitched
// roof. The sun is to the left, so right-hand faces are in shadow.

import type { BuildingType } from '../game/buildings';
import { demoFarm, type FarmState } from '../game/farm';
import { BAKERY_OVEN_MOUTH_DX, BAKERY_SLOTS, BASKET, MILL_SLOTS, PILE_UNIT, SACK, pileItems, STONECUTTER_DOOR, STONECUTTER_SLOTS, TAVERN_SLOTS, warehouseSlot, WOODCUTTER_DOOR, WOODCUTTER_SLOTS, YARD_ITEMS, type Slot } from '../game/layout';
import { stockOf, type Amounts, type Stock } from '../game/resources';
import type { Worker } from '../game/worker';
import { breadBasket, doorProgress, drawBackFences, drawBackField, drawFrontField, drawStore } from './farm';
import { drawArm, drawHead, drawLegs, drawTorso, type Figure, HEAD, outfitOf, SHOULDER } from './figure';
import { circle, clamp01, type Ctx, ellipse, hash, line, mix, poly, rect, shade, smoke } from './util';

export interface DrawArgs {
  /** Centre x on screen. */
  x: number;
  /** Ground line on screen. */
  base: number;
  time: number;
  /** Stable per-building seed for colour/detail variation. */
  seed: number;
  /** Live farm state (fields) — farms only. */
  farm?: FarmState;
  /** Upgraded (BuildingDef.upgrade): drawn as its bigger self. */
  upgraded?: boolean;
  /** The building's own store. */
  stock?: Stock;
  /** The people working here (for doors, sleepers…). */
  workers?: Worker[];
  /** The same people with how they look (for someone seen at a window). */
  crew?: Array<{ worker: Worker; figure: Figure }>;
  /** Under construction: materials lying on the site's pile. */
  onSite?: Amounts;
  /** Under construction: materials laid down at each work spot (dx from the centre), not yet built in. */
  laid?: Array<{ dx: number; amounts: Amounts }>;
  /** Ground-perspective vanishing point x (see ground.ts); defaults to `x`. */
  vpX?: number;
}

export interface BuildingArt {
  /** Approximate drawn height (world px): sizes scaffolding, labels and menu previews. */
  height: number;
  /** Drawn for all buildings before any building body (e.g. farm fields). */
  behind?: (ctx: Ctx, a: DrawArgs) => void;
  draw: (ctx: Ctx, a: DrawArgs) => void;
  /** Drawn on the land in front of the road (e.g. the farm's front field). */
  front?: (ctx: Ctx, a: DrawArgs) => void;
}

// Oblique projection for depth: back edges shift right and up.
const OX = 0.55;
const OY = 0.3;

const PLASTER = ['#efe3c8', '#e9d6b0', '#f1e8d6', '#e4cfa6'];
const TIMBER = '#4a3222';
const STONE = '#b8ab94';

// --- Primitives --------------------------------------------------------------

/** Front + right side face of a box. Returns the side-face geometry. */
function block(ctx: Ctx, x0: number, base: number, w: number, h: number, d: number, wall: string): void {
  const ox = d * OX;
  const oy = d * OY;
  const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
  g.addColorStop(0, shade(wall, 0.06));
  g.addColorStop(1, shade(wall, -0.06));
  ctx.fillStyle = g;
  ctx.fillRect(x0, base - h, w, h);
  poly(ctx, [x0 + w, base, x0 + w + ox, base - oy, x0 + w + ox, base - oy - h, x0 + w, base - h], shade(wall, -0.32));
  // soft contact shadow
  ctx.globalAlpha = 0.25;
  ellipse(ctx, x0 + w / 2 + ox / 2, base + 1, w / 2 + ox / 2 + 8, 4, '#2c2416');
  ctx.globalAlpha = 1;
}

/** Gable roof whose ridge runs left-right; gable end visible on the right. */
function gableRoof(
  ctx: Ctx,
  x0: number,
  top: number,
  w: number,
  d: number,
  rh: number,
  roof: string,
  wall: string,
  style: 'thatch' | 'tile' | 'slate',
  seed: number,
): { ridgeY: number; ridgeX1: number; ridgeX2: number } {
  const ox = d * OX;
  const oy = d * OY;
  const ov = 8;
  const rx1 = x0 + ox / 2 - ov;
  const rx2 = x0 + w + ox / 2 + ov * 0.3;
  const ry = top - oy / 2 - rh;

  // gable wall triangle (in shadow)
  poly(ctx, [x0 + w, top, x0 + w + ox, top - oy, x0 + w + ox / 2, ry], shade(wall, -0.32));
  // bargeboard along the back slope of the gable
  line(ctx, x0 + w + ox / 2, ry, x0 + w + ox, top - oy, shade(roof, -0.45), 3);

  // front roof plane
  const pts = [x0 - ov, top + 3, x0 + w + ov, top + 3, rx2, ry, rx1, ry];
  const g = ctx.createLinearGradient(0, ry, 0, top);
  g.addColorStop(0, shade(roof, 0.12));
  g.addColorStop(1, shade(roof, -0.12));
  poly(ctx, pts, undefined);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  ctx.clip();
  const H = top - ry + 4;
  if (style === 'thatch') {
    for (let row = 0; row < H; row += 7) {
      for (let x = x0 - 12; x < x0 + w + ox + 12; x += 3) {
        const len = 5 + hash(seed + x * 13, row) * 6;
        ctx.globalAlpha = 0.35;
        line(ctx, x, ry + row, x + 1, ry + row + len, hash(x, row + seed) < 0.5 ? shade(roof, -0.35) : shade(roof, 0.25), 1);
      }
    }
    ctx.globalAlpha = 1;
  } else {
    const step = style === 'slate' ? 5 : 7;
    for (let row = 0, k = 0; row < H; row += step, k++) {
      ctx.globalAlpha = 0.45;
      rect(ctx, x0 - 12, ry + row, w + ox + 30, 1.2, shade(roof, -0.4));
      for (let x = x0 - 12 + (k % 2) * 5; x < x0 + w + ox + 12; x += 10) {
        rect(ctx, x, ry + row, 1, step, shade(roof, -0.3));
        if (hash(x + k * 7, seed) < 0.12) rect(ctx, x + 1, ry + row + 1, 8, step - 1, shade(roof, hash(x, k) < 0.5 ? 0.15 : -0.15));
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  // eave shadow line and ridge
  line(ctx, x0 - ov, top + 3, x0 + w + ov, top + 3, shade(roof, -0.5), 1.5);
  line(ctx, rx1, ry, rx2, ry, shade(roof, -0.3), 2.5);
  return { ridgeY: ry, ridgeX1: rx1, ridgeX2: rx2 };
}

function window_(ctx: Ctx, x: number, y: number, w: number, h: number, lit: boolean, time: number, seed: number): void {
  rect(ctx, x - 2, y - 2, w + 4, h + 4, '#5a4331');
  if (lit) {
    const flicker = 0.85 + Math.sin(time * 6 + seed) * 0.05 + Math.sin(time * 13.1 + seed) * 0.04;
    ctx.globalAlpha = flicker;
    rect(ctx, x, y, w, h, '#f3b75a');
    ctx.globalAlpha = 1;
  } else {
    rect(ctx, x, y, w, h, '#3a3230');
    rect(ctx, x, y, w * 0.45, h, '#51453d');
  }
  line(ctx, x + w / 2, y, x + w / 2, y + h, '#5a4331', 1.5);
  line(ctx, x, y + h / 2, x + w, y + h / 2, '#5a4331', 1.5);
  rect(ctx, x - 3, y + h + 2, w + 6, 2.5, '#6e5640');
}

/**
 * Someone working inside, seen at a window: the worker whose indoor job is
 * under way, while they are at it (not on the stairs at either end).
 */
function atWindow(a: DrawArgs): Figure | null {
  for (const { worker, figure } of a.crew ?? []) {
    const t = worker.task;
    if (t.kind !== 'job' || !t.indoors) continue;
    const p = t.t / Math.max(t.duration, 1e-6);
    if (p > 0.12 && p < 0.88) return figure;
  }
  return null;
}

/** A lit window with someone at work behind it, moving about (head and shoulders). */
function occupiedWindow(ctx: Ctx, x: number, y: number, w: number, h: number, who: Figure, time: number, seed: number): void {
  window_(ctx, x, y, w, h, true, time, seed);
  const o = outfitOf(who);
  const s = 0.62;
  const sway = Math.sin(time * 1.4) * w * 0.18;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x + w / 2 + sway, y + h * 0.42 + (HEAD[1] * -1) * s);
  ctx.scale(s * (Math.cos(time * 0.7) > 0 ? 1 : -1), s);
  const [sx, sy] = SHOULDER;
  // working at the millstone / the dough: the hands go round in front
  const hx = 6 + Math.cos(time * 3) * 2;
  const hy = -6 + Math.sin(time * 3) * 1.5;
  drawArm(ctx, o, sx - 1.2, sy, hx - 1, hy, true);
  drawTorso(ctx, o, 0, who.seed);
  drawHead(ctx, o, HEAD[0], HEAD[1]);
  drawArm(ctx, o, sx, sy, hx, hy);
  ctx.restore();
  // the frame's cross bars in front of them
  line(ctx, x + w / 2, y, x + w / 2, y + h, '#5a4331', 1.5);
  line(ctx, x, y + h / 2, x + w, y + h / 2, '#5a4331', 1.5);
}

function door(ctx: Ctx, x: number, base: number, w: number, h: number, wood = '#6b4a2c'): void {
  ctx.fillStyle = '#3a2a1c';
  ctx.beginPath();
  ctx.moveTo(x - 2, base);
  ctx.lineTo(x - 2, base - h + w / 2);
  ctx.arc(x + w / 2, base - h + w / 2, w / 2 + 2, Math.PI, 0);
  ctx.lineTo(x + w + 2, base);
  ctx.fill();
  ctx.fillStyle = wood;
  ctx.beginPath();
  ctx.moveTo(x, base);
  ctx.lineTo(x, base - h + w / 2);
  ctx.arc(x + w / 2, base - h + w / 2, w / 2, Math.PI, 0);
  ctx.lineTo(x + w, base);
  ctx.fill();
  for (let px = x + w / 4; px < x + w; px += w / 4) line(ctx, px, base, px, base - h + 3, shade(wood, -0.3), 1);
  rect(ctx, x, base - h * 0.3, w, 2, '#2e2a26');
  rect(ctx, x, base - h * 0.75, w, 2, '#2e2a26');
  circle(ctx, x + w * 0.78, base - h * 0.5, 1.6, '#c9a860');
}

/** Dark oak framing on a plastered face. */
function timberFrame(ctx: Ctx, x0: number, base: number, w: number, h: number, seed: number): void {
  const t = 4;
  rect(ctx, x0, base - h, w, t, TIMBER);
  rect(ctx, x0, base - t, w, t, TIMBER);
  const bays = Math.max(2, Math.round(w / 34));
  const bw = w / bays;
  for (let i = 0; i <= bays; i++) rect(ctx, x0 + i * bw - (i === bays ? t : i === 0 ? 0 : t / 2), base - h, t, h, TIMBER);
  ctx.lineCap = 'butt';
  for (let i = 0; i < bays; i++) {
    const r = hash(seed, i);
    const bx = x0 + i * bw;
    if (r < 0.35) {
      line(ctx, bx + 2, base - 3, bx + bw - 2, base - h + 3, TIMBER, 3.5);
    } else if (r < 0.6) {
      line(ctx, bx + 2, base - h + 3, bx + bw - 2, base - 3, TIMBER, 3.5);
    } else if (r < 0.75) {
      rect(ctx, bx, base - h / 2 - 1.5, bw, 3, TIMBER);
    }
  }
}

function stonePlinth(ctx: Ctx, x0: number, base: number, w: number, h: number, d: number, stone = STONE): void {
  block(ctx, x0, base, w, h, d, stone);
  ctx.globalAlpha = 0.35;
  for (let y = base - h + 5; y < base; y += 6) {
    rect(ctx, x0, y, w, 1, shade(stone, -0.45));
    for (let x = x0 + ((y / 6) % 2) * 7; x < x0 + w; x += 14) rect(ctx, x, y, 1, 6, shade(stone, -0.45));
  }
  ctx.globalAlpha = 1;
}

function chimney(ctx: Ctx, x: number, top: number, h: number, a: DrawArgs, strength = 1): void {
  rect(ctx, x, top - h, 11, h, '#8a7462');
  rect(ctx, x + 7, top - h, 4, h, '#6b594b');
  rect(ctx, x - 1.5, top - h - 3, 14, 4, '#6e5c4e');
  smoke(ctx, x + 5, top - h - 4, a.time, a.seed, strength);
}

function barrel(ctx: Ctx, x: number, base: number, s = 1): void {
  const w = 14 * s;
  const h = 18 * s;
  ctx.fillStyle = '#7b5634';
  ctx.beginPath();
  ctx.ellipse(x, base - h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  rect(ctx, x - w / 2, base - h, w, h, '#86603b');
  rect(ctx, x + w * 0.15, base - h, w * 0.35, h, '#6c4c2e');
  rect(ctx, x - w / 2, base - h * 0.8, w, 1.8, '#3c3530');
  rect(ctx, x - w / 2, base - h * 0.25, w, 1.8, '#3c3530');
  ellipse(ctx, x, base - h, w / 2, 2.5, '#5e4128');
}

function crate(ctx: Ctx, x: number, base: number, s: number): void {
  block(ctx, x, base, 16 * s, 14 * s, 10 * s, '#a07a4a');
  line(ctx, x, base, x + 16 * s, base - 14 * s, '#6d522f', 1.5);
}

/** A townsperson standing at their work, in the same body as the villagers (figure.ts). */
function person(ctx: Ctx, x: number, base: number, tunic: string, time: number, hammer = false): void {
  const o = { ...outfitOf({ look: 'peasant', role: null, seed: Math.round(x) }), top: tunic, sleeve: tunic };
  if (hammer) Object.assign(o, { rolled: true, apron: '#4a3526', beard: true });
  ctx.save();
  ctx.translate(x, base);
  ctx.translate(0, drawLegs(ctx, o, 0, false));
  const [sx, sy] = SHOULDER;
  drawArm(ctx, o, sx - 1.2, sy, 4, -3, true);
  drawTorso(ctx, o, 0, Math.round(x));
  drawHead(ctx, o, HEAD[0], HEAD[1]);
  if (hammer) {
    const a = Math.abs(Math.sin(time * 5)) * 1.6 - 0.4;
    const hx = sx + Math.cos(-a) * 10;
    const hy = sy + 3 - Math.sin(a) * 8;
    line(ctx, hx, hy, hx + Math.cos(-a + 1.4) * 4, hy - Math.sin(a - 1.4) * 4, '#5a3d24', 2);
    rect(ctx, hx - 2, hy - 3, 5, 4, '#555');
    drawArm(ctx, o, sx, sy, hx, hy);
  } else {
    drawArm(ctx, o, sx, sy, 5, -4);
  }
  ctx.restore();
}

// --- Buildings ---------------------------------------------------------------

function drawHouse(ctx: Ctx, a: DrawArgs): void {
  const w = 104;
  const d = 44;
  const ox = d * OX;
  const x0 = a.x - (w + ox) / 2;
  const plaster = PLASTER[Math.floor(hash(a.seed, 1) * PLASTER.length)];
  const twoStorey = hash(a.seed, 2) < 0.55;
  const thatch = hash(a.seed, 3) < 0.5;

  stonePlinth(ctx, x0, a.base, w, 14, d);
  let top: number;
  if (twoStorey) {
    // stone ground floor, jettied timber-framed upper floor
    const g = a.base - 14;
    block(ctx, x0, g, w, 34, d, shade(STONE, 0.08));
    const jetty = 5;
    block(ctx, x0 - jetty, g - 34, w + jetty * 2, 40, d, plaster);
    timberFrame(ctx, x0 - jetty, g - 34, w + jetty * 2, 40, a.seed);
    rect(ctx, x0 - jetty, g - 36, w + jetty * 2, 4, '#3a281b');
    top = g - 74;
    door(ctx, x0 + 18, a.base, 20, 36);
    window_(ctx, x0 + 62, g - 26, 16, 14, hash(a.seed, 5) < 0.5, a.time, a.seed);
    window_(ctx, x0 + 18, g - 64, 14, 14, false, a.time, a.seed);
    window_(ctx, x0 + 70, g - 64, 14, 14, hash(a.seed, 6) < 0.6, a.time, a.seed + 1);
  } else {
    block(ctx, x0, a.base - 14, w, 48, d, plaster);
    timberFrame(ctx, x0, a.base - 14, w, 48, a.seed);
    top = a.base - 62;
    door(ctx, x0 + 42, a.base, 20, 40);
    window_(ctx, x0 + 12, a.base - 50, 16, 16, hash(a.seed, 5) < 0.5, a.time, a.seed);
    window_(ctx, x0 + 76, a.base - 50, 16, 16, false, a.time, a.seed);
  }
  const roofCol = thatch ? ['#b8955a', '#a8864e'][hash(a.seed, 4) < 0.5 ? 0 : 1] : ['#a4553a', '#8e4a33', '#6f6a74'][Math.floor(hash(a.seed, 4) * 3)];
  const r = gableRoof(ctx, x0 - (twoStorey ? 5 : 0), top, w + (twoStorey ? 10 : 0), d, thatch ? 50 : 44, roofCol, plaster, thatch ? 'thatch' : 'tile', a.seed);
  chimney(ctx, r.ridgeX1 + w * 0.7, r.ridgeY + 8, 18, a);
  // flower box / details
  if (hash(a.seed, 7) < 0.6) {
    barrel(ctx, x0 + w + 16, a.base + 4, 0.9);
  }
}

function drawFarmField(ctx: Ctx, a: DrawArgs): void {
  drawBackField(ctx, a, a.farm, a.seed);
}

function drawFarmFrontField(ctx: Ctx, a: DrawArgs): void {
  drawFrontField(ctx, a, a.farm, a.seed);
}

function drawFarm(ctx: Ctx, a: DrawArgs): void {
  // small cottage with a lean-to barn
  const w = 80;
  const d = 40;
  const x0 = a.x - 58;
  stonePlinth(ctx, x0, a.base, w, 10, d);
  block(ctx, x0, a.base - 10, w, 38, d, '#ead9b4');
  timberFrame(ctx, x0, a.base - 10, w, 38, a.seed + 3);
  // the door stands open while the farmer steps through it
  const doorOpen = (a.workers ?? []).some((w) => doorProgress(w) > 0 && doorProgress(w) < 1);
  door(ctx, x0 + 30, a.base, 18, 34, doorOpen ? '#1c140d' : undefined);
  if (doorOpen) rect(ctx, x0 + 26, a.base - 30, 4, 30, '#6b4a2c'); // the door leaf, swung open
  window_(ctx, x0 + 8, a.base - 40, 13, 13, true, a.time, a.seed);
  // upgraded: a second room on the other side of the door, for a second farmer
  if (a.upgraded) window_(ctx, x0 + 59, a.base - 40, 13, 13, true, a.time, a.seed + 1);
  gableRoof(ctx, x0, a.base - 48, w, d, 40, '#b8955a', '#ead9b4', 'thatch', a.seed);
  // barn
  const bx = x0 + w + d * OX - 4;
  block(ctx, bx, a.base, 44, 40, 26, '#8b6440');
  for (let px = bx + 4; px < bx + 44; px += 6) line(ctx, px, a.base, px, a.base - 40, '#6b4a2e', 1);
  rect(ctx, bx + 10, a.base - 30, 24, 30, '#3e2b1c');
  line(ctx, bx + 10, a.base - 30, bx + 34, a.base, '#8b6440', 2.5);
  line(ctx, bx + 34, a.base - 30, bx + 10, a.base, '#8b6440', 2.5);
  poly(ctx, [bx - 4, a.base - 38, bx + 50, a.base - 38, bx + 50, a.base - 52, bx - 4, a.base - 58], '#8e4a33');
  // low fences in front of the side plots
  drawBackFences(ctx, a, a.farm);
  // the grain store between the house and the street
  drawStore(ctx, a, a.stock?.grain ?? 0);
  // the farmers asleep inside, each in their own room
  const sleepers = (a.workers ?? []).filter((wk) => wk.task.kind === 'home' && wk.task.activity === 'sleep').length;
  if (sleepers > 0) drawSnore(ctx, x0 + w * 0.3, a.base - 70, a.time);
  if (sleepers > 1) drawSnore(ctx, x0 + w * 0.85, a.base - 70, a.time + 1.3);
}

/** Little z's drifting up from a sleeper's window. */
function drawSnore(ctx: Ctx, x: number, y: number, time: number): void {
  ctx.save();
  ctx.font = 'bold 11px Georgia, serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < 3; i++) {
    const t = (time * 0.35 + i / 3) % 1;
    ctx.globalAlpha = Math.sin(t * Math.PI) * 0.9;
    ctx.fillStyle = '#f3ead8';
    ctx.font = `bold ${8 + t * 8}px Georgia, serif`;
    ctx.fillText('z', x + t * 18 + Math.sin(t * 6) * 3, y - t * 34);
  }
  ctx.restore();
}

function drawWarehouse(ctx: Ctx, a: DrawArgs): void {
  // an open storage yard: everything it holds lies out in plain sight, each
  // item in its own place (game/layout.ts warehouseSlot), where builders take
  // it from and carriers put it down
  const stock = a.stock;
  const items = (r: keyof typeof YARD_ITEMS) => Math.min(YARD_ITEMS[r], pileItems(stock?.[r] ?? 0));
  // trodden earth and a wattle fence round the back of the yard
  ctx.globalAlpha = 0.35;
  ellipse(ctx, a.x, a.base + 1, 90, 5, '#7a6446');
  ctx.globalAlpha = 1;
  for (let px = a.x - 84; px <= a.x + 84; px += 14) rect(ctx, px - 1.5, a.base - 26, 3, 26, '#6b4f33');
  for (const y of [a.base - 22, a.base - 14, a.base - 7]) line(ctx, a.x - 86, y, a.x + 86, y, '#8a6a44', 2);

  // the open-fronted shed for what must stay dry
  const xl = a.x - 32;
  const xr = a.x + 34;
  rect(ctx, xl, a.base - 72, xr - xl, 72, '#6b4f33');
  for (let px = xl + 5; px < xr; px += 6) line(ctx, px, a.base - 72, px, a.base, '#5a412a', 1);
  for (const lift of [50, 62]) {
    rect(ctx, xl + 2, a.base - lift, xr - xl - 4, 2.5, '#9a7650'); // shelf
    rect(ctx, xl + 4, a.base - lift + 2.5, 2, 4, '#5e452e');
    rect(ctx, xr - 6, a.base - lift + 2.5, 2, 4, '#5e452e');
  }
  gableRoof(ctx, xl - 4, a.base - 72, xr - xl + 8, 30, 16, '#b8955a', '#6b4f33', 'thatch', a.seed);
  // bread in baskets on the shelves, the last basket part-full
  const bread = stock?.bread ?? 0;
  for (let i = 0; i < items('bread'); i++) {
    const s = warehouseSlot('bread', i);
    breadBasket(ctx, a.x + s.dx, a.base - s.lift, 0.75, Math.ceil((Math.min(PILE_UNIT, bread - i * PILE_UNIT) / PILE_UNIT) * 5));
  }
  // sacks of grain and of flour stacked on the ground
  for (const [r, body, tie] of [
    ['grain', '#d8c79a', '#9a8656'],
    ['flour', '#efe9da', '#b8ad94'],
  ] as const) {
    for (let i = 0; i < items(r); i++) {
      const s = warehouseSlot(r, i);
      ellipse(ctx, a.x + s.dx, a.base - 5 - s.lift, 4, 5.5, body);
      line(ctx, a.x + s.dx - 2, a.base - 9.5 - s.lift, a.x + s.dx + 2, a.base - 9.5 - s.lift, tie, 1);
    }
  }
  rect(ctx, xl - 2, a.base - 74, 4, 74, '#5e452e'); // front posts
  rect(ctx, xr - 2, a.base - 74, 4, 74, '#5e452e');

  // the stone heap and the log pile out in the open
  for (let i = 0; i < items('stone'); i++) {
    const s = warehouseSlot('stone', i);
    const bx = a.x + s.dx - 3.25;
    const by = a.base - s.lift - 2.5;
    rect(ctx, bx, by, 6.5, 5, shade('#aaa398', -hash(a.seed, i) * 0.15));
    rect(ctx, bx, by, 6.5, 1.5, '#c4beb3');
  }
  for (let i = 0; i < items('wood'); i++) {
    const s = warehouseSlot('wood', i);
    ellipse(ctx, a.x + s.dx, a.base - s.lift, 3.4, 3.2, '#8b6440');
    ellipse(ctx, a.x + s.dx, a.base - s.lift, 2.2, 2, '#c9a577');
  }
}

/** Baskets of loaves in a store's places: a full basket per BASKET loaves, the last one part-full. */
function breadStore(ctx: Ctx, a: DrawArgs, slots: readonly Slot[]): void {
  const bread = a.stock?.bread ?? 0;
  const n = Math.min(slots.length, Math.ceil(bread / BASKET - 1e-9));
  for (let i = 0; i < n; i++) {
    const inBasket = Math.min(BASKET, bread - i * BASKET);
    breadBasket(ctx, a.x + slots[i].dx, a.base - slots[i].lift, 1, Math.ceil((inBasket / BASKET) * 5));
  }
}

function drawBakery(ctx: Ctx, a: DrawArgs): void {
  // a low stone bakehouse with a domed bread oven built on at the side
  const w = 90;
  const d = 40;
  const x0 = a.x - 55;
  // the oven (its mouth where the baker works it, game/layout.ts): a brick dome glowing at the mouth, its flue smoking; while the
  // baker bakes, loaves sit in the mouth, browning, and the fire burns brighter
  const ovx = a.x + BAKERY_OVEN_MOUTH_DX;
  const bake = (a.crew ?? []).map((c) => c.worker.task).find((t) => t.kind === 'job' && t.carried && !t.indoors);
  const baked = bake?.kind === 'job' ? clamp01(bake.t / Math.max(bake.duration, 1e-6)) : null;
  ctx.globalAlpha = 0.25;
  ellipse(ctx, ovx, a.base + 1, 30, 4, '#2c2416');
  ctx.globalAlpha = 1;
  rect(ctx, ovx - 24, a.base - 12, 48, 12, '#a89c88');
  const og = ctx.createLinearGradient(ovx - 22, 0, ovx + 22, 0);
  og.addColorStop(0, '#c2764e');
  og.addColorStop(1, '#7e4630');
  ctx.fillStyle = og;
  ctx.beginPath();
  ctx.moveTo(ovx - 22, a.base - 12);
  ctx.quadraticCurveTo(ovx - 22, a.base - 46, ovx, a.base - 46);
  ctx.quadraticCurveTo(ovx + 22, a.base - 46, ovx + 22, a.base - 12);
  ctx.fill();
  ctx.globalAlpha = 0.3;
  for (let y = a.base - 18; y > a.base - 42; y -= 6) line(ctx, ovx - 20 + (a.base - 12 - y) * 0.35, y, ovx + 20 - (a.base - 12 - y) * 0.35, y, '#4a2a1a', 1);
  ctx.globalAlpha = 1;
  const flick = (baked === null ? 0.8 : 1) + Math.sin(a.time * 7) * 0.1 + Math.sin(a.time * 17) * 0.08;
  ctx.fillStyle = '#2a1a12';
  ctx.beginPath();
  ctx.moveTo(ovx - 9, a.base - 12);
  ctx.arc(ovx, a.base - 12, 9, Math.PI, 0);
  ctx.fill();
  ctx.globalAlpha = Math.min(1, flick);
  ctx.fillStyle = baked === null ? '#f0a040' : '#ffb850';
  ctx.beginPath();
  ctx.moveTo(ovx - 6, a.base - 12);
  ctx.arc(ovx, a.base - 12, 6, Math.PI, 0);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (baked !== null) {
    // loaves on the oven floor, from pale dough to a golden crust
    const crust = mix('#e8d6b0', '#a8642e', baked);
    for (const dx of [-3.5, 0.5, 4]) ellipse(ctx, ovx + dx, a.base - 13.2, 2.4, 1.5, crust);
    // warm light spilling out on the ground
    const g2 = ctx.createRadialGradient(ovx, a.base - 10, 0, ovx, a.base - 10, 26);
    g2.addColorStop(0, `rgba(255,190,90,${0.28 * flick})`);
    g2.addColorStop(1, 'rgba(255,190,90,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(ovx - 26, a.base - 36, 52, 40);
  }
  rect(ctx, ovx + 8, a.base - 58, 8, 16, '#8a5a40');
  smoke(ctx, ovx + 12, a.base - 60, a.time, a.seed, baked === null ? 0.8 : 1.3);
  // the bakehouse
  stonePlinth(ctx, x0, a.base, w, 12, d);
  block(ctx, x0, a.base - 12, w, 40, d, '#e9d6b0');
  timberFrame(ctx, x0, a.base - 12, w, 40, a.seed + 5);
  const doorOpen = (a.workers ?? []).some((w) => doorProgress(w) > 0 && doorProgress(w) < 1);
  door(ctx, x0 + 36, a.base, 20, 34, doorOpen ? '#1c140d' : '#6b4a2c');
  window_(ctx, x0 + 10, a.base - 42, 14, 14, true, a.time, a.seed);
  window_(ctx, x0 + 66, a.base - 42, 14, 14, true, a.time, a.seed + 2);
  const r = gableRoof(ctx, x0, a.base - 52, w, d, 42, '#a4553a', '#e9d6b0', 'tile', a.seed);
  chimney(ctx, r.ridgeX1 + 14, r.ridgeY + 10, 16, a, 0.5);
  // hanging sign with a loaf
  const sx = x0 - 4;
  line(ctx, sx, a.base - 50, sx - 22, a.base - 50, '#3a281b', 3);
  ctx.save();
  ctx.translate(sx - 14, a.base - 50);
  ctx.rotate(Math.sin(a.time * 1.1 + 1) * 0.08);
  line(ctx, -6, 0, -6, 5, '#333', 1);
  line(ctx, 6, 0, 6, 5, '#333', 1);
  rect(ctx, -10, 5, 20, 15, '#7a5230');
  ellipse(ctx, 0, 12.5, 7, 4, '#c98a48');
  line(ctx, -3, 11, -1, 14, '#8a5a2a', 1);
  line(ctx, 1, 11, 3, 14, '#8a5a2a', 1);
  ctx.restore();
  // the store: sacks of flour waiting left of the door, baskets of loaves right of it
  const sacks = Math.min(BAKERY_SLOTS.flour.length, Math.ceil((a.stock?.flour ?? 0) / SACK - 1e-9));
  for (let i = 0; i < sacks; i++) {
    const s = BAKERY_SLOTS.flour[i];
    ellipse(ctx, a.x + s.dx, a.base - 6 - s.lift, 7, 7, '#e8e0cc');
    ellipse(ctx, a.x + s.dx + 2, a.base - 5 - s.lift, 4, 5, '#cbbfa4');
  }
  breadStore(ctx, a, BAKERY_SLOTS.bread);
}

function drawMill(ctx: Ctx, a: DrawArgs): void {
  const cx = a.x - 6;
  const bw = 70;
  const tw = 44;
  const h = 150;
  const top = a.base - h;
  // tapered stone tower with cylindrical shading
  const g = ctx.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
  g.addColorStop(0, '#e6dccb');
  g.addColorStop(0.4, '#d3c6ae');
  g.addColorStop(1, '#8f8474');
  poly(ctx, [cx - bw / 2, a.base, cx + bw / 2, a.base, cx + tw / 2, top, cx - tw / 2, top], undefined);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.globalAlpha = 0.18;
  for (let y = top + 10; y < a.base; y += 9) {
    const t = (y - top) / h;
    const hw = (tw + (bw - tw) * t) / 2;
    rect(ctx, cx - hw, y, hw * 2, 1, '#4a4034');
  }
  ctx.globalAlpha = 1;
  ctx.globalAlpha = 0.25;
  ellipse(ctx, cx + 10, a.base + 1, 52, 5, '#2c2416');
  ctx.globalAlpha = 1;
  const doorOpen = (a.workers ?? []).some((w) => doorProgress(w) > 0 && doorProgress(w) < 1);
  door(ctx, cx - 10, a.base, 20, 34, doorOpen ? '#1c140d' : undefined);
  // the miller upstairs at the millstones, seen at the window
  const miller = atWindow(a);
  if (miller) occupiedWindow(ctx, cx - 8, a.base - 82, 14, 16, miller, a.time, a.seed);
  else window_(ctx, cx - 8, a.base - 82, 14, 16, false, a.time, a.seed);
  window_(ctx, cx - 4, top + 22, 9, 11, false, a.time, a.seed);
  // gallery ring
  rect(ctx, cx - bw / 2 - 6, a.base - 56, bw + 12, 4, '#5e4630');
  for (let px = cx - bw / 2 - 4; px < cx + bw / 2 + 6; px += 8) rect(ctx, px, a.base - 68, 2, 12, '#6b5038');
  rect(ctx, cx - bw / 2 - 6, a.base - 69, bw + 12, 2, '#6b5038');
  // cap
  const capG = ctx.createLinearGradient(cx - tw / 2, 0, cx + tw / 2, 0);
  capG.addColorStop(0, '#b9956a');
  capG.addColorStop(1, '#6c5236');
  ctx.fillStyle = capG;
  ctx.beginPath();
  ctx.moveTo(cx - tw / 2 - 6, top + 2);
  ctx.quadraticCurveTo(cx - tw / 2, top - 38, cx, top - 42);
  ctx.quadraticCurveTo(cx + tw / 2, top - 38, cx + tw / 2 + 6, top + 2);
  ctx.fill();
  // sails
  const hub = { x: cx - 2, y: top - 8 };
  const ang = a.time * 0.9 + a.seed;
  for (let i = 0; i < 4; i++) {
    const th = ang + (i * Math.PI) / 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const L = 96;
    line(ctx, hub.x, hub.y, hub.x + c * L, hub.y + s * L, '#5a3f28', 3);
    // lattice sail on one side of the stock
    const nx = -s;
    const ny = c;
    const pts = [
      hub.x + c * 20, hub.y + s * 20,
      hub.x + c * L, hub.y + s * L,
      hub.x + c * L + nx * 16, hub.y + s * L + ny * 16,
      hub.x + c * 20 + nx * 13, hub.y + s * 20 + ny * 13,
    ];
    poly(ctx, pts, 'rgba(236,226,205,0.85)', '#6b4f36', 1);
    for (let k = 1; k < 8; k++) {
      const t = 20 + ((L - 20) * k) / 8;
      line(ctx, hub.x + c * t, hub.y + s * t, hub.x + c * t + nx * (13 + k * 0.4), hub.y + s * t + ny * (13 + k * 0.4), '#8a6c4c', 1);
    }
  }
  circle(ctx, hub.x, hub.y, 5, '#3e2c1d');
  // the store: sacks of grain waiting left of the door, flour right of it, each in its place
  for (const [r, body, shadow] of [
    ['grain', '#d8c79a', '#b9a676'],
    ['flour', '#e8e0cc', '#cbbfa4'],
  ] as const) {
    const n = Math.min(MILL_SLOTS[r].length, Math.ceil((a.stock?.[r] ?? 0) / SACK - 1e-9));
    for (let i = 0; i < n; i++) {
      const s = MILL_SLOTS[r][i];
      ellipse(ctx, a.x + s.dx, a.base - 6 - s.lift, 7, 7, body);
      ellipse(ctx, a.x + s.dx + 2, a.base - 5 - s.lift, 4, 5, shadow);
    }
  }
}

function drawBlacksmith(ctx: Ctx, a: DrawArgs): void {
  const w = 120;
  const d = 44;
  const x0 = a.x - (w + d * OX) / 2;
  // back/side stone walls
  stonePlinth(ctx, x0, a.base, w, 12, d, '#a89c88');
  block(ctx, x0, a.base - 12, 30, 58, d, '#b3a68f');
  // open workshop interior
  rect(ctx, x0 + 30, a.base - 70, w - 30, 58, '#2f241c');
  const flick = 0.75 + Math.sin(a.time * 9) * 0.1 + Math.sin(a.time * 23) * 0.08;
  const fx = x0 + 52;
  const fy = a.base - 30;
  const glow = ctx.createRadialGradient(fx, fy, 2, fx, fy, 60);
  glow.addColorStop(0, `rgba(255,170,60,${flick})`);
  glow.addColorStop(0.4, `rgba(220,90,30,${flick * 0.45})`);
  glow.addColorStop(1, 'rgba(120,40,10,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x0 + 30, a.base - 70, w - 30, 58);
  // forge hearth
  rect(ctx, fx - 16, fy - 4, 32, 18, '#6d625a');
  ellipse(ctx, fx, fy - 3, 12, 4, `rgba(255,${150 + Math.floor(flick * 60)},70,1)`);
  // tools on the back wall
  for (let i = 0; i < 4; i++) line(ctx, x0 + 80 + i * 8, a.base - 64, x0 + 80 + i * 8, a.base - 48 + (i % 2) * 4, '#9a9a9a', 1.5);
  // posts + lean-to roof
  rect(ctx, x0 + 30, a.base - 72, 5, 72, '#4f3524');
  rect(ctx, x0 + w - 5, a.base - 72, 5, 72, '#4f3524');
  poly(ctx, [x0 + w, a.base, x0 + w + d * OX, a.base - d * OY, x0 + w + d * OX, a.base - d * OY - 72, x0 + w, a.base - 72], '#7e725f');
  gableRoof(ctx, x0, a.base - 72, w, d, 36, '#6f6a74', '#8e826c', 'slate', a.seed);
  // stone chimney with dark smoke
  rect(ctx, x0 + 6, a.base - 128, 18, 60, '#8f8474');
  rect(ctx, x0 + 18, a.base - 128, 6, 60, '#6c6356');
  rect(ctx, x0 + 4, a.base - 131, 22, 5, '#6c6356');
  smoke(ctx, x0 + 15, a.base - 132, a.time, a.seed, 1.3);
  // anvil + smith outside under the eave
  const ax = x0 + w - 14;
  rect(ctx, ax - 4, a.base - 12, 8, 12, '#4a4440');
  poly(ctx, [ax - 12, a.base - 16, ax + 10, a.base - 16, ax + 14, a.base - 20, ax - 16, a.base - 20], '#3b3836');
  person(ctx, ax - 22, a.base, '#6d4c34', a.time, true);
  // sparks on each hammer strike
  const strike = (a.time * 5) % Math.PI;
  if (strike < 0.5) {
    for (let i = 0; i < 6; i++) {
      const t = strike / 0.5;
      const ang = -Math.PI / 2 + (hash(Math.floor(a.time * 5 / Math.PI), i) - 0.5) * 2.4;
      circle(ctx, ax - 2 + Math.cos(ang) * t * 18, a.base - 20 + Math.sin(ang) * t * 18 + t * t * 8, 1.2, '#ffd27a');
    }
  }
  barrel(ctx, ax + 26, a.base + 3, 0.8);
}

function stall(ctx: Ctx, x: number, base: number, w: number, c1: string, c2: string, goods: string[], seed: number, time: number): void {
  // posts
  rect(ctx, x, base - 56, 4, 56, '#5a4030');
  rect(ctx, x + w - 4, base - 56, 4, 56, '#5a4030');
  // merchant behind the counter
  person(ctx, x + w / 2, base, hash(seed, 9) < 0.5 ? '#3f6a8a' : '#7a3d3d', time);
  // counter
  block(ctx, x - 2, base, w + 4, 22, 14, '#8a6541');
  for (let i = 0; i < 9; i++) {
    const g = goods[i % goods.length];
    circle(ctx, x + 8 + i * ((w - 12) / 9), base - 25, 4, g);
  }
  // striped awning with a scalloped edge
  const stripes = 7;
  const sw = (w + 12) / stripes;
  for (let i = 0; i < stripes; i++) {
    poly(ctx, [x - 6 + i * sw, base - 58, x - 6 + (i + 1) * sw, base - 58, x + (i + 1) * sw - 2, base - 76, x + i * sw - 2, base - 76], i % 2 ? c1 : c2);
    ctx.fillStyle = i % 2 ? c1 : c2;
    ctx.beginPath();
    ctx.arc(x - 6 + (i + 0.5) * sw, base - 58, sw / 2, 0, Math.PI);
    ctx.fill();
  }
}

function drawMarket(ctx: Ctx, a: DrawArgs): void {
  // back canopy wall of the market square
  stall(ctx, a.x - 82, a.base, 72, '#b83b35', '#f0e4c8', ['#c0392b', '#d35400', '#8e2c1f'], a.seed, a.time);
  stall(ctx, a.x + 8, a.base, 72, '#2f5d8a', '#e8c95a', ['#e7c469', '#b8844a', '#6a8b3a'], a.seed + 1, a.time);
  crate(ctx, a.x - 100, a.base + 2, 1);
  crate(ctx, a.x - 96, a.base - 12, 0.8);
  barrel(ctx, a.x + 94, a.base + 2, 1);
  barrel(ctx, a.x + 80, a.base + 3, 0.9);
  // bunting between stalls
  ctx.strokeStyle = '#5a4030';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a.x - 82, a.base - 76);
  ctx.quadraticCurveTo(a.x, a.base - 60, a.x + 82, a.base - 76);
  ctx.stroke();
  for (let i = 1; i < 10; i++) {
    const t = i / 10;
    const bx = a.x - 82 + 164 * t;
    const by = a.base - 76 + 32 * t * (1 - t) - 0.5;
    poly(ctx, [bx - 4, by, bx + 4, by, bx, by + 8], ['#c0392b', '#e8c95a', '#2f5d8a'][i % 3]);
  }
}

function drawChapel(ctx: Ctx, a: DrawArgs): void {
  const w = 96;
  const d = 50;
  const ox = d * OX;
  const x0 = a.x - (w + ox) / 2 + 18;
  const stone = '#d6cbb5';
  // nave
  stonePlinth(ctx, x0, a.base, w, 10, d, '#b3a68f');
  block(ctx, x0, a.base - 10, w, 72, d, stone);
  ctx.globalAlpha = 0.14;
  for (let y = a.base - 78; y < a.base - 10; y += 7) rect(ctx, x0, y, w, 1, '#5a5046');
  ctx.globalAlpha = 1;
  // buttresses
  for (const bx of [x0 + 30, x0 + 64]) poly(ctx, [bx, a.base, bx + 9, a.base, bx + 9, a.base - 50, bx + 3, a.base - 62, bx, a.base - 62], shade(stone, -0.12));
  // lancet windows with stained glass
  for (const wx of [x0 + 44, x0 + 78]) {
    ctx.fillStyle = '#5a4a6a';
    ctx.beginPath();
    ctx.moveTo(wx, a.base - 26);
    ctx.lineTo(wx, a.base - 52);
    ctx.quadraticCurveTo(wx + 5, a.base - 62, wx + 10, a.base - 52);
    ctx.lineTo(wx + 10, a.base - 26);
    ctx.fill();
    rect(ctx, wx + 2, a.base - 48, 3, 8, '#b84a4a');
    rect(ctx, wx + 5, a.base - 40, 3, 8, '#4a7ab8');
    rect(ctx, wx + 2, a.base - 34, 3, 6, '#d9b44a');
  }
  gableRoof(ctx, x0, a.base - 82, w, d, 52, '#7d5a4a', stone, 'tile', a.seed);
  // rose window on the gable end
  circle(ctx, x0 + w + ox / 2, a.base - 82 - 16, 7, '#5a4a6a');
  circle(ctx, x0 + w + ox / 2, a.base - 82 - 16, 3, '#c9a24a');

  // bell tower at the front-left
  const tx = x0 - 36;
  const tw = 40;
  const th = 150;
  block(ctx, tx, a.base, tw, th, 30, shade(stone, 0.04));
  ctx.globalAlpha = 0.14;
  for (let y = a.base - th + 6; y < a.base; y += 7) rect(ctx, tx, y, tw, 1, '#5a5046');
  ctx.globalAlpha = 1;
  door(ctx, tx + 10, a.base, 20, 40, '#5e3d24');
  // belfry opening with a swinging bell
  ctx.fillStyle = '#2e2622';
  ctx.beginPath();
  ctx.moveTo(tx + 11, a.base - th + 42);
  ctx.lineTo(tx + 11, a.base - th + 20);
  ctx.arc(tx + 20, a.base - th + 20, 9, Math.PI, 0);
  ctx.lineTo(tx + 29, a.base - th + 42);
  ctx.fill();
  const swing = Math.sin(a.time * 1.3) * 0.25;
  ctx.save();
  ctx.translate(tx + 20, a.base - th + 16);
  ctx.rotate(swing);
  poly(ctx, [-5, 6, 5, 6, 8, 18, -8, 18], '#b58a3a');
  ctx.restore();
  rect(ctx, tx - 2, a.base - th - 2, tw + 4, 5, shade(stone, -0.1));
  // spire
  const sx = tx + tw / 2 + 4;
  poly(ctx, [tx - 3, a.base - th - 1, sx, a.base - th - 80, sx + 6, a.base - th - 76, tx + tw + 12, a.base - th - 8], undefined);
  const sg = ctx.createLinearGradient(tx, 0, tx + tw + 12, 0);
  sg.addColorStop(0, '#6b7390');
  sg.addColorStop(0.55, '#4f5670');
  sg.addColorStop(1, '#353a4d');
  ctx.fillStyle = sg;
  ctx.fill();
  line(ctx, sx, a.base - th - 80, sx, a.base - th - 96, '#c9a24a', 2);
  line(ctx, sx - 5, a.base - th - 90, sx + 5, a.base - th - 90, '#c9a24a', 2);
}

function drawTavern(ctx: Ctx, a: DrawArgs): void {
  const w = 126;
  const d = 48;
  const ox = d * OX;
  const x0 = a.x - (w + ox) / 2;
  stonePlinth(ctx, x0, a.base, w, 12, d);
  block(ctx, x0, a.base - 12, w, 44, d, '#bfb09a');
  const j = 6;
  block(ctx, x0 - j, a.base - 56, w + j * 2, 46, d, '#ecdcb8');
  timberFrame(ctx, x0 - j, a.base - 56, w + j * 2, 46, a.seed + 11);
  rect(ctx, x0 - j, a.base - 58, w + j * 2, 4, '#3a281b');
  door(ctx, x0 + 52, a.base, 24, 40, '#6b3f22');
  window_(ctx, x0 + 12, a.base - 42, 22, 16, true, a.time, a.seed);
  window_(ctx, x0 + 90, a.base - 42, 22, 16, true, a.time, a.seed + 3);
  window_(ctx, x0 + 14, a.base - 92, 16, 16, true, a.time, a.seed + 5);
  window_(ctx, x0 + 56, a.base - 92, 16, 16, false, a.time, a.seed);
  window_(ctx, x0 + 96, a.base - 92, 16, 16, true, a.time, a.seed + 7);
  const r = gableRoof(ctx, x0 - j, a.base - 102, w + j * 2, d, 50, '#8e4a33', '#ecdcb8', 'tile', a.seed);
  chimney(ctx, r.ridgeX1 + 20, r.ridgeY + 10, 22, a);
  chimney(ctx, r.ridgeX2 - 30, r.ridgeY + 10, 16, a, 0.6);
  // hanging sign with a mug
  const sx = x0 - 6;
  line(ctx, sx, a.base - 64, sx - 28, a.base - 64, '#3a281b', 3);
  const sw = Math.sin(a.time * 1.1) * 0.08;
  ctx.save();
  ctx.translate(sx - 18, a.base - 64);
  ctx.rotate(sw);
  line(ctx, -8, 0, -8, 6, '#333', 1);
  line(ctx, 8, 0, 8, 6, '#333', 1);
  rect(ctx, -12, 6, 24, 20, '#7a5230');
  rect(ctx, -10, 8, 20, 16, '#9a6a3c');
  rect(ctx, -5, 11, 8, 10, '#e8c25a');
  rect(ctx, -5, 10, 8, 3, '#fff6e0');
  ctx.strokeStyle = '#e8c25a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(4, 16, 3, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.restore();
  // lantern
  const lx = x0 + 44;
  line(ctx, lx, a.base - 50, lx, a.base - 44, '#333', 1);
  rect(ctx, lx - 3, a.base - 44, 6, 8, '#f3c46a');
  const lg = ctx.createRadialGradient(lx, a.base - 40, 0, lx, a.base - 40, 22);
  lg.addColorStop(0, 'rgba(255,200,110,0.45)');
  lg.addColorStop(1, 'rgba(255,200,110,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(lx - 22, a.base - 62, 44, 44);
  // barrels and bench
  barrel(ctx, x0 + w + ox - 6, a.base + 4, 1);
  barrel(ctx, x0 + w + ox + 8, a.base + 5, 0.9);
  rect(ctx, x0 + 6, a.base - 10, 36, 3, '#6b4a2c');
  rect(ctx, x0 + 8, a.base - 7, 3, 7, '#5a3d24');
  rect(ctx, x0 + 37, a.base - 7, 3, 7, '#5a3d24');
  // baskets of bread on the bench for the guests
  breadStore(ctx, a, TAVERN_SLOTS);
}

function drawWatchtower(ctx: Ctx, a: DrawArgs): void {
  const cx = a.x;
  const legTop = a.base - 170;
  const wood = '#6b4c30';
  const dark = '#4d3622';
  // back legs
  line(ctx, cx - 10, a.base, cx - 16, legTop, dark, 6);
  line(ctx, cx + 34, a.base - 4, cx + 26, legTop - 4, dark, 6);
  // cross bracing
  for (let i = 0; i < 3; i++) {
    const y1 = a.base - i * 56;
    const y2 = y1 - 56;
    line(ctx, cx - 30 + i * 3, y1, cx + 22 - i * 3, y2, wood, 3);
    line(ctx, cx + 25 - i * 3, y1, cx - 27 + i * 3, y2, wood, 3);
    line(ctx, cx - 30 + i * 3, y2, cx + 25 - i * 3, y2, wood, 3);
  }
  // front legs
  line(ctx, cx - 34, a.base, cx - 24, legTop, wood, 7);
  line(ctx, cx + 28, a.base, cx + 20, legTop, wood, 7);
  // ladder
  line(ctx, cx - 4, a.base, cx - 2, legTop, '#8a6a48', 2);
  line(ctx, cx + 6, a.base, cx + 8, legTop, '#8a6a48', 2);
  for (let y = a.base - 8; y > legTop; y -= 10) line(ctx, cx - 4, y, cx + 7, y, '#8a6a48', 1.5);
  // platform house
  const px = cx - 40;
  block(ctx, px, legTop + 4, 74, 34, 30, '#8a6a48');
  for (let x = px + 4; x < px + 74; x += 7) line(ctx, x, legTop + 4, x, legTop - 30, '#6d5037', 1);
  rect(ctx, px, legTop - 30, 74, 3, dark);
  // guard with a spear
  const gx = px + 44;
  circle(ctx, gx, legTop - 38, 4.5, '#e0b48e');
  poly(ctx, [gx - 5, legTop - 34, gx + 5, legTop - 34, gx + 5, legTop - 26, gx - 5, legTop - 26], '#7a2e2e');
  ellipse(ctx, gx, legTop - 41, 5, 2.5, '#8a8a8a');
  line(ctx, gx + 8, legTop - 26, gx + 8, legTop - 62, '#5a4030', 1.5);
  poly(ctx, [gx + 6, legTop - 62, gx + 10, legTop - 62, gx + 8, legTop - 70], '#b0b0b0');
  // pyramid roof posts + roof
  rect(ctx, px + 2, legTop - 56, 3, 26, dark);
  rect(ctx, px + 69, legTop - 56, 3, 26, dark);
  poly(ctx, [px - 8, legTop - 54, px + 82, legTop - 54, px + 58, legTop - 100, px + 36, legTop - 104], '#8e4a33');
  poly(ctx, [px + 82, legTop - 54, px + 96, legTop - 62, px + 58, legTop - 100], '#6a3626');
  // banner
  const fy = legTop - 104;
  line(ctx, px + 36, fy, px + 36, fy - 26, '#3a2a1c', 2);
  const wv = Math.sin(a.time * 3.4) * 3;
  ctx.fillStyle = '#a8343a';
  ctx.beginPath();
  ctx.moveTo(px + 36, fy - 26);
  ctx.quadraticCurveTo(px + 48, fy - 26 + wv, px + 60, fy - 22 + wv * 0.5);
  ctx.lineTo(px + 60, fy - 12 + wv * 0.5);
  ctx.quadraticCurveTo(px + 48, fy - 14 + wv, px + 36, fy - 14);
  ctx.fill();
  circle(ctx, px + 47, fy - 19 + wv * 0.6, 3, '#e8c25a');
}

function drawWell(ctx: Ctx, a: DrawArgs): void {
  const cx = a.x;
  const r = 28;
  const top = a.base - 30;
  // stone drum with cylindrical shading
  const g = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
  g.addColorStop(0, '#d4c8b0');
  g.addColorStop(0.5, '#b8ab94');
  g.addColorStop(1, '#7f7566');
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, top, r * 2, 30);
  ellipse(ctx, cx, a.base, r, 7, '#7f7566');
  ctx.globalAlpha = 0.3;
  for (let y = top + 7; y < a.base; y += 7) rect(ctx, cx - r, y, r * 2, 1, '#4a4034');
  ctx.globalAlpha = 1;
  ellipse(ctx, cx, top, r, 7, '#c9bda5');
  ellipse(ctx, cx, top + 1, r - 5, 4.5, '#1f2a30');
  // posts, windlass, roof
  rect(ctx, cx - r + 2, top - 52, 5, 52, '#5a4030');
  rect(ctx, cx + r - 7, top - 52, 5, 52, '#4a3526');
  rect(ctx, cx - r + 2, top - 38, r * 2 - 4, 4, '#6b4c30');
  const crank = a.time * 1.2;
  line(ctx, cx + r - 2, top - 36, cx + r + 4 + Math.cos(crank) * 5, top - 36 + Math.sin(crank) * 5, '#3c2c1e', 2);
  const rope = 14 + Math.sin(a.time * 0.6) * 6;
  line(ctx, cx, top - 34, cx, top - 34 + rope, '#bfa77a', 1);
  rect(ctx, cx - 4, top - 34 + rope, 8, 7, '#7b5634');
  poly(ctx, [cx - r - 8, top - 50, cx + r + 8, top - 50, cx + 10, top - 72, cx - 10, top - 72], '#9a5a3a');
  poly(ctx, [cx + r + 8, top - 50, cx + r + 16, top - 56, cx + 16, top - 76, cx + 10, top - 72], '#6e3f28');
  // bucket on the ground
  poly(ctx, [cx + r + 6, a.base, cx + r + 18, a.base, cx + r + 20, a.base - 11, cx + r + 4, a.base - 11], '#7b5634');
}

/** Whether someone is stepping through the door now (it stands open), and whether anyone is asleep inside. */
function atHome(a: DrawArgs): { doorOpen: boolean; asleep: boolean } {
  const ws = a.workers ?? [];
  return {
    doorOpen: ws.some((w) => doorProgress(w) > 0 && doorProgress(w) < 1),
    asleep: ws.some((w) => w.task.kind === 'home' && w.task.activity === 'sleep'),
  };
}

/** A door at dx from the centre, open while someone steps through it. */
function hutDoor(ctx: Ctx, a: DrawArgs, dx: number, open: boolean, wood: string): void {
  const x = a.x + dx - 8;
  door(ctx, x, a.base, 16, 30, open ? '#1c140d' : wood);
  if (open) rect(ctx, x - 4, a.base - 27, 4, 27, wood); // the door leaf, swung open
}

function drawWoodcutter(ctx: Ctx, a: DrawArgs): void {
  // a log cabin at the edge of the woods, a chopping block by the door
  const w = 66;
  const d = 30;
  const x0 = a.x - 50;
  const h = 34;
  block(ctx, x0, a.base, w, h, d, '#8b6440');
  // the logs it is built of, their ends showing at the corner
  for (let y = a.base - 4; y > a.base - h; y -= 6) {
    line(ctx, x0, y, x0 + w, y, '#6b4a2e', 1.2);
    circle(ctx, x0 + 1, y - 3, 2.6, '#c9a577');
  }
  const { doorOpen, asleep } = atHome(a);
  hutDoor(ctx, a, WOODCUTTER_DOOR.dx, doorOpen, '#5a3d24');
  window_(ctx, x0 + 46, a.base - 26, 12, 11, hash(a.seed, 5) < 0.7, a.time, a.seed);
  const r = gableRoof(ctx, x0, a.base - h, w, d, 30, '#7a5a3a', '#8b6440', 'tile', a.seed);
  chimney(ctx, r.ridgeX1 + w * 0.25, r.ridgeY + 6, 14, a, 0.6);
  // chopping block with the axe in it, and chips about
  const bx = x0 - 14;
  rect(ctx, bx - 7, a.base - 10, 14, 10, '#7b5634');
  ellipse(ctx, bx, a.base - 10, 7, 2.2, '#c9a577');
  line(ctx, bx + 1, a.base - 11, bx + 9, a.base - 24, '#6b4a2c', 2);
  poly(ctx, [bx - 2, a.base - 10, bx + 4, a.base - 10, bx + 3, a.base - 15, bx - 1, a.base - 14], '#9a9a9a');
  for (let i = 0; i < 5; i++) rect(ctx, bx - 16 + hash(a.seed, 60 + i) * 30, a.base + 1 + hash(a.seed, 70 + i) * 3, 3, 1.5, '#d8b98a');
  // the store: logs stacked by the wall, one per load
  const logs = Math.min(WOODCUTTER_SLOTS.length, pileItems(a.stock?.wood ?? 0));
  for (let i = 0; i < logs; i++) {
    const sl = WOODCUTTER_SLOTS[i];
    const cx = a.x + sl.dx;
    const cy = a.base - sl.lift;
    rect(ctx, cx - 13, cy - 5, 26, 5, '#7b5634');
    circle(ctx, cx + 13, cy - 2.5, 2.6, '#c9a06a');
    circle(ctx, cx + 13, cy - 2.5, 1, '#8a6440');
  }
  if (asleep) drawSnore(ctx, x0 + 52, a.base - 58, a.time);
}

function drawStonecutter(ctx: Ctx, a: DrawArgs): void {
  // a squat stone hut with a slate roof, a mason's bench out front
  const w = 64;
  const d = 30;
  const x0 = a.x - 50;
  const h = 34;
  block(ctx, x0, a.base, w, h, d, '#b8ab94');
  // stone courses
  ctx.globalAlpha = 0.4;
  for (let y = a.base - 6, k = 0; y > a.base - h; y -= 7, k++) {
    line(ctx, x0, y, x0 + w, y, '#6e6456', 1);
    for (let x = x0 + (k % 2) * 6; x < x0 + w; x += 12) line(ctx, x, y, x, y - 7, '#6e6456', 1);
  }
  ctx.globalAlpha = 1;
  const { doorOpen, asleep } = atHome(a);
  hutDoor(ctx, a, STONECUTTER_DOOR.dx, doorOpen, '#6b4a2c');
  window_(ctx, x0 + 45, a.base - 26, 12, 11, hash(a.seed, 5) < 0.7, a.time, a.seed);
  gableRoof(ctx, x0, a.base - h, w, d, 28, '#5f646e', '#b8ab94', 'slate', a.seed);
  // the mason's bench with a block on it, mallet and chisel beside
  const bx = x0 - 16;
  rect(ctx, bx - 10, a.base - 12, 20, 3, '#7b5634');
  rect(ctx, bx - 9, a.base - 9, 2, 9, '#6b4a2c');
  rect(ctx, bx + 7, a.base - 9, 2, 9, '#6b4a2c');
  rect(ctx, bx - 5, a.base - 19, 10, 7, '#aaa398');
  rect(ctx, bx - 5, a.base - 19, 10, 2, '#c4beb3');
  // the store: dressed blocks set down by the wall, one per load
  const blocks = Math.min(STONECUTTER_SLOTS.length, pileItems(a.stock?.stone ?? 0));
  for (let i = 0; i < blocks; i++) {
    const sl = STONECUTTER_SLOTS[i];
    const cx = a.x + sl.dx;
    const cy = a.base - sl.lift;
    rect(ctx, cx - 5.5, cy - 8, 11, 8, '#aaa398');
    rect(ctx, cx - 5.5, cy - 8, 11, 2, '#c4beb3');
    rect(ctx, cx + 3.5, cy - 8, 2, 8, '#8f887c');
  }
  if (asleep) drawSnore(ctx, x0 + 51, a.base - 58, a.time);
}

/**
 * The crossroads: a fingerpost at the corner, one arm along the street and one
 * pointing down the road that runs off it (the road itself is drawn with the
 * ground, background.ts drawSideRoad, on both of its streets).
 */
function drawCrossroads(ctx: Ctx, a: DrawArgs): void {
  // a patch of beaten earth where the roads meet (under the road in the street, seen alone in the menu)
  ellipse(ctx, a.x, a.base + 2, 34, 5, '#a8875b');
  const px = a.x - 44;
  const top = a.base - 46;
  ellipse(ctx, px + 2, a.base + 1, 7, 2, 'rgba(40,28,16,0.3)');
  rect(ctx, px - 2, top, 4, a.base - top, '#6b4c30');
  rect(ctx, px + 1, top, 1, a.base - top, '#4f3622');
  // arm along the street, pointing right
  poly(ctx, [px - 3, top + 6, px + 24, top + 6, px + 30, top + 10.5, px + 24, top + 15, px - 3, top + 15], '#c9a86a');
  rect(ctx, px + 2, top + 10, 18, 1, '#7a5a38');
  // arm down the side road, foreshortened: pointing into the scene
  poly(ctx, [px + 3, top + 19, px - 14, top + 17, px - 19, top + 21, px - 14, top + 25, px + 3, top + 27], shade('#c9a86a', -0.15));
  rect(ctx, px - 13, top + 21, 11, 1, '#6d4f30');
  // cap
  poly(ctx, [px - 4, top, px + 4, top, px, top - 5], '#5a3f28');
}

export const BUILDING_ART: Record<BuildingType, BuildingArt> = {
  warehouse: { height: 100, draw: drawWarehouse },
  house: { height: 140, draw: drawHouse },
  farm: { height: 120, behind: drawFarmField, draw: drawFarm, front: drawFarmFrontField },
  mill: { height: 250, draw: drawMill },
  bakery: { height: 120, draw: drawBakery },
  blacksmith: { height: 150, draw: drawBlacksmith },
  market: { height: 110, draw: drawMarket },
  chapel: { height: 270, draw: drawChapel },
  tavern: { height: 170, draw: drawTavern },
  watchtower: { height: 260, draw: drawWatchtower },
  well: { height: 90, draw: drawWell },
  woodcutter: { height: 100, draw: drawWoodcutter },
  stonecutter: { height: 100, draw: drawStonecutter },
  intersection: { height: 56, draw: drawCrossroads },
};

const DEMO_FARM = demoFarm();
/** Menu previews show a half-full store. */
const DEMO_STOCK = stockOf({ grain: 3, wood: 60, stone: 50, flour: 20, bread: 25 });

/** Small icon-sized preview for the build menu (draws the real art, scaled). */
export function drawBuildingIcon(ctx: Ctx, type: BuildingType, x: number, base: number, scale: number, time: number): void {
  ctx.save();
  ctx.translate(x, base);
  ctx.scale(scale, scale);
  const art = BUILDING_ART[type];
  const args: DrawArgs = { x: 0, base: 0, time, seed: 7, farm: type === 'farm' ? DEMO_FARM : undefined, stock: DEMO_STOCK };
  if (art.behind) art.behind(ctx, args);
  art.draw(ctx, args);
  ctx.restore();
}

