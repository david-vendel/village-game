// The view turned around on the street (R, or the touch button): the camera stands as far behind
// the street as it normally stands in front of it and looks the other way, across the road at the
// land in front of it. This street's own lots are then behind the camera. The road and the grass
// along it are this street's usual ground, mirrored; everything standing (the rider, the people on
// the road, the trees and fields beyond, the other streets) is projected on the plane like any
// other street (plane.ts, its eye turned).

import { GROUND_PILE_Y } from '../game/piles';
import { groundPoint, streetOf } from '../game/streets';
import type { World } from '../game/world';
import { flushEmissive } from './assets';
import { alongStreet, drawBackground, drawForeground, drawHaze, drawStreetEnds, type View } from './background';
import { groundX, viewRatio, viewY } from './ground';
import { drawRider } from './horse';
import { drawGroundPile } from './piles';
import { BUILDING_LINE_DIST, drawOtherGround, eyeOf, type Standing, standingAt, standingOn, TREE_LINE_DIST } from './plane';
import { roadShown } from './roads';
import { drawGrade, type SceneView } from './scene';
import { scene3d } from './scene3d';
import { drawSkyBehind, lightAt, tintLand } from './sky';
import { type Ctx, GROUND_Y, ROAD_Y } from './util';
import { snowfall, snowOnLand } from './winter';

const BASE = GROUND_Y + 4;

export function drawTurnedScene(ctx: Ctx, world: World, sv: SceneView): void {
  const { camX, width: viewW } = sv;
  const eye = eyeOf(world, camX, viewW, true);
  const along = eye.at.x * eye.dir.x + eye.at.y * eye.dir.y;
  const v: View = { camX, along, turn: Math.atan2(eye.dir.y, eye.dir.x) / (Math.PI / 2), turned: true, width: viewW, top: sv.top, bottom: sv.bottom, time: world.time };
  drawBackground(ctx, v);
  alongStreet(ctx, v, () => drawStreetEnds(ctx, v, roadShown(world, eye.street)));
  drawOtherGround(ctx, world, eye);

  const elsewhere = standingOn(ctx, world, eye);
  const light = lightAt(world);
  // what lies along this street comes out mirrored: world x further on is further left
  const onGround = (x: number, y: number) => viewW - groundX(x - camX, y, viewW / 2);
  const atDepth = (sx: number, y: number, draw: () => void) => {
    const r = viewRatio(y);
    ctx.save();
    ctx.translate(sx, viewY(y));
    ctx.scale(r, r);
    draw();
    ctx.restore();
  };
  // advanced graphics: the other streets' 3D buildings (this street's are behind the camera)
  const gfx = scene3d(ctx, world, eye, { camX, viewW, top: sv.top, bottom: sv.bottom, base: BASE, light, atDepth, onGround });
  /** Something on this street, seen from behind it: the art faces the other way. */
  const here = (x: number, y: number, width: number, draw: () => void) =>
    standingAt(ctx, eye, groundPoint(world, x, y), width, () => {
      ctx.scale(-1, 1);
      draw();
    });
  const own = [
    here(world.rider.x, ROAD_Y, 60, () => drawRider(ctx, world.rider, 0, 0, world.time)),
    ...world.piles.filter((p) => streetOf(p.x) === eye.street).map((p) => here(p.x, GROUND_PILE_Y, 30, () => drawGroundPile(ctx, p, 0, 0))),
  ].filter((s): s is Standing => s !== null);
  const all = [...elsewhere, ...own];

  // far to near: what is beyond the road by distance, hazed beyond the tree line…
  const behind = [...all.filter((o) => o.z >= BUILDING_LINE_DIST), ...gfx.behind].sort((a, b) => b.z - a.z);
  let hazed = false;
  for (const o of behind) {
    if (!hazed && o.z < TREE_LINE_DIST) {
      drawHaze(ctx, v);
      hazed = true;
    }
    o.draw();
  }
  if (!hazed) drawHaze(ctx, v);
  // …then the road and what is near, by where it stands on screen
  const standing: Array<{ y: number; draw: () => void }> = [...all.filter((o) => o.z < BUILDING_LINE_DIST), ...gfx.standing];
  for (const s of standing.sort((a, b) => a.y - b.y)) s.draw();

  alongStreet(ctx, v, () => drawForeground(ctx, v));
  snowOnLand(ctx, world, viewW, sv.top, sv.bottom);
  tintLand(ctx, v, light);
  flushEmissive(ctx, light.night);
  gfx.drawLights();
  drawSkyBehind(ctx, v, light);
  snowfall(ctx, world, viewW, sv.top, sv.bottom);
  drawGrade(ctx, viewW, sv.top, sv.bottom);
}
