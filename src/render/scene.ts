// Composes one frame: backdrop → fields → plots & buildings → people →
// rider → foreground → UI.

import { BUILDINGS } from '../game/buildings';
import { getBuilding, plotAt, WORLD_WIDTH, type World } from '../game/world';
import { drawBackground, drawForeground, type View } from './background';
import { BUILDING_ART, type DrawArgs } from './buildings';
import { drawConstruction, drawConstructionBehind } from './construction';
import { drawRider } from './horse';
import { drawVillager } from './people';
import { drawBuildingLabel, drawBuildMenu, drawCompletionEffect, drawHud, drawPlotPrompt, drawProgress, drawToasts, type Toast } from './ui';
import { type Ctx, GROUND_Y, rect, ROAD_Y, VIEW_H } from './util';

const BASE = GROUND_Y + 4;

export function cameraX(world: World, viewW: number): number {
  const target = world.rider.x - viewW / 2 + world.rider.facing * viewW * 0.08;
  return Math.max(0, Math.min(WORLD_WIDTH - viewW, target));
}

export function drawScene(ctx: Ctx, world: World, viewW: number, camX: number, toasts: Toast[]): void {
  const v: View = { camX, width: viewW, time: world.time };
  drawBackground(ctx, v);

  const onScreen = (x: number, margin = 280) => x - camX > -margin && x - camX < viewW + margin;
  const args = (plotIndex: number, seed: number): DrawArgs => ({
    x: world.plots[plotIndex].x - camX,
    base: BASE,
    time: world.time,
    seed,
  });

  // things that spread behind buildings (farm fields)
  for (const b of world.buildings) {
    if (!onScreen(world.plots[b.plotIndex].x, 400)) continue;
    const a = args(b.plotIndex, b.id * 97);
    if (b.status === 'done') BUILDING_ART[b.type].behind?.(ctx, a);
    else drawConstructionBehind(ctx, b.type, a, b.progress);
  }

  // empty plot markers
  for (const p of world.plots) {
    if (p.buildingId !== null || !onScreen(p.x)) continue;
    plotMarker(ctx, p.x - camX, BASE, p.index);
  }

  // buildings
  for (const b of world.buildings) {
    if (!onScreen(world.plots[b.plotIndex].x)) continue;
    const a = args(b.plotIndex, b.id * 97);
    if (b.status === 'done') BUILDING_ART[b.type].draw(ctx, a);
    else drawConstruction(ctx, b.type, a, b.progress);
  }

  // villagers behind the rider (odd ids walk the far side of the street)
  for (const vl of world.villagers) {
    if (vl.id % 2 === 1 && onScreen(vl.x)) drawVillager(ctx, vl, vl.x - camX, ROAD_Y - 14, world.time);
  }
  drawRider(ctx, world.rider, world.rider.x - camX, ROAD_Y, world.time);
  for (const vl of world.villagers) {
    if (vl.id % 2 === 0 && onScreen(vl.x)) drawVillager(ctx, vl, vl.x - camX, ROAD_Y + 12, world.time);
  }

  drawForeground(ctx, v);
  drawGrade(ctx, viewW);

  // world-anchored UI
  for (const b of world.buildings) {
    const sx = world.plots[b.plotIndex].x - camX;
    if (!onScreen(world.plots[b.plotIndex].x)) continue;
    if (b.status === 'constructing') drawProgress(ctx, b, sx, BASE - BUILDINGS[b.type].height - 20);
    else if (b.completedAt !== null) drawCompletionEffect(ctx, sx, BASE, BUILDINGS[b.type].height, world.time - b.completedAt, b.id);
  }
  const plot = plotAt(world, world.rider.x);
  if (plot && !world.menu) {
    const sx = plot.x - camX;
    const b = getBuilding(world, plot.buildingId);
    if (!b) drawPlotPrompt(ctx, sx, BASE, world.time);
    else if (b.status === 'done') drawBuildingLabel(ctx, b, sx, BASE - BUILDINGS[b.type].height - 18);
  }

  drawHud(ctx, world, viewW);
  drawToasts(ctx, toasts, world.time, viewW);
  drawBuildMenu(ctx, world, viewW);
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
function drawGrade(ctx: Ctx, viewW: number): void {
  const g = ctx.createRadialGradient(viewW * 0.4, VIEW_H * 0.45, VIEW_H * 0.3, viewW * 0.5, VIEW_H * 0.5, Math.max(viewW, VIEW_H) * 0.85);
  g.addColorStop(0, 'rgba(255,220,160,0)');
  g.addColorStop(1, 'rgba(40,24,10,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, viewW, VIEW_H);
}
