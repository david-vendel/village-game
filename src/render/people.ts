// Villagers and chickens wandering the street.

import type { Animal, Look, Person, Stroll } from '../game/people';
import { circle, type Ctx, ellipse, hash, line, poly } from './util';

const TUNICS = ['#7a5a3a', '#6b7a4a', '#8a4a3a', '#5a6a7a', '#9a8a5a'];

/** What the street art needs to know about someone strolling: how they look and move. */
type Walker = Stroll & { kind: Look | 'chicken'; seed: number };

/** A person or animal as a street walker. */
export function walker(who: Person | Animal): Walker {
  return { ...who.stroll, kind: 'look' in who ? who.look : who.kind, seed: who.seed };
}

export function drawVillager(ctx: Ctx, v: Walker, x: number, base: number, time: number): void {
  const walking = v.idle <= 0;
  const phase = walking ? time * v.speed * 0.18 + v.seed : 0;
  ctx.save();
  ctx.translate(x, base);
  ctx.scale(v.dir, 1);
  ctx.globalAlpha = 0.22;
  ellipse(ctx, 0, 0, 9, 2.5, '#2c2416');
  ctx.globalAlpha = 1;
  if (v.kind === 'chicken') {
    drawChicken(ctx, phase, walking, time, v.seed);
  } else {
    drawPerson(ctx, v, phase, walking, time);
  }
  ctx.restore();
}

function drawPerson(ctx: Ctx, v: Walker, phase: number, walking: boolean, time: number): void {
  const swing = walking ? Math.sin(phase) * 0.45 : 0;
  const bob = walking ? Math.abs(Math.cos(phase)) * 1.2 : Math.sin(time * 1.5 + v.seed) * 0.3;
  const tunic = v.kind === 'monk' ? '#5a4632' : TUNICS[Math.floor(hash(v.seed, 1) * TUNICS.length)];
  ctx.lineCap = 'round';
  // legs
  line(ctx, 0, -14 - bob, Math.sin(swing) * 9, 0, '#3d3128', 3);
  line(ctx, 0, -14 - bob, Math.sin(-swing) * 9, 0, '#4d3f33', 3);
  // body
  if (v.kind === 'woman') {
    poly(ctx, [-8, -2 - bob, 8, -2 - bob, 4, -26 - bob, -4, -26 - bob], tunic);
    poly(ctx, [-4, -14 - bob, 5, -14 - bob, 6, -2 - bob, -3, -2 - bob], '#e9e1d2'); // apron
  } else if (v.kind === 'monk') {
    poly(ctx, [-7, 0 - bob, 7, 0 - bob, 5, -27 - bob, -5, -27 - bob], tunic);
    line(ctx, -5, -14 - bob, 5, -14 - bob, '#c9b07a', 1.5);
  } else {
    poly(ctx, [-6, -12 - bob, 6, -12 - bob, 5, -26 - bob, -5, -26 - bob], tunic);
  }
  // arms
  line(ctx, 1, -24 - bob, 1 + Math.sin(-swing) * 6, -14 - bob, tunic, 3);
  // head
  circle(ctx, 0, -31 - bob, 4.5, '#e0b48e');
  if (v.kind === 'woman') {
    ctx.fillStyle = '#e9e1d2';
    ctx.beginPath();
    ctx.arc(0, -32 - bob, 5.2, Math.PI, 0);
    ctx.fill();
  } else if (v.kind === 'monk') {
    circle(ctx, -1, -33 - bob, 3, '#c89c78');
  } else {
    ctx.fillStyle = '#5a3d24';
    ctx.beginPath();
    ctx.arc(0, -33 - bob, 5, Math.PI, 0);
    ctx.fill();
    // carries a sack or tool
    if (hash(v.seed, 2) < 0.5) {
      ellipse(ctx, -5, -22 - bob, 5, 7, '#c9b48a');
    } else {
      line(ctx, 3, -32 - bob, 3, -6 - bob, '#6b4a2c', 1.5);
      line(ctx, 0, -32 - bob, 7, -34 - bob, '#8a8a8a', 2);
    }
  }
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
