// The showroom (a dev aid): the art experiments (tools/paint/showroom.ts →
// public/showroom/) standing side by side along the main street, in the free
// stretches between the village's buildings, each with its label, so they can
// be judged in the game at its own scale beside its people. They're pictures on
// the land, not buildings: nobody walks round them. On by default in the dev
// build; the Menu turns it off.

import { cellKey, crossroadsPlaces, landUse, streetCell } from '../game/grid';
import { CELL_W, LOT_ROW, yAt } from '../game/layout';
import { streetOf, streetRange, streetStart } from '../game/streets';
import type { World } from '../game/world';
import { viewRatio } from './ground';
import { type Ctx, rect } from './util';

interface Item {
  /** Its number (#n), to talk about it by. */
  n: number;
  file: string;
  label: string;
  kind: 'cutout' | 'framed';
  width: number;
  aspect: number;
  img?: HTMLImageElement;
  /** Where it stands: world x of its middle; `front`: in front of the road (beside the easels). */
  x?: number;
  front?: boolean;
}

let on = import.meta.env?.DEV ?? false;
let items: Item[] | null = null;
let laidOut = false;

export function setShowroom(show: boolean): void {
  on = show;
}

function load(): void {
  if (items) return;
  items = [];
  // always the latest list (no cached copy), numbered by place if it has no numbers
  fetch(`showroom/manifest.json?t=${Date.now()}`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : []))
    .then((list: Item[]) => {
      items = list.map((it, k) => ({ ...it, n: it.n ?? k + 1 }));
      for (const it of items) {
        const img = new Image();
        img.src = `showroom/${it.file}?t=${Date.now()}`;
        it.img = img;
      }
    })
    .catch(() => (items = []));
}

/** Stand the pictures in the free stretches of the main street, left to right from the village. */
function layOut(world: World): void {
  if (laidOut || !items?.length) return;
  laidOut = true;
  const s = world.streets[0];
  const land = landUse(world);
  const kept = new Set(crossroadsPlaces(world).filter((x) => streetOf(x) === 0).map((x) => Math.floor((x - streetStart(0)) / CELL_W)));
  const { min, max } = streetRange(world, 0);
  const i0 = Math.ceil((min - streetStart(0)) / CELL_W) + 1;
  const i1 = Math.floor((max - streetStart(0)) / CELL_W) - 1;
  const free = (i: number) => {
    if (kept.has(i)) return false;
    // anything but a building or a road will do (a picture may stand in a field)
    for (let j = LOT_ROW; j <= LOT_ROW + 2; j++) {
      const c = streetCell(s, i, j);
      const u = land.get(cellKey(c.c, c.r));
      if (u && u.kind !== 'field') return false;
    }
    return true;
  };
  // buildings on the building line, in the free stretches; scenes on easels in front of the road, one after
  // another (clear of the side roads of crossroads)
  let i = i0;
  const overflow: Item[] = [];
  for (const it of items.filter((x) => x.kind === 'cutout')) {
    const cells = Math.ceil((it.width * 20) / CELL_W);
    // the next run of free cells wide enough; if the building line is full, in front of the road
    let j = i;
    while (j + cells < i1 && !Array.from({ length: cells }, (_, k) => free(j + k)).every(Boolean)) j++;
    if (j + cells >= i1) {
      overflow.push(it);
      continue;
    }
    it.x = streetStart(0) + (j + cells / 2) * CELL_W;
    i = j + cells;
  }
  i = i0;
  for (const it of [...items.filter((x) => x.kind === 'framed'), ...overflow]) {
    it.front = true;
    const cells = Math.ceil((it.width * 20) / (it.kind === 'cutout' ? viewRatio(EASEL_Y) : 1) / CELL_W) + 1;
    while (i + cells < i1 && Array.from({ length: cells }, (_, k) => [...kept].some((c) => Math.abs(c - (i + k)) <= 1)).some(Boolean)) i++;
    if (i + cells >= i1) break;
    it.x = streetStart(0) + (i + cells / 2) * CELL_W;
    i += cells;
  }
  const placed = items.filter((it) => it.x !== undefined).length;
  if (placed < items.length) console.warn(`showroom: room for ${placed} of ${items.length} pictures on the main street`);
  else console.info(`showroom: ${placed} pictures placed`);
}

/** Depth (world y) the easels stand at: just in front of the road. */
export const EASEL_Y = yAt(-62);

/** The scenes on easels in front of the road on this view: where each stands, and how to draw it at the origin (its foot). */
export function showroomEasels(world: World, camX: number, viewW: number): Array<{ x: number; draw: (ctx: Ctx) => void }> {
  if (!on) return [];
  load();
  layOut(world);
  return (items ?? [])
    .filter((it) => it.front && it.x !== undefined && it.img?.complete && it.img.naturalWidth && streetOf(it.x) === streetOf(world.rider.x) && Math.abs(it.x - camX - viewW / 2) < viewW)
    .map((it) => ({
      x: it.x!,
      draw: (ctx: Ctx) => {
        if (it.kind === 'framed') return easel(ctx, it, 0, 0);
        // as big on screen as on the building line, though it stands nearer the camera
        const w = (it.width * 20) / viewRatio(EASEL_Y);
        const h = w * it.aspect;
        ctx.drawImage(it.img!, -w / 2, -h + 4, w, h);
        label(ctx, `#${it.n} ${it.label}`, 0, -h - 8);
      },
    }));
}

/** A painting on an easel standing at (sx, base): legs, a dark wooden frame, its number and label. */
function easel(ctx: Ctx, it: Item, sx: number, base: number): void {
  const w = it.width * 20;
  const h = w * it.aspect;
  const top = base - h - 26;
  ctx.fillStyle = '#4a3222';
  ctx.fillRect(sx - w * 0.3, base - 26, 4, 26);
  ctx.fillRect(sx + w * 0.3 - 4, base - 26, 4, 26);
  rect(ctx, sx - w / 2 - 6, top - 6, w + 12, h + 12, '#3a281b');
  ctx.drawImage(it.img!, sx - w / 2, top, w, h);
  label(ctx, `#${it.n} ${it.label}`, sx, top - 12);
}

/** Draw the showroom's buildings on this view of the street (base: the building line on screen). */
export function drawShowroom(ctx: Ctx, world: World, camX: number, viewW: number, base: number): void {
  if (!on) return;
  load();
  layOut(world);
  for (const it of items ?? []) {
    if (it.front || it.x === undefined || !it.img?.complete || !it.img.naturalWidth) continue;
    const w = it.width * 20;
    const h = w * it.aspect;
    const sx = it.x - camX;
    if (sx + w < -50 || sx - w > viewW + 50 || streetOf(it.x) !== streetOf(world.rider.x)) continue;
    ctx.drawImage(it.img, sx - w / 2, base - h + 4, w, h);
    label(ctx, `#${it.n} ${it.label}`, sx, base - h - 8);
  }
}

/**
 * Every building's number (#id, as the game numbers it) over it, while the showroom is on: to talk
 * about a particular building. `top` says how far up its picture reaches (world units).
 */
export function drawBuildingNumbers(ctx: Ctx, world: World, camX: number, viewW: number, base: number, top: (b: World['buildings'][number]) => number): void {
  if (!on) return;
  const street = streetOf(world.rider.x);
  for (const b of world.buildings) {
    const sx = b.x - camX;
    if (streetOf(b.x) !== street || sx < -100 || sx > viewW + 100) continue;
    label(ctx, `#${b.id}`, sx, base - top(b) - 6);
  }
}

function label(ctx: Ctx, text: string, x: number, y: number): void {
  ctx.save();
  ctx.font = '9px Georgia, serif';
  ctx.textAlign = 'center';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = 'rgba(20,14,8,0.75)';
  ctx.fillRect(x - w / 2, y - 9, w, 13);
  ctx.fillStyle = '#efe3c8';
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}
