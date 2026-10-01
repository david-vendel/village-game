// The woods and the quarries behind the street (game/nature.ts). They stand in
// the world at the tree line's depth, so they follow the ground's perspective
// like the woodcutter and stonecutter walking out to them.

import { QUARRIES, QUARRY_W, QUARRY_Y, TREE_Y } from '../game/layout';
import { treeGrowth, type Tree } from '../game/nature';
import type { World } from '../game/world';
import { depthScale, groundX } from './ground';
import { circle, type Ctx, ellipse, hash, line, poly, rect, shade } from './util';

/** Seconds of felling done on each tree someone is chopping, as a share of the job. */
export function beingFelled(world: World): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of world.people) {
    const t = p.job?.worker.task;
    if (t?.kind === 'job' && t.job.action === 'chop') out.set(t.job.target, t.t / t.duration);
  }
  return out;
}

/** Every tree and stump on screen, standing along the tree line. */
export function drawTrees(ctx: Ctx, world: World, camX: number, viewW: number): void {
  const vpX = viewW / 2;
  const k = depthScale(TREE_Y);
  const felling = beingFelled(world);
  for (const t of world.trees) {
    const sx = groundX(t.x - camX, TREE_Y, vpX);
    if (sx < -80 || sx > viewW + 80) continue;
    drawTreeAt(ctx, world, t, sx, TREE_Y, k, felling);
  }
}

/** One tree (or stump) standing at (x, y), drawn at scale k. */
export function drawTreeAt(ctx: Ctx, world: World, t: Tree, x: number, y: number, k: number, felling = beingFelled(world)): void {
  if (t.state === 'stump') stump(ctx, x, y, k, t.id);
  else tree(ctx, t, x, y, k * (0.25 + 0.75 * treeGrowth(t)), felling.get(t.id), world.time);
}

/** A round-crowned tree or a tall poplar, by its id, sized `s`; shuddering under the axe while being felled. */
function tree(ctx: Ctx, t: Tree, x: number, y: number, s: number, felled: number | undefined, time: number): void {
  s *= 0.7 + hash(t.id, 92) * 0.6;
  ctx.save();
  ctx.translate(x, y);
  // each blow shakes it, and it leans a little more as the cut deepens
  if (felled !== undefined) ctx.rotate(felled * 0.12 + Math.sin(time * 9) * 0.015 * (1 + felled));
  if (hash(t.id, 93) < 0.3) {
    rect(ctx, -1.5, -10 * s, 3, 10 * s, '#4f3b2a');
    ellipse(ctx, 0, -42 * s, 9 * s, 34 * s, '#4d6634');
    ellipse(ctx, -3 * s, -48 * s, 4 * s, 22 * s, '#6c8543');
  } else {
    rect(ctx, -2.5 * s, -18 * s, 5 * s, 18 * s, '#4f3b2a');
    ellipse(ctx, 0, -32 * s, 26 * s, 20 * s, '#4e6533');
    ellipse(ctx, -10 * s, -26 * s, 16 * s, 13 * s, '#58703a');
    // sunlit left crown
    ellipse(ctx, -8 * s, -38 * s, 13 * s, 10 * s, '#7b9148');
    ellipse(ctx, -12 * s, -42 * s, 6 * s, 5 * s, '#9aab5a');
  }
  ctx.restore();
}

/** What is left of a felled tree, until it rots away. */
function stump(ctx: Ctx, x: number, y: number, k: number, seed: number): void {
  const s = k * (0.8 + hash(seed, 94) * 0.4);
  rect(ctx, x - 3.5 * s, y - 5 * s, 7 * s, 5 * s, '#5a4330');
  ellipse(ctx, x, y - 5 * s, 3.5 * s, 1.4 * s, '#c9a577');
  circle(ctx, x, y - 5 * s, 1 * s, '#8a6a44');
}

/** The rocky hills where stone is cut: a crag coming down to the tree line, with a quarried face at its foot. */
export function drawQuarries(ctx: Ctx, camX: number, viewW: number): void {
  const vpX = viewW / 2;
  const k = depthScale(QUARRY_Y);
  QUARRIES.forEach((q, qi) => {
    const x = groundX(q.x - camX, QUARRY_Y, vpX);
    const half = (QUARRY_W / 2) * k;
    if (x + half < -40 || x - half > viewW + 40) return;
    drawQuarry(ctx, x, QUARRY_Y, k, qi);
  });
}

/** Quarry qi's crag and face, its foot at (x, y), drawn at scale k. */
export function drawQuarry(ctx: Ctx, x: number, y: number, k: number, qi: number): void {
  {
    const half = (QUARRY_W / 2) * k;
    const seed = qi * 31 + 7;
    // the crag: a ragged outline, lit from the left
    const pts: number[] = [x - half, y];
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const bump = Math.sin(u * Math.PI);
      const h = (40 + bump * 120 + (hash(seed, i) - 0.5) * 30 * bump) * k;
      pts.push(x - half + u * half * 2, y - h);
    }
    pts.push(x + half, y);
    const g = ctx.createLinearGradient(x - half, 0, x + half, 0);
    g.addColorStop(0, '#b3aa9c');
    g.addColorStop(0.5, '#9b9387');
    g.addColorStop(1, '#6f6960');
    ctx.fillStyle = g;
    poly(ctx, pts, undefined);
    ctx.fill();
    // shaded right flank and a few ledges
    poly(ctx, [x + half * 0.25, y, x + half * 0.45, y - 120 * k, x + half, y - 40 * k, x + half, y], 'rgba(60,54,48,0.25)');
    for (let i = 0; i < 5; i++) {
      const ly = y - (30 + i * 24) * k;
      const lx = x - half * 0.6 + hash(seed, 20 + i) * half * 0.8;
      line(ctx, lx, ly, lx + (30 + hash(seed, 30 + i) * 40) * k, ly - 4 * k, 'rgba(70,64,56,0.45)', 1.5);
    }
    // scrub on the top
    for (let i = 0; i < 4; i++) {
      const bx = x - half * 0.5 + i * half * 0.35;
      ellipse(ctx, bx, y - (130 + hash(seed, 40 + i) * 20) * k * Math.sin(((bx - x + half) / (half * 2)) * Math.PI), 9 * k, 6 * k, '#6f7f55');
    }
    // the quarried face: flat, pale, cut in steps, blocks marked out on it
    const fw = 150 * k;
    const fh = 46 * k;
    rect(ctx, x - fw / 2, y - fh, fw, fh, '#d2cab8');
    rect(ctx, x - fw / 2 + 12 * k, y - fh - 16 * k, fw - 24 * k, 16 * k, '#c4bba8');
    for (let r = 0; r < 3; r++) line(ctx, x - fw / 2, y - fh + r * 15 * k, x + fw / 2, y - fh + r * 15 * k, 'rgba(90,82,70,0.4)', 1);
    for (let c = 1; c < 6; c++) {
      const cx = x - fw / 2 + c * (fw / 6) + (hash(seed, 50 + c) - 0.5) * 6;
      line(ctx, cx, y - fh, cx, y, 'rgba(90,82,70,0.3)', 1);
    }
    // loose blocks and chips at the foot
    for (let i = 0; i < 5; i++) {
      const bx = x - fw / 2 - 16 * k + hash(seed, 60 + i) * (fw + 32 * k);
      rect(ctx, bx, y - 6 * k, 9 * k, 6 * k, shade('#b8ae9c', -hash(seed, 70 + i) * 0.2));
    }
  }
}
