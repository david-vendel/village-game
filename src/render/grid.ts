// Debug overlay of the land grid (toggled from the tuning panel): every cell in
// the row behind the road and the row in front of it, tinted by what uses it —
// a building's footprint, a farm field, or free land — plus the plot boundaries.

import { BUILDINGS } from '../game/buildings';
import { cellX, landGrid, type CellUse } from '../game/land';
import { BACK_FIELD, BASE_Y, CELL_W, FRONT_FIELD } from '../game/layout';
import { getBuilding, PLOT_SPACING, type World } from '../game/world';
import type { Ctx } from './util';

const FILL: Record<CellUse['kind'], string> = {
  free: 'rgba(255,255,255,0.06)',
  building: 'rgba(214,82,62,0.42)',
  field: 'rgba(120,206,80,0.42)',
};

const ROWS = [
  { key: 'back', top: BACK_FIELD.back, bottom: BASE_Y },
  { key: 'front', top: FRONT_FIELD.top, bottom: FRONT_FIELD.bottom },
] as const;

export function drawLandGrid(ctx: Ctx, world: World, camX: number, viewW: number): void {
  const grid = landGrid(world);
  const first = Math.max(0, Math.floor((camX - cellX(0)) / CELL_W) - 1);
  const last = Math.min(grid.count - 1, Math.ceil((camX + viewW - cellX(0)) / CELL_W) + 1);

  ctx.save();
  for (const row of ROWS) {
    const cells = grid[row.key];
    const h = row.bottom - row.top;
    for (let k = first; k <= last; k++) {
      const x = cellX(k) - camX;
      ctx.fillStyle = FILL[cells[k].kind];
      ctx.fillRect(x, row.top, CELL_W, h);
      ctx.strokeStyle = 'rgba(255,248,225,0.55)';
      ctx.lineWidth = 0.75;
      ctx.strokeRect(x + 0.5, row.top + 0.5, CELL_W - 1, h - 1);
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
      ctx.strokeStyle = c.kind === 'building' ? '#ff9b7e' : '#b8f08a';
      ctx.lineWidth = 2;
      ctx.strokeRect(cellX(k) - camX + 1, row.top + 1, (end - k + 1) * CELL_W - 2, h - 2);
      if (c.kind === 'building' && row.key === 'back') {
        const b = getBuilding(world, c.buildingId);
        if (b) label(ctx, `${BUILDINGS[b.type].name} · ${end - k + 1} cells`, (cellX(k) + cellX(end + 1)) / 2 - camX, row.top - 4);
      }
    }
  }

  // plot (lot) boundaries and centres
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = 'rgba(232,200,114,0.9)';
  ctx.lineWidth = 1.5;
  for (const p of world.plots) {
    const x = p.x - camX;
    if (x < -PLOT_SPACING || x > viewW + PLOT_SPACING) continue;
    for (const edge of [x - PLOT_SPACING / 2, x + PLOT_SPACING / 2]) {
      ctx.beginPath();
      ctx.moveTo(edge, BACK_FIELD.back - 18);
      ctx.lineTo(edge, FRONT_FIELD.bottom);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  for (const p of world.plots) {
    const x = p.x - camX;
    if (x < -40 || x > viewW + 40) continue;
    label(ctx, `plot ${p.index}`, x, FRONT_FIELD.bottom + 11);
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
