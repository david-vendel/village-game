// The animals of the animal farms (game/livestock.ts), drawn side on, facing
// right, standing on the ground at (x, base): hen and cock, cow and bull, ewe
// and ram, mare and stallion, and their young, smaller. And what the farms
// make, wherever it lies or is carried: bales of hay, pails of milk, fleeces,
// baskets of eggs, joints of meat.

import type { AnimalKind, Beast } from '../game/livestock';
import { isAdult } from '../game/livestock';
import type { Resource } from '../game/resources';
import { waterBucket } from './farm';
import { circle, type Ctx, ellipse, hash, line, poly, rect, shade } from './util';

/** One animal at (x, base), facing `facing`, scale s; `t` the time, for its idling. */
export function drawAnimal(ctx: Ctx, kind: AnimalKind, a: Beast, x: number, base: number, facing: 1 | -1, t: number, seed: number, s = 1): void {
  const young = !isAdult(kind, a);
  ctx.save();
  ctx.translate(x, base);
  ctx.scale(facing * s * (young ? 0.6 : 1), s * (young ? 0.6 : 1));
  // grazing: the head goes down now and then
  const graze = Math.sin(t * 0.5 + seed) > 0.4;
  if (kind === 'chicken') chicken(young, a.sex === 'male', graze, seed);
  else if (kind === 'cow') cow(a.sex === 'male', graze, seed);
  else if (kind === 'sheep') sheep(a.sex === 'male', graze);
  else horse(a.sex === 'male', graze, seed, young);
  ctx.restore();

  function legs(xs: number[], top: number, colour: string, w: number): void {
    for (const lx of xs) line(ctx, lx, top, lx, 0, colour, w);
  }

  function chicken(chick: boolean, cock: boolean, peck: boolean, sd: number): void {
    if (chick) {
      ellipse(ctx, 0, -4, 4, 3.4, '#f2d35a');
      circle(ctx, 3, -7, 2.2, '#f2d35a');
      poly(ctx, [5, -7.4, 6.6, -6.8, 5, -6.3], '#e0a030');
      return;
    }
    const body = cock ? '#a8502a' : hash(sd, 3) < 0.5 ? '#efe9dc' : '#a86a3a';
    legs([-1, 1], -4, '#d8a040', 1);
    ellipse(ctx, 0, -8, cock ? 7.5 : 7, 5, body);
    // the cock's tall dark tail, arched; the hen's short one
    if (cock) {
      poly(ctx, [-5, -10, -12, -20, -9, -9], '#2f3a2a');
      poly(ctx, [-6, -9, -13, -15, -8, -6], '#47593c');
    } else poly(ctx, [-6, -10, -11, -15, -8, -7], shade(body, -0.1));
    const hx = peck ? 7 : 5;
    const hy = peck ? -4 : -13;
    circle(ctx, hx, hy, 3, body);
    poly(ctx, [hx + 2.5, hy - 0.5, hx + 5, hy + 0.5, hx + 2.5, hy + 1.5], '#e0a030');
    // comb and wattle: big and red on the cock
    if (cock) {
      poly(ctx, [hx - 2, hy - 2.5, hx - 1, hy - 6, hx, hy - 3.5, hx + 1, hy - 6.5, hx + 2, hy - 2.5], '#c0392b');
      ellipse(ctx, hx + 2, hy + 3, 1, 1.8, '#c0392b');
    } else circle(ctx, hx, hy - 3, 1.5, '#c0392b');
  }

  function cow(bull: boolean, low: boolean, sd: number): void {
    const hide = bull ? '#4a3426' : hash(sd, 5) < 0.5 ? '#f0ebe0' : '#a0623a';
    const patch = bull ? '#2e2018' : '#3a2a22';
    legs([-11, -7, 8, 11], -12, shade(hide, -0.25), 3);
    ellipse(ctx, 0, -16, bull ? 15 : 14, bull ? 8 : 7, hide);
    if (!bull) {
      ellipse(ctx, -3, -14, 4, 3, patch);
      ellipse(ctx, 6, -18, 3, 2.5, patch);
      ellipse(ctx, 3, -9, 3, 2, '#e8a0a0'); // the udder
    }
    line(ctx, -14, -18, -17, -8, shade(hide, -0.3), 1.5); // the tail
    const hy = low ? -8 : -20;
    poly(ctx, [11, -19, 17, hy - 2, 21, hy + 3, 15, -13], hide); // the neck
    ellipse(ctx, 19, hy + 1, 4.5, 3.5, hide);
    ellipse(ctx, 22, hy + 2.5, 2.2, 1.8, '#d9a49a'); // the muzzle
    if (bull) {
      poly(ctx, [17, hy - 2, 14, hy - 6, 18, hy - 3], '#e8e0cc'); // horns
      poly(ctx, [20, hy - 2, 22, hy - 6, 21, hy - 2], '#e8e0cc');
    }
  }

  function sheep(ram: boolean, low: boolean): void {
    legs([-6, -3, 4, 7], -6, '#2e2a26', 1.8);
    for (const [dx, dy, r] of [[-5, -10, 5], [0, -12, 5.5], [5, -10, 5], [-2, -7, 4], [3, -7, 4]] as const) circle(ctx, dx, dy, r * (ram ? 1.1 : 1), '#ece6d6');
    const hy = low ? -5 : -12;
    ellipse(ctx, 10, hy, 3.4, 2.6, '#2e2a26');
    if (ram) {
      ctx.strokeStyle = '#b9a98a';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(8.5, hy - 0.5, 2.6, Math.PI * 0.9, Math.PI * 2.4);
      ctx.stroke();
    }
  }

  function horse(stallion: boolean, low: boolean, sd: number, foal: boolean): void {
    const coat = stallion ? '#2a211c' : ['#8a4a26', '#6b3e22', '#a8784a'][Math.floor(hash(sd, 7) * 3)];
    const mane = stallion ? '#120e0c' : shade(coat, -0.45);
    // a foal is all legs
    const legTop = foal ? -16 : -14;
    legs([-12, -8, 9, 12], legTop, shade(coat, -0.2), 2.6);
    ellipse(ctx, 0, -19, 15, 6.5, coat);
    poly(ctx, [-14, -21, -19, -10, -16, -9, -13, -18], mane); // the tail
    const hy = low ? -6 : -32;
    poly(ctx, [9, -22, 13, -15, 22, hy + 3, 18, hy - 1], coat); // the neck
    poly(ctx, [18, hy - 1, 26, hy + 3, 27, hy + 6, 21, hy + 6], coat); // the head
    poly(ctx, [10, -23, 18, hy - 1, 16, hy + 2, 9, -19], mane); // the mane
    poly(ctx, [18.5, hy - 1, 19.5, hy - 4, 20.5, hy - 0.5], coat); // an ear
  }
}

/** A bale of hay at (x, base), scale s. */
export function hayBale(ctx: Ctx, x: number, base: number, s = 1): void {
  const w = 13 * s;
  const h = 8 * s;
  rect(ctx, x - w / 2, base - h, w, h, '#cdb860');
  for (let i = 1; i < 5; i++) line(ctx, x - w / 2 + 1, base - h + (i * h) / 5, x + w / 2 - 1, base - h + (i * h) / 5, '#b39d48', 0.6 * s);
  for (const k of [-0.25, 0.25]) line(ctx, x + k * w, base - h, x + k * w, base, '#7a6a30', 1 * s); // the twine
}

/** A fleece rolled up at (x, base), scale s. */
export function fleece(ctx: Ctx, x: number, base: number, s = 1): void {
  for (const [dx, dy, r] of [[-3, -3.5, 3.6], [3, -3.5, 3.6], [0, -6.5, 3.8]] as const) circle(ctx, x + dx * s, base + dy * s, r * s, '#ece6d6');
  circle(ctx, x - 1 * s, base - 5 * s, 1.4 * s, '#d4ccb8');
}

/** A basket of eggs at (x, base), scale s. */
export function eggBasket(ctx: Ctx, x: number, base: number, s = 1): void {
  for (const [dx, c] of [[-3, '#f4efe4'], [0, '#d9b48a'], [3, '#f4efe4']] as const) ellipse(ctx, x + dx * s, base - 6 * s, 1.8 * s, 2.3 * s, c);
  poly(ctx, [x - 6 * s, base - 5 * s, x + 6 * s, base - 5 * s, x + 4.5 * s, base, x - 4.5 * s, base], '#a0763e');
  line(ctx, x - 5.5 * s, base - 3 * s, x + 5.5 * s, base - 3 * s, '#7a5628', 0.8 * s);
}

/** A joint of meat at (x, base), scale s. */
export function meatJoint(ctx: Ctx, x: number, base: number, s = 1): void {
  ellipse(ctx, x, base - 4 * s, 6 * s, 4 * s, '#b5523b');
  ellipse(ctx, x - 1 * s, base - 5 * s, 4 * s, 2.4 * s, '#c96a50');
  rect(ctx, x + 5 * s, base - 5 * s, 4 * s, 2 * s, '#efe6d6'); // the bone
  circle(ctx, x + 9 * s, base - 4 * s, 1.5 * s, '#efe6d6');
}

/** A pail of milk at (x, base), scale s. */
export function milkPail(ctx: Ctx, x: number, base: number, s = 1): void {
  waterBucket(ctx, x, base, s, '#f4f1e8');
}

/** One item of an animal farm's goods (or hay) at (x, base): what each looks like wherever it is. */
export function drawGood(ctx: Ctx, r: Resource, x: number, base: number, s = 1): boolean {
  if (r === 'hay') hayBale(ctx, x, base, s);
  else if (r === 'milk') milkPail(ctx, x, base, s);
  else if (r === 'wool') fleece(ctx, x, base, s);
  else if (r === 'eggs') eggBasket(ctx, x, base, s);
  else if (r === 'meat') meatJoint(ctx, x, base, s);
  else return false;
  return true;
}
