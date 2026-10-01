// The village from above (Tab): the plane itself, north up, centred on the
// rider. Streets, fields, the quarries' rocky land, every building's roof on
// its lot, trees, and people and the rider moving about, all simply drawn.
// Positions come straight from the game's map (game/streets.ts groundPoint).

import { BUILDINGS, type BuildingType } from '../game/buildings';
import { CELL_W, FIELD_ROWS, FRONT_FIELD, GROUND_Y, QUARRIES, quarryLand, ROAD_BOTTOM, STREET_BAND_HALF, behindRoad, type FieldZone } from '../game/layout';
import { cellX, footprint, landGrid, type CellUse } from '../game/land';
import { treeGrowth } from '../game/nature';
import { GROUND_PILE_Y } from '../game/piles';
import type { Load } from '../game/resources';
import { backOf, groundPoint, mapPoint, streetOf, streetPoint, streetRange, type Vec } from '../game/streets';
import { getBuilding, type World } from '../game/world';
import { doorProgress } from './farm';
import { figureOf, outfitOf } from './figure';
import { circle, type Ctx, ellipse, hash, line, mix, poly, shade } from './util';

const SERIF = 'Georgia, "Times New Roman", serif';

/** Roof colours by building (the top view's only clue to what a building is, with its name). */
const ROOF: Record<BuildingType, string> = {
  warehouse: '#8a6a44',
  house: '#a0563a',
  farm: '#c9a24a',
  mill: '#8e7a5a',
  bakery: '#b0603e',
  blacksmith: '#5a5a62',
  market: '#b8463a',
  chapel: '#5c6275',
  tavern: '#7d4a32',
  watchtower: '#6b5a48',
  well: '#7a8a9a',
  woodcutter: '#6b4a2c',
  stonecutter: '#8a8680',
  intersection: '#a8875b',
};

/** A building stands on its lot's row of land-grid cells behind the road (the cells its footprint claims, land.ts). */
const LOT_ROW = FIELD_ROWS.back[0];

const RESOURCE_COLOUR: Record<Load['resource'], string> = { wood: '#7b5634', stone: '#a89c88', grain: '#d8b850', flour: '#f1ece0', bread: '#c58a46' };

export function drawTopView(ctx: Ctx, world: World, uiW: number, uiH: number, zoom: number, showGrid: boolean): void {
  const time = world.time;
  // map px per screen unit: about 1400 map px across the shorter side at zoom 1
  const S = (Math.min(uiW, uiH) / 1400) * zoom * 1.6;
  const c = mapPoint(world, world.rider.x);
  const sx = (p: Vec) => uiW / 2 + (p.x - c.x) * S;
  const sy = (p: Vec) => uiH / 2 - (p.y - c.y) * S;
  const shape = (pts: Vec[], fill: string, stroke?: string, lw = 1) => {
    poly(ctx, pts.flatMap((p) => [sx(p), sy(p)]), fill, stroke, lw);
  };
  /** A point d map px behind the road of street x's street, at world x. */
  const lot = (x: number, d: number): Vec => {
    const s = world.streets[streetOf(x)] ?? world.streets[0];
    const p = mapPoint(world, x);
    const b = backOf(s.dir);
    return { x: p.x + b.x * d, y: p.y + b.y * d };
  };

  // the land
  ctx.fillStyle = '#7f9148';
  ctx.fillRect(0, 0, uiW, uiH);
  // a little texture: tufts fixed to the ground
  const T = 60;
  const x0 = Math.floor((c.x - uiW / 2 / S) / T) - 1;
  const y0 = Math.floor((c.y - uiH / 2 / S) / T) - 1;
  for (let i = x0; i < x0 + uiW / S / T + 3; i++) {
    for (let j = y0; j < y0 + uiH / S / T + 3; j++) {
      if (hash(i * 7919 + j, 3) < 0.6) continue;
      const p = { x: i * T + hash(i, j) * T, y: j * T + hash(j, i) * T };
      circle(ctx, sx(p), sy(p), Math.max(0.8, 3 * S), hash(i + j, 9) < 0.5 ? '#74883f' : '#8a9c50');
    }
  }

  // the quarries: rocky land, a pale cut face along the front, boulders
  QUARRIES.forEach((q, qi) => {
    const r = quarryLand(q);
    const pts: Vec[] = [];
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const j = 0.86 + hash(qi * 31 + i, 5) * 0.14;
      pts.push({ x: q.x + Math.cos(a) * ((r.x1 - r.x0) / 2) * j, y: (r.y0 + r.y1) / 2 + Math.sin(a) * ((r.y1 - r.y0) / 2) * j });
    }
    shape(pts, '#9d9585', '#6f6960', 1.5);
    shape([{ x: q.x - 80, y: r.y0 + 6 }, { x: q.x + 80, y: r.y0 + 6 }, { x: q.x + 70, y: r.y0 + 40 }, { x: q.x - 70, y: r.y0 + 40 }], '#d2cab8');
    for (let i = 0; i < 9; i++) {
      const p = { x: q.x + (hash(qi, 40 + i) - 0.5) * 220, y: r.y0 + 60 + hash(qi, 50 + i) * 170 };
      ellipse(ctx, sx(p), sy(p), (10 + hash(qi, 60 + i) * 14) * S, (8 + hash(qi, 70 + i) * 10) * S, shade('#8f887c', (hash(qi, 80 + i) - 0.5) * 0.3));
    }
  });

  // streets
  for (const s of world.streets) {
    const { min, max } = streetRange(world, s.index);
    const road = [groundPoint(world, min, GROUND_Y + 6), groundPoint(world, max, GROUND_Y + 6), groundPoint(world, max, ROAD_BOTTOM), groundPoint(world, min, ROAD_BOTTOM)];
    shape(road, '#b89668', '#8a6a44', 1);
  }

  // fields
  for (const b of world.buildings) {
    if (!b.farm) continue;
    const fx = world.plots[b.plotIndex].x;
    for (const p of b.farm.plots) {
      if (!p.tilled) continue;
      const row = FIELD_ROWS[p.zone as FieldZone][p.row];
      const a = fx + p.dx - p.width / 2 + 1.5;
      const z = fx + p.dx + p.width / 2 - 1.5;
      const corners = [groundPoint(world, a, row.far), groundPoint(world, z, row.far), groundPoint(world, z, row.near), groundPoint(world, a, row.near)];
      const fill = p.state === 'ripe' ? '#d4b24c' : p.state === 'growing' ? mix('#8a7048', '#6f9a3c', Math.min(1, p.age / 90)) : '#8a6a44';
      shape(corners, fill, shade(fill, -0.25), 0.8);
      // furrows along the street
      const rows = 4;
      for (let k = 1; k < rows; k++) {
        const y = row.far + ((row.near - row.far) * k) / rows;
        const pa = groundPoint(world, a, y);
        const pb = groundPoint(world, z, y);
        line(ctx, sx(pa), sy(pa), sx(pb), sy(pb), shade(fill, -0.18), Math.max(0.5, S));
      }
    }
  }

  // buildings: a roof on the lot behind the road; sites are open frames filling in
  for (const b of world.buildings) {
    if (b.type === 'intersection') continue;
    const x = world.plots[b.plotIndex].x;
    const cells = footprint(world, b);
    const x0 = cellX(cells.from);
    const x1 = cellX(cells.to);
    const w = x1 - x0;
    const front = behindRoad(LOT_ROW.near);
    const deep = behindRoad(LOT_ROW.far) - front;
    const corners = [lot(x0, front), lot(x1, front), lot(x1, front + deep), lot(x0, front + deep)];
    const roof = ROOF[b.type];
    // shadow to the north-east
    shape(corners.map((p) => ({ x: p.x + 6, y: p.y + 6 })), 'rgba(30,24,12,0.25)');
    if (b.status !== 'done') {
      ctx.globalAlpha = 0.25 + 0.6 * b.progress;
      shape(corners, mix(roof, '#e8dcc0', 0.4), '#6d5037', 1.5);
      ctx.globalAlpha = 1;
      // the timber frame
      line(ctx, sx(corners[0]), sy(corners[0]), sx(corners[2]), sy(corners[2]), '#6d5037', 1);
      line(ctx, sx(corners[1]), sy(corners[1]), sx(corners[3]), sy(corners[3]), '#6d5037', 1);
    } else {
      // a gable roof: two slopes, the ridge running along the street, the far slope in shade
      const mid = (i: number, j: number) => ({ x: (corners[i].x + corners[j].x) / 2, y: (corners[i].y + corners[j].y) / 2 });
      const ridgeA = mid(0, 3);
      const ridgeB = mid(1, 2);
      shape([corners[0], corners[1], ridgeB, ridgeA], shade(roof, 0.12));
      shape([ridgeA, ridgeB, corners[2], corners[3]], shade(roof, -0.15));
      line(ctx, sx(ridgeA), sy(ridgeA), sx(ridgeB), sy(ridgeB), shade(roof, -0.35), Math.max(1, 2 * S));
      shape(corners, 'rgba(0,0,0,0)', shade(roof, -0.4), 1);
      if (b.type === 'chapel') {
        const t = lot(x0 + 18, front + deep / 2);
        circle(ctx, sx(t), sy(t), 14 * S, '#4f5670');
      }
      if (b.type === 'mill') {
        // sails turning
        const hub = lot(x, front + deep / 2);
        const a = time * 0.9;
        for (let k = 0; k < 4; k++) {
          const ang = a + (k * Math.PI) / 2;
          line(ctx, sx(hub), sy(hub), sx(hub) + Math.cos(ang) * w * 0.45 * S, sy(hub) + Math.sin(ang) * w * 0.45 * S, '#e9dcb8', Math.max(1, 5 * S));
        }
      }
      if (b.type === 'well') circle(ctx, sx(lot(x, front + deep / 2)), sy(lot(x, front + deep / 2)), Math.min(12, deep / 3) * S, '#3a4a5a');
    }
    if (S > 0.32) {
      const label = lot(x, front - 14);
      ctx.font = `${Math.round(Math.max(9, 11 * Math.min(1.4, S * 1.6)))}px ${SERIF}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(30,22,12,0.85)';
      ctx.fillText(BUILDINGS[b.type].name, sx(label), sy(label) + 4);
    }
  }
  // the crossroads' fingerposts
  for (const b of world.buildings) {
    if (b.type !== 'intersection') continue;
    const p = lot(world.plots[b.plotIndex].x - 44, behindRoad(LOT_ROW.near));
    circle(ctx, sx(p), sy(p), Math.max(1.5, 4 * S), '#6b4c30');
  }

  // trees: crowns from above, a shadow under each; stumps
  for (const t of world.trees) {
    const p = groundPoint(world, t.x, t.y);
    const X = sx(p);
    const Y = sy(p);
    if (X < -40 || X > uiW + 40 || Y < -40 || Y > uiH + 40) continue;
    if (t.state === 'stump') {
      circle(ctx, X, Y, Math.max(1, 4 * S), '#c9a577');
      continue;
    }
    const r = (10 + hash(t.id, 92) * 10) * (0.3 + 0.7 * treeGrowth(t)) * S;
    circle(ctx, X + r * 0.35, Y + r * 0.35, r, 'rgba(30,40,16,0.35)');
    circle(ctx, X, Y, r, '#4e6533');
    circle(ctx, X - r * 0.3, Y - r * 0.3, r * 0.55, '#6c8543');
  }

  // people: a body in their clothes and a head, stepping as they walk, with whatever they carry
  const person = (p: Vec, top: string, skin: string, heading: number, step: number, walking: boolean, load: Load | null) => {
    const X = sx(p);
    const Y = sy(p);
    if (X < -20 || X > uiW + 20 || Y < -20 || Y > uiH + 20) return;
    const k = Math.max(0.6, S * 1.4);
    const fx = Math.cos(heading);
    const fy = Math.sin(heading);
    if (walking) {
      // feet stepping forward and back
      const swing = Math.sin(step) * 3.5 * k;
      circle(ctx, X - fy * 2 * k + fx * swing, Y + fx * 2 * k + fy * swing, 1.4 * k, '#3a2a1c');
      circle(ctx, X + fy * 2 * k - fx * swing, Y - fx * 2 * k - fy * swing, 1.4 * k, '#3a2a1c');
    }
    ellipse(ctx, X, Y, 4.2 * k, 3 * k, top, heading + Math.PI / 2);
    circle(ctx, X + fx * 0.6 * k, Y + fy * 0.6 * k, 2.3 * k, skin);
    if (load) circle(ctx, X + fx * 4 * k, Y + fy * 4 * k, 2.2 * k, RESOURCE_COLOUR[load.resource]);
  };
  /** Screen heading of something facing `facing` along the street at world x. */
  const headingAt = (x: number, facing: number) => {
    const d = (world.streets[streetOf(x)] ?? world.streets[0]).dir;
    return Math.atan2(-d.y * facing, d.x * facing);
  };
  // what lies on the ground by the road: a little heap, bigger the more there is
  for (const pile of world.piles) {
    const p = groundPoint(world, pile.x, GROUND_PILE_Y);
    const r = Math.max(1.5, (5 + Math.min(10, Math.sqrt(pile.amount))) * S);
    circle(ctx, sx(p), sy(p), r + Math.max(0.6, S), 'rgba(40,28,16,0.45)');
    circle(ctx, sx(p), sy(p), r, RESOURCE_COLOUR[pile.resource]);
  }
  for (const p of world.people) {
    const o = outfitOf(figureOf(p));
    const b = p.job && getBuilding(world, p.job.buildingId);
    if (p.job && b) {
      const w = p.job.worker;
      if (doorProgress(w) >= 1) continue; // indoors
      const x = world.plots[b.plotIndex].x + w.dx;
      person(groundPoint(world, x, w.y), o.top, o.skin, headingAt(x, w.facing), w.stride * 0.25, w.task.kind === 'walk', w.carrying);
    } else if (!p.job) {
      const s = p.stroll;
      person(groundPoint(world, s.x, s.y), o.top, o.skin, headingAt(s.x, s.dir), time * s.speed * 0.2 + p.seed, s.idle <= 0, null);
    }
  }
  for (const a of world.animals) {
    const p = groundPoint(world, a.stroll.x, a.stroll.y);
    const hop = a.stroll.idle <= 0 ? Math.abs(Math.sin(time * 8 + a.seed)) * 1.5 : 0;
    circle(ctx, sx(p), sy(p) - hop, Math.max(1.2, 2.6 * S), hash(a.seed, 3) < 0.5 ? '#efe9dc' : '#a86a3a');
  }

  // the rider: the horse along the street, legs going, the king on its back
  const r = world.rider;
  const rp = groundPoint(world, r.x, 474);
  const h = headingAt(r.x, r.facing);
  const k = Math.max(0.8, S * 1.3);
  const X = sx(rp);
  const Y = sy(rp);
  const fx = Math.cos(h);
  const fy = Math.sin(h);
  const moving = Math.abs(r.vx) > 5;
  for (let i = 0; i < 4; i++) {
    const along = (i < 2 ? 7 : -7) * k + (moving ? Math.sin(r.gait / 8 + i * 1.6) * 3 * k : 0);
    const side = (i % 2 ? 3 : -3) * k;
    circle(ctx, X + fx * along - fy * side, Y + fy * along + fx * side, 1.5 * k, '#2a221c');
  }
  ellipse(ctx, X, Y, 11 * k, 4.2 * k, '#8b5a34', h);
  ellipse(ctx, X + fx * 12 * k, Y + fy * 12 * k, 4 * k, 2.4 * k, '#6b4226', h);
  ellipse(ctx, X - fx * 1 * k, Y - fy * 1 * k, 4.5 * k, 4 * k, '#9a2a2e', h);
  circle(ctx, X, Y, 2.8 * k, '#e3b893');
  circle(ctx, X, Y, 1.6 * k, '#e8c14a');

  if (showGrid) drawGrid(ctx, world, sx, sy, S, uiW, uiH);

  ctx.font = `bold 13px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(243,234,216,0.9)';
  ctx.fillText('The village from above — Tab, or tap “Back to the street”, to return', uiW / 2, uiH - 14);
  ctx.textAlign = 'left';
}

const GRID_FILL: Record<CellUse['kind'] | 'quarry', string> = {
  free: 'rgba(255,255,255,0.06)',
  building: 'rgba(214,82,62,0.45)',
  field: 'rgba(120,206,80,0.45)',
  spare: 'rgba(120,206,80,0.15)',
  quarry: 'rgba(150,150,170,0.45)',
};

/**
 * The land grid from above: every street's cells, row by row (the lots behind
 * the road, the two rows in front), tinted by what uses them, outlined; the
 * quarries' cells; and each plot's lot, dashed, with its number.
 */
function drawGrid(ctx: Ctx, world: World, sx: (p: Vec) => number, sy: (p: Vec) => number, S: number, uiW: number, uiH: number): void {
  const quad = (pts: Vec[], fill: string) => {
    if (pts.every((p) => sx(p) < -20) || pts.every((p) => sx(p) > uiW + 20) || pts.every((p) => sy(p) < -20) || pts.every((p) => sy(p) > uiH + 20)) return;
    poly(ctx, pts.flatMap((p) => [sx(p), sy(p)]), fill, 'rgba(255,248,225,0.5)', 0.6);
  };
  const grid = landGrid(world);
  for (const { zone, row, cells } of grid.rows) {
    const band = FIELD_ROWS[zone][row];
    cells.forEach((c, k) => {
      const x0 = cellX(k);
      const street = world.streets[streetOf(x0)];
      if (!street) return;
      const { min, max } = streetRange(world, street.index);
      if (x0 < min || x0 + CELL_W > max) return;
      quad([groundPoint(world, x0, band.far), groundPoint(world, x0 + CELL_W, band.far), groundPoint(world, x0 + CELL_W, band.near), groundPoint(world, x0, band.near)], GRID_FILL[c.kind]);
    });
  }
  for (const q of QUARRIES) {
    const r = quarryLand(q);
    for (let x = r.x0; x < r.x1 - 1e-6; x += CELL_W) {
      for (let y = r.y0; y < r.y1 - 1e-6; y += CELL_W) {
        quad([{ x, y }, { x: x + CELL_W, y }, { x: x + CELL_W, y: y + CELL_W }, { x, y: y + CELL_W }], GRID_FILL.quarry);
      }
    }
  }
  // the plots' lots: across the street's whole band, PLOT_SPACING wide
  ctx.save();
  ctx.setLineDash([5, 4]);
  for (const p of world.plots) {
    if (p.off) continue;
    for (const edge of [-125, 125]) {
      const a = streetPoint(world, p.x + edge, -STREET_BAND_HALF);
      const b = streetPoint(world, p.x + edge, STREET_BAND_HALF);
      if (Math.max(sx(a), sx(b)) < -10 || Math.min(sx(a), sx(b)) > uiW + 10 || Math.max(sy(a), sy(b)) < -10 || Math.min(sy(a), sy(b)) > uiH + 10) continue;
      line(ctx, sx(a), sy(a), sx(b), sy(b), 'rgba(232,200,114,0.85)', 1.2);
    }
    if (S > 0.25) {
      const c = streetPoint(world, p.x, behindRoad(FRONT_FIELD.bottom) - 14);
      ctx.font = `10px ${SERIF}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,240,200,0.9)';
      ctx.fillText(`plot ${p.index}`, sx(c), sy(c));
    }
  }
  ctx.restore();
}
