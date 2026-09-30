// Composes the world part of a frame: backdrop → fields → plots & buildings →
// people → rider → foreground → daylight tint, sky behind it all (sky.ts) →
// world-anchored labels. Screen UI (HUD, menu,
// touch buttons) is drawn separately by main.ts in its own coordinate space.

import { employees } from '../game/people';
import { onSite } from '../game/site';
import { getBuilding, plotAt, WORLD_WIDTH, type Building, type World } from '../game/world';
import { drawBackground, drawForeground, type View } from './background';
import { BUILDING_ART, type DrawArgs } from './buildings';
import { drawConstruction, drawConstructionBehind, drawConstructionFront } from './construction';
import { drawWorker } from './farm';
import { drawLandGrid } from './grid';
import { groundX } from './ground';
import { drawSkyBehind, lightAt, tintLand } from './sky';
import { drawRider } from './horse';
import { drawVillager, walker } from './people';
import { drawBuildingLabel, drawCompletionEffect, drawPlotPrompt, drawProgress } from './ui';
import { type Ctx, GROUND_Y, rect, ROAD_Y, VIEW_H } from './util';

const BASE = GROUND_Y + 4;

export function cameraX(world: World, viewW: number): number {
  const target = world.rider.x - viewW / 2 + world.rider.facing * viewW * 0.08;
  return Math.max(0, Math.min(WORLD_WIDTH - viewW, target));
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
  /** Overlay the land grid (debug view). */
  showGrid: boolean;
}

export function drawScene(ctx: Ctx, world: World, sv: SceneView): void {
  const { camX, width: viewW, labelScale: k } = sv;
  const v: View = { camX, width: viewW, top: sv.top, bottom: sv.bottom, time: world.time };
  drawBackground(ctx, v);

  const onScreen = (x: number, margin = 280) => x - camX > -margin && x - camX < viewW + margin;
  /** Screen x of something standing on the ground at world x and depth y (ground.ts). */
  const onGround = (x: number, y: number) => groundX(x - camX, y, viewW / 2);
  const args = (b: Building): DrawArgs => ({
    x: world.plots[b.plotIndex].x - camX,
    base: BASE,
    time: world.time,
    seed: b.id * 97,
    farm: b.farm,
    stock: b.stock,
    workers: employees(world, b).map((p) => p.job!.worker),
    onSite: onSite(b),
    vpX: viewW / 2,
  });
  // people at work, with their workplace's position
  const atWork = world.people.flatMap((p) => {
    const b = p.job && getBuilding(world, p.job.buildingId);
    // builders fetching from a far warehouse can be anywhere along the street
    const x = b ? world.plots[b.plotIndex].x : 0;
    return b && onScreen(x + p.job!.worker.dx, 300) ? [{ w: p.job!.worker, role: p.job!.role, who: p, x }] : [];
  });
  /** Draw workers whose y satisfies `pred` (depth decides which layer they are in). */
  const farmers = (pred: (y: number) => boolean) => {
    for (const { w, role, who, x } of atWork) {
      // they walk on the ground, so they follow its perspective like the fields do
      if (pred(w.y)) drawWorker(ctx, w, role, who, groundX(x + w.dx - camX, w.y, viewW / 2), w.y, world.time);
    }
  };
  // the unemployed and the animals stroll the street (odd ids on the far side)
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
    if (p.buildingId !== null || !onScreen(p.x)) continue;
    plotMarker(ctx, p.x - camX, BASE, p.index);
  }

  // buildings
  for (const b of world.buildings) {
    if (!onScreen(world.plots[b.plotIndex].x)) continue;
    const a = args(b);
    if (b.status === 'done') BUILDING_ART[b.type].draw(ctx, a);
    else drawConstruction(ctx, b.type, a, b.progress);
  }

  // land in front of the road (farm front fields)
  for (const b of world.buildings) {
    if (!onScreen(world.plots[b.plotIndex].x, 300)) continue;
    const a = args(b);
    if (b.status === 'done') BUILDING_ART[b.type].front?.(ctx, a);
    else drawConstructionFront(ctx, b.type, a, b.progress);
  }
  farmers((y) => y >= BASE - 4 && y < ROAD_Y);

  // villagers behind the rider (odd ids walk the far side of the street)
  for (const who of strollers) {
    const x = who.stroll.x;
    if (who.id % 2 === 1 && onScreen(x)) drawVillager(ctx, walker(who), onGround(x, ROAD_Y - 14), ROAD_Y - 14, world.time);
  }
  drawRider(ctx, world.rider, onGround(world.rider.x, ROAD_Y), ROAD_Y, world.time);
  for (const who of strollers) {
    const x = who.stroll.x;
    if (who.id % 2 === 0 && onScreen(x)) drawVillager(ctx, walker(who), onGround(x, ROAD_Y + 12), ROAD_Y + 12, world.time);
  }
  farmers((y) => y >= ROAD_Y);

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
    if (b.status === 'constructing') drawProgress(ctx, world, b, sx, BASE - BUILDING_ART[b.type].height - 20, k);
    else if (b.completedAt !== null) drawCompletionEffect(ctx, sx, BASE, BUILDING_ART[b.type].height, world.time - b.completedAt, b.id);
  }
  const plot = plotAt(world, world.rider.x);
  if (plot && !world.menu) {
    const sx = plot.x - camX;
    const b = getBuilding(world, plot.buildingId);
    if (!b) drawPlotPrompt(ctx, sx, BASE, world.time, sv.promptLabel, k);
    else if (b.status === 'done') drawBuildingLabel(ctx, world, b, sx, BASE - BUILDING_ART[b.type].height - 18, k, viewW);
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
