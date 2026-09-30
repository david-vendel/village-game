// Parallax backdrop in the spirit of the Age of Empires II intro: a warm
// late-afternoon sky, hazy blue mountains, a castle on a hill, patchwork
// fields, a distant village and a tree line behind the street.

import { circle, type Ctx, ellipse, GROUND_Y, hash, mix, poly, rect, shade, smoke, VIEW_H } from './util';

const HAZE = '#dcc9ad';

/** Castle position in the castle layer's own coordinates. */
const CASTLE_LAYER_X = 1050;
const CASTLE_FACTOR = 0.14;

export interface View {
  camX: number;
  width: number;
  /** World y at the top of the screen; below 0 when zoomed out. */
  top: number;
  /** World y at the bottom of the screen; beyond VIEW_H when the street is lifted. */
  bottom: number;
  time: number;
}

export function drawBackground(ctx: Ctx, v: View): void {
  drawSky(ctx, v);
  drawClouds(ctx, v);
  drawMountains(ctx, v);
  drawCastleHills(ctx, v);
  drawFarHills(ctx, v);
  drawBirds(ctx, v);
  drawDistantVillage(ctx, v);
  drawTreeLine(ctx, v);
  drawStreetGround(ctx, v);
}

// --- Sky -------------------------------------------------------------------

function drawSky(ctx: Ctx, v: View): void {
  // Stops are defined in world y so the horizon stays put; extra sky above y=0
  // (when zoomed out) deepens towards the zenith.
  const top = Math.min(0, v.top);
  const at = (y: number) => (y - top) / (380 - top);
  const g = ctx.createLinearGradient(0, top, 0, 380);
  g.addColorStop(0, top < 0 ? '#3f5f99' : '#5f7fb3');
  g.addColorStop(at(0), '#5f7fb3');
  g.addColorStop(at(133), '#9fb3c9');
  g.addColorStop(at(266), '#ecd3a6');
  g.addColorStop(1, '#f6ddb0');
  ctx.fillStyle = g;
  ctx.fillRect(0, top, v.width, VIEW_H - top);

  // Low sun slightly to the left; it barely moves (very far away).
  const sx = v.width * 0.3 - v.camX * 0.01;
  const sy = 205;
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 380);
  glow.addColorStop(0, 'rgba(255,244,214,0.95)');
  glow.addColorStop(0.08, 'rgba(255,230,170,0.75)');
  glow.addColorStop(0.35, 'rgba(255,205,140,0.25)');
  glow.addColorStop(1, 'rgba(255,200,140,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, Math.min(0, v.top), v.width, VIEW_H - Math.min(0, v.top));
  circle(ctx, sx, sy, 22, '#fff6de');
}

function drawClouds(ctx: Ctx, v: View): void {
  const T = 520;
  const off = v.camX * 0.03 - v.time * 3;
  const i0 = Math.floor(off / T) - 1;
  for (let i = i0; i < i0 + v.width / T + 3; i++) {
    const x = i * T - off + hash(i, 1) * 200;
    // when zoomed out, some clouds drift higher into the extra sky
    const y = 50 + hash(i, 2) * 110 + Math.min(0, v.top) * hash(i, 5) * 0.8;
    const s = 0.6 + hash(i, 3) * 0.8;
    ctx.globalAlpha = 0.55 + hash(i, 4) * 0.3;
    // shaded underside, lit top
    for (let k = 0; k < 6; k++) {
      const cx = x + (k - 2.5) * 26 * s + hash(i, 10 + k) * 12;
      const cy = y + Math.abs(k - 2.5) * 4 * s;
      ellipse(ctx, cx, cy + 6 * s, 30 * s, 12 * s, '#d8b9a5');
    }
    for (let k = 0; k < 5; k++) {
      const cx = x + (k - 2) * 24 * s + hash(i, 20 + k) * 10;
      const cy = y - 4 * s - hash(i, 30 + k) * 10 * s;
      ellipse(ctx, cx, cy, 26 * s, 14 * s, '#fbead6');
    }
  }
  ctx.globalAlpha = 1;
}

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
  const off = v.camX * factor;
  ctx.beginPath();
  ctx.moveTo(-10, VIEW_H);
  for (let sx = -10; sx <= v.width + 10; sx += 6) {
    const lx = sx + off;
    ctx.lineTo(sx, baseY - ridge(lx, seed, amp) - (bump ? bump(lx) : 0));
  }
  ctx.lineTo(v.width + 10, VIEW_H);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawMountains(ctx: Ctx, v: View): void {
  const g = ctx.createLinearGradient(0, 180, 0, 330);
  g.addColorStop(0, '#9aa6c2');
  g.addColorStop(1, '#c3bdbf');
  fillRidge(ctx, v, 0.05, 275, 1.3, 45, g, (x) => Math.max(0, Math.sin(x * 0.0009 + 0.4)) * 40);
  // snow-lit ridge highlight
  ctx.globalAlpha = 0.35;
  fillRidge(ctx, v, 0.05, 290, 4.1, 30, '#b4b8cc');
  ctx.globalAlpha = 1;
}

/** Height bump that raises the castle hill in the castle layer. */
function castleBump(lx: number): number {
  const d = (lx - CASTLE_LAYER_X) / 260;
  return Math.exp(-d * d) * 70;
}

function drawCastleHills(ctx: Ctx, v: View): void {
  const g = ctx.createLinearGradient(0, 220, 0, 360);
  g.addColorStop(0, '#9aa886');
  g.addColorStop(1, '#b7b596');
  fillRidge(ctx, v, CASTLE_FACTOR, 335, 2.2, 22, g, castleBump);

  const cx = CASTLE_LAYER_X - v.camX * CASTLE_FACTOR;
  if (cx > -300 && cx < v.width + 300) {
    const baseY = 335 - ridge(CASTLE_LAYER_X, 2.2, 22) - castleBump(CASTLE_LAYER_X) + 6;
    drawCastle(ctx, cx, baseY, v.time);
  }
}

function drawFarHills(ctx: Ctx, v: View): void {
  const factor = 0.24;
  const g = ctx.createLinearGradient(0, 300, 0, 420);
  g.addColorStop(0, '#8e9e6a');
  g.addColorStop(1, '#a7a574');
  fillRidge(ctx, v, factor, 368, 5.5, 18, g);

  // patchwork fields on the slopes
  const off = v.camX * factor;
  const T = 150;
  const i0 = Math.floor(off / T) - 1;
  const fieldCols = ['#c9b36c', '#a9a45f', '#b99c5a', '#8f9a5a', '#d3bf7a'];
  for (let i = i0; i < i0 + v.width / T + 3; i++) {
    if (hash(i, 40) < 0.35) continue;
    const lx = i * T + hash(i, 41) * 40;
    const sx = lx - off;
    const w = 60 + hash(i, 42) * 70;
    const y1 = 368 - ridge(lx, 5.5, 18) + 8;
    const y2 = 368 - ridge(lx + w, 5.5, 18) + 8;
    const h = 10 + hash(i, 43) * 12;
    poly(ctx, [sx, y1, sx + w, y2, sx + w + 6, y2 + h, sx + 6, y1 + h], mix(fieldCols[Math.floor(hash(i, 44) * 5)], HAZE, 0.3));
  }
  // forest clumps along the ridge
  for (let i = i0 * 3; i < (i0 + v.width / T + 3) * 3; i++) {
    if (hash(i, 50) < 0.45) continue;
    const lx = i * (T / 3) + hash(i, 51) * 30;
    const sx = lx - off;
    const y = 368 - ridge(lx, 5.5, 18) + 2;
    const r = 7 + hash(i, 52) * 8;
    ellipse(ctx, sx, y - r * 0.6, r, r * 0.9, '#6f7f55');
    ellipse(ctx, sx - r * 0.3, y - r * 0.9, r * 0.6, r * 0.55, '#86925f');
  }
}

function drawBirds(ctx: Ctx, v: View): void {
  ctx.strokeStyle = 'rgba(60,50,50,0.6)';
  ctx.lineWidth = 1.3;
  for (let i = 0; i < 6; i++) {
    const span = v.width + 400;
    const x = ((v.time * (18 + i * 3) + hash(i, 60) * span - v.camX * 0.08) % span + span) % span - 200;
    const y = 110 + hash(i, 61) * 70 + Math.sin(v.time * 0.7 + i) * 8;
    const flap = Math.sin(v.time * 8 + i * 2) * 3;
    ctx.beginPath();
    ctx.moveTo(x - 5, y - flap);
    ctx.quadraticCurveTo(x - 2, y - 2, x, y);
    ctx.quadraticCurveTo(x + 2, y - 2, x + 5, y - flap);
    ctx.stroke();
  }
}

function drawDistantVillage(ctx: Ctx, v: View): void {
  const factor = 0.42;
  const baseY = 402;
  const g = ctx.createLinearGradient(0, 360, 0, 440);
  g.addColorStop(0, '#869a5c');
  g.addColorStop(1, '#94a062');
  fillRidge(ctx, v, factor, baseY, 8.8, 8, g);

  const off = v.camX * factor;
  const T = 110;
  const i0 = Math.floor(off / T) - 2;
  for (let i = i0; i < i0 + v.width / T + 4; i++) {
    const r = hash(i, 70);
    const lx = i * T + hash(i, 71) * 50;
    const sx = lx - off;
    const y = baseY - ridge(lx, 8.8, 8) + 4;
    if (r < 0.5) {
      tinyHouse(ctx, sx, y, i, v.time);
    } else if (r < 0.56) {
      tinyChurch(ctx, sx, y);
    } else {
      // poplars and round trees
      const tall = hash(i, 72) < 0.4;
      if (tall) ellipse(ctx, sx, y - 22, 6, 22, '#5d7042');
      else {
        ellipse(ctx, sx, y - 14, 15, 13, '#62763f');
        ellipse(ctx, sx - 4, y - 18, 8, 7, '#7c8c4d');
      }
    }
  }
}

function tinyHouse(ctx: Ctx, x: number, y: number, seed: number, time: number): void {
  const w = 22 + hash(seed, 80) * 16;
  const h = 12 + hash(seed, 81) * 7;
  const d = 9;
  const wall = mix(['#d9c8a8', '#cdb792', '#bfae90'][seed & 1 ? 1 : hash(seed, 82) < 0.5 ? 0 : 2], HAZE, 0.35);
  const roof = mix(hash(seed, 83) < 0.5 ? '#8e5c3e' : '#9f8a58', HAZE, 0.35);
  rect(ctx, x, y - h, w, h, wall);
  poly(ctx, [x + w, y, x + w + d, y - 4, x + w + d, y - h - 4, x + w, y - h], shade(wall, -0.2));
  poly(ctx, [x - 2, y - h, x + w + 2, y - h, x + w + d / 2, y - h - 11, x + d / 2 - 2, y - h - 11], roof);
  poly(ctx, [x + w, y - h, x + w + d, y - h - 4, x + w + d / 2, y - h - 11], shade(roof, -0.25));
  if (hash(seed, 84) < 0.4) {
    rect(ctx, x + w * 0.7, y - h - 14, 3, 6, '#7a6a5c');
    smoke(ctx, x + w * 0.7 + 1, y - h - 15, time, seed, 0.5);
  }
}

function tinyChurch(ctx: Ctx, x: number, y: number): void {
  const wall = mix('#d4ccbc', HAZE, 0.35);
  rect(ctx, x, y - 20, 36, 20, wall);
  poly(ctx, [x - 2, y - 20, x + 38, y - 20, x + 32, y - 30, x + 4, y - 30], mix('#7d6e66', HAZE, 0.35));
  rect(ctx, x + 30, y - 46, 12, 46, shade(wall, -0.05));
  poly(ctx, [x + 29, y - 46, x + 43, y - 46, x + 36, y - 68], mix('#5c6275', HAZE, 0.3));
}

function drawTreeLine(ctx: Ctx, v: View): void {
  const factor = 0.66;
  const off = v.camX * factor;
  const T = 70;
  const i0 = Math.floor(off / T) - 2;
  // meadow behind the street
  const g = ctx.createLinearGradient(0, 395, 0, 440);
  g.addColorStop(0, '#7f9148');
  g.addColorStop(1, '#8a9a4c');
  fillRidge(ctx, v, factor, 416, 3.3, 5, g);
  for (let i = i0; i < i0 + v.width / T + 4; i++) {
    if (hash(i, 90) < 0.3) continue;
    const lx = i * T + hash(i, 91) * 40;
    const sx = lx - off;
    const y = 416 - ridge(lx, 3.3, 5) + 4;
    const s = 0.7 + hash(i, 92) * 0.6;
    if (hash(i, 93) < 0.3) {
      // tall poplar / cypress
      rect(ctx, sx - 1.5, y - 10 * s, 3, 10 * s, '#4f3b2a');
      ellipse(ctx, sx, y - 42 * s, 9 * s, 34 * s, '#4d6634');
      ellipse(ctx, sx - 3 * s, y - 48 * s, 4 * s, 22 * s, '#6c8543');
    } else {
      rect(ctx, sx - 2.5 * s, y - 18 * s, 5 * s, 18 * s, '#4f3b2a');
      ellipse(ctx, sx, y - 32 * s, 26 * s, 20 * s, '#4e6533');
      ellipse(ctx, sx - 10 * s, y - 26 * s, 16 * s, 13 * s, '#58703a');
      // sunlit left crown
      ellipse(ctx, sx - 8 * s, y - 38 * s, 13 * s, 10 * s, '#7b9148');
      ellipse(ctx, sx - 12 * s, y - 42 * s, 6 * s, 5 * s, '#9aab5a');
    }
  }
}

function drawStreetGround(ctx: Ctx, v: View): void {
  // grass verge the buildings stand on
  const g = ctx.createLinearGradient(0, 418, 0, GROUND_Y + 10);
  g.addColorStop(0, '#869a45');
  g.addColorStop(1, '#6f8238');
  ctx.fillStyle = g;
  ctx.fillRect(0, 420, v.width, GROUND_Y + 12 - 420);

  // the dirt street
  const r = ctx.createLinearGradient(0, GROUND_Y + 6, 0, 500);
  r.addColorStop(0, '#a8875b');
  r.addColorStop(0.5, '#b89668');
  r.addColorStop(1, '#9b7a50');
  ctx.fillStyle = r;
  ctx.fillRect(0, GROUND_Y + 6, v.width, 500 - GROUND_Y - 6);

  // ruts, stones and hoofprints — scroll with the street
  const T = 40;
  const i0 = Math.floor(v.camX / T) - 1;
  for (let i = i0; i < i0 + v.width / T + 3; i++) {
    const sx = i * T - v.camX;
    ctx.globalAlpha = 0.35;
    rect(ctx, sx, 458 + hash(i, 100) * 2, T * (0.5 + hash(i, 101) * 0.5), 1.5, '#7e6040');
    rect(ctx, sx + 10, 484 + hash(i, 102) * 2, T * (0.4 + hash(i, 103) * 0.5), 1.5, '#7e6040');
    ctx.globalAlpha = 1;
    if (hash(i, 104) < 0.5) ellipse(ctx, sx + hash(i, 105) * T, 445 + hash(i, 106) * 50, 2 + hash(i, 107) * 2.5, 1.5 + hash(i, 108), shade('#b0a08a', -hash(i, 109) * 0.3));
  }

  // grassy edge between verge and street
  ctx.fillStyle = '#6a7c33';
  for (let i = i0 * 2; i < (i0 + v.width / T + 3) * 2; i++) {
    const sx = i * (T / 2) - v.camX;
    ctx.beginPath();
    ctx.moveTo(sx, GROUND_Y + 8);
    ctx.lineTo(sx + 4 + hash(i, 110) * 6, GROUND_Y + 3 - hash(i, 111) * 5);
    ctx.lineTo(sx + 14, GROUND_Y + 8);
    ctx.lineTo(sx + 20, GROUND_Y + 10);
    ctx.lineTo(sx, GROUND_Y + 10);
    ctx.fill();
  }

  // foreground meadow below the street
  const bottom = Math.max(VIEW_H, v.bottom);
  const f = ctx.createLinearGradient(0, 498, 0, bottom);
  f.addColorStop(0, '#6d8236');
  f.addColorStop(Math.min(1, (VIEW_H - 498) / (bottom - 498)), '#4d6127');
  f.addColorStop(1, '#3a4a1d');
  ctx.fillStyle = f;
  ctx.fillRect(0, 498, v.width, bottom - 498);
}

/** Tall grass, flowers and fence posts in front of everything. */
export function drawForeground(ctx: Ctx, v: View): void {
  const factor = 1.2;
  const off = v.camX * factor;
  const T = 26;
  const i0 = Math.floor(off / T) - 2;
  for (let i = i0; i < i0 + v.width / T + 4; i++) {
    const sx = i * T - off + hash(i, 120) * 10;
    const base = VIEW_H + 4;
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
  }
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
