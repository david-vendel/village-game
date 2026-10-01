// Staged construction, generic over every building type:
// staking → foundation → timber frame → walls (the finished art revealed
// bottom-up behind scaffolding) → roof (reveal continues to the top).
// An upgrade is built the same way on the finished building: the upgraded
// art is revealed bottom-up over it, behind scaffolding.

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
  for (const spot of a.laid ?? []) laidDown(ctx, a.x + spot.dx, a.base, spot.amounts, a.seed);

  // 1. stakes and rope marking the footprint
  const stakes = 6;
  const shown = stage === 'staking' ? Math.ceil(t * stakes) : stakes;
  for (let i = 0; i < shown; i++) {
    const sx = left + (i / (stakes - 1)) * W;
    rect(ctx, sx - 1.5, a.base - 12, 3, 12, POLE);
    if (i > 0) line(ctx, sx - W / (stakes - 1), a.base - 9, sx, a.base - 9, ROPE, 1);
  }
  if (stage === 'staking') return;
  // a crossroads is a road, not a house: past the stakes it is the road taking shape (drawn with the ground)
  if (type === 'intersection') return;

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
  if (stage !== 'frame') scaffolding(ctx, a, left, W, frameTop);
}

/** A finished building being upgraded: the upgraded art revealed over it, bottom-up, behind scaffolding. */
export function drawUpgrade(ctx: Ctx, type: BuildingType, a: DrawArgs, progress: number): void {
  const W = BUILDINGS[type].width;
  const H = BUILDING_ART[type].height;
  const left = a.x - W / 2;
  const art = BUILDING_ART[type];
  art.draw(ctx, { ...a, upgraded: false });
  if (progress > 0) {
    const revealH = (H + 60) * progress;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left - 120, a.base - revealH, W + 280, revealH + 40);
    ctx.clip();
    art.draw(ctx, { ...a, upgraded: true });
    ctx.restore();
  }
  materials(ctx, a.x, W, a.base, a.onSite ?? {}, a.seed);
  for (const spot of a.laid ?? []) laidDown(ctx, a.x + spot.dx, a.base, spot.amounts, a.seed);
  scaffolding(ctx, a, left, W, a.base - Math.min(H, 150) * 0.78);
}

/**
 * A building being pulled down: the building as it stands, taken away from
 * the top down as the work goes on (`left`: 1 untouched, 0 gone), a pale
 * broken edge where the builders are at it, down to the foundation stones.
 */
export function drawDemolition(ctx: Ctx, type: BuildingType, a: DrawArgs, left: number): void {
  const W = BUILDINGS[type].width;
  const H = BUILDING_ART[type].height;
  const x0 = a.x - W / 2;
  const standing = (H + 60) * clamp01(left);
  const top = a.base - standing;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0 - 120, top, W + 280, standing + 40);
  ctx.clip();
  BUILDING_ART[type].draw(ctx, a);
  ctx.restore();
  if (left < 1 && standing < H + 60) {
    // the broken top, ragged, with dust
    ctx.globalAlpha = 0.5;
    for (let x = x0; x < x0 + W; x += 6) rect(ctx, x, top - 1 - hash(a.seed, x) * 3, 6, 3, '#d8ccb0');
    ctx.globalAlpha = 1;
  }
  // the foundation is the last to go
  const fh = 10 * clamp01(left * 4);
  if (fh > 0) rect(ctx, x0, a.base - fh, W, fh, '#a89c88');
}

/** Poles and boards round the building, and a pulley hoisting a stone while someone is building. */
function scaffolding(ctx: Ctx, a: DrawArgs, left: number, W: number, frameTop: number): void {
  const sTop = frameTop - 16;
  for (const sx of [left - 12, a.x, left + W + 10]) line(ctx, sx, a.base + 2, sx, sTop, POLE, 2.5);
  for (let y = a.base - 34; y > sTop + 10; y -= 38) {
    line(ctx, left - 16, y, left + W + 14, y, '#a07d52', 4);
    line(ctx, left - 12, y + 38, left + 10, y, POLE, 1.2);
  }
  const building = (a.workers ?? []).some((w) => w.task.kind === 'job' && w.task.job.action === 'build');
  const hoist = building ? (Math.sin(a.time * 0.8 + a.seed) + 1) / 2 : 0;
  line(ctx, left + W + 10, sTop, left + W + 22, sTop, POLE, 2);
  line(ctx, left + W + 22, sTop, left + W + 22, sTop + 20 + hoist * (a.base - sTop - 34), ROPE, 1);
  rect(ctx, left + W + 17, sTop + 20 + hoist * (a.base - sTop - 34), 10, 8, '#a89c88');
}

/**
 * The materials lying on the site's pile: delivered by the builders and not
 * yet taken to the building. An unsupplied site has none; each delivery adds
 * a log or block in its own place (game/layout.ts), and builders take them
 * off the top.
 */
/** Materials a builder has laid down at their work spot: short logs stacked, stones beside them. */
function laidDown(ctx: Ctx, x: number, base: number, amounts: Amounts, seed: number): void {
  const logs = Math.min(4, pileItems(amounts.wood ?? 0));
  for (let i = 0; i < logs; i++) {
    const cy = base + 2 - i * 4.5;
    rect(ctx, x - 7, cy - 4, 14, 4, '#7b5634');
    circle(ctx, x + 7, cy - 2, 2.2, '#c9a06a');
  }
  const stones = Math.min(4, pileItems(amounts.stone ?? 0));
  for (let i = 0; i < stones; i++) ellipse(ctx, x + 12 + (i % 2) * 7, base + 1 - Math.floor(i / 2) * 5, 4, 3, hash(seed, 40 + i) < 0.5 ? '#a89c88' : '#948877');
}

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
