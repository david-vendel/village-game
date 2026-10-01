// The land grid on the street being looked at (G): every cell in the rows
// along it, from the land in front of the road to well behind the lots,
// tinted by what takes it (game/grid.ts): road, building, field, quarry, or
// free. Drawn in the ground perspective (ground.ts), so it lines up with the
// fields; each cell is named where its name fits. Also the cells a building
// chosen in the build menu would take (drawSitePreview).

import { BUILDINGS, type BuildingType } from '../game/buildings';
import { blockStartX, cellKey, cellName, footprintAt, landUse, streetCell, type LandUse } from '../game/grid';
import { BLOCK, CELL_W, LOT_ROW, rowFar, rowNear, yAt } from '../game/layout';
import { streetOf, streetStart } from '../game/streets';
import { placeAt, whyNotBuild, type World } from '../game/world';
import { groundX } from './ground';
import type { Ctx } from './util';

const FILL: Record<LandUse['kind'] | 'free', string> = {
  free: 'rgba(255,255,255,0.05)',
  road: 'rgba(200,170,120,0.35)',
  building: 'rgba(214,82,62,0.42)',
  field: 'rgba(120,206,80,0.42)',
  quarry: 'rgba(150,150,170,0.45)',
};

/** Rows of cells drawn, near to far (row j: j cells behind the middle of the road). */
const ROWS = { near: -4, far: 8 };

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

export function drawLandGrid(ctx: Ctx, world: World, camX: number, viewW: number): void {
  const street = world.streets[streetOf(camX + viewW / 2)];
  if (!street) return;
  const land = landUse(world);
  const vpX = viewW / 2;
  const start = streetStart(street.index);
  // the near ground fans out past the screen edges, so look a little wider
  const margin = viewW * 0.3;
  const first = Math.floor((camX - margin - start) / CELL_W);
  const last = Math.ceil((camX + viewW + margin - start) / CELL_W);
  ctx.save();
  ctx.font = 'bold 8px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  for (let j = ROWS.far; j >= ROWS.near; j--) {
    const far = yAt(rowFar(j));
    const near = yAt(rowNear(j));
    for (let i = first; i <= last; i++) {
      const cell = streetCell(street, i, j);
      const use = land.get(cellKey(cell.c, cell.r));
      block(ctx, street.index, i, i, j, j, camX, vpX);
      ctx.fillStyle = FILL[use?.kind ?? 'free'];
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,248,225,0.5)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
      // the cell's name, where it fits
      const mid = (far + near) / 2;
      const xa = groundX(start + i * CELL_W - camX, mid, vpX);
      const xb = groundX(start + (i + 1) * CELL_W - camX, mid, vpX);
      const name = cellName(cell.c, cell.r);
      if (near - far >= 9 && xb - xa >= ctx.measureText(name).width + 3) {
        ctx.fillStyle = 'rgba(255,244,220,0.85)';
        ctx.fillText(name, (xa + xb) / 2, mid + 3);
      }
    }
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
