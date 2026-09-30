// The monarch on horseback, at the villagers' scale (render/figure.ts): the
// horse's back is about as high as a villager's shoulder. Drawn facing right
// with the origin on the ground between the hooves; mirrored for left.
//
// The horse's legs work like the villagers': each hoof plants on the ground
// and stays there while the body passes over it (it moves back exactly as far
// as the horse moves on), then lifts and swings forward; knees and hocks are
// solved from where the hoof is (figure.ts joint). A 4-beat walk, and a trot
// that moves diagonal pairs together. The king is a villager's body in royal
// clothes, sitting the saddle: legs in the stirrups, hands on the reins, a
// cloak that streams out behind with speed, and a crown.

import type { Rider } from '../game/world';
import { RIDER_MAX_SPEED } from '../game/world';
import { drawArm, drawHead, drawTorso, HEAD, joint, type Outfit, SHOULDER } from './figure';
import { circle, type Ctx, ellipse, line, poly, shade } from './util';

const COAT = '#8b5a34';
const COAT_DARK = '#6b4226';
const COAT_FAR = '#5e3a22';
const COAT_LIGHT = '#a26d43';
const MANE = '#2b1d14';
const HOOF = '#2a221c';

/** Distance the horse moves per full gait cycle (px); the hoofbeat sound follows it too (app/sound.ts). */
export const STRIDE = 48;

/** Where the legs join the body, in the body's frame: fore (shoulder) and hind (stifle). */
const FORE = { x: 11, y: -20.5, upper: 10.2, lower: 10.3, knee: -1 as const };
const HIND = { x: -12, y: -21, upper: 10.2, lower: 10.8, knee: 1 as const };
/** How far the top of a leg swings with it (the shoulder blade and the hip turn as the leg reaches). */
const ROOT_SWING = 0.3;
/** Height of the hoof: the leg ends this far above the ground. */
const HOOF_H = 1.8;

type LegDef = typeof FORE | typeof HIND;

/**
 * Where a hoof is at leg phase u (0..1, touching down at 0): planted for the
 * `stance` part of the cycle, sliding back under the body exactly as fast as
 * the horse moves on, then lifted and swung forward.
 */
function hoofAt(rootX: number, u: number, stance: number, liftH: number): { x: number; lift: number } {
  const reach = STRIDE * stance;
  if (u < stance) return { x: rootX + reach * (0.5 - u / stance), lift: 0 };
  const v = (u - stance) / (1 - stance);
  return { x: rootX + reach * (-0.5 + (1 - Math.cos(Math.PI * v)) / 2), lift: Math.sin(Math.PI * v) * liftH };
}

/** One leg from its root (body frame, lifted by `bob`) to the hoof (ground frame). */
function drawLeg(ctx: Ctx, leg: LegDef, bob: number, hoof: { x: number; lift: number }, coat: string, sock: string): void {
  const rx = leg.x + (hoof.x - leg.x) * ROOT_SWING;
  const ry = leg.y - bob;
  let fx = hoof.x;
  let fy = -HOOF_H - hoof.lift;
  // at the very end of a long reach the leg is straight: the hoof is where it reaches
  const d = Math.hypot(fx - rx, fy - ry);
  const reach = leg.upper + leg.lower;
  if (d > reach) {
    fx = rx + ((fx - rx) * reach) / d;
    fy = ry + ((fy - ry) * reach) / d;
  }
  const [kx, ky] = joint(rx, ry, fx, fy, leg.upper, leg.lower, leg.knee);
  ctx.lineCap = 'round';
  line(ctx, rx, ry, kx, ky, coat, leg === HIND ? 5.2 : 4.4);
  line(ctx, kx, ky, fx, fy, coat, 2.4);
  // white sock over the fetlock, then the hoof (tipped up as it lifts)
  line(ctx, kx + (fx - kx) * 0.62, ky + (fy - ky) * 0.62, fx, fy, sock, 2.5);
  circle(ctx, fx, fy - 0.3, 1.5, sock);
  ctx.lineCap = 'butt';
  const tip = Math.min(1, hoof.lift / 3) * 1.2;
  poly(ctx, [fx - 1.8, fy - 0.2, fx + 1.9, fy - 0.2 - tip, fx + 2.4, fy + HOOF_H - tip, fx - 2, fy + HOOF_H], HOOF);
}

/** The king's clothes on a villager's body (figure.ts). */
const KING: Outfit = {
  skin: '#e3b893',
  hair: '#5a3d24',
  top: '#2f4f86',
  sleeve: '#2f4f86',
  rolled: false,
  legs: '#4a3a5a',
  shoes: '#2e2018',
  hem: 6.5,
  flare: 1.6,
  belt: '#6b4a2c',
  apron: null,
  hat: 'none',
  hatColor: '#e8c14a',
  beard: true,
  longHair: false,
  dusty: false,
  patched: false,
};
const CLOAK = '#9a2a2e';
const ERMINE = '#ece5d6';
const GOLD = '#e8c14a';

export function drawRider(ctx: Ctx, rider: Rider, screenX: number, groundY: number, time: number): void {
  const speed = Math.min(1, Math.abs(rider.vx) / RIDER_MAX_SPEED); // 0..1, vs the default top speed
  const moving = speed > 0.02;
  const phase = rider.gait / STRIDE;
  const trot = speed > 0.6;
  const stance = trot ? 0.38 : 0.5;
  const liftH = trot ? 5.5 : 3.2;

  // the body rises and falls twice a cycle (as each diagonal pair or each end pushes off)
  const bob = moving ? (0.5 - 0.5 * Math.cos(phase * Math.PI * 4)) * (trot ? 1.5 : 0.7) : 0;
  const breathe = Math.sin(time * 2.1) * 0.25;
  // the head swings with the walk; idle, slow nods, an occasional deeper dip, and a hoof pawing now and then
  const nod = moving ? Math.sin(phase * Math.PI * 4 + 0.6) * (trot ? 0.04 : 0.08) - speed * 0.12 : Math.sin(time * 0.9) * 0.08 + Math.max(0, Math.sin(time * 0.37) - 0.8) * 1.4;
  const paw = moving ? 0 : Math.max(0, Math.sin(time * 1.3) - 0.85) * 18;

  ctx.save();
  ctx.translate(screenX, groundY);
  ctx.globalAlpha = 0.26;
  ellipse(ctx, 0, 0, 25, 3.2, '#2c2416');
  ctx.globalAlpha = 1;
  ctx.scale(rider.facing, 1);

  // dust kicked up at speed
  if (speed > 0.4) {
    for (let i = 0; i < 5; i++) {
      const t = (phase * 2 + i / 5) % 1;
      ctx.globalAlpha = (1 - t) * 0.28 * speed;
      circle(ctx, -18 - t * 18, -2 - t * 6, 2.5 + t * 5, '#cdb48a');
    }
    ctx.globalAlpha = 1;
  }

  // walk: left hind, left fore, right hind, right fore; trot: diagonal pairs
  const off = trot ? { lh: 0, rf: 0, rh: 0.5, lf: 0.5 } : { lh: 0, lf: 0.25, rh: 0.5, rf: 0.75 };
  const hoof = (leg: LegDef, o: number, far: boolean, lift = 0) => {
    if (moving) return hoofAt(leg.x + (far ? 1.5 : 0), (((phase + o) % 1) + 1) % 1, stance, liftH);
    return { x: leg.x + (far ? 2.5 : -0.5) + (lift ? 2 : 0), lift };
  };

  // far-side legs
  drawLeg(ctx, HIND, bob, hoof(HIND, off.rh, true), COAT_FAR, '#bdb2a0');
  drawLeg(ctx, FORE, bob, hoof(FORE, off.rf, true), COAT_FAR, '#bdb2a0');

  ctx.save();
  ctx.translate(0, -bob);

  // tail, from the croup
  const swish = moving ? Math.sin(phase * Math.PI * 2) * 0.2 - speed * 0.55 : Math.sin(time * 1.7) * 0.22;
  ctx.save();
  ctx.translate(-18, -27);
  ctx.rotate(0.3 + swish);
  ctx.fillStyle = MANE;
  ctx.beginPath();
  ctx.moveTo(0, -1.5);
  ctx.quadraticCurveTo(-6, 4, -4, 17);
  ctx.quadraticCurveTo(-1, 15, 2.4, 2);
  ctx.fill();
  ctx.restore();

  // body: barrel, chest and quarters, shaded underneath and lit along the back
  ellipse(ctx, -0.5, -23.5, 14, 6.3 + breathe, COAT);
  ellipse(ctx, 9, -23, 6.5, 6.5, COAT);
  ellipse(ctx, -11, -24.5, 7.6, 7, COAT);
  ellipse(ctx, 8, -27.2, 5, 3, COAT);
  ellipse(ctx, 0, -18.6, 10, 1.8, COAT_DARK);
  ellipse(ctx, -12.5, -21, 4.5, 3.5, shade(COAT, -0.08)); // stifle
  ellipse(ctx, -3, -29.2, 11, 1.4, COAT_LIGHT);

  // neck and head, nodding about the base of the neck
  ctx.save();
  ctx.translate(11, -27);
  ctx.rotate(nod);
  poly(ctx, [-6, -3, 2, -11, 9, -14.5, 12, -10, 6.5, -2, 3, 5.5, -3, 3], COAT);
  ellipse(ctx, 4.5, -7, 3.5, 5, COAT_LIGHT, -0.7); // sunlit neck
  // head, pointing down and forward from the poll
  poly(ctx, [8, -15.5, 11.5, -13, 16.5, -7, 17.4, -5.2, 15.8, -3.6, 13.4, -4.6, 9.6, -8.4, 7.4, -10.6], COAT);
  ellipse(ctx, 10, -10.4, 3.2, 3, COAT); // cheek
  ellipse(ctx, 16.2, -5, 1.9, 1.7, COAT_DARK); // muzzle
  circle(ctx, 16.8, -5.6, 0.5, '#1a1410'); // nostril
  circle(ctx, 11.2, -12.4, 0.8, '#1a1410'); // eye
  poly(ctx, [8.2, -14.6, 8.6, -19, 10.2, -15], COAT_DARK); // ear
  // mane along the crest, and the forelock
  ctx.fillStyle = MANE;
  ctx.beginPath();
  ctx.moveTo(9, -15.2);
  ctx.quadraticCurveTo(3, -12.5, -6.5, -3.5);
  ctx.lineTo(-4.5, -1.8);
  ctx.quadraticCurveTo(2, -9, 8, -12.6);
  ctx.closePath();
  ctx.fill();
  poly(ctx, [9, -15.4, 11.6, -14.6, 10.2, -12.4], MANE);
  // bridle
  line(ctx, 10.6, -14.6, 12.6, -7.6, '#3a2a1c', 0.8);
  line(ctx, 11.2, -9.8, 16.4, -6.6, '#3a2a1c', 0.8);
  ctx.restore();
  ctx.restore();

  // near-side legs
  drawLeg(ctx, HIND, bob, hoof(HIND, off.lh, false), COAT, '#e8dfcf');
  drawLeg(ctx, FORE, bob, hoof(FORE, off.lf, false, paw), COAT, '#e8dfcf');

  ctx.save();
  ctx.translate(0, -bob);
  // saddle cloth and saddle
  poly(ctx, [-8.5, -30, 5, -30, 6, -21.6, -9.5, -21.6], '#2f4f86');
  line(ctx, -9.5, -22, 6, -22, GOLD, 1.3);
  poly(ctx, [-6.5, -31.8, 3.8, -31.8, 3.2, -29.2, -5.8, -29.2], '#5a3a22');
  poly(ctx, [-6.5, -31.8, -5, -34, -4.2, -31.8], '#5a3a22'); // cantle
  ctx.restore();

  // the king, sitting the saddle: his body rises a little in the trot, and he leans into the ride
  const post = trot ? Math.abs(Math.sin(phase * Math.PI * 2)) * 1.3 : 0;
  const lean = speed * 0.14;
  const bit = headPoint(nod, 16, -5, bob);
  drawKing(ctx, -1, -31.6 - bob - post, lean, speed, moving, time, bit);
  ctx.restore();
}

/** A point on the horse's head (in the head's frame) in the rider frame. */
function headPoint(nod: number, x: number, y: number, bob: number): [number, number] {
  const c = Math.cos(nod);
  const s = Math.sin(nod);
  return [11 + x * c - y * s, -27 - bob + x * s + y * c];
}

/** The king, his hip at (hipX, hipY), leaning forward by `lean`; his hands hold the reins to the bit. */
function drawKing(ctx: Ctx, hipX: number, hipY: number, lean: number, speed: number, moving: boolean, time: number, bit: [number, number]): void {
  const o = KING;
  const sway = moving ? 0 : Math.sin(time * 1.1) * 0.3;
  const [sx, sy] = SHOULDER;
  ctx.save();
  ctx.translate(hipX, hipY);
  ctx.rotate(lean + sway * 0.03);

  // hands on the reins, a little ahead of the saddle
  const hands: [number, number] = [8.2, -4.2];

  // the cloak hangs from his shoulders over the horse's back, streaming out behind with speed
  const flow = 3 + speed * 16 + Math.sin(time * 5) * (0.5 + speed * 1.5);
  const tipY = 9 - speed * 7;
  ctx.fillStyle = CLOAK;
  ctx.beginPath();
  ctx.moveTo(-2.5, -12.6);
  ctx.quadraticCurveTo(-5 - flow * 0.35, -4, -6 - flow, tipY);
  ctx.lineTo(-2, 8);
  ctx.quadraticCurveTo(-1, -2, 2, -12.2);
  ctx.closePath();
  ctx.fill();
  line(ctx, -6 - flow, tipY, -2, 8, ERMINE, 1.6); // ermine hem

  // far arm to the reins (behind his body)
  drawArm(ctx, o, sx - 1.2, sy, hands[0] - 0.8, hands[1] + 0.4, true);
  drawTorso(ctx, o, 0, 7);
  // near leg: thigh along the saddle, knee forward, foot in the stirrup
  const ankle: [number, number] = [4.2, 11.4];
  const [kx, ky] = joint(0.8, 0, ankle[0], ankle[1], 7.3, 7.3, -1);
  line(ctx, 0.2, -0.6, 0.2, ankle[1] - 1.2, '#3a2a1c', 0.7); // stirrup leather
  ctx.lineCap = 'round';
  line(ctx, 0.8, 0, kx, ky, o.legs, 3.8);
  line(ctx, kx, ky, ankle[0], ankle[1], o.legs, 3.1);
  ctx.lineCap = 'butt';
  // riding boot in the stirrup iron
  poly(ctx, [ankle[0] - 2, ankle[1] - 3.5, ankle[0] + 1.6, ankle[1] - 3.5, ankle[0] + 2, ankle[1] + 0.6, ankle[0] + 4.4, ankle[1] + 1, ankle[0] + 4.2, ankle[1] + 2.4, ankle[0] - 2, ankle[1] + 2.4], o.shoes);
  line(ctx, ankle[0] - 1.8, ankle[1] + 2.9, ankle[0] + 3, ankle[1] + 2.9, '#9a9488', 0.9);

  // head, and the crown
  const [hx, hy] = HEAD;
  drawHead(ctx, o, hx, hy);
  poly(ctx, [hx - 4.2, hy - 3.2, hx + 4.2, hy - 3.2, hx + 4.4, hy - 7.6, hx + 2.8, hy - 5.4, hx + 1.4, hy - 8.4, hx, hy - 5.6, hx - 1.4, hy - 8.4, hx - 2.8, hy - 5.4, hx - 4.4, hy - 7.6], GOLD);
  line(ctx, hx - 4.2, hy - 3.6, hx + 4.2, hy - 3.6, shade(GOLD, -0.25), 0.8);
  circle(ctx, hx, hy - 4.6, 0.8, '#b8323a');
  // ermine collar over the shoulders
  ellipse(ctx, 0.2, -12.2, 4.2, 1.6, ERMINE);

  // near arm to the reins
  drawArm(ctx, o, sx, sy, hands[0], hands[1]);
  // reins from his hands to the bit (worked out in the horse's frame)
  const c = Math.cos(-(lean + sway * 0.03));
  const s = Math.sin(-(lean + sway * 0.03));
  const bx = bit[0] - hipX;
  const by = bit[1] - hipY;
  line(ctx, hands[0], hands[1], bx * c - by * s, bx * s + by * c, '#3a2a1c', 0.8);
  ctx.restore();
}
