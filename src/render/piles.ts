// What lies on the ground by the road (game/piles.ts): a heap of whatever it
// is (logs, stone blocks, sheaves, sacks of flour, baskets of bread), an item
// for every item of it (layout.ts unitOf), stacked in a low pyramid.

import { pileItems } from '../game/layout';
import type { Pile } from '../game/piles';
import { breadBasket, sheaf } from './farm';
import { circle, type Ctx, ellipse, hash, rect } from './util';

/** Most items a heap shows; a bigger pile just looks full. */
const SHOWN = 15;
/** Rows of the heap, bottom first. */
const ROWS = [5, 4, 3, 2, 1];

/** Where item i of a heap lies: dx from its middle, and how far up. */
function slot(i: number, w: number, h: number): { dx: number; lift: number } {
  let start = 0;
  for (let row = 0; row < ROWS.length; row++) {
    if (i < start + ROWS[row]) return { dx: (i - start - (ROWS[row] - 1) / 2) * w, lift: row * h };
    start += ROWS[row];
  }
  return { dx: 0, lift: 0 };
}

/** A pile lying on the ground, its middle at screen x, on the ground at `base`. */
export function drawGroundPile(ctx: Ctx, pile: Pile, x: number, base: number): void {
  const n = Math.min(SHOWN, Math.max(1, pileItems(pile.amount, pile.resource)));
  ellipse(ctx, x, base + 1, 26, 3.5, 'rgba(40,28,16,0.22)');
  for (let i = 0; i < n; i++) {
    const seed = hash(pile.id, i);
    if (pile.resource === 'wood') {
      const s = slot(i, 6, 4.5);
      const cx = x + s.dx * 0.8 - 11;
      const cy = base - s.lift;
      rect(ctx, cx, cy - 5, 22, 5, '#7b5634');
      circle(ctx, cx + 22, cy - 2.5, 2.6, '#c9a06a');
    } else if (pile.resource === 'stone') {
      const s = slot(i, 8, 5);
      ellipse(ctx, x + s.dx, base - 2.5 - s.lift, 4.6, 3.2, seed < 0.5 ? '#a89c88' : '#948877');
    } else if (pile.resource === 'grain') {
      const s = slot(i, 8, 7);
      ctx.save();
      ctx.translate(x + s.dx, base - s.lift);
      ctx.scale(0.5, 0.5);
      sheaf(ctx, 0, 0);
      ctx.restore();
    } else if (pile.resource === 'flour') {
      const s = slot(i, 9, 6.5);
      ellipse(ctx, x + s.dx, base - 4 - s.lift, 4.8, 4, '#efe9da', (seed - 0.5) * 0.4);
    } else {
      const s = slot(i, 11, 7);
      breadBasket(ctx, x + s.dx, base - s.lift, 0.6, 3);
    }
  }
}
