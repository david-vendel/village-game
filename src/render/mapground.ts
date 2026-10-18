// The land of the village from straight above, north up: grass, streets,
// fields, the quarries' rocky land, the crossroads' posts, what lies on the
// ground, and a flat roof on the lot of any building with no 3D model. The
// strategy view (strategy.ts) paints it into textures and lays them on its
// ground, under the 3D buildings, trees and people. Positions come straight
// from the game's map (game/streets.ts groundPoint).

import type { BuildingType } from '../game/buildings';
import { CELL_W, FIELD_ROWS, QUARRIES, quarryLand, ROAD_HALF, rowFar, rowNear, type FieldZone } from '../game/layout';
import { crossroadsPlaces, footprintOf, landUse, type LandUse } from '../game/grid';
import { LINE_ALPHA, lineLevel, showLevel } from './grid';
import { GROUND_PILE_Y } from '../game/piles';
import type { Load } from '../game/resources';
import { backOf, groundPoint, mapPoint, streetOf, streetPoint, streetRange, streetStart, type Vec } from '../game/streets';
import type { World } from '../game/world';
import { circle, type Ctx, ellipse, hash, line, mix, poly, shade } from './util';

/** Roof colours by building, for one drawn flat (no 3D model). */
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

export const RESOURCE_COLOUR: Record<Load['resource'], string> = { wood: '#7b5634', stone: '#a89c88', grain: '#d8b850', flour: '#f1ece0', bread: '#c58a46' };

/** The colour of the open land. */
export const GRASS = '#7f9148';

/** What a canvas of w × h shows: map point (cx, cy) in its middle, S canvas px per map px; and the land grid over it or not. */
export interface GroundView {
  cx: number;
  cy: number;
  S: number;
  w: number;
  h: number;
  grid: boolean;
}

/** Paint the land into ctx: canvas = (w/2 + (p.x − cx)·S, h/2 − (p.y − cy)·S). Buildings `modelled` in 3D are left off. */
export function paintGround(ctx: Ctx, world: World, view: GroundView, modelled: (type: BuildingType) => boolean): void {
  const time = world.time;
  const { S, w: uiW, h: uiH } = view;
  const c = { x: view.cx, y: view.cy };
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
  ctx.fillStyle = GRASS;
  ctx.fillRect(0, 0, uiW, uiH);
  // broad patches of lusher and drier grass, fixed to the ground
  const P = 260;
  for (let i = Math.floor((c.x - uiW / 2 / S) / P) - 1; i < (c.x + uiW / 2 / S) / P + 1; i++) {
    for (let j = Math.floor((c.y - uiH / 2 / S) / P) - 1; j < (c.y + uiH / 2 / S) / P + 1; j++) {
      const p = { x: (i + hash(i * 31 + j, 21)) * P, y: (j + hash(j * 37 + i, 22)) * P };
      const r = (130 + hash(i + j * 7, 23) * 150) * S;
      const k = hash(i * 13 + j, 24);
      const g = ctx.createRadialGradient(sx(p), sy(p), 0, sx(p), sy(p), r);
      const tint = k < 0.5 ? `rgba(92,118,52,${0.35 * (0.5 - k) * 2})` : `rgba(168,160,86,${0.3 * (k - 0.5) * 2})`;
      g.addColorStop(0, tint);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx(p) - r, sy(p) - r, 2 * r, 2 * r);
    }
  }
  // a little texture: tufts fixed to the ground
  const T = 60;
  const x0 = Math.floor((c.x - uiW / 2 / S) / T) - 1;
  const y0 = Math.floor((c.y - uiH / 2 / S) / T) - 1;
  // (left out when painted too small to see)
  for (let i = x0; S > 0.25 && i < x0 + uiW / S / T + 3; i++) {
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
    if (s.gone) continue;
    // three lanes, a cell each
    const { min, max } = streetRange(world, s.index);
    const road = [streetPoint(world, min, ROAD_HALF), streetPoint(world, max, ROAD_HALF), streetPoint(world, max, -ROAD_HALF), streetPoint(world, min, -ROAD_HALF)];
    shape(road, '#b89668', '#8a6a44', 1);
    for (const d of [-ROAD_HALF / 3, ROAD_HALF / 3]) {
      const a = streetPoint(world, min, d);
      const b = streetPoint(world, max, d);
      ctx.setLineDash([6 * S, 6 * S]);
      line(ctx, sx(a), sy(a), sx(b), sy(b), 'rgba(110,80,50,0.45)', Math.max(0.5, 1.2 * S));
      ctx.setLineDash([]);
    }
  }

  // fields
  for (const b of world.buildings) {
    if (!b.farm) continue;
    const fx = b.x;
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
    if (b.type === 'intersection' || modelled(b.type)) continue;
    const x = b.x;
    const f = footprintOf(b);
    if (!f) continue;
    const x0 = streetStart(f.street) + f.i0 * CELL_W;
    const x1 = streetStart(f.street) + (f.i1 + 1) * CELL_W;
    const w = x1 - x0;
    const front = rowNear(f.j0);
    const deep = rowFar(f.j1) - front;
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
  }
  // the crossroads' fingerposts
  for (const b of world.buildings) {
    if (b.type !== 'intersection') continue;
    const p = lot(b.x - 44, rowNear(3));
    circle(ctx, sx(p), sy(p), Math.max(1.5, 4 * S), '#6b4c30');
  }

  // where a crossroads can be built: its signpost, with a board pointing into the land
  for (const x of crossroadsPlaces(world)) {
    const p = lot(x, rowNear(3));
    const q = lot(x, rowNear(5));
    line(ctx, sx(p), sy(p), sx(p) + (sx(q) - sx(p)) * 0.35, sy(p) + (sy(q) - sy(p)) * 0.35, '#d8b77a', Math.max(1, 3 * S));
    circle(ctx, sx(p), sy(p), Math.max(1.5, 4 * S), '#6b4c30');
  }

  // what lies on the ground by the road: a little heap, bigger the more there is
  for (const pile of world.piles) {
    const p = groundPoint(world, pile.x, GROUND_PILE_Y);
    const r = Math.max(1.5, (5 + Math.min(10, Math.sqrt(pile.amount))) * S);
    circle(ctx, sx(p), sy(p), r + Math.max(0.6, S), 'rgba(40,28,16,0.45)');
    circle(ctx, sx(p), sy(p), r, RESOURCE_COLOUR[pile.resource]);
  }
  if (view.grid) drawGrid(ctx, world, sx, sy, S, uiW, uiH);
}

const GRID_FILL: Record<LandUse['kind'], string> = {
  road: 'rgba(200,170,120,0.35)',
  building: 'rgba(214,82,62,0.45)',
  field: 'rgba(120,206,80,0.45)',
  quarry: 'rgba(150,150,170,0.45)',
};

/**
 * The land grid from above (G): the whole plane in cells, north up, in light
 * lines (every tenth a little stronger, and fewer of them as it zooms out),
 * every cell taken by something tinted by what takes it.
 */
function drawGrid(ctx: Ctx, world: World, sx: (p: Vec) => number, sy: (p: Vec) => number, S: number, uiW: number, uiH: number): void {
  const px = CELL_W * S;
  // the cells on screen
  const at = (X: number, Y: number) => ({ x: (X - sx({ x: 0, y: 0 })) / S, y: -(Y - sy({ x: 0, y: 0 })) / S });
  const tl = at(0, 0);
  const br = at(uiW, uiH);
  const c0 = Math.floor(tl.x / CELL_W);
  const c1 = Math.floor(br.x / CELL_W);
  const r0 = Math.floor(br.y / CELL_W);
  const r1 = Math.floor(tl.y / CELL_W);
  // what takes the land
  for (const [key, use] of landUse(world)) {
    const [c, r] = key.split(',').map(Number);
    if (c < c0 || c > c1 || r < r0 || r > r1) continue;
    ctx.fillStyle = GRID_FILL[use.kind];
    ctx.fillRect(sx({ x: c * CELL_W, y: 0 }), sy({ x: 0, y: (r + 1) * CELL_W }), px, px);
  }
  // the lines between the cells: faint between single cells, stronger round the blocks of three
  // (the main street's three lanes are one, its lots the next) and of nine; the finer left out as they crowd
  ctx.save();
  const colour = (level: 0 | 1 | 2) => `rgba(255,248,225,${LINE_ALPHA[level]})`;
  for (let c = c0; c <= c1 + 1; c++) {
    const level = lineLevel(c, 1, 1);
    if (!showLevel(level, px)) continue;
    const X = Math.round(sx({ x: c * CELL_W, y: 0 })) + 0.5;
    line(ctx, X, 0, X, uiH, colour(level), 1);
  }
  for (let r = r0; r <= r1 + 1; r++) {
    const level = lineLevel(r, 2, 5);
    if (!showLevel(level, px)) continue;
    const Y = Math.round(sy({ x: 0, y: r * CELL_W })) + 0.5;
    line(ctx, 0, Y, uiW, Y, colour(level), 1);
  }
  ctx.restore();
}
