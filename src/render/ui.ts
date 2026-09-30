// On-screen UI: title/controls, construction toggle, plot prompt, build menu,
// progress bars and toasts. Everything is drawn in logical view coordinates.

import { BUILDINGS, BUILDING_TYPES } from '../game/buildings';
import { constructionStage, STAGE_LABEL, type Building, type World } from '../game/world';
import { drawBuildingIcon } from './buildings';
import { type Ctx, VIEW_H } from './util';

const SERIF = 'Georgia, "Times New Roman", serif';
const GOLD = '#e8c872';

export interface Toast {
  text: string;
  at: number;
}

function panel(ctx: Ctx, x: number, y: number, w: number, h: number, alpha = 0.78): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#1e1710';
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.globalAlpha = 1;
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

export function drawHud(ctx: Ctx, world: World, viewW: number): void {
  text(ctx, 'Village Crown', 18, 34, 24, GOLD, 'left', true);
  text(ctx, '← → ride   ↓ / Space build   C construction', 18, 54, 12, '#f3ead8');

  const on = world.constructionEnabled;
  const label = `Construction: ${on ? 'ON' : 'OFF'}  (C)`;
  ctx.font = `bold 13px ${SERIF}`;
  const w = ctx.measureText(label).width + 30;
  panel(ctx, viewW - w - 16, 16, w, 28, 0.65);
  ctx.fillStyle = on ? '#8fd16a' : '#c9695a';
  ctx.beginPath();
  ctx.arc(viewW - w - 16 + 13, 30, 4.5, 0, Math.PI * 2);
  ctx.fill();
  text(ctx, label, viewW - w - 16 + 22, 35, 13, '#f3ead8', 'left', true);

  const built = world.buildings.filter((b) => b.status === 'done').length;
  text(ctx, `Buildings: ${built}`, viewW - 18, 64, 12, '#f3ead8', 'right');
}

/** Floating marker over the empty plot the rider stands at. */
export function drawPlotPrompt(ctx: Ctx, sx: number, base: number, time: number): void {
  const y = base - 70 + Math.sin(time * 3) * 4;
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.moveTo(sx - 9, y - 10);
  ctx.lineTo(sx + 9, y - 10);
  ctx.lineTo(sx, y);
  ctx.fill();
  text(ctx, 'Press ↓ or Space to build', sx, y - 18, 13, '#fff4dc', 'center', true);
  // glowing footprint on the ground
  const g = ctx.createRadialGradient(sx, base, 5, sx, base, 110);
  g.addColorStop(0, 'rgba(255,220,140,0.35)');
  g.addColorStop(1, 'rgba(255,220,140,0)');
  ctx.fillStyle = g;
  ctx.fillRect(sx - 110, base - 20, 220, 30);
}

/** Name + purpose label over a finished building the rider is next to. */
export function drawBuildingLabel(ctx: Ctx, b: Building, sx: number, y: number): void {
  const def = BUILDINGS[b.type];
  ctx.font = `12px ${SERIF}`;
  const w = Math.max(ctx.measureText(def.purpose).width, 60) + 24;
  panel(ctx, sx - w / 2, y - 44, w, 40, 0.6);
  text(ctx, def.name, sx, y - 27, 14, GOLD, 'center', true);
  text(ctx, def.purpose, sx, y - 11, 12, '#f3ead8', 'center');
}

export function drawProgress(ctx: Ctx, b: Building, sx: number, y: number): void {
  const w = 110;
  const { stage } = constructionStage(b.progress);
  panel(ctx, sx - w / 2 - 6, y - 30, w + 12, 30, 0.6);
  ctx.fillStyle = '#3a2e22';
  ctx.fillRect(sx - w / 2, y - 12, w, 6);
  ctx.fillStyle = GOLD;
  ctx.fillRect(sx - w / 2, y - 12, w * b.progress, 6);
  text(ctx, `${BUILDINGS[b.type].name} — ${STAGE_LABEL[stage]}`, sx, y - 17, 10, '#f3ead8', 'center');
}

export function drawBuildMenu(ctx: Ctx, world: World, viewW: number): void {
  if (!world.menu) return;
  const n = BUILDING_TYPES.length;
  const cardW = Math.min(104, (viewW - 60) / n);
  const cardH = 112;
  const totalW = cardW * n + 40;
  const x0 = (viewW - totalW) / 2;
  const y0 = VIEW_H - cardH - 86;

  // dim the scene behind the menu
  ctx.fillStyle = 'rgba(20,14,8,0.35)';
  ctx.fillRect(0, 0, viewW, VIEW_H);

  panel(ctx, x0, y0 - 34, totalW, cardH + 110, 0.88);
  text(ctx, 'What shall we build?', viewW / 2, y0 - 10, 17, GOLD, 'center', true);

  for (let i = 0; i < n; i++) {
    const type = BUILDING_TYPES[i];
    const def = BUILDINGS[type];
    const cx = x0 + 20 + i * cardW;
    const sel = i === world.menu.selection;
    ctx.save();
    ctx.fillStyle = sel ? 'rgba(232,200,114,0.22)' : 'rgba(255,240,210,0.06)';
    roundRect(ctx, cx + 3, y0 + 2, cardW - 6, cardH, 6);
    ctx.fill();
    if (sel) {
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // clip the preview to the card
    roundRect(ctx, cx + 3, y0 + 2, cardW - 6, cardH - 26, 6);
    ctx.clip();
    const scale = Math.min(0.6, (cardW - 14) / (def.width * 1.3), 74 / (def.height + 20));
    drawBuildingIcon(ctx, type, cx + cardW / 2, y0 + cardH - 32, scale, world.time);
    ctx.restore();
    text(ctx, `${i + 1}. ${def.name}`, cx + cardW / 2, y0 + cardH - 10, cardW < 90 ? 10 : 12, sel ? GOLD : '#f3ead8', 'center', sel);
  }

  const def = BUILDINGS[BUILDING_TYPES[world.menu.selection]];
  text(ctx, def.purpose, viewW / 2, y0 + cardH + 26, 14, '#f3ead8', 'center');
  const time = world.constructionEnabled ? `Builds in ${def.buildTime}s` : 'Builds instantly (construction off)';
  text(ctx, time, viewW / 2, y0 + cardH + 46, 12, '#cbbfa4', 'center');
  text(ctx, '← → choose   Enter / Space build   Esc / ↑ cancel', viewW / 2, y0 + cardH + 66, 12, GOLD, 'center');
}

export function drawToasts(ctx: Ctx, toasts: Toast[], now: number, viewW: number): void {
  let y = 110;
  for (const t of toasts) {
    const age = now - t.at;
    if (age > 3) continue;
    const a = Math.min(1, age * 4, (3 - age) * 2);
    ctx.globalAlpha = a;
    ctx.font = `bold 16px ${SERIF}`;
    const w = ctx.measureText(t.text).width + 36;
    panel(ctx, viewW / 2 - w / 2, y - 22, w, 32, 0.7);
    text(ctx, t.text, viewW / 2, y, 16, GOLD, 'center', true);
    ctx.globalAlpha = 1;
    y += 40;
  }
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
  // dust settling at the base
  ctx.globalAlpha = (1 - t) * 0.4;
  ctx.fillStyle = '#d8c7a0';
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.arc(sx + (i - 3.5) * 22, base - 4 - t * 6, 10 + t * 14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
