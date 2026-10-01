// Composes the world part of a frame: backdrop → fields → plots & buildings →
// people → rider → foreground → daylight tint, sky behind it all (sky.ts) →
// world-anchored labels. Screen UI (HUD, menu,
// touch buttons) is drawn separately by main.ts in its own coordinate space.

import { chapelBell } from '../game/daynight';
import { employees } from '../game/people';
import type { Worker } from '../game/worker';
import { laidOut, onSite, upgrading } from '../game/site';
import { crossings, streetOf, streetRange } from '../game/streets';
import { canUpgrade, crossroadAt, getBuilding, plotAt, type Building, type World } from '../game/world';
import { drawBackground, drawForeground, drawHaze, drawSideRoad, drawStreetEnds, type View } from './background';
import { drawOtherGround, eyeOf, standingOn, TREE_LINE_DIST } from './plane';
import { BUILDING_ART, type DrawArgs } from './buildings';
import { drawConstruction, drawConstructionBehind, drawConstructionFront, drawUpgrade } from './construction';
import { drawWorker } from './farm';
import { type Figure, figureOf } from './figure';
import { drawLandGrid } from './grid';
import { drawQuarries, drawTrees } from './nature';
import { groundX } from './ground';
import { drawSkyBehind, lightAt, tintLand } from './sky';
import { drawRider } from './horse';
import { drawVillager, walker } from './people';
import { drawBuildingLabel, drawCompletionEffect, drawPlotGlow, drawPlotPrompt, drawProgress } from './ui';
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
  /** How to upgrade the building the rider is at, e.g. "Press ↓ or Space to upgrade". */
  upgradeLabel: string;
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
  // the rest of the village on the plane: the other streets' roads and fields, then everything standing
  // on them that is further off than this street's woods; the haze of distance over it
  drawOtherGround(ctx, world, eye);
  const elsewhere = standingOn(ctx, world, eye);
  for (const o of elsewhere) if (o.z >= TREE_LINE_DIST) o.draw();
  drawHaze(ctx, v);
  // a road still being laid at a crossroads
  for (const b of world.buildings) {
    const x = world.plots[b.plotIndex].x;
    if (b.type === 'intersection' && b.status !== 'done' && onScreen(x)) drawSideRoad(ctx, v, x, 0.15 + 0.85 * b.progress);
  }
  // the woods and the quarries along the tree line, behind everything on the street
  drawQuarries(ctx, camX, viewW);
  drawTrees(ctx, world, camX, viewW);

  /** Screen x of something standing on the ground at world x and depth y (ground.ts). */
  const onGround = (x: number, y: number) => groundX(x - camX, y, viewW / 2);
  const bell = chapelBell(world).angle;
  const args = (b: Building): DrawArgs => ({
    x: world.plots[b.plotIndex].x - camX,
    base: BASE,
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
    const x = b ? world.plots[b.plotIndex].x : 0;
    return b && onScreen(x + p.job!.worker.dx, 300) ? [{ w: p.job!.worker, fig: figureOf(p), x }] : [];
  });
  /** Draw workers whose y satisfies `pred` (depth decides which layer they are in). */
  const farmers = (pred: (y: number) => boolean) => {
    for (const { w, fig, x } of atWork) if (pred(w.y)) drawAtWork(w, fig, x);
  };
  // they walk on the ground, so they follow its perspective like the fields do
  const drawAtWork = (w: Worker, fig: Figure, x: number) => drawWorker(ctx, w, fig, groundX(x + w.dx - camX, w.y, viewW / 2), w.y, world.time);
  // the unemployed and the animals stroll the street, each at their own depth
  const strollers = [...world.people.filter((p) => !p.job), ...world.animals];

  // things that spread behind buildings (farm fields)
  for (const b of world.buildings) {
    if (!onScreen(world.plots[b.plotIndex].x, 400)) continue;
    const a = args(b);
    if (b.status === 'done') BUILDING_ART[b.type].behind?.(ctx, a);
    else drawConstructionBehind(ctx, b.type, a, b.progress);
  }
  // farmers out in the back fields are hidden by the farmhouse when behind it
  farmers((y) => y < BASE - 4);

  // empty plot markers
  for (const p of world.plots) {
    if (p.off || p.buildingId !== null || !onScreen(p.x)) continue;
    plotMarker(ctx, p.x - camX, BASE, p.index);
    if (!world.menu && plotAt(world, world.rider.x) === p) drawPlotGlow(ctx, p.x - camX, BASE);
  }

  // buildings
  for (const b of world.buildings) {
    if (!onScreen(world.plots[b.plotIndex].x)) continue;
    const a = args(b);
    if (upgrading(b)) drawUpgrade(ctx, b.type, a, b.progress);
    else if (b.status === 'done') BUILDING_ART[b.type].draw(ctx, a);
    else drawConstruction(ctx, b.type, a, b.progress);
  }
  // a crossroads' fingerpost also stands on the street its road leads to
  for (const c of crossings(world)) {
    const b = getBuilding(world, c.buildingId);
    if (b && world.plots[b.plotIndex].x !== c.x && onScreen(c.x)) BUILDING_ART.intersection.draw(ctx, { ...args(b), x: c.x - camX });
  }

  // land in front of the road (farm front fields)
  for (const b of world.buildings) {
    if (!onScreen(world.plots[b.plotIndex].x, 300)) continue;
    const a = args(b);
    if (b.status === 'done') BUILDING_ART[b.type].front?.(ctx, a);
    else drawConstructionFront(ctx, b.type, a, b.progress);
  }

  // everyone on the street and the land in front of it, far to near, so
  // whoever stands nearer the viewer is drawn over whoever is behind them
  const standing: Array<{ y: number; draw: () => void }> = [
    ...atWork.filter(({ w }) => w.y >= BASE - 4).map(({ w, fig, x }) => ({ y: w.y, draw: () => drawAtWork(w, fig, x) })),
    ...strollers
      .filter((who) => onScreen(who.stroll.x))
      .map((who) => ({ y: who.stroll.y, draw: () => drawVillager(ctx, walker(who), onGround(who.stroll.x, who.stroll.y), who.stroll.y, world.time) })),
    { y: ROAD_Y, draw: () => drawRider(ctx, world.rider, onGround(world.rider.x, ROAD_Y), ROAD_Y, world.time) },
    // nearer things on the other streets (where they run past this one): sorted in by where they stand on screen
    ...elsewhere.filter((o) => o.z < TREE_LINE_DIST),
  ];
  for (const s of standing.sort((a, b) => a.y - b.y)) s.draw();

  drawForeground(ctx, v);
  // daylight: tint the land, then put the sky behind it
  const light = lightAt(world);
  tintLand(ctx, v, light);
  drawSkyBehind(ctx, v, light);
  drawGrade(ctx, viewW, sv.top, sv.bottom);
  if (sv.showGrid) drawLandGrid(ctx, world, camX, viewW);

  // world-anchored UI
  for (const b of world.buildings) {
    const sx = world.plots[b.plotIndex].x - camX;
    if (!onScreen(world.plots[b.plotIndex].x)) continue;
    if (b.site) drawProgress(ctx, world, b, sx, BASE - BUILDING_ART[b.type].height - 20, k);
    else if (b.completedAt !== null) drawCompletionEffect(ctx, sx, BASE, BUILDING_ART[b.type].height, world.time - b.completedAt, b.id);
  }
  const plot = plotAt(world, world.rider.x);
  if (plot && !world.menu) {
    const sx = plot.x - camX;
    const b = getBuilding(world, plot.buildingId);
    if (!b) drawPlotPrompt(ctx, sx, BASE, world.time, sv.promptLabel, k);
    else if (b.status === 'done' && !b.site) {
      const turn = crossroadAt(world) ? sv.turnLabel : null;
      drawBuildingLabel(ctx, world, b, sx, BASE - BUILDING_ART[b.type].height - 18, k, viewW, canUpgrade(b) ? sv.upgradeLabel : null, turn);
    }
  }
}

/** A little stake with a pennant marks each free building plot. */
function plotMarker(ctx: Ctx, x: number, base: number, index: number): void {
  rect(ctx, x - 1.5, base - 26, 3, 26, '#6b4c30');
  const col = index % 2 ? '#c9a24a' : '#b8453a';
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(x + 1.5, base - 26);
  ctx.lineTo(x + 14, base - 22);
  ctx.lineTo(x + 1.5, base - 18);
  ctx.fill();
  ctx.globalAlpha = 0.5;
  rect(ctx, x - 40, base - 1, 80, 1.5, '#e9dcb8');
  ctx.globalAlpha = 1;
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
