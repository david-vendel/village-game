// Villagers and chickens wandering the street.

import type { Animal, Look, Person, Stroll } from '../game/people';
import { type Carry, drawFigure, type Figure, figureOf } from './figure';
import { circle, type Ctx, ellipse, hash, line, poly } from './util';

/** What the street art needs to know about someone strolling: how they look and move. */
type Walker = Stroll & { kind: Look | 'chicken'; seed: number; figure: Figure | null };

/** A person or animal as a street walker. */
export function walker(who: Person | Animal): Walker {
  return 'look' in who
    ? { ...who.stroll, kind: who.look, seed: who.seed, figure: figureOf(who) }
    : { ...who.stroll, kind: who.kind, seed: who.seed, figure: null };
}

export function drawVillager(ctx: Ctx, v: Walker, x: number, base: number, time: number): void {
  const walking = v.idle <= 0;
  const phase = walking ? time * v.speed * 0.2 + v.seed : 0;
  ctx.save();
  ctx.translate(x, base);
  ctx.scale(v.dir, 1);
  ctx.globalAlpha = 0.22;
  ellipse(ctx, v.figure ? 0.8 : 0, 0, v.figure ? 7.5 : 9, 2.2, '#2c2416');
  ctx.globalAlpha = 1;
  if (v.figure) drawFigure(ctx, v.figure, phase, walking, carryOf(v.figure));
  else drawChicken(ctx, phase, walking, time, v.seed);
  ctx.restore();
}

/** What someone carries about the street, by their trade (and seed). */
function carryOf(f: Figure): Carry {
  const r = hash(f.seed, 2);
  if (f.look === 'monk') return 'none';
  if (f.look === 'woman') return r < 0.4 ? 'basket' : 'none';
  if (f.role === 'farmer') return 'tool';
  if (f.role === 'miller' || f.role === 'serf') return r < 0.5 ? 'sack' : 'none';
  if (f.role === 'baker') return r < 0.6 ? 'basket' : 'none';
  return r < 0.3 ? 'sack' : 'none';
}

function drawChicken(ctx: Ctx, phase: number, walking: boolean, time: number, seed: number): void {
  const peck = !walking && Math.sin(time * 3 + seed) > 0.6;
  const hop = walking ? Math.abs(Math.sin(phase * 1.5)) * 1.5 : 0;
  const white = hash(seed, 3) < 0.5;
  line(ctx, -1, -4 - hop, -2 + Math.sin(phase) * 2, 0, '#d8a040', 1);
  line(ctx, 1, -4 - hop, 2 - Math.sin(phase) * 2, 0, '#d8a040', 1);
  ellipse(ctx, 0, -8 - hop, 7, 5, white ? '#efe9dc' : '#a86a3a');
  poly(ctx, [-6, -10 - hop, -11, -15 - hop, -8, -7 - hop], white ? '#dcd4c4' : '#6d4424');
  const hx = peck ? 7 : 5;
  const hy = peck ? -4 - hop : -13 - hop;
  circle(ctx, hx, hy, 3, white ? '#efe9dc' : '#a86a3a');
  poly(ctx, [hx + 2.5, hy - 0.5, hx + 5, hy + 0.5, hx + 2.5, hy + 1.5], '#e0a030');
  circle(ctx, hx, hy - 3, 1.5, '#c0392b');
}
