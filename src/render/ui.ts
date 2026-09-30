// On-screen UI. Two coordinate spaces:
// - Screen UI (HUD, touch buttons, build menu, toasts) is drawn in "UI units"
//   whose size is independent of the world zoom. Layout functions return the
//   rectangles so input hit-testing uses exactly what is drawn.
// - World-anchored labels (plot prompt, progress bars, building names) are drawn
//   in world coordinates, scaled by `k` around their anchor so they stay
//   readable when zoomed out.

import { BUILDINGS, BUILDING_TYPES, ROLES, type Role } from '../game/buildings';
import { clock } from '../game/daynight';
import { buildShortfall, villageStock } from '../game/economy';
import { materialsAllow } from '../game/site';
import { isBorrowed } from '../game/farm';
import { employees } from '../game/people';
import { RESOURCES, type Amounts } from '../game/resources';
import { constructionStage, type Building, type ConstructionStage, type World } from '../game/world';
import { BUILDING_ART, drawBuildingIcon } from './buildings';
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
const ROLE_NAME: Record<Role, string> = { farmer: 'Farmer', builder: 'Builders', miller: 'Miller', serf: 'Serfs' };

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
  } else roundRect(ctx, r.x, r.y, r.w, r.h, 12);
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
  const t = Math.max(2, r.w * 0.08);
  ctx.fillStyle = GOLD;
  ctx.fillRect(cx - s, cy - t / 2, s * 2, t);
  if (plus) ctx.fillRect(cx - t / 2, cy - s, t, s * 2);
}

// --- HUD -------------------------------------------------------------------------

export interface HudLayout {
  zoomOut: Rect;
  zoomIn: Rect;
  left: Rect;
  right: Rect;
  build: Rect;
}

export function hudLayout(uiW: number, uiH: number): HudLayout {
  const z = 20;
  const b = 76;
  return {
    zoomOut: { x: uiW - 12 - z * 2 - 4, y: 12, w: z, h: z },
    zoomIn: { x: uiW - 12 - z, y: 12, w: z, h: z },
    left: { x: 16, y: uiH - 16 - b, w: b, h: b },
    right: { x: 16 + b + 14, y: uiH - 16 - b, w: b, h: b },
    build: { x: uiW - 16 - 86, y: uiH - 16 - 86, w: 86, h: 86 },
  };
}

export interface HudState {
  touch: boolean;
  leftHeld: boolean;
  rightHeld: boolean;
  /** Rider stands at an empty plot. */
  canBuild: boolean;
}

export function drawHud(ctx: Ctx, world: World, uiW: number, uiH: number, st: HudState): void {
  const L = hudLayout(uiW, uiH);
  text(ctx, 'Village Crown', 16, 34, 24, GOLD, 'left', true);
  const lines = st.touch
    ? ['Hold the arrows to ride, hammer to build', 'Pinch or tap - + to zoom']
    : ['A D / ← → ride   S / ↓ / Space build   C construction   M sound', 'In the menu: WASD choose, Space build, Esc / Q close   - + zoom'];
  const maxW = L.zoomOut.x - 28;
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
  const stockLine = `Warehouse: ${amounts(villageStock(world))}   People ${world.people.length} (${working} at work)`;
  text(ctx, stockLine, 16, y + 18, fitSize(ctx, stockLine, 12, maxW), '#e8d9a8');

  button(ctx, L.zoomOut, false);
  plusMinusIcon(ctx, L.zoomOut, false);
  button(ctx, L.zoomIn, false);
  plusMinusIcon(ctx, L.zoomIn, true);

  if (st.touch && !world.menu) {
    button(ctx, L.left, st.leftHeld);
    arrowIcon(ctx, L.left, -1);
    button(ctx, L.right, st.rightHeld);
    arrowIcon(ctx, L.right, 1);
    ctx.globalAlpha = st.canBuild ? 1 : 0.4;
    button(ctx, L.build, false, true);
    hammerIcon(ctx, L.build.x + L.build.w / 2, L.build.y + L.build.h / 2, L.build.w * 0.5);
    ctx.globalAlpha = 1;
  }
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

export function drawBuildMenu(ctx: Ctx, world: World, uiW: number, uiH: number): void {
  if (!world.menu) return;
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
    // what the village can't afford is shown faded
    if (Object.keys(buildShortfall(world, type)).length) ctx.globalAlpha = 0.4;
    const previewH = r.h - 34;
    const scale = Math.min(0.6, (r.w - 8) / (def.width * 1.3), previewH / (BUILDING_ART[type].height + 20));
    drawBuildingIcon(ctx, type, r.x + r.w / 2, r.y + r.h - 30, scale, world.time);
    ctx.restore();
    const label = `${i + 1}. ${def.name}`;
    text(ctx, label, r.x + r.w / 2, r.y + r.h - 8, fitSize(ctx, label, 12, r.w - 6, sel), sel ? GOLD : '#f3ead8', 'center', sel);
  });

  const def = BUILDINGS[BUILDING_TYPES[world.menu.selection]];
  text(ctx, def.purpose, uiW / 2, M.infoY, fitSize(ctx, def.purpose, 14, M.panel.w - 24), '#f3ead8', 'center');
  const time = world.constructionEnabled ? `Builds in ${+(def.buildTime / world.params.buildSpeed).toFixed(1)}s` : 'Builds instantly (construction off)';
  const lack = buildShortfall(world, def.type);
  const cost = `Costs ${amounts(def.cost)}` + (Object.keys(lack).length ? ` — need ${amounts(lack)} more` : '');
  const info = `${cost}   ·   ${time}`;
  text(ctx, info, uiW / 2, M.infoY + 20, fitSize(ctx, info, 12, M.panel.w - 24), Object.keys(lack).length ? '#e89a7a' : '#cbbfa4', 'center');

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

/** Name, purpose, store and workers: the label over a finished building the rider is next to. */
export function drawBuildingLabel(ctx: Ctx, world: World, b: Building, sx: number, y: number, k: number, viewW: number): void {
  const def = BUILDINGS[b.type];
  const lines = [def.purpose];
  const stored = RESOURCES.filter((r) => def.storage[r]);
  if (stored.length) lines.push(`Store: ${stored.map((r) => `${r} ${b.stock[r]}/${def.storage[r]}`).join(' · ')}`);
  for (const role of ROLES) {
    const slots = def.jobs[role] ?? 0;
    if (!slots) continue;
    const staff = employees(world, b).filter((p) => p.job!.role === role);
    const names = staff.map((p) => `${p.name} (#${p.id})`).join(', ');
    lines.push(`${ROLE_NAME[role]}: ${names || 'nobody free to hire'}${slots > 1 ? ` (${staff.length}/${slots})` : ''}`);
  }
  if (b.farm) {
    // idle borrowed land isn't waiting to be sown, it's spare
    const n = (st: string) => b.farm!.plots.filter((p) => p.state === st && (st !== 'fallow' || !isBorrowed(p))).length;
    lines.push(`Fields: ${n('ripe')} ripe · ${n('growing')} growing · ${n('fallow')} to sow`);
  }
  ctx.font = `12px ${SERIF}`;
  const lineW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  ctx.font = `bold 14px ${SERIF}`;
  const w = Math.max(60, lineW, ctx.measureText(def.name).width) + 24;
  // keep the label on screen (it may be wider than a phone's view)
  const half = (w / 2) * k + 6;
  sx = half * 2 > viewW ? viewW / 2 : Math.max(half, Math.min(viewW - half, sx));
  around(ctx, sx, y, k, () => {
    const h = 24 + lines.length * 16;
    panel(ctx, sx - w / 2, y - h - 4, w, h, 0.6);
    text(ctx, def.name, sx, y - h + 13, 14, GOLD, 'center', true);
    lines.forEach((l, i) => text(ctx, l, sx, y - h + 29 + i * 16, 12, i ? '#e8d9a8' : '#f3ead8', 'center'));
  });
}

/** Progress bar over a construction site, with how much of its materials have arrived. */
export function drawProgress(ctx: Ctx, world: World, b: Building, sx: number, y: number, k: number): void {
  const w = 110;
  const { stage } = constructionStage(b.progress);
  const caption = `${BUILDINGS[b.type].name} — ${STAGE_LABEL[stage]}`;
  const cost = BUILDINGS[b.type].cost;
  const delivered = b.site?.delivered;
  const builders = employees(world, b).length;
  const materials =
    RESOURCES.filter((r) => cost[r])
      .map((r) => `${r} ${delivered?.[r] ?? 0}/${cost[r]}`)
      .join(' · ') + `  ·  ${builders ? `${builders} builder${builders > 1 ? 's' : ''}` : 'no builders (night, or nobody free)'}`;
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
