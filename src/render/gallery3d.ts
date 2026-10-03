// `?view=3d`: the 3D buildings on their own, for looking them over. Rows of
// buildings on a street seen through the game's camera: every type; houses of
// every style and size side by side, their walls meeting and roofs running on;
// one building going up stage by stage; the same seen by day, at evening and by
// night. `&hour=` sets the time of day (default 10), `&zoom=` the scale,
// `&cam=` the camera's distance, `&type=` a type to build in the construction row.

import type { BuildingType } from '../game/buildings';
import { STAGE_BOUNDS, constructionStage } from '../game/world';
import { modelTypes } from './build3d/index';
import { STYLES } from './build3d/style';
import { plotOf } from './build3d/plot';
import { cameraHeight, setCameraDistance, setCameraHeight, viewHorizon } from './ground';
import { type Building3d, draw3d, set3d, type View3d } from './world3d';

const FULL = { wood: 30, stone: 30, grain: 50, flour: 30, bread: 40 };

interface Row {
  title: string;
  items: Building3d[];
  hour: number;
  style?: string;
}

let nextId = 100000;

function item(type: BuildingType, x: number, opts: Partial<Building3d> = {}): Building3d {
  return { id: nextId++, type, seed: 7 + nextId * 13, x, size: 1, sides: { left: false, right: false }, upgraded: false, age: 0.3, door: 0, shutters: 1, light: 0, fire: 0, stock: FULL, ...opts };
}

/** Lay buildings along the street left to right, `gap` world units apart (0: walls touching). */
function along(list: Array<{ type: BuildingType; size?: 1 | 2 | 3; opts?: Partial<Building3d> }>, gap: number): Building3d[] {
  let x = 0;
  const out: Building3d[] = [];
  list.forEach((l, i) => {
    const w = plotOf(l.type, l.size ?? 1).W * 20;
    const touchL = gap === 0 && i > 0;
    const touchR = gap === 0 && i < list.length - 1;
    out.push(item(l.type, x + w / 2, { size: l.size ?? 1, sides: { left: touchL, right: touchR }, ...l.opts }));
    x += w + gap;
  });
  const mid = x / 2;
  for (const b of out) b.x -= mid;
  return out;
}

export function showGallery3d(): void {
  const q = new URLSearchParams(location.search);
  const hour = Number(q.get('hour') ?? 10);
  const zoom = Number(q.get('zoom') ?? 1.6);
  const buildType = (q.get('type') ?? 'house') as BuildingType;
  if (q.get('cam')) setCameraDistance(Number(q.get('cam')));
  if (q.get('height')) setCameraHeight(Number(q.get('height')));
  set3d(true);
  // &plain=1: Painterly without its painted textures and grading (to compare before and after)
  if (q.get('plain')) Object.assign(STYLES.painterly, { textures: false, grade: 0 });
  const types = modelTypes();
  const rows: Row[] = [
    { title: 'Every building', items: along(types.map((type) => ({ type })), 40), hour },
    {
      title: 'Houses: styles and sizes, walls meeting',
      items: along(
        [
          { type: 'house' },
          { type: 'house', size: 2 },
          { type: 'house' },
          { type: 'house', size: 3 },
          { type: 'house' },
          { type: 'house' },
          { type: 'house', size: 2 },
        ],
        0,
      ),
      hour,
    },
    {
      title: `Going up: ${buildType}`,
      items: along(
        [0.03, 0.08, 0.15, 0.22, 0.3, 0.38, 0.46, 0.55, 0.65, 0.75, 0.84, 0.92, 0.98].map((p) => {
          const s = constructionStage(p);
          return { type: buildType, opts: { build: s.stage === 'done' ? undefined : { stage: s.stage, t: s.t }, seed: 4242, stock: {} } };
        }),
        30,
      ),
      hour,
    },
    { title: 'Evening', items: along(types.map((type) => ({ type, opts: { light: 1, fire: 1, door: 1, age: 0.9 } })), 40), hour: 18.6 },
    { title: 'Night', items: along(types.map((type) => ({ type, opts: { light: 1, fire: 1, shutters: 0 } })), 40), hour: 23 },
    {
      // &rows=5: the &type= building finished, its Large look, and at evening with its door open
      title: `Finished: ${buildType}, its Large look, evening`,
      items: along(
        [
          { type: buildType, opts: { seed: 4242 } },
          { type: buildType, opts: { seed: 4242, upgraded: true } },
          { type: buildType, opts: { seed: 4242, upgraded: true, light: 1, fire: 1, door: 1 } },
        ],
        40,
      ),
      hour,
    },
  ];
  void STAGE_BOUNDS;
  // &styles=1: every style side by side, the same buildings in each (&houses=1: a row of houses instead)
  if (q.get('styles')) {
    const houses = q.get('houses');
    rows.length = 0;
    for (const s of Object.values(STYLES)) {
      const list = houses
        ? along(
            (['house', 'house', 'house', 'tavern', 'house', 'bakery'] as BuildingType[]).map((type, i) => ({ type, size: (i === 1 ? 2 : 1) as 1 | 2, opts: { seed: 31 + i * 17 } })),
            0,
          )
        : along(types.map((type) => ({ type, opts: { seed: 31 } })), 40);
      rows.push({ title: s.label, items: list, hour, style: s.name });
    }
  }
  const only = q.get('rows')?.split(',').map(Number);
  const shown = only ? rows.filter((_, i) => only.includes(i)) : rows;
  const pan = Number(q.get('x') ?? 0);
  const span = q.get('w') ? Number(q.get('w')) : null;

  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#1b1612;overflow:auto;color:#efe3c8;font:14px Georgia,serif';
  const W = span ?? Math.max(...shown.map((r) => r.items.reduce((a, b) => Math.max(a, Math.abs(b.x) + 240), 0) * 2));
  const rowH = 330;
  const canvas = document.createElement('canvas');
  const k = zoom;
  canvas.width = Math.min(16000, Math.round(W * k));
  canvas.height = Math.round(shown.length * rowH * k);
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  let time = 0;
  const draw = () => {
    time += 1 / 30;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1b1612';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    shown.forEach((row, i) => {
      const phase = row.hour / 24;
      const sunHeight = -Math.cos(phase * Math.PI * 2);
      const night = Math.max(0, Math.min(1, (0.1 - sunHeight) / 0.3));
      const top = viewHorizon() - 40;
      const bottom = top + rowH;
      ctx.setTransform(k, 0, 0, k, 0, i * rowH * k - top * k);
      // sky and land, so the buildings stand on something
      const day = Math.max(0, Math.min(1, sunHeight * 2 + 0.3));
      ctx.fillStyle = `rgb(${40 + 120 * day},${55 + 130 * day},${80 + 150 * day})`;
      ctx.fillRect(0, top, W, viewHorizon() - top);
      ctx.fillStyle = `rgb(${50 + 70 * day},${60 + 80 * day},${35 + 30 * day})`;
      ctx.fillRect(0, viewHorizon(), W, bottom - viewHorizon());
      ctx.fillStyle = `rgba(150,120,80,${0.6})`;
      ctx.fillRect(0, 436 + 3, W, 30);
      const v: View3d = { camX: pan - W / 2, viewW: W, top, bottom, pxPerU: k, phase, sunHeight, night, time, style: row.style };
      draw3d(ctx, row.items.map((b) => ({ ...b, x: b.x })), v);
      ctx.fillStyle = '#efe3c8';
      ctx.font = '14px Georgia';
      ctx.fillText(`${row.title} (${row.hour}:00)`, 12 + pan * 0, top + 18);
    });
    void cameraHeight;
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
