// On-screen UI. Two coordinate spaces:
// - Screen UI (HUD, touch buttons, build menu, toasts) is drawn in "UI units"
//   whose size is independent of the world zoom. Layout functions return the
//   rectangles so input hit-testing uses exactly what is drawn.
// - World-anchored labels (plot prompt, progress bars, building names) are drawn
//   in world coordinates, scaled by `k` around their anchor so they stay
//   readable when zoomed out.

import { BUILDINGS, BUILDING_TYPES, ROLES, type Role, storageOf } from '../game/buildings';
import { clock } from '../game/daynight';
import { buildShortfall, upgradeShortfall, villageStock } from '../game/economy';
import { demolitionWork } from '../game/demolition';
import { materialsAllow, siteWork, upgrading } from '../game/site';
import { sizeOf, sizeOfBuilding } from '../game/grid';
import { WOOD_REACH } from '../game/nature';
import { employees, jobsOf } from '../game/people';
import { RESOURCES, type Amounts } from '../game/resources';
import { backOf, mapPoint, streetOf, streetRange } from '../game/streets';
import { constructionStage, demolitionYield, getBuilding, streetFrom, whyNotBuild, whyNotDemolish, type Building, type BuildingOption, type ConstructionStage, type World } from '../game/world';
import { BUILDING_ART } from './buildings';
import { drawBuildingIcon } from './sprites';
import type { Ctx } from './util';

const SERIF = 'Georgia, "Times New Roman", serif';
const GOLD = '#e8c872';

/** Caption shown on the progress bar for each construction stage. */
const STAGE_LABEL: Record<ConstructionStage, string> = {
  staking: 'Marking out the plot',
  foundation: 'Laying the foundation',
  frame: 'Raising the timber frame',
  walls: 'Building the walls',
  roof: 'Putting on the roof',
  done: 'Finished',
};

/** On-screen names of the jobs. */
const ROLE_NAME: Record<Role, string> = { farmer: 'Farmer', builder: 'Builders', miller: 'Miller', baker: 'Baker', woodcutter: 'Woodcutter', stonecutter: 'Stonecutter', serf: 'Serfs' };

/** "50 wood · 20 stone" (only the resources present). */
function amounts(a: Amounts): string {
  const parts = RESOURCES.filter((r) => a[r]).map((r) => `${a[r]} ${r}`);
  return parts.length ? parts.join(' · ') : 'nothing';
}

export interface Toast {
  text: string;
  at: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function hit(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

// --- Primitives ----------------------------------------------------------------

function panel(ctx: Ctx, x: number, y: number, w: number, h: number, alpha = 0.78): void {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = '#1e1710';
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.globalAlpha /= alpha;
  ctx.strokeStyle = 'rgba(232,200,114,0.55)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8);
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function text(ctx: Ctx, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', bold = false): void {
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${SERIF}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(s, x + 1, y + 1.5);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

/** Font size that makes `s` fit in `maxW`, never larger than `size`. */
function fitSize(ctx: Ctx, s: string, size: number, maxW: number, bold = false): number {
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${SERIF}`;
  const w = ctx.measureText(s).width;
  return w > maxW ? Math.max(8, (size * maxW) / w) : size;
}

function button(ctx: Ctx, r: Rect, pressed: boolean, round = false): void {
  ctx.save();
  ctx.globalAlpha = pressed ? 0.85 : 0.55;
  ctx.fillStyle = pressed ? '#5a4526' : '#1e1710';
  if (round) {
    ctx.beginPath();
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, Math.PI * 2);
  } else roundRect(ctx, r.x, r.y, r.w, r.h, Math.min(12, r.w * 0.3));
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function arrowIcon(ctx: Ctx, r: Rect, dir: -1 | 1): void {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const s = r.w * 0.22;
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.moveTo(cx + dir * s, cy);
  ctx.lineTo(cx - dir * s * 0.7, cy - s);
  ctx.lineTo(cx - dir * s * 0.7, cy + s);
  ctx.closePath();
  ctx.fill();
}

function hammerIcon(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.6);
  ctx.fillStyle = '#b98a52';
  ctx.fillRect(-s * 0.08, -s * 0.2, s * 0.16, s * 0.75);
  ctx.fillStyle = GOLD;
  ctx.fillRect(-s * 0.36, -s * 0.42, s * 0.72, s * 0.26);
  ctx.restore();
}

function plusMinusIcon(ctx: Ctx, r: Rect, plus: boolean): void {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const s = r.w * 0.28;
  const t = Math.max(1.5, r.w * 0.1);
  ctx.fillStyle = GOLD;
  ctx.fillRect(cx - s, cy - t / 2, s * 2, t);
  if (plus) ctx.fillRect(cx - t / 2, cy - s, t, s * 2);
}

// --- HUD -------------------------------------------------------------------------

export interface HudLayout {
  zoomOut: Rect;
  zoomIn: Rect;
  /** Start a new village: left of the zoom keys. */
  newVillage: Rect;
  left: Rect;
  right: Rect;
  build: Rect;
  /** Touch buttons to turn at a crossroads: onto the road away from the viewer, and towards them. */
  turnUp: Rect;
  turnDown: Rect;
  /** The village map, top right. */
  map: Rect;
}

/** Size of the small round-cornered HUD buttons (zoom), in UI units; the side panels' buttons match it. */
export const HUD_BUTTON = 14;

export function hudLayout(uiW: number, uiH: number): HudLayout {
  const z = HUD_BUTTON;
  const b = 76;
  const build = { x: uiW - 16 - 86, y: uiH - 16 - 86, w: 86, h: 86 };
  const mapW = Math.round(Math.min(170, uiW * 0.34));
  return {
    zoomOut: { x: uiW - 12 - z * 2 - 4, y: 12, w: z, h: z },
    zoomIn: { x: uiW - 12 - z, y: 12, w: z, h: z },
    newVillage: { x: uiW - 12 - z * 2 - 4 - 6 - 64, y: 12, w: 64, h: z },
    left: { x: 16, y: uiH - 16 - b, w: b, h: b },
    right: { x: 16 + b + 14, y: uiH - 16 - b, w: b, h: b },
    build,
    turnUp: { x: build.x - 14 - 64, y: build.y, w: 64, h: 40 },
    turnDown: { x: build.x - 14 - 64, y: build.y + 46, w: 64, h: 40 },
    map: { x: uiW - 12 - mapW, y: 12 + z + 8, w: mapW, h: Math.round(mapW * 0.72) },
  };
}

export interface HudState {
  touch: boolean;
  leftHeld: boolean;
  rightHeld: boolean;
  /** Rider stands at an empty plot. */
  canBuild: boolean;
  /** Rider stands at a crossroads. */
  canTurn: boolean;
  /** The village is shown from above: no small map. */
  topView: boolean;
}

export function drawHud(ctx: Ctx, world: World, uiW: number, uiH: number, st: HudState): void {
  const L = hudLayout(uiW, uiH);
  text(ctx, 'Village Crown', 16, 34, 24, GOLD, 'left', true);
  const lines = st.touch
    ? ['Hold the arrows to ride, hammer to build, upgrade or destroy', 'Pinch or tap - + to zoom']
    : ['A D / ← → ride   S / ↓ / Space build, upgrade or destroy   W / S turn at a crossroads   Tab view from above   G grid   C construction   M sound', 'In the menu: WASD choose, Space confirm, Esc / Q close   - + zoom'];
  const maxW = L.map.x - 28;
  let y = 54;
  for (const s of lines) {
    text(ctx, s, 16, y, fitSize(ctx, s, 12, maxW), '#f3ead8');
    y += 16;
  }
  const built = world.buildings.filter((b) => b.status === 'done').length;
  const c = clock(world);
  const hhmm = `${String(c.hours).padStart(2, '0')}:${String(c.minutes).padStart(2, '0')}`;
  text(ctx, `Day ${c.day} · ${hhmm}   Buildings: ${built}`, 16, y + 2, 12, '#cbbfa4');
  const working = world.people.filter((p) => p.job).length;
  const stockLine = `Stored: ${amounts(villageStock(world))}   People ${world.people.length} (${working} at work)`;
  text(ctx, stockLine, 16, y + 18, fitSize(ctx, stockLine, 12, maxW), '#e8d9a8');

  if (!st.topView) drawMiniMap(ctx, world, L.map);
  else {
    // where the small map was: the way back to the street
    const r = { ...L.map, h: 34 };
    panel(ctx, r.x, r.y, r.w, r.h, 0.75);
    text(ctx, 'Back to the street', r.x + r.w / 2, r.y + 22, fitSize(ctx, 'Back to the street', 13, r.w - 12, true), GOLD, 'center', true);
  }
  button(ctx, L.zoomOut, false);
  plusMinusIcon(ctx, L.zoomOut, false);
  button(ctx, L.zoomIn, false);
  plusMinusIcon(ctx, L.zoomIn, true);
  text(ctx, 'New village', L.newVillage.x + L.newVillage.w / 2, L.newVillage.y + L.newVillage.h - 3.5, 9, GOLD, 'center', true);

  if (st.touch && !world.menu) {
    button(ctx, L.left, st.leftHeld);
    arrowIcon(ctx, L.left, -1);
    button(ctx, L.right, st.rightHeld);
    arrowIcon(ctx, L.right, 1);
    ctx.globalAlpha = st.canBuild ? 1 : 0.4;
    button(ctx, L.build, false, true);
    hammerIcon(ctx, L.build.x + L.build.w / 2, L.build.y + L.build.h / 2, L.build.w * 0.5);
    ctx.globalAlpha = 1;
    if (st.canTurn) {
      for (const [r, dir] of [[L.turnUp, -1], [L.turnDown, 1]] as const) {
        button(ctx, r, false);
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        ctx.fillStyle = GOLD;
        ctx.beginPath();
        ctx.moveTo(cx - 11, cy - dir * 6);
        ctx.lineTo(cx + 11, cy - dir * 6);
        ctx.lineTo(cx, cy + dir * 8);
        ctx.fill();
      }
    }
  }
}

/** Most of the village (world px) the map shows across; a bigger network is shown around the rider. */
const MAP_SPAN = 4200;
/** How far behind its street (world px) a building is marked on the map. */
const MAP_LOT = 80;

/**
 * The village map: the streets and a small picture of every building, north
 * up, with the rider as a gold arrow. It fits the whole network, zoomed in no
 * closer than MAP_SPAN across, and follows the rider when that is too big.
 */
function drawMiniMap(ctx: Ctx, world: World, r: Rect): void {
  panel(ctx, r.x, r.y, r.w, r.h, 0.55);
  ctx.save();
  roundRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 6);
  ctx.clip();

  const ends = world.streets.filter((s) => !s.gone).map((s) => {
    const { min, max } = streetRange(world, s.index);
    return [mapPoint(world, min), mapPoint(world, max)] as const;
  });
  const pts = ends.flat();
  const pad = 250;
  const box = {
    minX: Math.min(...pts.map((p) => p.x)) - pad,
    maxX: Math.max(...pts.map((p) => p.x)) + pad,
    minY: Math.min(...pts.map((p) => p.y)) - pad,
    maxY: Math.max(...pts.map((p) => p.y)) + pad,
  };
  const scale = Math.max(Math.min(r.w / (box.maxX - box.minX), r.h / (box.maxY - box.minY)), r.w / MAP_SPAN);
  const me = mapPoint(world, world.rider.x);
  const centre = (lo: number, hi: number, at: number, half: number) => (hi - lo <= half * 2 ? (lo + hi) / 2 : Math.max(lo + half, Math.min(hi - half, at)));
  const cx = centre(box.minX, box.maxX, me.x, r.w / 2 / scale);
  const cy = centre(box.minY, box.maxY, me.y, r.h / 2 / scale);
  const sx = (x: number) => r.x + r.w / 2 + (x - cx) * scale;
  const sy = (y: number) => r.y + r.h / 2 - (y - cy) * scale;

  // streets
  ctx.lineCap = 'round';
  for (const [colour, width] of [['#3a2a1c', 5], ['#c9a86a', 2.5]] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    for (const [a, b] of ends) {
      ctx.beginPath();
      ctx.moveTo(sx(a.x), sy(a.y));
      ctx.lineTo(sx(b.x), sy(b.y));
      ctx.stroke();
    }
  }

  // buildings, standing on their lots behind the street (crossroads are the streets meeting)
  const iconScale = Math.max(0.03, scale * 1.25);
  const lots = world.buildings
    .filter((b) => b.type !== 'intersection')
    .map((b) => {
      const x = b.x;
      const p = mapPoint(world, x);
      const back = backOf(world.streets[streetOf(x)]?.dir ?? { x: 1, y: 0 });
      return { b, x: sx(p.x + back.x * MAP_LOT), y: sy(p.y + back.y * MAP_LOT) };
    })
    .filter((l) => l.x > r.x - 20 && l.x < r.x + r.w + 20 && l.y > r.y - 20 && l.y < r.y + r.h + 30)
    // nearer the bottom of the map is nearer the viewer: drawn last
    .sort((a, b) => a.y - b.y);
  for (const { b, x, y } of lots) {
    ctx.globalAlpha = b.status === 'done' ? 1 : 0.45;
    drawBuildingIcon(ctx, b.type, x, y + 3, iconScale, world.time);
  }
  ctx.globalAlpha = 1;

  // the rider: an arrow the way they are heading
  const street = world.streets[streetOf(world.rider.x)] ?? world.streets[0];
  const hx = street.dir.x * world.rider.facing;
  const hy = -street.dir.y * world.rider.facing;
  const px = sx(me.x);
  const py = sy(me.y);
  ctx.fillStyle = GOLD;
  ctx.strokeStyle = '#3a2a1c';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(px + hx * 6, py + hy * 6);
  ctx.lineTo(px - hx * 4 - hy * 4, py - hy * 4 + hx * 4);
  ctx.lineTo(px - hx * 4 + hy * 4, py - hy * 4 - hx * 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  text(ctx, 'N', r.x + r.w - 9, r.y + 13, 9, '#cbbfa4', 'center', true);
}

/** Just after turning at a crossroads the view comes up out of a short fade. */
export function drawTurnFade(ctx: Ctx, world: World, uiW: number, uiH: number): void {
  const t = world.rider.turnedAt;
  if (t === undefined) return;
  const age = world.time - t;
  if (age < 0 || age > 0.45) return;
  ctx.fillStyle = `rgba(20,14,8,${(1 - age / 0.45) * 0.9})`;
  ctx.fillRect(0, 0, uiW, uiH);
}

export function drawToasts(ctx: Ctx, toasts: Toast[], now: number, uiW: number): void {
  let y = 124;
  for (const t of toasts) {
    const age = now - t.at;
    if (age > 3) continue;
    ctx.globalAlpha = Math.min(1, age * 4, (3 - age) * 2);
    const size = fitSize(ctx, t.text, 16, uiW - 64, true);
    ctx.font = `bold ${size}px ${SERIF}`;
    const w = ctx.measureText(t.text).width + 36;
    panel(ctx, uiW / 2 - w / 2, y - 22, w, 32, 0.7);
    text(ctx, t.text, uiW / 2, y, size, GOLD, 'center', true);
    ctx.globalAlpha = 1;
    y += 40;
  }
}

// --- Build menu --------------------------------------------------------------------

export interface MenuLayout {
  panel: Rect;
  cards: Rect[];
  build: Rect;
  cancel: Rect;
  titleY: number;
  infoY: number;
}

export function menuLayout(uiW: number, uiH: number): MenuLayout {
  const n = BUILDING_TYPES.length;
  const cols = Math.min(n, Math.max(3, Math.floor((uiW - 40) / 100)));
  const rows = Math.ceil(n / cols);
  const cardW = Math.min(104, (uiW - 40) / cols);
  const chrome = 44 + 60 + 58; // title + info + buttons
  const cardH = Math.max(70, Math.min(108, (uiH - 24 - chrome - (rows - 1) * 8) / rows));
  const pw = cols * cardW + 24;
  const ph = chrome + rows * cardH + (rows - 1) * 8;
  const px = (uiW - pw) / 2;
  const py = Math.max(12, uiH - ph - 12);
  const cards: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    // centre a partial last row
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const rowX = px + 12 + ((cols - inRow) * cardW) / 2;
    cards.push({ x: rowX + c * cardW + 3, y: py + 44 + r * (cardH + 8), w: cardW - 6, h: cardH });
  }
  const infoY = py + 44 + rows * cardH + (rows - 1) * 8 + 24;
  const bw = Math.min(150, (pw - 36) / 2);
  const by = py + ph - 50;
  return {
    panel: { x: px, y: py, w: pw, h: ph },
    cards,
    build: { x: uiW / 2 + 6, y: by, w: bw, h: 38 },
    cancel: { x: uiW / 2 - 6 - bw, y: by, w: bw, h: 38 },
    titleY: py + 30,
    infoY,
  };
}

/** The menu at a building: a card for each thing that can be done to it, what it means, and Cancel / do it. */
export function buildingMenuLayout(uiW: number, uiH: number, n: number): MenuLayout {
  const cardW = 150;
  const cardH = 108;
  const pw = Math.min(uiW - 24, Math.max(340, n * cardW + 24));
  const w = Math.min(cardW, (pw - 24) / n);
  const ph = 44 + cardH + 60 + 58;
  const px = (uiW - pw) / 2;
  const py = Math.max(12, uiH - ph - 12);
  const cards = Array.from({ length: n }, (_, i) => ({ x: uiW / 2 - (n * w) / 2 + i * w + 3, y: py + 44, w: w - 6, h: cardH }));
  const bw = Math.min(150, (pw - 36) / 2);
  const by = py + ph - 50;
  return {
    panel: { x: px, y: py, w: pw, h: ph },
    cards,
    build: { x: uiW / 2 + 6, y: by, w: bw, h: 38 },
    cancel: { x: uiW / 2 - 6 - bw, y: by, w: bw, h: 38 },
    titleY: py + 30,
    infoY: py + 44 + cardH + 24,
  };
}

const OPTION_NAME: Record<BuildingOption, string> = { upgrade: 'Upgrade', demolishSection: 'Destroy this section', demolish: 'Destroy' };

function drawBuildingMenu(ctx: Ctx, world: World, uiW: number, uiH: number): void {
  const menu = world.menu;
  if (menu?.kind !== 'building') return;
  const b = getBuilding(world, menu.buildingId);
  if (!b) return;
  const def = BUILDINGS[b.type];
  const upgrade = def.upgrade;
  const M = buildingMenuLayout(uiW, uiH, menu.options.length);

  ctx.fillStyle = 'rgba(20,14,8,0.35)';
  ctx.fillRect(0, 0, uiW, uiH);
  panel(ctx, M.panel.x, M.panel.y, M.panel.w, M.panel.h, 0.9);
  const title = `The ${b.upgraded && upgrade ? upgrade.name : def.name}`;
  text(ctx, title, uiW / 2, M.titleY, 17, GOLD, 'center', true);

  menu.options.forEach((option, i) => {
    const r = M.cards[i];
    const sel = i === menu.selection;
    ctx.save();
    ctx.fillStyle = sel ? 'rgba(232,200,114,0.22)' : 'rgba(255,240,210,0.06)';
    roundRect(ctx, r.x, r.y, r.w, r.h, 6);
    ctx.fill();
    if (sel) {
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    roundRect(ctx, r.x, r.y, r.w, r.h - 24, 6);
    ctx.clip();
    if (option === 'upgrade' && Object.keys(upgradeShortfall(world, b)).length) ctx.globalAlpha = 0.4;
    if (option !== 'upgrade' && whyNotDemolish(world, b)) ctx.globalAlpha = 0.4;
    const previewH = r.h - 34;
    // this very building, as it stands: its width (a merged one), look, store and fields
    const width = sizeOfBuilding(b).w * 25;
    const like = { seed: b.id * 97, width, upgraded: !!b.upgraded, stock: b.stock, farm: b.farm };
    const scale = Math.min(0.6, (r.w - 8) / (width * 1.3), previewH / (BUILDING_ART[b.type].height + 20));
    if (option !== 'upgrade') {
      // the building, faded, with a red cross over it (a small one, for a section)
      ctx.globalAlpha = 0.45;
      drawBuildingIcon(ctx, b.type, r.x + r.w / 2, r.y + r.h - 30, scale, world.time, like);
      ctx.globalAlpha = 1;
      const k = option === 'demolishSection' ? 0.55 : 1;
      const cx = r.x + r.w / 2;
      const cy = r.y + (r.h - 24) / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(k, k);
      ctx.translate(-cx, -cy);
      ctx.strokeStyle = '#c8553d';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 18, cy - 18);
      ctx.lineTo(cx + 18, cy + 18);
      ctx.moveTo(cx + 18, cy - 18);
      ctx.lineTo(cx - 18, cy + 18);
      ctx.stroke();
      ctx.restore();
    } else drawBuildingIcon(ctx, b.type, r.x + r.w / 2, r.y + r.h - 30, scale, world.time, like);
    ctx.restore();
    const label = `${i + 1}. ${OPTION_NAME[option]}`;
    text(ctx, label, r.x + r.w / 2, r.y + r.h - 8, fitSize(ctx, label, 12, r.w - 6, sel), sel ? GOLD : '#f3ead8', 'center', sel);
  });

  const option = menu.options[menu.selection];
  let line1: string;
  let line2: string;
  let short = false;
  if (option === 'upgrade' && upgrade) {
    const lack = upgradeShortfall(world, b);
    short = Object.keys(lack).length > 0;
    line1 = `Make it a ${upgrade.name}`;
    const time = world.constructionEnabled ? `Builds in ${+(upgrade.buildTime / world.params.buildSpeed).toFixed(1)}s` : 'Builds instantly (construction off)';
    line2 = `Costs ${amounts(upgrade.cost)}` + (short ? ` — need ${amounts(lack)} more` : '') + `   ·   ${time}`;
  } else {
    // a section is a small one's share of the whole
    const part = option === 'demolishSection' ? 1 / (b.size ?? 1) : 1;
    const left = demolitionYield(b);
    const rounded: Amounts = {};
    for (const r of RESOURCES) if (left[r] * part >= 0.5) rounded[r] = Math.round(left[r] * part);
    const secs = +((demolitionWork(b) * part) / world.params.buildSpeed).toFixed(1);
    const street = streetFrom(world, b);
    const why = whyNotDemolish(world, b);
    if (option === 'demolishSection') {
      const k = Math.floor((menu.x - (b.x - ((b.size ?? 1) * 75) / 2)) / 75);
      const middle = k > 0 && k < (b.size ?? 1) - 1;
      line1 = (world.constructionEnabled ? `Builders pull down the section you are at in ${secs}s` : 'Pull down the section you are at, at once') + (middle ? '; the rest stands as two' : '; the rest stands');
    } else {
      line1 = world.constructionEnabled ? `Builders pull it down in ${secs}s` : 'Pull it down at once (construction off)';
      line1 += street ? '; the street it opened goes with it' : '; its workers are let go';
    }
    line2 = why ? `Can't: ${why.toLowerCase()}` : Object.keys(rounded).length ? `Leaves ${amounts(rounded)} on the ground for serfs to carry off` : 'Leaves nothing behind';
    short = !!why;
  }
  text(ctx, line1, uiW / 2, M.infoY, fitSize(ctx, line1, 14, M.panel.w - 24), '#f3ead8', 'center');
  text(ctx, line2, uiW / 2, M.infoY + 20, fitSize(ctx, line2, 12, M.panel.w - 24), short ? '#e89a7a' : '#cbbfa4', 'center');

  button(ctx, M.cancel, false);
  text(ctx, 'Cancel', M.cancel.x + M.cancel.w / 2, M.cancel.y + 25, 15, '#f3ead8', 'center', true);
  button(ctx, M.build, true);
  const act = OPTION_NAME[option];
  text(ctx, act, M.build.x + M.build.w / 2, M.build.y + 25, fitSize(ctx, act, 15, M.build.w - 12, true), GOLD, 'center', true);
}

export function drawBuildMenu(ctx: Ctx, world: World, uiW: number, uiH: number): void {
  if (world.menu?.kind === 'building') return drawBuildingMenu(ctx, world, uiW, uiH);
  if (!world.menu) return;
  const menuX = world.menu.x;
  const M = menuLayout(uiW, uiH);

  ctx.fillStyle = 'rgba(20,14,8,0.35)';
  ctx.fillRect(0, 0, uiW, uiH);
  panel(ctx, M.panel.x, M.panel.y, M.panel.w, M.panel.h, 0.9);
  text(ctx, 'What shall we build?', uiW / 2, M.titleY, 17, GOLD, 'center', true);

  M.cards.forEach((r, i) => {
    const type = BUILDING_TYPES[i];
    const def = BUILDINGS[type];
    const sel = i === world.menu!.selection;
    ctx.save();
    ctx.fillStyle = sel ? 'rgba(232,200,114,0.22)' : 'rgba(255,240,210,0.06)';
    roundRect(ctx, r.x, r.y, r.w, r.h, 6);
    ctx.fill();
    if (sel) {
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    roundRect(ctx, r.x, r.y, r.w, r.h - 24, 6);
    ctx.clip();
    // what doesn't fit here is greyed out; what the village can't afford is shown faded
    const fits = !whyNotBuild(world, type, menuX);
    // (no canvas filter: drawing every card through one each frame is far too slow)
    if (!fits) ctx.globalAlpha = 0.2;
    else if (Object.keys(buildShortfall(world, type)).length) ctx.globalAlpha = 0.4;
    const previewH = r.h - 34;
    const scale = Math.min(0.6, (r.w - 8) / (def.width * 1.3), previewH / (BUILDING_ART[type].height + 20));
    drawBuildingIcon(ctx, type, r.x + r.w / 2, r.y + r.h - 30, scale, world.time);
    ctx.restore();
    const label = `${i + 1}. ${def.name}`;
    text(ctx, label, r.x + r.w / 2, r.y + r.h - 8, fitSize(ctx, label, 12, r.w - 6, sel), !fits ? '#8a8378' : sel ? GOLD : '#f3ead8', 'center', sel);
  });

  const def = BUILDINGS[BUILDING_TYPES[world.menu.selection]];
  text(ctx, def.purpose, uiW / 2, M.infoY, fitSize(ctx, def.purpose, 14, M.panel.w - 24), '#f3ead8', 'center');
  const time = world.constructionEnabled ? `Builds in ${+(def.buildTime / world.params.buildSpeed).toFixed(1)}s` : 'Builds instantly (construction off)';
  const lack = buildShortfall(world, def.type);
  const cost = `Costs ${amounts(def.cost)}` + (Object.keys(lack).length ? ` — need ${amounts(lack)} more` : '');
  const { w, d } = sizeOf(def.type);
  const why = whyNotBuild(world, def.type, menuX);
  const size = def.type === 'intersection' ? 'a road across' : `${w} × ${d} squares`;
  const info = `${cost}   ·   ${time}   ·   ${size}` + (why ? `   ·   ${why}` : '');
  text(ctx, info, uiW / 2, M.infoY + 20, fitSize(ctx, info, 12, M.panel.w - 24), Object.keys(lack).length || why ? '#e89a7a' : '#cbbfa4', 'center');

  button(ctx, M.cancel, false);
  text(ctx, 'Cancel', M.cancel.x + M.cancel.w / 2, M.cancel.y + 25, 15, '#f3ead8', 'center', true);
  button(ctx, M.build, true);
  text(ctx, `Build ${def.name}`, M.build.x + M.build.w / 2, M.build.y + 25, fitSize(ctx, `Build ${def.name}`, 15, M.build.w - 12, true), GOLD, 'center', true);
}

// --- World-anchored labels ------------------------------------------------------------

function around(ctx: Ctx, x: number, y: number, k: number, draw: () => void): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.translate(-x, -y);
  draw();
  ctx.restore();
}

/** Warm glow on the ground at the empty plot the rider stands at (drawn behind the rider). */
export function drawPlotGlow(ctx: Ctx, sx: number, base: number): void {
  const g = ctx.createRadialGradient(sx, base, 5, sx, base, 110);
  g.addColorStop(0, 'rgba(255,220,140,0.35)');
  g.addColorStop(1, 'rgba(255,220,140,0)');
  ctx.fillStyle = g;
  ctx.fillRect(sx - 110, base - 20, 220, 30);
}

/** Floating marker over the empty plot the rider stands at. */
export function drawPlotPrompt(ctx: Ctx, sx: number, base: number, time: number, label: string, k: number): void {
  const y = base - 70 + Math.sin(time * 3) * 4;
  around(ctx, sx, y, k, () => {
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.moveTo(sx - 9, y - 10);
    ctx.lineTo(sx + 9, y - 10);
    ctx.lineTo(sx, y);
    ctx.fill();
    text(ctx, label, sx, y - 18, 13, '#fff4dc', 'center', true);
  });
}

/**
 * Name, purpose, store and workers: the label over a finished building the
 * rider is next to; with `upgradeHint`, how to upgrade it and what that costs;
 * with `turnHint` (at a crossroads), how to turn onto the other street.
 */
export function drawBuildingLabel(ctx: Ctx, world: World, b: Building, sx: number, y: number, k: number, viewW: number, upgradeHint: string | null, turnHint: string | null = null): void {
  const def = BUILDINGS[b.type];
  const name = b.upgraded && def.upgrade ? def.upgrade.name : def.name;
  const lines = [def.purpose];
  const storage = storageOf(b);
  const stored = RESOURCES.filter((r) => storage[r]);
  if (stored.length) lines.push(`Store: ${stored.map((r) => `${r} ${Math.round(b.stock[r])}/${storage[r]}`).join(' · ')}`);
  for (const role of ROLES) {
    const slots = jobsOf(b)[role] ?? 0;
    if (!slots) continue;
    const staff = employees(world, b).filter((p) => p.job!.role === role);
    const names = staff.map((p) => `${p.name} (#${p.id})`).join(', ');
    lines.push(`${ROLE_NAME[role]}: ${names || 'nobody free to hire'}${slots > 1 ? ` (${staff.length}/${slots})` : ''}`);
  }
  if (b.farm) {
    const n = (st: string) => b.farm!.plots.filter((p) => p.state === st).length;
    lines.push(`Fields: ${n('ripe')} ripe · ${n('growing')} growing · ${n('fallow')} to sow`);
  }
  if (b.type === 'woodcutter') {
    const x = b.x;
    const near = world.trees.filter((t) => Math.abs(t.x - x) <= WOOD_REACH);
    const n = (st: string) => near.filter((t) => t.state === st).length;
    lines.push(`Woods in reach: ${n('grown')} trees to fell · ${n('growing')} growing`);
  }
  if (upgradeHint && def.upgrade) {
    const cost = RESOURCES.filter((r) => def.upgrade!.cost[r]).map((r) => `${def.upgrade!.cost[r]} ${r}`).join(' · ');
    const short = Object.keys(upgradeShortfall(world, b)).length ? ' — not enough yet' : '';
    lines.push(`${upgradeHint} to a ${def.upgrade.name} (${cost})${short}`);
  }
  if (turnHint) lines.push(turnHint);
  ctx.font = `12px ${SERIF}`;
  const lineW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  ctx.font = `bold 14px ${SERIF}`;
  const w = Math.max(60, lineW, ctx.measureText(name).width) + 24;
  // keep the label on screen (it may be wider than a phone's view)
  const half = (w / 2) * k + 6;
  sx = half * 2 > viewW ? viewW / 2 : Math.max(half, Math.min(viewW - half, sx));
  around(ctx, sx, y, k, () => {
    const h = 24 + lines.length * 16;
    panel(ctx, sx - w / 2, y - h - 4, w, h, 0.6);
    text(ctx, name, sx, y - h + 13, 14, GOLD, 'center', true);
    lines.forEach((l, i) => text(ctx, l, sx, y - h + 29 + i * 16, 12, i ? '#e8d9a8' : '#f3ead8', 'center'));
  });
}

/** Progress bar over a construction site, with how much of its materials have arrived. */
export function drawProgress(ctx: Ctx, world: World, b: Building, sx: number, y: number, k: number): void {
  const w = 110;
  const { stage } = constructionStage(b.progress);
  const def = BUILDINGS[b.type];
  const caption = upgrading(b) && def.upgrade ? `${def.name} — upgrading to a ${def.upgrade.name}` : `${def.name} — ${STAGE_LABEL[stage]}`;
  const cost = siteWork(b).cost;
  const delivered = b.site?.delivered;
  const builders = employees(world, b).filter((p) => p.job!.role === 'builder').length;
  const materials =
    RESOURCES.filter((r) => cost[r])
      .map((r) => `${r} ${delivered?.[r] ?? 0}/${cost[r]}`)
      .join(' · ') + `  ·  ${builders ? `${builders} builder${builders > 1 ? 's' : ''}` : 'no builders free'}`;
  ctx.font = `10px ${SERIF}`;
  // box grows with the captions; the bar keeps its fixed width
  const pw = Math.max(w, ctx.measureText(caption).width, ctx.measureText(materials).width) + 12;
  around(ctx, sx, y, k, () => {
    panel(ctx, sx - pw / 2, y - 44, pw, 44, 0.6);
    ctx.fillStyle = '#3a2e22';
    ctx.fillRect(sx - w / 2, y - 26, w, 6);
    // how far the materials allow, then how far it is built
    ctx.fillStyle = 'rgba(232,200,114,0.3)';
    ctx.fillRect(sx - w / 2, y - 26, w * materialsAllow(b), 6);
    ctx.fillStyle = GOLD;
    ctx.fillRect(sx - w / 2, y - 26, w * b.progress, 6);
    text(ctx, caption, sx, y - 31, 10, '#f3ead8', 'center');
    text(ctx, materials, sx, y - 8, 10, '#cbbfa4', 'center');
  });
}

/** Over a building being pulled down: "In demolition", how far it has come down, and who is at it. */
export function drawDemolitionLabel(ctx: Ctx, world: World, b: Building, sx: number, y: number, k: number): void {
  const w = 110;
  const caption = `${BUILDINGS[b.type].name} — In demolition`;
  const builders = employees(world, b).filter((p) => p.job!.role === 'builder').length;
  const crew = builders ? `${builders} builder${builders > 1 ? 's' : ''}` : 'no builders free';
  const down = b.demolition ? 1 - b.progress / b.demolition.from : 1;
  ctx.font = `10px ${SERIF}`;
  const pw = Math.max(w, ctx.measureText(caption).width, ctx.measureText(crew).width) + 12;
  around(ctx, sx, y, k, () => {
    panel(ctx, sx - pw / 2, y - 44, pw, 44, 0.6);
    ctx.fillStyle = '#3a2e22';
    ctx.fillRect(sx - w / 2, y - 26, w, 6);
    ctx.fillStyle = '#d07a5a';
    ctx.fillRect(sx - w / 2, y - 26, w * Math.max(0, Math.min(1, down)), 6);
    text(ctx, caption, sx, y - 31, 10, '#f3ead8', 'center');
    text(ctx, crew, sx, y - 8, 10, '#cbbfa4', 'center');
  });
}

/** Golden sparkle burst over a building that just finished. */
export function drawCompletionEffect(ctx: Ctx, sx: number, base: number, height: number, age: number, seed: number): void {
  if (age < 0 || age > 2) return;
  const t = age / 2;
  for (let i = 0; i < 26; i++) {
    const a = ((i * 137.5 + seed) % 360) * (Math.PI / 180);
    const r = 20 + t * (70 + (i % 5) * 16);
    const x = sx + Math.cos(a) * r;
    const y = base - height * 0.55 + Math.sin(a) * r * 0.7 - t * 30;
    ctx.globalAlpha = (1 - t) * 0.9;
    ctx.fillStyle = i % 3 ? GOLD : '#fff6de';
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  ctx.globalAlpha = (1 - t) * 0.4;
  ctx.fillStyle = '#d8c7a0';
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.arc(sx + (i - 3.5) * 22, base - 4 - t * 6, 10 + t * 14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
