// Backdrop in the spirit of the Age of Empires II intro: hazy blue mountains and
// a castle on a hill along the horizon, which turn with the view when the rider
// turns at a crossroads, then the land itself: a plane from the horizon down to
// the street, on which the rest of the village stands (plane.ts), and the
// street being looked at (its trees and the quarries are in the world: render/nature.ts).

import { LANE_YS, ROAD_FAR_Y, ROAD_NEAR_Y } from '../game/layout';
import { SIDE_ROAD_HALF } from '../game/streets';
import { backdropShift, depthScale, groundTiles, groundX, HORIZON_Y, unviewY, viewY } from './ground';
import { circle, type Ctx, ellipse, hash, mix, poly, rect, shade, smoke, VIEW_H } from './util';

const HAZE = '#dcc9ad';

/** The panel's "blue hills": how far the far blue mountains are raised (+) or lowered (-) behind the castle's hills (world units). */
let mountainLift = 0;
export function setMountainLift(v: number): void {
  mountainLift = v;
}

/** Castle position in the castle layer's own coordinates. */
const CASTLE_LAYER_X = 1050;
const CASTLE_FACTOR = 0.14;

export interface View {
  camX: number;
  /** Where the camera is along the way it looks across (map px), and which way it looks (quarter turns): the backdrop pans with both. */
  along: number;
  turn: number;
  width: number;
  /** World y at the top of the screen; below 0 when zoomed out. */
  top: number;
  /** World y at the bottom of the screen; beyond VIEW_H when the street is lifted. */
  bottom: number;
  time: number;
}

/** The land, far to near. The sky goes behind it afterwards (sky.ts). */
export function drawBackground(ctx: Ctx, v: View): void {
  // the backdrop stands on the land some way off (ground.ts backdropShift), which the drawing camera moves
  ctx.save();
  ctx.translate(0, backdropShift());
  drawMountains(ctx, v);
  drawCastleHills(ctx, v);
  drawFarHills(ctx, v);
  drawBirds(ctx, v);
  drawPlane(ctx, v);
  ctx.restore();
  drawStreetGround(ctx, v);
}

/** Screen px a quarter turn of the view pans the horizon by. */
const QUARTER_TURN = 900;
/** How far a backdrop layer at `factor` is panned. */
const pan = (v: View, factor: number) => v.along * factor - v.turn * QUARTER_TURN;

// --- Terrain layers ----------------------------------------------------------

/** Smooth ridge height from summed sines. */
function ridge(x: number, seed: number, amp: number): number {
  return (
    Math.sin(x * 0.0021 + seed) * amp +
    Math.sin(x * 0.0053 + seed * 2.1) * amp * 0.45 +
    Math.sin(x * 0.0131 + seed * 3.7) * amp * 0.15
  );
}

function fillRidge(ctx: Ctx, v: View, factor: number, baseY: number, seed: number, amp: number, fill: string | CanvasGradient, bump?: (lx: number) => number): void {
  const off = pan(v, factor);
  // closed just below the horizon, not at the screen's bottom: the land plane is drawn over
  // everything below it, and at high resolutions filling the hidden part cost half the frame rate
  const foot = HORIZON_Y + 80;
  ctx.beginPath();
  ctx.moveTo(-10, foot);
  for (let sx = -10; sx <= v.width + 10; sx += 6) {
    const lx = sx + off;
    ctx.lineTo(sx, baseY - ridge(lx, seed, amp) - (bump ? bump(lx) : 0));
  }
  ctx.lineTo(v.width + 10, foot);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawMountains(ctx: Ctx, v: View): void {
  ctx.save();
  ctx.translate(0, -mountainLift);
  const g = ctx.createLinearGradient(0, 180, 0, 330);
  g.addColorStop(0, '#9aa6c2');
  g.addColorStop(1, '#c3bdbf');
  fillRidge(ctx, v, 0.05, HORIZON_Y - 10, 1.3, 45, g, (x) => Math.max(0, Math.sin(x * 0.0009 + 0.4)) * 40);
  // snow-lit ridge highlight
  ctx.globalAlpha = 0.35;
  fillRidge(ctx, v, 0.05, HORIZON_Y + 5, 4.1, 30, '#b4b8cc');
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Height bump that raises the castle hill in the castle layer. */
function castleBump(lx: number): number {
  const d = (lx - CASTLE_LAYER_X) / 260;
  return Math.exp(-d * d) * 70;
}

function drawCastleHills(ctx: Ctx, v: View): void {
  const g = ctx.createLinearGradient(0, HORIZON_Y - 90, 0, HORIZON_Y);
  g.addColorStop(0, '#9aa886');
  g.addColorStop(1, '#b7b596');
  const base = HORIZON_Y + 16;
  fillRidge(ctx, v, CASTLE_FACTOR, base, 2.2, 22, g, castleBump);

  const cx = CASTLE_LAYER_X - pan(v, CASTLE_FACTOR);
  if (cx > -300 && cx < v.width + 300) {
    const baseY = base - ridge(CASTLE_LAYER_X, 2.2, 22) - castleBump(CASTLE_LAYER_X) + 6;
    // far off on its hill beyond the horizon
    ctx.save();
    ctx.translate(cx, baseY);
    ctx.scale(0.55, 0.55);
    drawCastle(ctx, 0, 0, v.time);
    ctx.restore();
  }
}

/** Low wooded hills along the horizon. */
function drawFarHills(ctx: Ctx, v: View): void {
  const factor = 0.24;
  const base = HORIZON_Y + 6;
  const g = ctx.createLinearGradient(0, HORIZON_Y - 30, 0, HORIZON_Y);
  g.addColorStop(0, mix('#8e9e6a', HAZE, 0.45));
  g.addColorStop(1, mix('#a7a574', HAZE, 0.45));
  fillRidge(ctx, v, factor, base, 5.5, 10, g);
  // forest clumps along the ridge
  const off = pan(v, factor);
  const T = 50;
  const i0 = Math.floor(off / T) - 1;
  for (let i = i0; i < i0 + v.width / T + 3; i++) {
    if (hash(i, 50) < 0.45) continue;
    const lx = i * T + hash(i, 51) * 30;
    const sx = lx - off;
    const y = base - ridge(lx, 5.5, 10) + 2;
    const r = 4 + hash(i, 52) * 5;
    ellipse(ctx, sx, y - r * 0.6, r, r * 0.9, mix('#6f7f55', HAZE, 0.4));
  }
}

function drawBirds(ctx: Ctx, v: View): void {
  ctx.strokeStyle = 'rgba(60,50,50,0.6)';
  ctx.lineWidth = 1.3;
  for (let i = 0; i < 6; i++) {
    const span = v.width + 400;
    const x = ((v.time * (18 + i * 3) + hash(i, 60) * span - pan(v, 0.08)) % span + span) % span - 200;
    const y = HORIZON_Y - 110 + hash(i, 61) * 70 + Math.sin(v.time * 0.7 + i) * 8;
    const flap = Math.sin(v.time * 8 + i * 2) * 3;
    ctx.beginPath();
    ctx.moveTo(x - 5, y - flap);
    ctx.quadraticCurveTo(x - 2, y - 2, x, y);
    ctx.quadraticCurveTo(x + 2, y - 2, x + 5, y - flap);
    ctx.stroke();
  }
}

/** The land from the horizon to the street: hazy far off, greener near. */
function drawPlane(ctx: Ctx, v: View): void {
  const g = ctx.createLinearGradient(0, HORIZON_Y, 0, 440);
  g.addColorStop(0, mix('#a7a574', HAZE, 0.55));
  g.addColorStop(0.25, '#9aa262');
  g.addColorStop(0.7, '#879a4c');
  g.addColorStop(1, '#7f9148');
  ctx.fillStyle = g;
  // on down past the street, whatever the horizon's shift (the street's own ground is drawn over it)
  ctx.fillRect(-10, HORIZON_Y - 1, v.width + 20, Math.max(VIEW_H, v.bottom) - backdropShift() - HORIZON_Y + 2);
}

/** Haze over everything far off: thickest at the horizon. */
export function drawHaze(ctx: Ctx, v: View): void {
  ctx.save();
  ctx.translate(0, backdropShift());
  const g = ctx.createLinearGradient(0, HORIZON_Y, 0, 400);
  g.addColorStop(0, 'rgba(220,201,173,0.75)');
  g.addColorStop(0.35, 'rgba(220,201,173,0.3)');
  g.addColorStop(1, 'rgba(220,201,173,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-10, HORIZON_Y - 1, v.width + 20, 400 - HORIZON_Y);
  ctx.restore();
}

function drawStreetGround(ctx: Ctx, v: View): void {
  // grass verge the buildings stand on
  // (depths through the drawing camera: ground.ts viewY)
  const g = ctx.createLinearGradient(0, viewY(418), 0, viewY(ROAD_FAR_Y + 2));
  g.addColorStop(0, '#869a45');
  g.addColorStop(1, '#6f8238');
  ctx.fillStyle = g;
  ctx.fillRect(0, viewY(420), v.width, viewY(ROAD_FAR_Y + 4) - viewY(420));

  // the dirt street: three lanes, a land-grid cell each (game/layout.ts)
  const r = ctx.createLinearGradient(0, viewY(ROAD_FAR_Y), 0, viewY(ROAD_NEAR_Y));
  r.addColorStop(0, '#a8875b');
  r.addColorStop(0.5, '#b89668');
  r.addColorStop(1, '#9b7a50');
  ctx.fillStyle = r;
  ctx.fillRect(0, viewY(ROAD_FAR_Y), v.width, viewY(ROAD_NEAR_Y) - viewY(ROAD_FAR_Y));

  // Ruts, stones and hoofprints lie on the ground, so they follow its
  // perspective (ground.ts): nearer ones are spread wider and scroll faster.
  const T = 40;
  const rut = (y: number, dx: number, salt: number) =>
    groundTiles(v.camX, v.width, y, T, (i, sx, s) => {
      rect(ctx, sx + dx * s, viewY(y) + hash(i, salt) * 2 * s, T * s * (0.4 + hash(i, salt + 1) * 0.5), 1.5 * s, '#7e6040');
    });
  ctx.globalAlpha = 0.35;
  rut(LANE_YS[0], 0, 100);
  rut(LANE_YS[1], 10, 102);
  ctx.globalAlpha = 1;
  // stones: each at its own depth; the tile index keeps them fixed in the world
  groundTiles(v.camX, v.width, 470, T, (i) => {
    if (hash(i, 104) >= 0.5) return;
    const y = ROAD_FAR_Y + 2 + hash(i, 106) * (ROAD_NEAR_Y - ROAD_FAR_Y - 4);
    const s = depthScale(y);
    const x = groundX(i * T + hash(i, 105) * T - v.camX, y, v.width / 2);
    ellipse(ctx, x, viewY(y), (2 + hash(i, 107) * 2.5) * s, (1.5 + hash(i, 108)) * s, shade('#b0a08a', -hash(i, 109) * 0.3));
  });

  // grassy edge between verge and street
  ctx.fillStyle = '#6a7c33';
  const edge = ROAD_FAR_Y + 2;
  const ey = viewY(edge);
  groundTiles(v.camX, v.width, edge, T / 2, (i, sx, s) => {
    ctx.beginPath();
    ctx.moveTo(sx, ey);
    ctx.lineTo(sx + (4 + hash(i, 110) * 6) * s, ey - (5 + hash(i, 111) * 5) * s);
    ctx.lineTo(sx + 14 * s, ey);
    ctx.lineTo(sx + 20 * s, ey + 2 * s);
    ctx.lineTo(sx, ey + 2 * s);
    ctx.fill();
  });

  // foreground meadow below the street
  const bottom = Math.max(VIEW_H, v.bottom);
  const meadow = viewY(ROAD_NEAR_Y - 2);
  const f = ctx.createLinearGradient(0, meadow, 0, bottom);
  f.addColorStop(0, '#6d8236');
  f.addColorStop(Math.min(1, (VIEW_H - meadow) / (bottom - meadow)), '#4d6127');
  f.addColorStop(1, '#3a4a1d');
  ctx.fillStyle = f;
  ctx.fillRect(0, meadow, v.width, bottom - meadow);
}

/**
 * A road running off the street at a crossroads, at world x `x`: away from the
 * viewer through the woods behind the street, fading into the meadow, and
 * towards the viewer across the land in front of it. `alpha` < 1 while it is
 * still being laid.
 */
export function drawSideRoad(ctx: Ctx, v: View, x: number, alpha = 1): void {
  const vp = v.width / 2;
  const sx = x - v.camX;
  const hw = SIDE_ROAD_HALF;
  // depths (world y) of its ends; drawn at viewY (the drawing camera)
  const bottom = unviewY(Math.max(VIEW_H, v.bottom));
  // behind the street it narrows faster than the ground does, running off into the distance
  const far = 396;
  const street = ROAD_FAR_Y;
  const narrow = (y: number) => 0.45 + 0.55 * ((y - far) / (street - far));
  const at = (y: number, side: -1 | 1, k = 1) => groundX(sx + side * hw * k, y, vp);
  const Y = viewY;
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createLinearGradient(0, Y(far), 0, Y(street));
  g.addColorStop(0, 'rgba(168,135,91,0)');
  g.addColorStop(0.4, 'rgba(168,135,91,0.85)');
  g.addColorStop(1, '#a8875b');
  poly(ctx, [at(far, -1, narrow(far)), Y(far), at(far, 1, narrow(far)), Y(far), at(street, 1), Y(street), at(street, -1), Y(street)], undefined);
  ctx.fillStyle = g;
  ctx.fill();
  // in front of the street, down to the bottom of the view
  const near = ROAD_NEAR_Y - 4;
  const f = ctx.createLinearGradient(0, Y(near), 0, Y(bottom));
  f.addColorStop(0, '#9b7a50');
  f.addColorStop(0.3, '#b08e60');
  f.addColorStop(1, '#94744b');
  poly(ctx, [at(near, -1), Y(near), at(near, 1), Y(near), at(bottom, 1), Y(bottom), at(bottom, -1), Y(bottom)], undefined);
  ctx.fillStyle = f;
  ctx.fill();
  // grassy edges and wheel ruts, in the same perspective
  ctx.globalAlpha = alpha * 0.35;
  for (const k of [-0.4, 0.4]) {
    ctx.beginPath();
    ctx.moveTo(at(far + 12, 1, k * narrow(far + 12)), Y(far + 12));
    ctx.lineTo(at(street, 1, k), Y(street));
    ctx.moveTo(at(near, 1, k), Y(near));
    ctx.lineTo(at(bottom, 1, k), Y(bottom));
    ctx.strokeStyle = '#7e6040';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.globalAlpha = alpha * 0.8;
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(at(near, side), Y(near));
    ctx.lineTo(at(bottom, side), Y(bottom));
    ctx.strokeStyle = '#5d7030';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

/** Where a street ends (world x range `ends`): past each end the road gives way to grass. */
export function drawStreetEnds(ctx: Ctx, v: View, ends: { min: number; max: number }): void {
  const vp = v.width / 2;
  // depths of the road's edges, drawn at viewY (the drawing camera)
  const top = ROAD_FAR_Y - 2;
  const bottom = ROAD_NEAR_Y + 2;
  const [ty, by] = [viewY(top), viewY(bottom)];
  const verge = ctx.createLinearGradient(0, ty, 0, by);
  verge.addColorStop(0, '#7a8e3e');
  verge.addColorStop(1, '#6d8236');
  for (const [x, side] of [[ends.min, -1], [ends.max, 1]] as const) {
    const sx = x - v.camX;
    if (side < 0 ? sx < -40 : sx > v.width + 40) continue;
    // the road's end rounds off into the grass, in the ground perspective
    const edge = (y: number) => groundX(sx, y, vp);
    const far = side < 0 ? -40 : v.width + 40;
    ctx.fillStyle = verge;
    ctx.beginPath();
    ctx.moveTo(far, ty);
    ctx.lineTo(edge(top), ty);
    ctx.bezierCurveTo(edge(top) - side * 26, ty + (by - ty) * 0.17, edge(bottom) - side * 26, by - (by - ty) * 0.2, edge(bottom), by);
    ctx.lineTo(far, by);
    ctx.closePath();
    ctx.fill();
    // a few tufts along the edge
    ctx.fillStyle = '#5d7030';
    for (let i = 0; i < 6; i++) {
      const d = top + 6 + i * 11;
      const y = viewY(d);
      const gx = edge(d) - side * (18 + Math.sin(i * 2.3) * 6);
      ctx.beginPath();
      ctx.moveTo(gx - 4, y);
      ctx.lineTo(gx, y - 6);
      ctx.lineTo(gx + 4, y);
      ctx.fill();
    }
  }
}

/** Tall grass and flowers in front of everything, nearest of all in the ground perspective. */
export function drawForeground(ctx: Ctx, v: View): void {
  const base = VIEW_H + 4;
  groundTiles(v.camX, v.width, base, 21, (i, tx, s) => {
    const sx = tx + hash(i, 120) * 8 * s;
    const h = 10 + hash(i, 121) * 16;
    const sway = Math.sin(v.time * 1.6 + i * 0.7) * 3;
    ctx.fillStyle = hash(i, 122) < 0.5 ? '#3f5222' : '#56692b';
    ctx.beginPath();
    ctx.moveTo(sx - 6, base);
    ctx.quadraticCurveTo(sx - 2, base - h * 0.6, sx + sway, base - h);
    ctx.quadraticCurveTo(sx + 2, base - h * 0.5, sx + 6, base);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sx + 2, base);
    ctx.quadraticCurveTo(sx + 8, base - h * 0.4, sx + 12 + sway, base - h * 0.75);
    ctx.quadraticCurveTo(sx + 9, base - h * 0.3, sx + 10, base);
    ctx.fill();
    if (hash(i, 123) < 0.18) {
      const fc = ['#e8d36a', '#d9795f', '#f2efe6', '#b98ad6'][Math.floor(hash(i, 124) * 4)];
      circle(ctx, sx + sway, base - h - 2, 3, fc);
    }
  });
}

// --- Castle ----------------------------------------------------------------

function roundTower(ctx: Ctx, x: number, baseY: number, r: number, h: number, roofH: number, stone: string, roof: string, flag: string | null, time: number): void {
  const top = baseY - h;
  const g = ctx.createLinearGradient(x - r, 0, x + r, 0);
  g.addColorStop(0, shade(stone, 0.15));
  g.addColorStop(0.45, stone);
  g.addColorStop(1, shade(stone, -0.3));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, top, r * 2, h);
  // corbelled parapet
  rect(ctx, x - r - 2, top - 4, r * 2 + 4, 5, shade(stone, -0.08));
  // windows
  rect(ctx, x - 1.5, top + h * 0.3, 3, 6, '#3d3a44');
  // conical roof
  const rg = ctx.createLinearGradient(x - r, 0, x + r, 0);
  rg.addColorStop(0, shade(roof, 0.2));
  rg.addColorStop(1, shade(roof, -0.3));
  poly(ctx, [x - r - 4, top - 3, x + r + 4, top - 3, x, top - 3 - roofH], undefined);
  ctx.fillStyle = rg;
  ctx.fill();
  if (flag) {
    const fy = top - 3 - roofH;
    ctx.strokeStyle = '#4a4040';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, fy);
    ctx.lineTo(x, fy - 12);
    ctx.stroke();
    const w = Math.sin(time * 3 + x) * 1.5;
    poly(ctx, [x, fy - 12, x + 10, fy - 10 + w, x, fy - 7], flag);
  }
}

function crenellations(ctx: Ctx, x1: number, x2: number, y: number, color: string): void {
  for (let x = x1; x < x2 - 2; x += 6) rect(ctx, x, y - 4, 3.5, 4, color);
}

function drawCastle(ctx: Ctx, cx: number, baseY: number, time: number): void {
  const stone = mix('#c8bda8', HAZE, 0.25);
  const stoneShadow = mix('#8f8c95', HAZE, 0.25);
  const roof = mix('#4f5e86', HAZE, 0.2);
  const flag = '#a8343a';

  // hill crest below the walls
  ellipse(ctx, cx, baseY + 6, 190, 18, mix('#8f9d74', HAZE, 0.2));

  // back keep tower (tallest)
  const keepTopY = baseY - 150;
  rect(ctx, cx - 22, keepTopY, 44, 150, stone);
  rect(ctx, cx + 10, keepTopY, 12, 150, stoneShadow);
  crenellations(ctx, cx - 24, cx + 24, keepTopY, stone);
  rect(ctx, cx - 6, keepTopY + 30, 4, 9, '#3d3a44');
  rect(ctx, cx - 6, keepTopY + 70, 4, 9, '#3d3a44');
  roundTower(ctx, cx + 22, keepTopY + 24, 9, 30, 30, stone, roof, flag, time);

  // inner hall
  rect(ctx, cx - 70, baseY - 95, 70, 55, stone);
  poly(ctx, [cx - 74, baseY - 95, cx + 2, baseY - 95, cx - 12, baseY - 120, cx - 62, baseY - 120], roof);
  rect(ctx, cx + 25, baseY - 90, 50, 50, shade(stone, -0.08));
  crenellations(ctx, cx + 24, cx + 76, baseY - 90, shade(stone, -0.08));

  // curtain wall
  const wallTop = baseY - 48;
  const wg = ctx.createLinearGradient(0, wallTop, 0, baseY);
  wg.addColorStop(0, stone);
  wg.addColorStop(1, shade(stone, -0.15));
  ctx.fillStyle = wg;
  ctx.fillRect(cx - 140, wallTop, 280, 48);
  crenellations(ctx, cx - 140, cx + 140, wallTop, stone);
  // wall shading & stone courses
  ctx.globalAlpha = 0.18;
  for (let y = wallTop + 8; y < baseY; y += 8) rect(ctx, cx - 140, y, 280, 1, '#5c5660');
  ctx.globalAlpha = 1;

  // gatehouse
  rect(ctx, cx - 18, wallTop - 22, 36, 70, shade(stone, 0.05));
  crenellations(ctx, cx - 20, cx + 20, wallTop - 22, shade(stone, 0.05));
  ctx.fillStyle = '#3a3440';
  ctx.beginPath();
  ctx.moveTo(cx - 9, baseY);
  ctx.lineTo(cx - 9, baseY - 20);
  ctx.arc(cx, baseY - 20, 9, Math.PI, 0);
  ctx.lineTo(cx + 9, baseY);
  ctx.fill();

  // flanking round towers
  roundTower(ctx, cx - 140, baseY, 15, 78, 34, stone, roof, flag, time);
  roundTower(ctx, cx - 58, baseY, 12, 64, 26, stone, roof, null, time);
  roundTower(ctx, cx + 58, baseY, 12, 64, 26, stone, roof, null, time);
  roundTower(ctx, cx + 140, baseY, 15, 82, 36, stone, roof, flag, time);

  // a thread of smoke from the hall
  smoke(ctx, cx - 30, baseY - 120, time, 999, 0.5);
}
