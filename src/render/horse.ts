// The monarch on horseback. Drawn facing right in local coordinates with the
// origin on the ground between the hooves; mirrored for left.

import type { Rider } from '../game/world';
import { RIDER_MAX_SPEED } from '../game/world';
import { circle, type Ctx, ellipse, line, poly } from './util';

const COAT = '#8b5a34';
const COAT_DARK = '#6b4226';
const COAT_FAR = '#5e3a22';
const MANE = '#2b1d14';
const HOOF = '#2a221c';

/** Stride length in px per full gait cycle. */
const STRIDE = 78;

interface LegPose {
  hipX: number;
  hipY: number;
  upper: number;
  lower: number;
}

function legPose(hipX: number, hipY: number, phase: number, amp: number, front: boolean, lift: number): LegPose {
  const s = Math.sin(phase * Math.PI * 2);
  const c = Math.cos(phase * Math.PI * 2);
  const upper = s * amp;
  // bend the knee/hock while the leg swings forward (lifted)
  const bend = Math.max(0, c) * amp * 1.6 + lift;
  const lower = upper + (front ? bend : -bend * 0.6);
  return { hipX, hipY, upper, lower };
}

function drawLeg(ctx: Ctx, p: LegPose, color: string, far: boolean): void {
  const L1 = 19;
  const L2 = 19;
  const kx = p.hipX + Math.sin(p.upper) * L1;
  const ky = p.hipY + Math.cos(p.upper) * L1;
  const fx = kx + Math.sin(p.lower) * L2;
  const fy = ky + Math.cos(p.lower) * L2;
  ctx.lineCap = 'round';
  line(ctx, p.hipX, p.hipY, kx, ky, color, 9);
  line(ctx, kx, ky, fx, fy, color, 5);
  // white sock + hoof
  line(ctx, kx + (fx - kx) * 0.6, ky + (fy - ky) * 0.6, fx, fy, far ? '#bdb2a0' : '#e8dfcf', 5);
  ctx.lineCap = 'butt';
  poly(ctx, [fx - 3.5, fy - 1, fx + 4, fy - 1, fx + 4.5, fy + 2, fx - 4, fy + 2], HOOF);
}

export function drawRider(ctx: Ctx, rider: Rider, screenX: number, groundY: number, time: number): void {
  const speed = Math.min(1, Math.abs(rider.vx) / RIDER_MAX_SPEED); // 0..1, vs the default top speed
  const moving = speed > 0.02;
  const phase = rider.gait / STRIDE;
  const trot = speed > 0.6;
  const amp = 0.55 * Math.min(1, speed * 1.4);

  // body bob: two beats per cycle
  const bob = moving ? Math.abs(Math.sin(phase * Math.PI * 2)) * (trot ? 3.5 : 1.8) : 0;
  const breathe = Math.sin(time * 2.1) * 0.6;
  // idle: slow head nods with an occasional deeper dip; a hoof paws now and then
  const nod = moving ? Math.sin(phase * Math.PI * 4) * 0.06 : Math.sin(time * 0.9) * 0.12 + Math.max(0, Math.sin(time * 0.37) - 0.8) * 1.5;
  const paw = moving ? 0 : Math.max(0, Math.sin(time * 1.3) - 0.85) * 5;

  ctx.save();
  ctx.translate(screenX, groundY);
  ctx.globalAlpha = 0.28;
  ellipse(ctx, 0, 0, 44, 5, '#2c2416');
  ctx.globalAlpha = 1;
  ctx.scale(rider.facing, 1);

  // hoof dust when moving fast
  if (speed > 0.4) {
    for (let i = 0; i < 5; i++) {
      const t = (phase * 2 + i / 5) % 1;
      ctx.globalAlpha = (1 - t) * 0.3 * speed;
      circle(ctx, -30 - t * 30, -4 - t * 10, 4 + t * 8, '#cdb48a');
    }
    ctx.globalAlpha = 1;
  }

  // walk is a 4-beat gait; trot moves diagonal pairs together
  const off = trot ? { lh: 0, rf: 0, rh: 0.5, lf: 0.5 } : { lh: 0, lf: 0.25, rh: 0.5, rf: 0.75 };
  const hipY = -40 - bob;
  const pose = (o: number, hipX: number, front: boolean, lift = 0) =>
    moving ? legPose(hipX, hipY, phase + o, amp, front, 0) : legPose(hipX, hipY, 0.5, 0.02, front, lift);

  // far-side legs
  drawLeg(ctx, pose(off.rh, -20, false), COAT_FAR, true);
  drawLeg(ctx, pose(off.rf, 20, true), COAT_FAR, true);

  ctx.translate(0, -bob);

  // tail
  const swish = moving ? Math.sin(phase * Math.PI * 2) * 0.25 - speed * 0.5 : Math.sin(time * 1.7) * 0.3;
  ctx.save();
  ctx.translate(-32, -50);
  ctx.rotate(0.35 + swish);
  ctx.fillStyle = MANE;
  ctx.beginPath();
  ctx.moveTo(0, -3);
  ctx.quadraticCurveTo(-12, 8, -8, 34);
  ctx.quadraticCurveTo(-2, 30, 4, 4);
  ctx.fill();
  ctx.restore();

  // body
  ellipse(ctx, 0, -46, 32, 14 + breathe * 0.3, COAT);
  ellipse(ctx, -20, -47, 15, 14, COAT);
  ellipse(ctx, 21, -45, 14, 14, COAT);
  ellipse(ctx, 2, -39, 24, 5, COAT_DARK); // belly shading
  ellipse(ctx, -4, -55, 24, 4.5, '#a26d43'); // sunlit back

  // neck + head (nods)
  ctx.save();
  ctx.translate(24, -52);
  ctx.rotate(nod);
  poly(ctx, [-12, -2, 10, 12, 26, -14, 10, -32], COAT);
  ellipse(ctx, 21, -22, 8.5, 8, COAT); // cheek
  ctx.save();
  ctx.translate(20, -24);
  ctx.rotate(0.95);
  ellipse(ctx, 11, 0, 17, 8, COAT);
  ellipse(ctx, 24, 1, 7, 6.5, COAT_DARK); // muzzle
  circle(ctx, 27, -1, 1.3, '#1a1410'); // nostril
  line(ctx, 22, 5, 29, 4, '#3a2418', 1);
  ctx.restore();
  circle(ctx, 20, -26, 1.8, '#1a1410'); // eye
  poly(ctx, [12, -30, 15, -41, 19, -30], COAT_DARK); // ear
  ctx.fillStyle = MANE;
  ctx.beginPath();
  ctx.moveTo(15, -32);
  ctx.quadraticCurveTo(0, -24, -13, -3);
  ctx.lineTo(-8, 0);
  ctx.quadraticCurveTo(2, -18, 13, -27);
  ctx.fill();
  // forelock
  poly(ctx, [15, -32, 20, -30, 17, -25], MANE);
  // bridle + reins
  line(ctx, 17, -27, 30, -12, '#3a2a1c', 1.2);
  line(ctx, 30, -12, -18, -10, '#3a2a1c', 1);
  ctx.restore();

  // near-side legs (drawn in the un-bobbed frame so hooves stay on the ground)
  ctx.translate(0, bob);
  drawLeg(ctx, pose(off.lh, -22, false), COAT, false);
  drawLeg(ctx, pose(off.lf, 18, true, paw * 0.3), COAT, false);
  ctx.translate(0, -bob);

  // saddle cloth + saddle
  poly(ctx, [-16, -60, 12, -60, 14, -42, -18, -42], '#2f4f86');
  poly(ctx, [-18, -44, 14, -44, 14, -41, -18, -41], '#d8b64a');
  poly(ctx, [-10, -62, 8, -62, 6, -56, -8, -56], '#5a3a22');

  drawMonarch(ctx, speed, time, moving);
  ctx.restore();
}

function drawMonarch(ctx: Ctx, speed: number, time: number, moving: boolean): void {
  const sway = moving ? 0 : Math.sin(time * 1.1) * 0.8;
  ctx.save();
  ctx.translate(0, -60);
  ctx.rotate(speed * 0.12);

  // cloak streams behind with speed
  const flow = 8 + speed * 22 + Math.sin(time * 5) * (1 + speed * 2);
  const tipY = 4 - speed * 6;
  ctx.fillStyle = '#9a2a2e';
  ctx.beginPath();
  ctx.moveTo(-3, -26);
  ctx.quadraticCurveTo(-8 - flow * 0.4, -12, -10 - flow, tipY);
  ctx.lineTo(-6, 6);
  ctx.quadraticCurveTo(-4, -10, 3, -24);
  ctx.fill();
  poly(ctx, [-10 - flow, tipY, -6, 6, -7, 3, -9 - flow, tipY - 3], '#e9e1d2'); // ermine trim

  // leg + boot
  ctx.lineCap = 'round';
  line(ctx, 0, 0, 9, 8, '#4a3a5a', 5);
  line(ctx, 9, 8, 7, 18, '#4a3a5a', 4.5);
  ctx.lineCap = 'butt';
  poly(ctx, [4, 16, 11, 16, 13, 21, 4, 21], '#2e2018');

  // torso + belt
  poly(ctx, [-6, 2, 7, 2, 5 + sway * 0.2, -24, -4 + sway * 0.2, -24], '#2f4f86');
  poly(ctx, [-6, 2, 7, 2, 6, -3, -6, -3], '#6b4a2c');
  circle(ctx, 1, -1, 1.5, '#d8b64a');
  // arm to the reins
  ctx.lineCap = 'round';
  line(ctx, 3, -20, 12, -10, '#2f4f86', 4);
  line(ctx, 12, -10, 20, -12, '#e0b48e', 3);
  ctx.lineCap = 'butt';

  // head, hair, crown
  const hx = 1 + sway * 0.3;
  circle(ctx, hx, -30, 6, '#e3b893');
  ctx.fillStyle = '#4a3222';
  ctx.beginPath();
  ctx.arc(hx - 1, -31, 6, Math.PI * 0.9, Math.PI * 1.9);
  ctx.fill();
  poly(ctx, [hx - 6, -34, hx + 6, -34, hx + 6, -39, hx + 4, -37, hx + 2, -41, hx, -37, hx - 2, -41, hx - 4, -37, hx - 6, -39], '#e8c14a');
  circle(ctx, hx, -35.5, 1, '#b8323a');
  ctx.restore();
}
