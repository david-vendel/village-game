// The land grid on the street being looked at (G): light lines over the
// ground in the rows along it, from the land in front of the road on to the
// horizon, fading and thinning out with distance; each cell tinted by what
// takes it (game/grid.ts): road, building, field or quarry; and the name of
// the cell under the mouse. Drawn in the ground perspective (ground.ts), so
// it lines up with the fields. Also the block the rider could build on
// (drawBlockGlow) and the cells a building chosen in the build menu would
// take (drawSitePreview).

import { BUILDINGS, type BuildingType } from '../game/buildings';
import { blockStartX, cellKey, cellName, footprintAt, landUse, streetCell, type LandUse } from '../game/grid';
import { behindRoad, BLOCK, CELL_W, LOT_ROW, rowFar, rowNear, yAt } from '../game/layout';
import { streetOf, streetStart } from '../game/streets';
import { placeAt, whyNotBuild, type World } from '../game/world';
import { depthScale, groundX } from './ground';
import type { Ctx } from './util';

const FILL: Record<LandUse['kind'], string> = {
  road: 'rgba(200,170,120,0.28)',
  building: 'rgba(214,82,62,0.32)',
  field: 'rgba(120,206,80,0.32)',
  quarry: 'rgba(150,150,170,0.35)',
};

/** Rows of cells drawn, near to far (row j: j cells behind the middle of the road): on to the horizon. */
const ROWS = { near: -4, far: 80 };
/** Lines between cells closer together than this on screen (px) are thinned out: every second, fourth… */
const MIN_GAP = 7;

/** A cell's corners on screen: cells i0..i1 along street `street`, rows j0..j1, the camera at camX. */
function block(ctx: Ctx, street: number, i0: number, i1: number, j0: number, j1: number, camX: number, vpX: number): void {
  const x0 = streetStart(street) + i0 * CELL_W;
  const x1 = streetStart(street) + (i1 + 1) * CELL_W;
  const far = yAt(rowFar(j1));
  const near = yAt(rowNear(j0));
  ctx.beginPath();
  ctx.moveTo(groundX(x0 - camX, far, vpX), far);
  ctx.lineTo(groundX(x1 - camX, far, vpX), far);
  ctx.lineTo(groundX(x1 - camX, near, vpX), near);
  ctx.lineTo(groundX(x0 - camX, near, vpX), near);
  ctx.closePath();
}

/**
 * The land grid on the street being looked at (G): light lines over the
 * ground running on to the horizon, fading and thinning out with distance;
 * what takes a cell tinted; and the name of the cell under the mouse.
 */
export function drawLandGrid(ctx: Ctx, world: World, camX: number, viewW: number, hover: { x: number; y: number } | null): void {
  const street = world.streets[streetOf(camX + viewW / 2)];
  if (!street) return;
  const land = landUse(world);
  const vpX = viewW / 2;
  const start = streetStart(street.index);
  ctx.save();
  for (let j = ROWS.far; j >= ROWS.near; j--) {
    const far = yAt(rowFar(j));
    const near = yAt(rowNear(j));
    const s = depthScale((far + near) / 2);
    // world x at the screen edges at this depth (the near ground fans out past them)
    const left = camX + vpX - vpX / s;
    const right = camX + vpX + (viewW - vpX) / s;
    const first = Math.floor((left - start) / CELL_W) - 1;
    const last = Math.ceil((right - start) / CELL_W) + 1;
    const fade = Math.max(0, 1 - Math.max(0, j - 4) / (ROWS.far - 4));
    // what takes the land
    for (let i = first; i <= last; i++) {
      const cell = streetCell(street, i, j);
      const use = land.get(cellKey(cell.c, cell.r));
      if (!use) continue;
      block(ctx, street.index, i, i, j, j, camX, vpX);
      ctx.globalAlpha = fade;
      ctx.fillStyle = FILL[use.kind];
      ctx.fill();
    }
    // the lines: the row's far edge, and the cells' sides, fewer the smaller they get
    ctx.globalAlpha = 0.28 * fade * fade;
    ctx.strokeStyle = '#fff8e1';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(0, far);
    ctx.lineTo(viewW, far);
    const step = 2 ** Math.max(0, Math.ceil(Math.log2(MIN_GAP / (CELL_W * s))));
    for (let i = Math.floor(first / step) * step; i <= last; i += step) {
      const x = start + i * CELL_W - camX;
      ctx.moveTo(groundX(x, far, vpX), far);
      ctx.lineTo(groundX(x, near, vpX), near);
    }
    ctx.stroke();
  }
  // the cell under the mouse: outlined, with its name
  if (hover && hover.y > yAt(rowFar(ROWS.far))) {
    const j = Math.round(behindRoad(hover.y) / CELL_W);
    const s = depthScale(hover.y);
    const i = Math.floor((camX + vpX + (hover.x - vpX) / s - start) / CELL_W);
    const cell = streetCell(street, i, j);
    ctx.globalAlpha = 1;
    block(ctx, street.index, i, i, j, j, camX, vpX);
    ctx.strokeStyle = '#fff4dc';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const name = cellName(cell.c, cell.r);
    ctx.font = 'bold 11px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    const y = yAt(rowFar(j)) - 5;
    const w = ctx.measureText(name).width + 8;
    ctx.fillStyle = 'rgba(30,22,12,0.7)';
    ctx.fillRect(hover.x - w / 2, y - 12, w, 15);
    ctx.fillStyle = '#fff4dc';
    ctx.fillText(name, hover.x, y);
  }
  ctx.restore();
}

/** A soft glow on the block of three cells world x is in, in its lot rows: where the rider could build. */
export function drawBlockGlow(ctx: Ctx, x: number, camX: number, viewW: number, time: number): void {
  const at = blockStartX(x);
  const street = streetOf(at);
  const i0 = Math.round((at - streetStart(street)) / CELL_W - 0.5);
  ctx.save();
  ctx.globalAlpha = 0.75 + 0.25 * Math.sin(time * 2.5);
  block(ctx, street, i0, i0 + BLOCK - 1, LOT_ROW, LOT_ROW + 1, camX, viewW / 2);
  ctx.fillStyle = 'rgba(255,224,150,0.22)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,232,170,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/** The cells the building chosen in the build menu would take where the rider wants it: green if it fits there, red if not. */
export function drawSitePreview(ctx: Ctx, world: World, type: BuildingType, wantX: number, camX: number, viewW: number): void {
  const x = placeAt(world, type, wantX);
  if (x === null) return;
  const f = footprintAt(type, x);
  const ok = !whyNotBuild(world, type, wantX);
  const vpX = viewW / 2;
  ctx.save();
  for (let i = f.i0; i <= f.i1; i++) {
    for (let j = f.j0; j <= f.j1; j++) {
      block(ctx, f.street, i, i, j, j, camX, vpX);
      ctx.fillStyle = ok ? 'rgba(140,230,110,0.35)' : 'rgba(235,90,70,0.35)';
      ctx.fill();
    }
  }
  block(ctx, f.street, f.i0, f.i1, f.j0, f.j1, camX, vpX);
  ctx.strokeStyle = ok ? '#c8f5a0' : '#ff9b7e';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = 'bold 11px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = ok ? '#e8ffd8' : '#ffd8cc';
  const y = yAt(rowFar(f.j1)) - 6;
  ctx.fillText(BUILDINGS[type].name, groundX((streetStart(f.street) + ((f.i0 + f.i1 + 1) / 2) * CELL_W) - camX, y, vpX), y);
  ctx.restore();
}
