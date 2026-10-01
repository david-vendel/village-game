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
import { blockStartX, sizeOfBuilding } from '../game/grid';
import { BLOCK, CELL_W } from '../game/layout';
import { buildingAt, canDemolish, canUpgrade, crossroadAt, getBuilding, roomToBuild, type Building, type World } from '../game/world';
import { drawBackground, drawForeground, drawHaze, drawSideRoad, drawStreetEnds, type View } from './background';
import { BUILDING_LINE_DIST, distAt, drawOtherGround, eyeOf, standingOn, TREE_LINE_DIST } from './plane';
import { flushEmissive } from './assets';
import { BUILDING_ART, type DrawArgs } from './buildings';
import { drawBuilding } from './sprites';
import { drawConstruction, drawConstructionBehind, drawConstructionFront, drawDemolition, drawUpgrade } from './construction';
import { drawWorker } from './farm';
import { type Figure, figureOf } from './figure';
import { drawLandGrid, drawSitePreview } from './grid';
import { groundX } from './ground';
import { drawSkyBehind, lightAt, tintLand } from './sky';
import { drawRider } from './horse';
import { drawVillager, walker } from './people';
import { drawGroundPile } from './piles';
import { drawBuildingLabel, drawCompletionEffect, drawDemolitionLabel, drawPlotPrompt, drawProgress } from './ui';
import { type Ctx, GROUND_Y, rect, ROAD_Y, VIEW_H } from './util';

const BASE = GROUND_Y + 4;

export function cameraX(world: World, viewW: number): number {
  const target = world.rider.x - viewW / 2 + world.rider.facing * viewW * 0.08;
  // the camera stays on the rider's street (and on a street shorter than the view, in its middle)
  const { min, max } = streetRange(world, streetOf(world.rider.x));
  const lo = min - 60;
  const hi = max + 60 - viewW;
  return lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, target));
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
  });
  // people at work, with their workplace's position
  const atWork = world.people.flatMap((p) => {
    const b = p.job && getBuilding(world, p.job.buildingId);
    // builders fetching from a far warehouse can be anywhere along the street
    const x = b ? b.x : 0;
    return b && onScreen(x + p.job!.worker.dx, 300) ? [{ w: p.job!.worker, fig: figureOf(p), x }] : [];
  });
  // they walk on the ground, so they follow its perspective like the fields do
  const drawAtWork = (w: Worker, fig: Figure, x: number) => drawWorker(ctx, w, fig, groundX(x + w.dx - camX, w.y, viewW / 2), w.y, world.time);
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
  const behind = [
    ...elsewhere.filter((o) => o.z >= BUILDING_LINE_DIST),
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

  // a little stake at every cell 3n + 1 along this street where something could be built
  if (!world.menu) {
    const { min, max } = streetRange(world, street);
    for (let at = blockStartX(Math.max(min, camX - 100)); at < Math.min(max, camX + viewW + 100); at += BLOCK * CELL_W) {
      if (roomToBuild(world, at)) blockMarker(ctx, onGround(at, BASE), BASE);
    }
  }
  // where the building chosen in the menu would stand: its cells on the ground, green where it fits
  if (world.menu?.kind === 'build') drawSitePreview(ctx, world, BUILDING_TYPES[world.menu.selection], world.menu.x, camX, viewW);

  // buildings
  for (const b of world.buildings) {
    if (!onScreen(b.x)) continue;
    const a = args(b);
    if (b.demolition && b.demolition.from >= 1) drawDemolition(ctx, b.type, a, b.progress); // one still being built comes down through its stages
    else if (upgrading(b)) drawUpgrade(ctx, b.type, a, b.progress);
    else if (b.status === 'done') drawBuilding(ctx, b.type, a);
    else drawConstruction(ctx, b.type, a, b.progress);
  }
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
      .map((who) => ({ y: who.stroll.y, draw: () => drawVillager(ctx, walker(who), onGround(who.stroll.x, who.stroll.y), who.stroll.y, world.time) })),
    // what lies on the ground by the road on this street
    ...world.piles
      .filter((p) => streetOf(p.x) === street && onScreen(p.x))
      .map((p) => ({ y: GROUND_PILE_Y, draw: () => drawGroundPile(ctx, p, onGround(p.x, GROUND_PILE_Y), GROUND_PILE_Y) })),
    { y: ROAD_Y, draw: () => drawRider(ctx, world.rider, onGround(world.rider.x, ROAD_Y), ROAD_Y, world.time) },
    // nearer things (trees in front, the other streets where they run past this one): sorted in by where they stand on screen
    ...elsewhere.filter((o) => o.z < BUILDING_LINE_DIST),
  ];
  for (const s of standing.sort((a, b) => a.y - b.y)) s.draw();

  drawForeground(ctx, v);
  // daylight: tint the land, then put the sky behind it
  const light = lightAt(world);
  tintLand(ctx, v, light);
  // lights (sprites' emissive layers) shine through the dark
  flushEmissive(ctx, light.night);
  drawSkyBehind(ctx, v, light);
  drawGrade(ctx, viewW, sv.top, sv.bottom);
  if (sv.showGrid) drawLandGrid(ctx, world, camX, viewW);

  // world-anchored UI
  for (const b of world.buildings) {
    const sx = b.x - camX;
    if (!onScreen(b.x)) continue;
    if (b.status === 'demolishing') drawDemolitionLabel(ctx, world, b, sx, BASE - BUILDING_ART[b.type].height - 20, k);
    else if (b.site) drawProgress(ctx, world, b, sx, BASE - BUILDING_ART[b.type].height - 20, k);
    else if (b.completedAt !== null) drawCompletionEffect(ctx, sx, BASE, BUILDING_ART[b.type].height, world.time - b.completedAt, b.id);
  }
  if (!world.menu) {
    const b = buildingAt(world, world.rider.x);
    const sx = (b?.x ?? blockStartX(world.rider.x)) - camX;
    // anywhere something fits, once the rider stops, they can build
    if (!b) {
      if (Math.abs(world.rider.vx) < 5 && roomToBuild(world, world.rider.x)) drawPlotPrompt(ctx, sx, BASE, world.time, sv.promptLabel, k);
    } else if (b.status === 'done' && !b.site) {
      const turn = crossroadAt(world) ? sv.turnLabel : null;
      drawBuildingLabel(ctx, world, b, sx, BASE - BUILDING_ART[b.type].height - 18, k, viewW, canUpgrade(b) ? sv.upgradeLabel : canDemolish(b) ? sv.destroyLabel : null, turn);
    }
  }
}

/** A little stake with a pennant: a building could start here (a cell 3n + 1). */
function blockMarker(ctx: Ctx, x: number, base: number): void {
  rect(ctx, x - 1, base - 18, 2, 18, '#6b4c30');
  ctx.fillStyle = '#c9a24a';
  ctx.beginPath();
  ctx.moveTo(x + 1, base - 18);
  ctx.lineTo(x + 10, base - 15);
  ctx.lineTo(x + 1, base - 12);
  ctx.fill();
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
