// Debug overlay of the land grid (toggled from the tuning panel): every cell in
// the row behind the road and the row in front of it, tinted by what uses it —
// a building's footprint, a farm field, or free land — plus the plot boundaries.
// Drawn in the ground perspective (ground.ts), so it lines up with the fields.

import { BUILDINGS } from '../game/buildings';
import { cellAt, cellX, landGrid, type CellUse } from '../game/land';
import { BACK_FIELD, FIELD_ROWS, FRONT_FIELD } from '../game/layout';
import { getBuilding, PLOT_SPACING, type World } from '../game/world';
import { groundX } from './ground';
import type { Ctx } from './util';

const FILL: Record<CellUse['kind'], string> = {
  free: 'rgba(255,255,255,0.06)',
  building: 'rgba(214,82,62,0.42)',
  field: 'rgba(120,206,80,0.42)',
  spare: 'rgba(120,206,80,0.14)',
};

export function drawLandGrid(ctx: Ctx, world: World, camX: number, viewW: number): void {
  const grid = landGrid(world);
  const vpX = viewW / 2;
  /** Camera-relative x → screen x at depth y. */
  const gx = (x: number, y: number) => groundX(x - camX, y, vpX);
  /** Ground quad from world x0 to x1 between depths top and bottom (far → near). */
  const quad = (x0: number, x1: number, top: number, bottom: number) => {
    ctx.beginPath();
    ctx.moveTo(gx(x0, top), top);
    ctx.lineTo(gx(x1, top), top);
    ctx.lineTo(gx(x1, bottom), bottom);
    ctx.lineTo(gx(x0, bottom), bottom);
    ctx.closePath();
  };
  // the near ground fans out past the screen edges, so look a little wider
  const margin = viewW * 0.25;
  const first = Math.max(0, cellAt(camX - margin));
  const last = Math.min(grid.count - 1, cellAt(camX + viewW + margin));

  ctx.save();
  for (const { zone, row: r, cells } of grid.rows) {
    const band = FIELD_ROWS[zone][r];
    const row = { top: band.far, bottom: band.near };
    for (let k = first; k <= last; k++) {
      quad(cellX(k), cellX(k + 1), row.top, row.bottom);
      ctx.fillStyle = FILL[cells[k].kind];
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,248,225,0.55)';
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }
    // outline each building footprint / farm field run
    for (let k = first; k <= last; k++) {
      const c = cells[k];
      if (c.kind === 'free') continue;
      const prev = cells[k - 1];
      if (prev && prev.kind === c.kind && 'buildingId' in prev && prev.buildingId === c.buildingId) continue;
      let end = k;
      while (end + 1 < grid.count) {
        const n = cells[end + 1];
        if (n.kind !== c.kind || !('buildingId' in n) || n.buildingId !== c.buildingId) break;
        end++;
      }
      ctx.strokeStyle = c.kind === 'building' ? '#ff9b7e' : c.kind === 'field' ? '#b8f08a' : 'rgba(184,240,138,0.55)';
      ctx.lineWidth = 2;
      quad(cellX(k) + 1, cellX(end + 1) - 1, row.top + 1, row.bottom - 1);
      ctx.stroke();
      if (c.kind === 'building') {
        const b = getBuilding(world, c.buildingId);
        if (b) label(ctx, `${BUILDINGS[b.type].name} · ${end - k + 1} cells`, gx((cellX(k) + cellX(end + 1)) / 2, row.top), row.top - 4);
      }
    }
  }

  // plot (lot) boundaries and centres
  const top = BACK_FIELD.back - 18;
  const bottom = FRONT_FIELD.bottom;
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = 'rgba(232,200,114,0.9)';
  ctx.lineWidth = 1.5;
  for (const p of world.plots) {
    if (p.x < camX - margin - PLOT_SPACING || p.x > camX + viewW + margin + PLOT_SPACING) continue;
    for (const edge of [p.x - PLOT_SPACING / 2, p.x + PLOT_SPACING / 2]) {
      ctx.beginPath();
      ctx.moveTo(gx(edge, top), top);
      ctx.lineTo(gx(edge, bottom), bottom);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  for (const p of world.plots) {
    const x = gx(p.x, bottom);
    if (x < -40 || x > viewW + 40) continue;
    label(ctx, `plot ${p.index}`, x, bottom + 11);
  }
  ctx.restore();
}

function label(ctx: Ctx, s: string, x: number, y: number): void {
  ctx.font = 'bold 10px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillText(s, x + 1, y + 1);
  ctx.fillStyle = '#fff4dc';
  ctx.fillText(s, x, y);
}
