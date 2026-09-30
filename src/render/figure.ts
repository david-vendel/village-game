// A villager's body, drawn the same way everywhere: strolling the street
// (people.ts) or at work (farm.ts). Everyone faces +x (callers mirror with
// ctx.scale); the ground is y = 0 and the hip sits about HIP above it.
//
// Limbs have two segments each (thigh and shin, upper arm and forearm) bent
// at the knee and elbow, and shoes stand flat on the ground. What someone
// wears comes from their occupation: straw hat for the farmer, leather cap
// and apron for the builder, flour-white smock for the miller, white cap and apron for the baker, a green
// hood for the woodcutter, a grey cap and leather apron for the stonecutter, a patched hood for the serf,
// a robe for the monk.

import type { Role } from '../game/buildings';
import type { Look, Person } from '../game/people';
import { circle, type Ctx, ellipse, hash, line, shade } from './util';

/** Who is drawn: enough to pick their body, face and clothes. */
export interface Figure {
  look: Look;
  /** What they do, which decides their clothes; null: no trade yet. */
  role: Role | null;
  seed: number;
}

/**
 * A person as a figure. Clothes follow their trade for life, not today's job,
 * so nobody changes outfit on the way to work; a seeker runs errands as a serf.
 */
export function figureOf(p: Person): Figure {
  return { look: p.look, role: p.profession ?? (p.seeker ? 'serf' : (p.job?.role ?? null)), seed: p.seed };
}

type Hat = 'none' | 'straw' | 'cap' | 'miller' | 'hood' | 'coif' | 'tonsure';

export interface Outfit {
  skin: string;
  hair: string;
  /** Tunic, dress or robe. */
  top: string;
  /** Upper sleeves; forearms are bare when `rolled`. */
  sleeve: string;
  rolled: boolean;
  legs: string;
  shoes: string;
  /** How far down the top reaches, below the hip. */
  hem: number;
  /** Widening of the top from waist to hem (dresses and robes flare). */
  flare: number;
  belt: string | null;
  apron: string | null;
  hat: Hat;
  hatColor: string;
  beard: boolean;
  /** Long hair shows below a woman's coif-less head. */
  longHair: boolean;
  /** Dusted with flour. */
  dusty: boolean;
  /** Patched, worn clothes. */
  patched: boolean;
}

const SKIN = ['#f0cfb0', '#e8c2a0', '#e0b48e', '#d6a47c', '#c89068'];
const HAIR = ['#2a2220', '#3b2a1e', '#5a3d24', '#7a5230', '#a0703a', '#c9a060', '#8a3a1e'];
const PLAIN = ['#7a5a3a', '#6b7a4a', '#8a4a3a', '#5a6a7a', '#9a8a5a'];
const DRESS = ['#7a3d3d', '#3f5a7a', '#6b7a4a', '#8a6a3a', '#5a4a6a'];

const pick = <T>(list: readonly T[], seed: number, salt: number): T => list[Math.floor(hash(seed, salt) * list.length)];

/** What someone looks like and wears, stable for their seed. */
export function outfitOf(f: Figure): Outfit {
  const woman = f.look === 'woman';
  const old = hash(f.seed, 11) < 0.12;
  const o: Outfit = {
    skin: pick(SKIN, f.seed, 12),
    hair: old ? '#a8a298' : pick(HAIR, f.seed, 13),
    top: woman ? pick(DRESS, f.seed, 14) : pick(PLAIN, f.seed, 1),
    sleeve: '',
    rolled: false,
    legs: '#4d3f33',
    shoes: '#3a2a1c',
    hem: woman ? 11.5 : 6,
    flare: woman ? 3 : 1.2,
    belt: woman ? null : '#4a3524',
    apron: woman && hash(f.seed, 15) < 0.6 ? '#e9e1d2' : null,
    hat: woman ? (hash(f.seed, 16) < 0.65 ? 'coif' : 'none') : 'none',
    hatColor: '#ece6d8',
    beard: !woman && hash(f.seed, 17) < 0.45,
    longHair: woman,
    dusty: false,
    patched: false,
  };
  if (f.look === 'monk') {
    Object.assign(o, { top: '#5a4632', legs: '#5a4632', shoes: '#6b4a2c', hem: 13, flare: 3.5, belt: '#c9b07a', hat: 'tonsure', beard: false });
  } else if (f.role === 'farmer') {
    o.top = woman ? pick(['#6b7a4a', '#7a6a3a', '#8a6a3a'], f.seed, 18) : pick(['#6b7a4a', '#7a6a3a', '#5f6e3c'], f.seed, 18);
    Object.assign(o, { rolled: true, legs: '#5a4a36', shoes: '#3a2a1c', hat: 'straw', hatColor: '#d8bf6a' });
    if (woman) o.apron = '#e2d6bc';
  } else if (f.role === 'builder') {
    o.top = pick(['#9a7a58', '#8a6a4a', '#a88a62'], f.seed, 18);
    Object.assign(o, { rolled: true, legs: '#4a4038', shoes: '#2e2218', apron: '#6a4a2e', hat: 'cap', hatColor: '#6b5038' });
    if (woman) o.hem = 9;
  } else if (f.role === 'miller') {
    Object.assign(o, { top: '#e6ded0', legs: '#cfc4b0', shoes: '#6a5a48', belt: woman ? null : '#b8a888', apron: '#f4f0e6', hat: woman ? 'coif' : 'miller', hatColor: '#f4f0e6', dusty: true });
  } else if (f.role === 'baker') {
    Object.assign(o, { top: woman ? '#c9a878' : '#d8c8a8', legs: '#6a5a48', shoes: '#4a3a2a', belt: null, apron: '#f4f0e6', hat: woman ? 'coif' : 'cap', hatColor: '#f4f0e6', rolled: true, dusty: true });
  } else if (f.role === 'woodcutter') {
    o.top = pick(['#4f6a3a', '#5a6e3e', '#6a5a3a'], f.seed, 18);
    Object.assign(o, { rolled: true, legs: '#4a3e2e', shoes: '#2e2218', belt: '#3a2a1c', hat: 'hood', hatColor: pick(['#3f5a2e', '#4a5a34'], f.seed, 19) });
  } else if (f.role === 'stonecutter') {
    o.top = pick(['#8a8680', '#7a766e', '#948c80'], f.seed, 18);
    Object.assign(o, { rolled: true, legs: '#5a554c', shoes: '#3a342c', apron: '#6a4a2e', hat: 'cap', hatColor: '#6e6a62' });
  } else if (f.role === 'serf') {
    o.top = pick(['#7d7264', '#6e6452', '#857a62'], f.seed, 18);
    Object.assign(o, { legs: '#5c5346', shoes: '#8a7d68', belt: '#5a4a3a', apron: null, hat: 'hood', hatColor: pick(['#6a5a44', '#5e5648'], f.seed, 19), patched: true });
  }
  o.sleeve = o.top;
  if (o.hat === 'coif' || o.hat === 'hood') o.longHair = false;
  return o;
}

/** Hip height above the ground when standing. */
export const HIP = 14.6;
/** Shoulder and head centre in the hip frame (origin at the hip). */
export const SHOULDER: [number, number] = [0.6, -11.2];
export const HEAD: [number, number] = [0.5, -17.4];

const THIGH = 7.3;
const SHIN = 7.3;
const ANKLE = 1.3;
const UPPER_ARM = 5.8;
const FOREARM = 5.6;

/**
 * Knee or elbow of a two-segment limb from joint a to end b. side 1 bends it
 * down/back (elbows), -1 forward (knees); out of reach it straightens.
 */
function joint(ax: number, ay: number, bx: number, by: number, l1: number, l2: number, side: 1 | -1): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.max(0.001, Math.hypot(dx, dy));
  const r = Math.min(d, l1 + l2 - 0.001);
  const along = (l1 * l1 - l2 * l2 + r * r) / (2 * r);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const ux = dx / d;
  const uy = dy / d;
  return [ax + ux * along - uy * h * side, ay + uy * along + ux * h * side];
}

/** A shoe standing with its sole at y = sole, heel at the ankle's x. */
function shoe(ctx: Ctx, x: number, sole: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - 1.8, sole);
  ctx.lineTo(x + 3.2, sole);
  ctx.quadraticCurveTo(x + 4.4, sole, x + 3.8, sole - 1.4);
  ctx.quadraticCurveTo(x + 2.2, sole - 2.7, x - 0.4, sole - 2.9);
  ctx.lineTo(x - 1.9, sole - 2.4);
  ctx.closePath();
  ctx.fill();
}

/**
 * Both legs, in the ground frame. Walking, each foot plants flat and pushes
 * back, then lifts and swings forward; standing, the feet rest a little apart.
 * Returns the hip's y (it rises as the feet pass each other).
 */
export function drawLegs(ctx: Ctx, o: Outfit, phase: number, walking: boolean): number {
  const hipY = walking ? -HIP - Math.abs(Math.cos(phase)) * 0.9 : -HIP;
  for (const far of [true, false]) {
    const p = far ? phase + Math.PI : phase;
    const fx = walking ? Math.sin(p) * 6 : far ? -2 : 2;
    const sole = walking ? -Math.max(0, Math.cos(p)) * 2.4 : 0;
    const hx = far ? -0.8 : 0.8;
    const ay = sole - ANKLE;
    const [kx, ky] = joint(hx, hipY, fx, ay, THIGH, SHIN, -1);
    const legs = far ? shade(o.legs, -0.22) : o.legs;
    ctx.lineCap = 'round';
    line(ctx, hx, hipY, kx, ky, legs, 3.6);
    line(ctx, kx, ky, fx, ay, legs, 3);
    shoe(ctx, fx, sole, far ? shade(o.shoes, -0.2) : o.shoes);
  }
  return hipY;
}

/** One arm from the shoulder (sx, sy) to the hand (hx, hy), bent at the elbow. */
export function drawArm(ctx: Ctx, o: Outfit, sx: number, sy: number, hx: number, hy: number, far = false): void {
  const [ex, ey] = joint(sx, sy, hx, hy, UPPER_ARM, FOREARM, 1);
  // out of reach: the hand stays where the arm ends
  const d = Math.hypot(hx - sx, hy - sy);
  const reach = UPPER_ARM + FOREARM;
  if (d > reach) {
    hx = sx + ((hx - sx) / d) * reach;
    hy = sy + ((hy - sy) / d) * reach;
  }
  const k = far ? -0.22 : 0;
  const sleeve = shade(o.sleeve, k);
  const skin = shade(o.skin, k);
  ctx.lineCap = 'round';
  line(ctx, sx, sy, ex, ey, sleeve, 3.2);
  if (o.rolled) {
    line(ctx, ex, ey, hx, hy, skin, 2.4);
    circle(ctx, ex, ey, 1.7, shade(sleeve, -0.08)); // rolled cuff
  } else {
    line(ctx, ex, ey, hx, hy, sleeve, 2.8);
  }
  circle(ctx, hx, hy, 1.45, skin);
}

/** An arm swinging while walking: angle 0 hangs straight down, positive swings forward. */
export function swingHand(sx: number, sy: number, angle: number): [number, number] {
  return [sx + Math.sin(angle) * 10.6, sy + Math.cos(angle) * 10.6];
}

/**
 * The top in the hip frame: tunic, dress or robe with belt, apron and the
 * marks of the trade. `sway` (walking) swings a long hem.
 */
export function drawTorso(ctx: Ctx, o: Outfit, sway = 0, seed = 0): void {
  const hem = o.hem;
  const front = 4.4 + o.flare + sway * 1.2;
  const back = -4.4 - o.flare + sway * 0.6;
  const outline = shade(o.top, -0.35);
  // neck
  line(ctx, 0.5, -12, 0.7, -15, shade(o.skin, -0.08), 2.8);
  ctx.beginPath();
  ctx.moveTo(-3.6, -12.4);
  ctx.quadraticCurveTo(0.4, -13.8, 4, -12.2);
  ctx.quadraticCurveTo(5.4, -7.5, 4.3, -2);
  ctx.quadraticCurveTo(front - 0.6, hem - 3, front, hem);
  ctx.quadraticCurveTo(0, hem + 1.3, back, hem);
  ctx.quadraticCurveTo(back + 0.6, hem - 3, -4.3, -2);
  ctx.quadraticCurveTo(-5.2, -8, -3.6, -12.4);
  ctx.closePath();
  ctx.fillStyle = o.top;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 0.7;
  ctx.stroke();
  // shadowed back, lit front
  ctx.save();
  ctx.clip();
  ctx.globalAlpha *= 0.22;
  ctx.fillStyle = '#000';
  ctx.fillRect(-9, -15, 6, hem + 17);
  ctx.globalAlpha *= 0.6;
  ctx.fillStyle = '#fff';
  ctx.fillRect(2.6, -13, 1.4, hem + 13);
  ctx.restore();
  // neckline
  ctx.beginPath();
  ctx.moveTo(-1.2, -12.9);
  ctx.quadraticCurveTo(1, -10.6, 3, -12.6);
  ctx.strokeStyle = outline;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // folds in a long hem
  if (hem > 8) {
    ctx.globalAlpha *= 0.5;
    line(ctx, 1 + sway, 2, 1.5 + sway * 1.5, hem, outline, 0.6);
    line(ctx, -2 + sway * 0.5, 3, -2.8 + sway, hem, outline, 0.6);
    ctx.globalAlpha /= 0.5;
  }
  if (o.apron) {
    ctx.fillStyle = o.apron;
    ctx.beginPath();
    ctx.moveTo(-0.5, -3.5);
    ctx.lineTo(4.5, -3.5);
    ctx.quadraticCurveTo(front - 0.3, hem * 0.6, front - 0.6, Math.min(hem, 9) - 0.5);
    ctx.lineTo(0.2, Math.min(hem, 9));
    ctx.closePath();
    ctx.fill();
    // bib for the leather apron
    if (o.hat === 'cap') {
      ctx.beginPath();
      ctx.moveTo(1, -3.5);
      ctx.lineTo(4.4, -3.5);
      ctx.lineTo(4.8, -9.5);
      ctx.lineTo(1.8, -9.5);
      ctx.fill();
      line(ctx, 1.9, -9.5, -1.5, -12.6, shade(o.apron, -0.2), 0.8);
    }
  }
  if (o.belt) {
    line(ctx, -4.4, -2.6, 4.4, -2.6, o.belt, 1.4);
    if (o.hat === 'tonsure') {
      // rope belt with a hanging end
      line(ctx, 2.8, -2.4, 3.4 + sway, 5, o.belt, 0.9);
    } else {
      ctx.fillStyle = '#b8a060';
      ctx.fillRect(2.6, -3.4, 1.4, 1.6);
    }
  }
  if (o.hat === 'cap') {
    // hammer hanging at the belt
    line(ctx, -2.5, -2.4, -3.5, 3.5, '#6b4a2c', 1);
    ctx.fillStyle = '#7a7a7a';
    ctx.fillRect(-5, -3.2, 3.2, 1.6);
  }
  if (o.hat === 'tonsure') {
    // hood lying on the shoulders
    ellipse(ctx, -2.2, -11.8, 3.6, 2.2, shade(o.top, -0.15), -0.3);
  }
  if (o.patched) {
    ctx.fillStyle = shade(o.top, 0.18);
    ctx.fillRect(-3 + hash(seed, 21) * 3, -8 + hash(seed, 22) * 6, 2.4, 2.2);
    ctx.fillStyle = shade(o.top, -0.15);
    ctx.fillRect(-2 + hash(seed, 23) * 3, 1 + hash(seed, 24) * 2, 2, 2);
    // ragged hem
    ctx.fillStyle = o.top;
    for (let i = 0; i < 4; i++) ctx.fillRect(back + 1.5 + i * 2.6, hem - 0.3, 1.1, 1.2 + hash(seed, 25 + i));
  }
  if (o.dusty) {
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 7; i++) ctx.fillRect(-4 + hash(seed, 30 + i) * 8, -11 + hash(seed, 40 + i) * (hem + 9), 0.8, 0.8);
  }
}

/** The top and back of a head of hair, or anything shaped like it (hood, coif), at radius r. */
function capShape(ctx: Ctx, x: number, y: number, r: number, fringe: number, nape: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI * 0.72, Math.PI * 1.88);
  ctx.lineTo(x + 2.2, y - fringe);
  ctx.quadraticCurveTo(x - 0.5, y - 1.8, x - 1.8, y + 0.2);
  ctx.lineTo(x - 2.6, y + nape);
  ctx.closePath();
}

/** Head with face, hair and headwear, centred at (x, y), facing +x. */
export function drawHead(ctx: Ctx, o: Outfit, x: number, y: number): void {
  const r = 4.5;
  // long hair falls behind the neck
  if (o.longHair) {
    ctx.fillStyle = shade(o.hair, -0.1);
    ctx.beginPath();
    ctx.moveTo(x - 4.6, y - 1);
    ctx.quadraticCurveTo(x - 6.2, y + 5, x - 4.2, y + 8.5);
    ctx.lineTo(x - 0.8, y + 6.5);
    ctx.lineTo(x - 1, y);
    ctx.closePath();
    ctx.fill();
  }
  if (o.hat === 'hood') {
    // the hood's back, behind the head
    circle(ctx, x - 0.6, y - 0.2, r + 1.6, shade(o.hatColor, -0.12));
  }
  // head: a little taller than wide, jaw a touch forward
  ellipse(ctx, x, y, r - 0.2, r + 0.1, o.skin);
  ellipse(ctx, x + 1.2, y + 1.8, 2.8, 2.4, o.skin);
  // nose
  ctx.fillStyle = o.skin;
  ctx.beginPath();
  ctx.moveTo(x + 3.9, y - 1.2);
  ctx.quadraticCurveTo(x + 5.8, y + 0.6, x + 4, y + 1.1);
  ctx.fill();
  // ear
  ellipse(ctx, x - 0.8, y + 0.4, 1.1, 1.5, shade(o.skin, -0.14));
  // cheek
  ctx.globalAlpha *= 0.3;
  circle(ctx, x + 2.4, y + 1.4, 1.1, '#e0806a');
  ctx.globalAlpha /= 0.3;
  // eye and brow
  circle(ctx, x + 2.5, y - 0.5, 0.75, '#2a1e16');
  line(ctx, x + 1.4, y - 2.1, x + 3.5, y - 1.9, shade(o.hair, -0.1), 0.7);
  if (o.beard) {
    ctx.fillStyle = o.hair;
    ctx.beginPath();
    ctx.moveTo(x - 0.4, y + 0.6);
    ctx.quadraticCurveTo(x + 0.2, y + 5.6, x + 3, y + 5);
    ctx.quadraticCurveTo(x + 4.6, y + 4.2, x + 4.2, y + 2);
    ctx.quadraticCurveTo(x + 2.6, y + 1.2, x + 1.2, y + 2);
    ctx.closePath();
    ctx.fill();
    line(ctx, x + 2.2, y + 1.6, x + 4.2, y + 1.7, o.hair, 0.8); // moustache
  }
  // mouth
  line(ctx, x + 2.5, y + 2.5, x + 3.6, y + 2.3, '#8a4636', 0.7);

  // hair
  if (o.hat !== 'coif' && o.hat !== 'hood') {
    ctx.fillStyle = o.hair;
    capShape(ctx, x, y, r + 0.4, 2.8, 3);
    ctx.fill();
    if (o.hat === 'tonsure') ellipse(ctx, x - 0.4, y - 3.9, 2.8, 1.5, shade(o.skin, 0.05));
    if (o.longHair) circle(ctx, x - 4, y - 2.6, 2, o.hair); // bun
  }
  switch (o.hat) {
    case 'straw':
      ellipse(ctx, x + 0.4, y - 3.1, 8.2, 1.9, shade(o.hatColor, -0.12));
      ellipse(ctx, x + 0.4, y - 3.5, 8, 1.6, o.hatColor);
      ctx.fillStyle = o.hatColor;
      ctx.beginPath();
      ctx.moveTo(x - 3.8, y - 3.4);
      ctx.quadraticCurveTo(x - 3.4, y - 8.4, x + 0.3, y - 8.6);
      ctx.quadraticCurveTo(x + 4, y - 8.4, x + 4.4, y - 3.4);
      ctx.fill();
      line(ctx, x - 3.7, y - 4.4, x + 4.3, y - 4.4, '#8a6a2a', 1);
      break;
    case 'cap':
      ctx.fillStyle = o.hatColor;
      capShape(ctx, x, y - 0.3, r + 0.6, 3.2, -0.5);
      ctx.fill();
      ellipse(ctx, x + 3.8, y - 3, 2.8, 0.9, shade(o.hatColor, -0.2), -0.1);
      line(ctx, x - 4, y - 1.5, x + 3, y - 3.7, shade(o.hatColor, -0.25), 0.6);
      break;
    case 'miller':
      // a floppy linen cap, drooping at the back
      ctx.fillStyle = o.hatColor;
      ctx.beginPath();
      ctx.moveTo(x + 4.2, y - 2.6);
      ctx.quadraticCurveTo(x + 3, y - 8.5, x - 2, y - 7.4);
      ctx.quadraticCurveTo(x - 7.2, y - 6, x - 6.4, y - 1.6);
      ctx.quadraticCurveTo(x - 4.4, y - 3.4, x - 3.8, y - 2.6);
      ctx.closePath();
      ctx.fill();
      line(ctx, x - 4.2, y - 2.8, x + 4.3, y - 2.6, shade(o.hatColor, -0.15), 1.2);
      break;
    case 'coif':
      // linen headscarf framing the face
      ctx.fillStyle = o.hatColor;
      capShape(ctx, x, y, r + 0.8, 3.2, 4.6);
      ctx.fill();
      line(ctx, x + 2.6, y - 3.1, x - 1.4, y + 0.4, shade(o.hatColor, -0.15), 0.6);
      break;
    case 'hood':
      ctx.fillStyle = o.hatColor;
      ctx.beginPath();
      ctx.arc(x - 0.6, y - 0.2, r + 1.6, Math.PI * 0.62, Math.PI * 1.86);
      ctx.quadraticCurveTo(x + 1.5, y - 3.6, x - 0.2, y + 1);
      ctx.quadraticCurveTo(x - 0.4, y + 4.6, x + 1.8, y + 6.8);
      ctx.lineTo(x - 5, y + 6.4);
      ctx.closePath();
      ctx.fill();
      break;
  }
}

/** Something carried while strolling. */
export type Carry = 'none' | 'sack' | 'tool' | 'basket';

/** A whole person standing or walking (in the ground frame, feet at y = 0). */
export function drawFigure(ctx: Ctx, f: Figure, phase: number, walking: boolean, carry: Carry = 'none'): void {
  const o = outfitOf(f);
  const hipY = drawLegs(ctx, o, phase, walking);
  const swing = walking ? Math.sin(phase) * 0.55 : 0;
  const [sx, sy] = SHOULDER;
  ctx.save();
  ctx.translate(0, hipY);
  // far arm swings with the near leg
  drawArm(ctx, o, sx - 1.2, sy, ...swingHand(sx - 1.2, sy, swing + 0.05), true);
  drawTorso(ctx, o, walking ? Math.sin(phase) * 0.6 : 0, f.seed);
  drawHead(ctx, o, HEAD[0], HEAD[1]);
  if (carry === 'sack') {
    // a sack over the shoulder, held at the neck
    ellipse(ctx, -2.5, -11, 4.8, 6.2, '#c9b48a', 0.5);
    line(ctx, -0.2, -15.5, 1.2, -14.2, '#8a7a58', 1.2);
    drawArm(ctx, o, sx, sy, 2.6, -14.6);
  } else if (carry === 'tool') {
    // a hoe on the shoulder
    line(ctx, -9, -4, 7, -18.5, '#6b4a2c', 1.5);
    ctx.fillStyle = '#8a8a8a';
    ctx.beginPath();
    ctx.moveTo(-9.6, -4.4);
    ctx.lineTo(-9.4, 0.4);
    ctx.lineTo(-7.6, -3.2);
    ctx.fill();
    drawArm(ctx, o, sx, sy, 3.4, -13.8);
  } else if (carry === 'basket') {
    const [hx, hy] = [5, -1.5];
    drawArm(ctx, o, sx, sy, hx, hy);
    ctx.strokeStyle = '#7a5a30';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(hx, hy + 2.5, 3, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#b08850';
    ctx.beginPath();
    ctx.moveTo(hx - 3.6, hy + 2.5);
    ctx.lineTo(hx + 3.6, hy + 2.5);
    ctx.lineTo(hx + 2.6, hy + 6.6);
    ctx.lineTo(hx - 2.6, hy + 6.6);
    ctx.fill();
    line(ctx, hx - 3.2, hy + 4.3, hx + 3.2, hy + 4.3, '#8a6a3a', 0.6);
  } else {
    drawArm(ctx, o, sx, sy, ...swingHand(sx, sy, -swing + 0.05));
  }
  ctx.restore();
}
