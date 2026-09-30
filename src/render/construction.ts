// Staged construction, generic over every building type:
// staking → foundation → timber frame → walls (the finished art revealed
// bottom-up behind scaffolding) → roof (reveal continues to the top).

import { BUILDINGS, type BuildingType } from '../game/buildings';
import { constructionStage } from '../game/world';
import { BUILDING_ART, type DrawArgs } from './buildings';
import { circle, clamp01, type Ctx, ellipse, hash, line, poly, rect } from './util';

const POLE = '#8a6a48';
const ROPE = '#d9c9a0';

export function drawConstructionBehind(ctx: Ctx, type: BuildingType, a: DrawArgs, progress: number): void {
  const art = BUILDING_ART[type];
  if (!art.behind) return;
  // fields are sown gradually once the walls go up
  const t = clamp01((progress - 0.5) / 0.5);
  if (t <= 0) return;
  ctx.globalAlpha = t;
  art.behind(ctx, a);
  ctx.globalAlpha = 1;
}

export function drawConstruction(ctx: Ctx, type: BuildingType, a: DrawArgs, progress: number): void {
  const def = BUILDINGS[type];
  const W = def.width;
  const H = def.height;
  const left = a.x - W / 2;
  const { stage, t } = constructionStage(progress);

  materials(ctx, a.x + W / 2 + 14, a.base, progress, a.seed);

  // 1. stakes and rope marking the footprint
  const stakes = 6;
  const shown = stage === 'staking' ? Math.ceil(t * stakes) : stakes;
  for (let i = 0; i < shown; i++) {
    const sx = left + (i / (stakes - 1)) * W;
    rect(ctx, sx - 1.5, a.base - 12, 3, 12, POLE);
    if (i > 0) line(ctx, sx - W / (stakes - 1), a.base - 9, sx, a.base - 9, ROPE, 1);
  }
  if (stage === 'staking') {
    worker(ctx, left + t * W, a.base + 6, a.time, a.seed, true);
    return;
  }

  // 2. foundation stones
  const fh = stage === 'foundation' ? 10 * t : 10;
  const fw = stage === 'foundation' ? W * Math.min(1, t * 1.5) : W;
  rect(ctx, left, a.base - fh, fw, fh, '#a89c88');
  ctx.globalAlpha = 0.4;
  for (let x = left; x < left + fw; x += 12) rect(ctx, x, a.base - fh, 1, fh, '#5c5448');
  ctx.globalAlpha = 1;
  if (stage === 'foundation') {
    worker(ctx, left + fw + 8, a.base + 6, a.time, a.seed, true);
    worker(ctx, left - 14, a.base + 8, a.time + 0.7, a.seed + 1, false);
    return;
  }

  // 3. timber frame — posts grow, then beams
  const frameTop = a.base - Math.min(H, 150) * 0.78;
  const frameT = stage === 'frame' ? t : 1;
  const posts = Math.max(3, Math.round(W / 38));
  const postH = (a.base - 10 - frameTop) * Math.min(1, frameT * 1.4);

  // 4/5. reveal the finished art from the bottom up
  if (stage === 'walls' || stage === 'roof') {
    const revealH = stage === 'walls' ? (a.base - frameTop) * t : a.base - frameTop + (H + 60 - (a.base - frameTop)) * t;
    const top = a.base - revealH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left - 120, top, W + 280, revealH + 40);
    ctx.clip();
    BUILDING_ART[type].draw(ctx, a);
    ctx.restore();
    // bright edge where masons are working
    ctx.globalAlpha = 0.35;
    rect(ctx, left, top - 1, W, 2, '#f4e6c4');
    ctx.globalAlpha = 1;
  }

  ctx.lineCap = 'butt';
  for (let i = 0; i < posts; i++) {
    const px = left + 4 + (i / (posts - 1)) * (W - 8);
    line(ctx, px, a.base - 10, px, a.base - 10 - postH, '#6d5037', 4);
  }
  if (frameT > 0.7) {
    const beamT = clamp01((frameT - 0.7) / 0.3);
    line(ctx, left + 4, frameTop, left + 4 + (W - 8) * beamT, frameTop, '#6d5037', 4);
    line(ctx, left + 4, (frameTop + a.base) / 2, left + 4 + (W - 8) * beamT, (frameTop + a.base) / 2, '#6d5037', 3);
  }

  // scaffolding once the walls are going up
  if (stage !== 'frame') {
    const sTop = frameTop - 16;
    for (const sx of [left - 12, a.x, left + W + 10]) line(ctx, sx, a.base + 2, sx, sTop, POLE, 2.5);
    for (let y = a.base - 34; y > sTop + 10; y -= 38) {
      line(ctx, left - 16, y, left + W + 14, y, '#a07d52', 4);
      line(ctx, left - 12, y + 38, left + 10, y, POLE, 1.2);
    }
    // a pulley hoisting a stone
    const hoist = (Math.sin(a.time * 0.8 + a.seed) + 1) / 2;
    line(ctx, left + W + 10, sTop, left + W + 22, sTop, POLE, 2);
    line(ctx, left + W + 22, sTop, left + W + 22, sTop + 20 + hoist * (a.base - sTop - 34), ROPE, 1);
    rect(ctx, left + W + 17, sTop + 20 + hoist * (a.base - sTop - 34), 10, 8, '#a89c88');
  }

  worker(ctx, left - 26, a.base + 8, a.time, a.seed, true);
  worker(ctx, left + W + 30, a.base + 7, a.time + 0.4, a.seed + 2, stage !== 'roof');
  if (stage !== 'frame') {
    // worker up on the scaffold
    const y = stage === 'walls' ? a.base - 34 : a.base - 72;
    worker(ctx, left + W * (0.3 + 0.4 * ((Math.sin(a.time * 0.3 + a.seed) + 1) / 2)), y - 2, a.time + 1.1, a.seed + 3, true);
  }
}

/** Pile of logs and stones that shrinks as construction proceeds. */
function materials(ctx: Ctx, x: number, base: number, progress: number, seed: number): void {
  const left = 1 - progress;
  const logs = Math.ceil(left * 5);
  for (let i = 0; i < logs; i++) {
    const row = i < 3 ? 0 : 1;
    const col = row ? i - 3 : i;
    const cx = x + col * 9 + row * 4;
    const cy = base + 4 - row * 8;
    rect(ctx, cx - 4, cy - 8, 30, 8, '#7b5634');
    circle(ctx, cx - 4, cy - 4, 4, '#c9a06a');
    circle(ctx, cx - 4, cy - 4, 1.5, '#8a6440');
  }
  const stones = Math.ceil(left * 6);
  for (let i = 0; i < stones; i++) ellipse(ctx, x + 42 + (i % 3) * 8, base + 3 - Math.floor(i / 3) * 6, 5, 3.5, hash(seed, i) < 0.5 ? '#a89c88' : '#948877');
}

/** Builder in a straw hat, hammering or carrying. */
function worker(ctx: Ctx, x: number, base: number, time: number, seed: number, hammering: boolean): void {
  rect(ctx, x - 3, base - 10, 2.5, 10, '#4a3a2c');
  rect(ctx, x + 0.5, base - 10, 2.5, 10, '#4a3a2c');
  poly(ctx, [x - 5, base - 9, x + 5, base - 9, x + 4, base - 22, x - 4, base - 22], hash(seed, 5) < 0.5 ? '#8a6a3c' : '#6b7a4a');
  circle(ctx, x, base - 26, 4, '#e0b48e');
  ellipse(ctx, x, base - 29, 7, 2, '#d8bf6a');
  ellipse(ctx, x, base - 31, 3.5, 2.5, '#d8bf6a');
  if (hammering) {
    const sw = Math.abs(Math.sin(time * 6 + seed)) * 1.4 - 0.3;
    const hx = x + 3 + Math.cos(-sw) * 9;
    const hy = base - 19 - Math.sin(sw) * 9;
    line(ctx, x + 3, base - 19, hx, hy, '#e0b48e', 2.5);
    rect(ctx, hx - 2, hy - 3, 5, 4, '#555');
  } else {
    // carrying a plank on the shoulder
    line(ctx, x - 14, base - 24, x + 14, base - 21, '#a07d52', 3);
  }
}
