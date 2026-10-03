// Winter (game/daynight.ts season): the land lies under snow, and snow falls.
// The land is whitened before the sky is put behind it (scene.ts), so only
// the land and what stands on it take the snow; the flakes fall in front of
// everything, sky too.

import { dayPhase, isWinter, season } from '../game/daynight';
import { YEAR_DAYS, WINTER_DAYS } from '../game/balance';
import type { World } from '../game/world';
import type { Ctx } from './util';

/** How deep into winter (0..1): it comes on over the first hours of its first day and goes over the last of its last. */
function depth(world: World): number {
  if (!isWinter(world)) return 0;
  const { dayOfYear } = season(world);
  const into = dayOfYear - (YEAR_DAYS - WINTER_DAYS) - 1 + dayPhase(world);
  return Math.max(0, Math.min(1, into * 4, (WINTER_DAYS - into) * 4));
}

/** Snow on the land: called after the land is drawn and before the sky goes behind it. */
export function snowOnLand(ctx: Ctx, world: World, w: number, top: number, bottom: number): void {
  const k = depth(world);
  if (k <= 0) return;
  ctx.save();
  ctx.globalAlpha = 0.32 * k;
  ctx.fillStyle = '#eef3f7';
  ctx.fillRect(0, top, w, bottom - top);
  ctx.restore();
}

/** Falling snow, in front of everything. */
export function snowfall(ctx: Ctx, world: World, w: number, top: number, bottom: number): void {
  const k = depth(world);
  if (k <= 0) return;
  const h = bottom - top;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  const n = Math.round(160 * k);
  for (let i = 0; i < n; i++) {
    // each flake its own speed and sway, wrapping round the screen
    const a = (i * 0.618034) % 1;
    const b = (i * 0.414214) % 1;
    const fall = 18 + b * 30;
    const y = top + ((b * h + world.time * fall) % h);
    const x = (((a * w + Math.sin(world.time * (0.6 + b) + i) * 14) % w) + w) % w;
    ctx.globalAlpha = 0.5 + 0.4 * b;
    ctx.fillRect(x, y, 1.6 + b * 1.6, 1.6 + b * 1.6);
  }
  ctx.restore();
}
