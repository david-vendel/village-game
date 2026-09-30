// Staged construction, generic over every building type:
// staking → foundation → timber frame → walls (the finished art revealed
// bottom-up behind scaffolding) → roof (reveal continues to the top).

import { BUILDINGS, type BuildingType } from '../game/buildings';
import { constructionStage } from '../game/world';
import { BUILDING_ART, type DrawArgs } from './buildings';
import { pileItems, SITE_SHOWN, siteSlot } from '../game/layout';
import type { Amounts } from '../game/resources';
import { circle, clamp01, type Ctx, ellipse, hash, line, rect } from './util';

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

export function drawConstructionFront(ctx: Ctx, type: BuildingType, a: DrawArgs, progress: number): void {
  const art = BUILDING_ART[type];
  if (!art.front) return;
  const t = clamp01((progress - 0.5) / 0.5);
  if (t <= 0) return;
  ctx.globalAlpha = t;
  art.front(ctx, a);
  ctx.globalAlpha = 1;
}

export function drawConstruction(ctx: Ctx, type: BuildingType, a: DrawArgs, progress: number): void {
  const def = BUILDINGS[type];
  const W = def.width;
  const H = BUILDING_ART[type].height;
  const left = a.x - W / 2;
  const { stage, t } = constructionStage(progress);

  materials(ctx, a.x, W, a.base, a.onSite ?? {}, a.seed);

  // 1. stakes and rope marking the footprint
  const stakes = 6;
  const shown = stage === 'staking' ? Math.ceil(t * stakes) : stakes;
  for (let i = 0; i < shown; i++) {
    const sx = left + (i / (stakes - 1)) * W;
    rect(ctx, sx - 1.5, a.base - 12, 3, 12, POLE);
    if (i > 0) line(ctx, sx - W / (stakes - 1), a.base - 9, sx, a.base - 9, ROPE, 1);
  }
  if (stage === 'staking') return;

  // 2. foundation stones
  const fh = stage === 'foundation' ? 10 * t : 10;
  const fw = stage === 'foundation' ? W * Math.min(1, t * 1.5) : W;
  rect(ctx, left, a.base - fh, fw, fh, '#a89c88');
  ctx.globalAlpha = 0.4;
  for (let x = left; x < left + fw; x += 12) rect(ctx, x, a.base - fh, 1, fh, '#5c5448');
  ctx.globalAlpha = 1;
  if (stage === 'foundation') return;

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
    // a pulley hoisting a stone — only while someone is actually building here
    const building = (a.workers ?? []).some((w) => w.task.kind === 'job' && w.task.job.action === 'build');
    const hoist = building ? (Math.sin(a.time * 0.8 + a.seed) + 1) / 2 : 0;
    line(ctx, left + W + 10, sTop, left + W + 22, sTop, POLE, 2);
    line(ctx, left + W + 22, sTop, left + W + 22, sTop + 20 + hoist * (a.base - sTop - 34), ROPE, 1);
    rect(ctx, left + W + 17, sTop + 20 + hoist * (a.base - sTop - 34), 10, 8, '#a89c88');
  }
}

/**
 * The materials lying on the site's pile: delivered by the builders and not
 * yet taken to the building. An unsupplied site has none; each delivery adds
 * a log or block in its own place (game/layout.ts), and builders take them
 * off the top.
 */
function materials(ctx: Ctx, x: number, width: number, base: number, onSite: Amounts, seed: number): void {
  const logs = Math.min(SITE_SHOWN.wood, pileItems(onSite.wood ?? 0));
  for (let i = 0; i < logs; i++) {
    const s = siteSlot(width, 'wood', i);
    const cx = x + s.dx - 15;
    const cy = base - s.lift;
    rect(ctx, cx, cy - 8, 30, 8, '#7b5634');
    circle(ctx, cx, cy - 4, 4, '#c9a06a');
    circle(ctx, cx, cy - 4, 1.5, '#8a6440');
  }
  const stones = Math.min(SITE_SHOWN.stone, pileItems(onSite.stone ?? 0));
  for (let i = 0; i < stones; i++) {
    const s = siteSlot(width, 'stone', i);
    ellipse(ctx, x + s.dx, base - s.lift, 5, 3.5, hash(seed, i) < 0.5 ? '#a89c88' : '#948877');
  }
}
