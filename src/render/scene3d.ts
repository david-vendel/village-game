// The advanced graphics' part of a frame (app/graphics.ts): buildings in 3D
// (world3d.ts) on this street and the others, their lights and smoke
// (life3d.ts), and the showroom of art tests with the building numbers
// (showroom.ts). scene.ts calls this layer at fixed points of its draw order;
// with advanced graphics off it draws nothing and every building is 2D art.
// Graphics work changes this file, not scene.ts.

import { EYE_DIST } from '../game/layout';
import type { Building, World } from '../game/world';
import type { DrawArgs } from './buildings';
import { drawSitePiles } from './construction';
import { building3d, flushGlows, overlay3d } from './life3d';
import { BUILDING_LINE_DIST, elsewhere3d, type Eye } from './plane';
import { drawBuildingNumbers, drawShowroom, EASEL_Y, showroomEasels } from './showroom';
import type { Light } from './sky';
import type { Ctx } from './util';
import { draw3d, has3d, height3d, nearestFootY, ready3d } from './world3d';

type Item = { y: number; draw: () => void };

export interface Layer3d {
  /** Other streets' 3D buildings behind this street's buildings, to sort in with the far scenery by distance. */
  behind: Array<Item & { z: number }>;
  /** Drawn among the people by where they stand on screen: other streets' buildings in front, the showroom's easels. */
  standing: Item[];
  /** Takes this street's building if it is drawn in 3D (then drawBuildings draws it); false: draw its 2D art. */
  take(b: Building, a: DrawArgs): boolean;
  /** Right after this street's 2D buildings: the 3D ones in one pass, then the showroom. */
  drawBuildings(): void;
  /** After the land is tinted for the time of day: lit windows, lanterns, fires. */
  drawLights(): void;
  /** World-anchored labels: each building's number (with the showroom), above its top (`top`: how tall it is drawn). */
  drawLabels(top: (b: Building) => number): void;
}

export interface Frame3d {
  camX: number;
  viewW: number;
  top: number;
  bottom: number;
  /** The line this street's buildings stand on (world y). */
  base: number;
  light: Light;
  /** Draw a picture made for the game's camera standing at depth y (scene.ts). */
  atDepth: (sx: number, y: number, draw: () => void) => void;
  /** Screen x of something standing on the ground at world x and depth y. */
  onGround: (x: number, y: number) => number;
}

/** How tall a building stands on screen if it is drawn in 3D (for labels above it), else null. */
export function height3dOf(b: Building): number | null {
  return has3d(b.type) ? height3d(b.type, b.id * 97, (b.size ?? 1) as 1 | 2 | 3) : null;
}

export function scene3d(ctx: Ctx, world: World, eye: Eye, f: Frame3d): Layer3d {
  const { camX, viewW, light } = f;
  const view = () => ({ camX, viewW, top: f.top, bottom: f.bottom, pxPerU: ctx.getTransform().a, phase: light.phase, sunHeight: light.sun, night: light.night, time: world.time });
  const cx = camX + viewW / 2;
  type M3 = ReturnType<typeof building3d>;

  // other streets' 3D buildings (true place and facing), each drawn on its own: those behind this street's
  // buildings at their place among the far scenery (hazed with it beyond the tree line), those in front among
  // the people and pictures by where they stand on screen
  /** One building on another street, drawn on its own (clipped), with its smoke. */
  const drawElsewhere = (m: M3, b: Building) => {
    const at = draw3d(ctx, [m], view(), { clip: true }).get(b.id);
    if (at) overlay3d(ctx, world, b, m, at);
  };
  const behind: Layer3d['behind'] = [];
  const standing: Item[] = [];
  for (const e of elsewhere3d(world, eye)) {
    const m = building3d(world, e.b, { x: cx + e.u, z: EYE_DIST - e.z, rot: e.rot });
    // each on its own, so a well or a tree behind it is drawn first and hidden, one in front drawn after
    if (e.z >= BUILDING_LINE_DIST) behind.push({ z: e.z, y: 0, draw: () => drawElsewhere(m, e.b) });
    // by where its footprint comes nearest
    else standing.push({ y: nearestFootY(m, view()), draw: () => drawElsewhere(m, e.b) });
  }
  // the showroom's scenes on easels in front of the road (dev)
  for (const e of showroomEasels(world, camX, viewW)) standing.push({ y: EASEL_Y, draw: () => f.atDepth(f.onGround(e.x, EASEL_Y), EASEL_Y, () => e.draw(ctx)) });

  // this street's buildings with a 3D model, in one 3D pass; a model still being made (a few a frame)
  // shows its 2D art meanwhile
  const here: Array<{ b: Building; a: DrawArgs; m: M3 }> = [];
  return {
    behind,
    standing,
    take(b, a) {
      if (!has3d(b.type)) return false;
      const m = building3d(world, b);
      if (!ready3d(m)) return false;
      here.push({ b, a, m });
      return true;
    },
    drawBuildings() {
      if (here.length) {
        const at = draw3d(ctx, here.map((e) => e.m), view());
        for (const { b, a, m } of here) {
          if (m.build && !b.demolition) drawSitePiles(ctx, b.type, a);
          const p = at.get(b.id);
          if (p) overlay3d(ctx, world, b, m, p, a);
        }
      }
      // the art experiments standing in the free stretches of the main street (dev)
      drawShowroom(ctx, world, camX, viewW, f.base);
    },
    drawLights() {
      flushGlows(ctx, light.night, world.time);
    },
    drawLabels(top) {
      drawBuildingNumbers(ctx, world, camX, viewW, f.base, top);
    },
  };
}
