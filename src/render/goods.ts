// What every good looks like, wherever it is: on a store's shelf or stall, in
// a pile on the ground, in a bubble over a house that wants it. One item of
// it, standing on the ground at (x, base), scale s.

import type { Resource } from '../game/resources';
import { breadBasket, sheaf, waterBucket } from './farm';
import { drawAnimal, drawGood } from './livestock';
import { circle, type Ctx, ellipse, line, poly, rect } from './util';

export function drawItem(ctx: Ctx, r: Resource, x: number, base: number, s = 1, time = 0): void {
  if (drawGood(ctx, r, x, base, s)) return;
  switch (r) {
    case 'wood':
      rect(ctx, x - 9 * s, base - 5 * s, 18 * s, 5 * s, '#7b5634');
      circle(ctx, x + 9 * s, base - 2.5 * s, 2.6 * s, '#c9a06a');
      return;
    case 'stone':
      rect(ctx, x - 4 * s, base - 5 * s, 8 * s, 5 * s, '#aaa398');
      rect(ctx, x - 4 * s, base - 5 * s, 8 * s, 1.5 * s, '#c4beb3');
      return;
    case 'planks':
      rect(ctx, x - 10 * s, base - 3 * s, 20 * s, 2.5 * s, '#d2ab74');
      rect(ctx, x - 10 * s, base - 1.2 * s, 20 * s, 0.8 * s, '#a07a4c');
      return;
    case 'grain':
      ctx.save();
      ctx.translate(x, base);
      ctx.scale(0.45 * s, 0.45 * s);
      sheaf(ctx, 0, 0);
      ctx.restore();
      return;
    case 'flour':
    case 'salt':
      ellipse(ctx, x, base - 5 * s, 4 * s, 5 * s, r === 'salt' ? '#f7f7f2' : '#efe9da');
      line(ctx, x - 2 * s, base - 9.5 * s, x + 2 * s, base - 9.5 * s, '#b8ad94', s);
      if (r === 'salt') circle(ctx, x, base - 5 * s, 1.2 * s, '#9ab0c0');
      return;
    case 'bread':
      breadBasket(ctx, x, base, 0.6 * s, 4);
      return;
    case 'water':
      waterBucket(ctx, x, base, 0.9 * s);
      return;
    case 'cheese':
      ellipse(ctx, x, base - 3 * s, 5.5 * s, 3 * s, '#e8c35a');
      rect(ctx, x - 5.5 * s, base - 3 * s, 11 * s, 3 * s, '#e8c35a');
      ellipse(ctx, x, base - 6 * s, 5.5 * s, 2 * s, '#f2d57a');
      return;
    case 'smokedmeat':
      ellipse(ctx, x, base - 5 * s, 4 * s, 5.5 * s, '#7a3424');
      ellipse(ctx, x - 1 * s, base - 6 * s, 2.2 * s, 3 * s, '#9a4a34');
      line(ctx, x, base - 10.5 * s, x, base - 13 * s, '#b8a888', 0.8 * s); // its string
      return;
    case 'cloth':
      rect(ctx, x - 6 * s, base - 6 * s, 12 * s, 6 * s, '#6a7fa8');
      rect(ctx, x - 6 * s, base - 6 * s, 12 * s, 1.5 * s, '#8aa0c8');
      line(ctx, x - 6 * s, base - 3 * s, x + 6 * s, base - 3 * s, '#4e6088', 0.6 * s);
      return;
    case 'hides':
      poly(ctx, [x - 7 * s, base, x - 5 * s, base - 5 * s, x + 5 * s, base - 6 * s, x + 7 * s, base], '#8a5a34');
      return;
    case 'tallow':
      rect(ctx, x - 4 * s, base - 4 * s, 8 * s, 4 * s, '#efe6c8');
      rect(ctx, x - 4 * s, base - 4 * s, 8 * s, 1 * s, '#fbf4dc');
      return;
    case 'leather':
      ellipse(ctx, x, base - 3.5 * s, 4 * s, 3.5 * s, '#a8703a');
      ellipse(ctx, x, base - 3.5 * s, 1.5 * s, 1.5 * s, '#7a4e26');
      return;
    case 'candles':
      for (const dx of [-2.5, 0, 2.5]) {
        rect(ctx, x + (dx - 0.8) * s, base - 9 * s, 1.6 * s, 9 * s, '#f4ecd2');
        line(ctx, x + dx * s, base - 9 * s, x + dx * s, base - 10.5 * s, '#3a2a1c', 0.5 * s);
      }
      return;
    case 'harness':
      ctx.save();
      ctx.strokeStyle = '#6b4226';
      ctx.lineWidth = 1.6 * s;
      ctx.beginPath();
      ctx.ellipse(x, base - 6 * s, 4.5 * s, 5.5 * s, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      circle(ctx, x, base - 11 * s, 1.2 * s, '#c9b07a'); // a buckle
      return;
    case 'horse':
      drawAnimal(ctx, 'horse', { sex: 'female', age: 10 }, x, base, 1, time, 3, 0.5 * s);
      return;
    case 'ale':
      ellipse(ctx, x, base - 5 * s, 4.5 * s, 5.5 * s, '#8a5a30');
      for (const dy of [-8, -2]) line(ctx, x - 4.2 * s, base + dy * s, x + 4.2 * s, base + dy * s, '#4a3a2a', 0.8 * s);
      return;
    case 'pastries':
      rect(ctx, x - 6 * s, base - 1.5 * s, 12 * s, 1.5 * s, '#8a6a44');
      for (const dx of [-3.5, 0, 3.5]) ellipse(ctx, x + dx * s, base - 3 * s, 1.8 * s, 1.5 * s, '#d89a4a');
      return;
    case 'iron':
      for (const dy of [0, 2.2]) rect(ctx, x - 6 * s, base - (2.2 + dy) * s, 12 * s, 2 * s, dy ? '#7a7f86' : '#5c6168');
      return;
    case 'tools':
      line(ctx, x - 4 * s, base, x + 2 * s, base - 10 * s, '#7a5634', 1.2 * s);
      rect(ctx, x, base - 11.5 * s, 5 * s, 2.5 * s, '#8a8f96'); // a hammer's head
      line(ctx, x + 4 * s, base, x - 1 * s, base - 9 * s, '#7a5634', 1.2 * s);
      poly(ctx, [x - 1 * s, base - 9 * s, x - 4 * s, base - 11 * s, x - 3 * s, base - 7 * s], '#9a9fa6'); // an axe's blade
      return;
    default:
      ellipse(ctx, x, base - 3 * s, 3 * s, 3 * s, '#a89c88');
  }
}
