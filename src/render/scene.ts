// Composes the world part of a frame: backdrop → fields → plots & buildings →
// people → rider → foreground → daylight tint, sky behind it all (sky.ts) →
// world-anchored labels. Screen UI (HUD, menu,
// touch buttons) is drawn separately by main.ts in its own coordinate space.

import { chapelBell } from '../game/daynight';
import { employees } from '../game/people';
import { GROUND_PILE_Y } from '../game/piles';
import type { Worker } from '../game/worker';
import { laidOut, onSite, upgrading } from '../game/site';
import { crossings, streetOf, streetRange } from '../game/streets';
import { BUILDING_TYPES } from '../game/buildings';
import { blockStartX, crossroadsPlaces, sizeOfBuilding } from '../game/grid';
import { CELL_W, EYE_DIST } from '../game/layout';
import { buildingAt, canDemolish, canUpgrade, crossroadAt, getBuilding, roomToBuild, type Building, type World } from '../game/world';
import { drawBackground, drawForeground, drawHaze, drawSideRoad, drawStreetEnds, type View } from './background';
import { BUILDING_LINE_DIST, distAt, drawOtherGround, elsewhere3d, eyeOf, standingOn, TREE_LINE_DIST } from './plane';
import { flushEmissive } from './assets';
import { BUILDING_ART, drawCrossroadsSign, type DrawArgs } from './buildings';
import { drawBuilding } from './sprites';
import { drawConstruction, drawConstructionBehind, drawConstructionFront, drawDemolition, drawSitePiles, drawUpgrade } from './construction';
import { drawWorker } from './farm';
import { type Figure, figureOf } from './figure';
import { drawBlockGlow, drawLandGrid, drawSitePreview } from './grid';
import { groundX, viewRatio, viewY } from './ground';
import { drawSkyBehind, lightAt, tintLand } from './sky';
import { drawRider } from './horse';
import { drawVillager, walker } from './people';
import { drawGroundPile } from './piles';
import { drawBuildingLabel, drawCompletionEffect, drawDemolitionLabel, drawPlotPrompt, drawProgress } from './ui';
import { type Ctx, GROUND_Y, ROAD_Y, VIEW_H } from './util';
import { building3d, flushGlows, overlay3d } from './life3d';
import { drawBuildingNumbers, drawShowroom, EASEL_Y, showroomEasels } from './showroom';
import { draw3d, has3d, height3d, nearestFootY, ready3d } from './world3d';

const BASE = GROUND_Y + 4;

export function cameraX(world: World, viewW: number): number {
  // always centred on the rider, out to the very end of a street too (past it the grass runs on)
  return world.rider.x - viewW / 2;
}

export interface SceneView {
  camX: number;
  /** Visible width in world units. */
  width: number;
  /** World y at the top of the screen (negative when zoomed out: more sky). */
  top: number;
  /** World y at the bottom of the screen. */
  bottom: number;
  /** Scale for world-anchored labels so they stay readable when zoomed out. */
  labelScale: number;
  /** Text of the "build here" prompt (differs for touch vs keyboard). */
  promptLabel: string;
  /** How to open the menu of a building that can be upgraded, e.g. "Press ↓ or Space to upgrade or destroy". */
  upgradeLabel: string;
  /** How to open the menu of a building that can only be pulled down. */
  destroyLabel: string;
  /** How to turn at a crossroads onto the street crossing this one. */
  turnLabel: string;
  /** Overlay the land grid (debug view). */
  showGrid: boolean;
  /**
   * The mouse in scene units (x from the camera's left edge, y world depth), null when it isn't
   * over the canvas: the grid names the cell under it, and a building shows its info box only
   * under it. Undefined on touch screens (no hover): the building at the rider shows its box.
   */
  hover?: { x: number; y: number } | null;
}

export function drawScene(ctx: Ctx, world: World, sv: SceneView): void {
  const { camX, width: viewW, labelScale: k } = sv;
  // the camera, in front of the street being looked at (plane.ts)
  const eye = eyeOf(world, camX, viewW);
  const along = eye.at.x * eye.dir.x + eye.at.y * eye.dir.y;
  const v: View = { camX, along, turn: Math.atan2(eye.dir.y, eye.dir.x) / (Math.PI / 2), width: viewW, top: sv.top, bottom: sv.bottom, time: world.time };
  drawBackground(ctx, v);
  // a street that ends short: the road stops and the grass runs on
  const street = streetOf(world.rider.x);
  if (street > 0) drawStreetEnds(ctx, v, streetRange(world, street));
  const onScreen = (x: number, margin = 280) => x - camX > -margin && x - camX < viewW + margin;
  // the ground first: the other streets' roads and fields on the plane, and a road still being laid at a crossroads
  drawOtherGround(ctx, world, eye);
  for (const b of world.buildings) {
    const x = b.x;
    if (b.type === 'intersection' && b.status !== 'done' && onScreen(x)) drawSideRoad(ctx, v, x, 0.15 + 0.85 * b.progress);
  }

  /** Screen x of something standing on the ground at world x and depth y (ground.ts). */
  const onGround = (x: number, y: number) => groundX(x - camX, y, viewW / 2);
  const bell = chapelBell(world).angle;
  const args = (b: Building): DrawArgs => ({
    x: b.x - camX,
    base: BASE,
    width: sizeOfBuilding(b).w * CELL_W,
    time: world.time,
    seed: b.id * 97,
    farm: b.farm,
    upgraded: !!b.upgraded,
    stock: b.stock,
    workers: employees(world, b).map((p) => p.job!.worker),
    crew: employees(world, b).map((p) => ({ worker: p.job!.worker, figure: figureOf(p) })),
    onSite: onSite(b),
    laid: laidOut(b),
    vpX: viewW / 2,
    bell: b.type === 'chapel' ? bell : undefined,
    doorOpen: !!b.arriving,
  });
  // people at work, with their workplace's position
  const atWork = world.people.flatMap((p) => {
    const b = p.job && getBuilding(world, p.job.buildingId);
    // builders fetching from a far warehouse can be anywhere along the street
    const x = b ? b.x : 0;
    return b && onScreen(x + p.job!.worker.dx, 300) ? [{ w: p.job!.worker, fig: figureOf(p), x }] : [];
  });
  // they walk on the ground, so they follow its perspective like the fields do
  const drawAtWork = (w: Worker, fig: Figure, x: number) => drawWorker(ctx, w, fig, groundX(x + w.dx - camX, w.y, viewW / 2), viewY(w.y), world.time);
  /** Draw a picture made for the game's camera standing at depth y, where and as big as the drawing camera sees it. */
  const atDepth = (sx: number, y: number, draw: () => void) => {
    const r = viewRatio(y);
    ctx.save();
    ctx.translate(sx, viewY(y));
    ctx.scale(r, r);
    draw();
    ctx.restore();
  };
  // the unemployed and the animals stroll the street, each at their own depth
  const strollers = [...world.people.filter((p) => !p.job), ...world.animals];

  // things that spread behind buildings (farm fields)
  for (const b of world.buildings) {
    if (!onScreen(b.x, 400)) continue;
    const a = args(b);
    if (b.status === 'done') BUILDING_ART[b.type].behind?.(ctx, a);
    else if (!b.demolition) drawConstructionBehind(ctx, b.type, a, b.progress);
  }

  // then everything standing behind this street's buildings, far to near: trees and quarries, the other
  // streets and their people, and this street's people out behind it (in the back fields, at the woods);
  // the haze of distance over what is beyond this street's lots
  const elsewhere = standingOn(ctx, world, eye);
  // other streets' 3D buildings (true place and facing), each drawn on its own: those behind this street's
  // buildings at their place among the far scenery (hazed with it beyond the tree line), those in front among
  // the people and pictures by where they stand on screen
  const light = lightAt(world);
  const view3d = () => ({ camX, viewW, top: sv.top, bottom: sv.bottom, pxPerU: ctx.getTransform().a, phase: light.phase, sunHeight: light.sun, night: light.night, time: world.time });
  const cx = camX + viewW / 2;
  type M3 = ReturnType<typeof building3d>;
  const groups3d = { behind: [] as Array<{ m: M3; b: Building; z: number }>, near: [] as Array<{ m: M3; b: Building }> };
  for (const e of elsewhere3d(world, eye)) {
    const m = building3d(world, e.b, { x: cx + e.u, z: EYE_DIST - e.z, rot: e.rot });
    if (e.z >= BUILDING_LINE_DIST) groups3d.behind.push({ m, b: e.b, z: e.z });
    else groups3d.near.push({ m, b: e.b });
  }
  /** One building on another street, drawn on its own (clipped), with its smoke. */
  const drawElsewhere = (m: M3, b: Building) => {
    const at = draw3d(ctx, [m], view3d(), { clip: true }).get(b.id);
    if (at) overlay3d(ctx, world, b, m, at);
  };
  const behind = [
    ...elsewhere.filter((o) => o.z >= BUILDING_LINE_DIST),
    // each on its own, so a well or a tree behind it is drawn first and hidden, one in front drawn after
    ...groups3d.behind.map(({ m, b, z }) => ({ z, y: 0, draw: () => drawElsewhere(m, b) })),
    ...atWork.filter(({ w }) => w.y < BASE - 4).map(({ w, fig, x }) => ({ z: distAt(w.y), y: w.y, draw: () => drawAtWork(w, fig, x) })),
  ].sort((a, b) => b.z - a.z);
  let hazed = false;
  for (const o of behind) {
    if (!hazed && o.z < TREE_LINE_DIST) {
      drawHaze(ctx, v);
      hazed = true;
    }
    o.draw();
  }
  if (!hazed) drawHaze(ctx, v);

  // the block of three cells the rider has stopped in, gently lit, if something could be built there
  if (!world.menu && Math.abs(world.rider.vx) < 5 && !buildingAt(world, world.rider.x) && roomToBuild(world, world.rider.x)) drawBlockGlow(ctx, world.rider.x, camX, viewW, world.time);
  // where the building chosen in the menu would stand: its cells on the ground, green where it fits
  if (world.menu?.kind === 'build') drawSitePreview(ctx, world, BUILDING_TYPES[world.menu.selection], world.menu.x, camX, viewW);

  // buildings: those with a 3D model in one 3D pass (world3d.ts), the rest as 2D art; a model still
  // being made (a few a frame) shows its 2D art meanwhile
  const in3d: Array<{ b: Building; a: DrawArgs; m: ReturnType<typeof building3d> }> = [];
  for (const b of world.buildings) {
    if (!onScreen(b.x)) continue;
    const a = args(b);
    if (has3d(b.type)) {
      const m = building3d(world, b);
      if (ready3d(m)) {
        in3d.push({ b, a, m });
        continue;
      }
    }
    if (b.demolition && b.demolition.from >= 1) drawDemolition(ctx, b.type, a, b.progress); // one still being built comes down through its stages
    else if (upgrading(b)) drawUpgrade(ctx, b.type, a, b.progress);
    else if (b.status === 'done') drawBuilding(ctx, b.type, a);
    else drawConstruction(ctx, b.type, a, b.progress);
  }
  if (in3d.length) {
    const at = draw3d(ctx, in3d.map((e) => e.m), view3d());
    for (const { b, a, m } of in3d) {
      if (m.build && !b.demolition) drawSitePiles(ctx, b.type, a);
      const p = at.get(b.id);
      if (p) overlay3d(ctx, world, b, m, p, a);
    }
  }
  // the art experiments standing in the free stretches of the main street (dev)
  drawShowroom(ctx, world, camX, viewW, BASE);
  // where a crossroads can be built on this street, a signpost
  for (const x of crossroadsPlaces(world)) if (streetOf(x) === street && onScreen(x)) drawCrossroadsSign(ctx, x - camX, BASE, world.time);
  // a crossroads' fingerpost also stands on the street its road leads to
  for (const c of crossings(world)) {
    const b = getBuilding(world, c.buildingId);
    if (b && b.x !== c.x && onScreen(c.x)) drawBuilding(ctx, 'intersection', { ...args(b), x: c.x - camX });
  }

  // land in front of the road (farm front fields)
  for (const b of world.buildings) {
    if (!onScreen(b.x, 300)) continue;
    const a = args(b);
    if (b.status === 'done') BUILDING_ART[b.type].front?.(ctx, a);
    else if (!b.demolition) drawConstructionFront(ctx, b.type, a, b.progress);
  }

  // everyone on the street and the land in front of it, far to near, so
  // whoever stands nearer the viewer is drawn over whoever is behind them
  const standing: Array<{ y: number; draw: () => void }> = [
    ...atWork.filter(({ w }) => w.y >= BASE - 4).map(({ w, fig, x }) => ({ y: w.y, draw: () => drawAtWork(w, fig, x) })),
    ...strollers
      .filter((who) => onScreen(who.stroll.x))
      .map((who) => ({ y: who.stroll.y, draw: () => atDepth(onGround(who.stroll.x, who.stroll.y), who.stroll.y, () => drawVillager(ctx, walker(who), 0, 0, world.time)) })),
    // what lies on the ground by the road on this street
    ...world.piles
      .filter((p) => streetOf(p.x) === street && onScreen(p.x))
      .map((p) => ({ y: GROUND_PILE_Y, draw: () => atDepth(onGround(p.x, GROUND_PILE_Y), GROUND_PILE_Y, () => drawGroundPile(ctx, p, 0, 0)) })),
    { y: ROAD_Y, draw: () => atDepth(onGround(world.rider.x, ROAD_Y), ROAD_Y, () => drawRider(ctx, world.rider, 0, 0, world.time)) },
    // the showroom's scenes on easels in front of the road (dev)
    ...showroomEasels(world, camX, viewW).map((e) => ({ y: EASEL_Y, draw: () => atDepth(onGround(e.x, EASEL_Y), EASEL_Y, () => e.draw(ctx)) })),
    // nearer things (trees in front, the other streets where they run past this one): sorted in by where they stand on screen
    ...elsewhere.filter((o) => o.z < BUILDING_LINE_DIST),
    // and other streets' 3D buildings in front of this street's, each on its own, by where its footprint comes nearest
    ...groups3d.near.map(({ m, b }) => ({ y: nearestFootY(m, view3d()), draw: () => drawElsewhere(m, b) })),
  ];
  for (const s of standing.sort((a, b) => a.y - b.y)) s.draw();

  drawForeground(ctx, v);
  // daylight: tint the land, then put the sky behind it
  tintLand(ctx, v, light);
  // lights (sprites' emissive layers) shine through the dark
  flushEmissive(ctx, light.night);
  flushGlows(ctx, light.night, world.time);
  drawSkyBehind(ctx, v, light);
  drawGrade(ctx, viewW, sv.top, sv.bottom);
  if (sv.showGrid) drawLandGrid(ctx, world, camX, viewW, sv.hover ?? null);

  // world-anchored UI
  // each building's number over it (with the showroom: to talk about a particular one)
  drawBuildingNumbers(ctx, world, camX, viewW, BASE, drawnHeight);
  for (const b of world.buildings) {
    const sx = b.x - camX;
    if (!onScreen(b.x)) continue;
    if (b.status === 'demolishing') drawDemolitionLabel(ctx, world, b, sx, BASE - BUILDING_ART[b.type].height - 20, k);
    else if (b.site) drawProgress(ctx, world, b, sx, BASE - BUILDING_ART[b.type].height - 20, k);
    else if (b.completedAt !== null) drawCompletionEffect(ctx, sx, BASE, BUILDING_ART[b.type].height, world.time - b.completedAt, b.id);
  }
  if (!world.menu) {
    const b = buildingAt(world, world.rider.x);
    const sx = (b?.x ?? blockStartX(world.rider.x) + CELL_W) - camX;
    // anywhere something fits, once the rider stops, they can build
    if (!b) {
      if (Math.abs(world.rider.vx) < 5 && roomToBuild(world, world.rider.x)) drawPlotPrompt(ctx, sx, BASE, world.time, sv.promptLabel, k);
    }
    // a building's info box: the one under the mouse (on touch screens, the one at the rider)
    const shown = sv.hover === undefined ? b : sv.hover ? buildingUnder(world, camX, sv.hover) : null;
    if (shown && shown.status === 'done' && !shown.site) {
      const here = shown === b;
      const turn = here && crossroadAt(world) ? sv.turnLabel : null;
      const hint = !here ? null : canUpgrade(shown) ? sv.upgradeLabel : canDemolish(shown) ? sv.destroyLabel : null;
      drawBuildingLabel(ctx, world, shown, shown.x - camX, BASE - drawnHeight(shown) - 30, k * 0.8, viewW, hint, turn);
    }
  }
}

/** How tall a building stands on screen: its 3D model's height, or its 2D art's. */
function drawnHeight(b: Building): number {
  return has3d(b.type) ? height3d(b.type, b.id * 97, (b.size ?? 1) as 1 | 2 | 3) : BUILDING_ART[b.type].height;
}

/** The finished building of this street under a point of the scene (its footprint, up to its drawn height). */
function buildingUnder(world: World, camX: number, p: { x: number; y: number }): Building | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of world.buildings) {
    if (b.status !== 'done' || b.type === 'intersection') continue;
    const sx = b.x - camX;
    const half = (sizeOfBuilding(b).w * CELL_W) / 2;
    const d = Math.abs(p.x - sx);
    if (d > half || p.y > BASE + 6 || p.y < BASE - drawnHeight(b) - 10) continue;
    if (d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

/** Warm colour grade + soft vignette for a painterly finish. */
function drawGrade(ctx: Ctx, viewW: number, top: number, bottom: number): void {
  const h = Math.max(VIEW_H, bottom) - top;
  const cy = top + h * 0.5;
  const g = ctx.createRadialGradient(viewW * 0.4, cy - h * 0.05, h * 0.3, viewW * 0.5, cy, Math.max(viewW, h) * 0.85);
  g.addColorStop(0, 'rgba(255,220,160,0)');
  g.addColorStop(1, 'rgba(40,24,10,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, top, viewW, h);
}
