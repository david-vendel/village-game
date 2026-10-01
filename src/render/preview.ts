// `?art=preview`: a contact sheet of every asset in the manifest, for review
// and approval. Each building image is shown beside the procedural art it
// replaces, on the street's ground line, by day or by night, at zoom 1 or
// 0.45, with its anchor and points marked; then each of its layers.

import { BUILDINGS, type BuildingType } from '../game/buildings';
import { demoFarm } from '../game/farm';
import { stockOf } from '../game/resources';
import { artManifest, artRoot, drawImageSet, flushEmissive, forceProcedural, ready } from './assets';
import { BUILDING_ART, type DrawArgs } from './buildings';
import { drawConstruction } from './construction';
import { imagesOf, isBuilding, type ImageSet, type LayerName, tierPath } from './manifest';
import { tintLand } from './sky';
import { drawBuilding } from './sprites';
import type { Ctx } from './util';

interface Settings {
  zoom: number;
  night: boolean;
  marks: boolean;
}

const STAGE_PROGRESS: Record<string, number> = { staking: 0.06, foundation: 0.2, frame: 0.42, walls: 0.62, roof: 0.92 };

/** Replace the page with the contact sheet. */
export function showArtPreview(): void {
  document.body.style.overflow = 'auto';
  document.body.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = `
    body { font: 14px/1.4 Georgia, serif; color: #efe3c8; background: #1b1612; margin: 0; padding: 16px; overflow: auto !important; height: auto !important; }
    h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 24px 0 8px; }
    .bar { position: sticky; top: 0; background: #1b1612ee; padding: 8px 0; display: flex; gap: 16px; flex-wrap: wrap; align-items: center; z-index: 1; }
    .bar label { cursor: pointer; } .note { color: #b8ab94; font-size: 12px; }
    .card { display: inline-block; vertical-align: top; margin: 0 16px 16px 0; background: #2a221b; border-radius: 6px; padding: 8px; }
    .card canvas { display: block; } .layers { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
    .layers figure { margin: 0; font-size: 11px; color: #b8ab94; text-align: center; }
    .layers img { display: block; max-height: 110px; background: repeating-conic-gradient(#555 0 25%, #777 0 50%) 0 0 / 12px 12px; }
    .layers img.dark { background: #000; } .layers img.light { background: #fff; }
  `;
  document.head.appendChild(style);

  // &zoom=0.45, &night=1 and &marks=0 set the switches from the address, for links and screenshots
  const q = new URLSearchParams(location.search);
  const s: Settings = { zoom: q.get('zoom') === '0.45' ? 0.45 : 1, night: q.get('night') === '1', marks: q.get('marks') !== '0' };
  const root = document.createElement('div');
  const header = document.createElement('div');
  header.innerHTML = `<h1>Village Crown — art preview</h1>
    <div class="note">Manifest: ${artRoot()}manifest.json · left: procedural art, right: the sprite · <a style="color:#c9a24a" href="?">back to the game</a> · <a style="color:#c9a24a" href="?art=procedural">game without sprites</a></div>`;
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.innerHTML = `
    <label><input type="radio" name="z" value="1"${s.zoom === 1 ? ' checked' : ''}> zoom 1</label>
    <label><input type="radio" name="z" value="0.45"${s.zoom !== 1 ? ' checked' : ''}> zoom 0.45</label>
    <label><input type="checkbox" name="night"${s.night ? ' checked' : ''}> night</label>
    <label><input type="checkbox" name="marks"${s.marks ? ' checked' : ''}> anchor and points</label>`;
  const sheet = document.createElement('div');
  root.append(header, bar, sheet);
  document.body.appendChild(root);

  const render = () => fill(sheet, s);
  bar.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'z') s.zoom = Number(t.value);
    if (t.name === 'night') s.night = t.checked;
    if (t.name === 'marks') s.marks = t.checked;
    render();
  });
  render();
  // sprites decode lazily: redraw once they are in
  let tries = 0;
  const again = setInterval(() => {
    render();
    if (++tries > 8) clearInterval(again);
  }, 500);
}

function fill(sheet: HTMLElement, s: Settings): void {
  sheet.innerHTML = '';
  const m = artManifest();
  const ids = Object.keys(m.assets).sort();
  if (!ids.length) {
    sheet.innerHTML = '<p>No assets: <code>public/assets/manifest.json</code> is missing or empty. Run <code>npm run assets:export</code> for the procedural placeholders.</p>';
    return;
  }
  for (const id of ids) {
    const asset = m.assets[id];
    const h2 = document.createElement('h2');
    h2.textContent = `${id} — ${asset.source.method}${asset.source.approvedBy ? `, approved by ${asset.source.approvedBy}` : ', not approved (dev builds only)'}`;
    sheet.appendChild(h2);
    for (const { label, image } of imagesOf(id, asset)) {
      const card = document.createElement('div');
      card.className = 'card';
      const title = document.createElement('div');
      title.textContent = `${label} · ${image.size[0]}×${image.size[1]} u · tiers ${image.tiers.join(', ')}`;
      card.appendChild(title);
      if (isBuilding(asset) && !label.includes(' part ') && !/ (behind|front)$/.test(label)) card.appendChild(comparison(id.slice('building.'.length) as BuildingType, label, image, s));
      card.appendChild(layerStrip(image));
      sheet.appendChild(card);
    }
  }
}

/** The procedural art and the sprite side by side, on a strip of ground, at the chosen zoom and light. */
function comparison(type: BuildingType, label: string, image: ImageSet, s: Settings): HTMLCanvasElement {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(BUILDINGS[type]?.width ?? 0, image.size[0]) + 60;
  const H = Math.max(image.size[1], BUILDING_ART[type]?.height ?? 0) + 50;
  const k = s.zoom * dpr * 1.8; // canvas px per u: zoom 1 on a 1080p screen is 1.8 px/u
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * 2 * k);
  canvas.height = Math.round(H * k);
  canvas.style.width = `${canvas.width / dpr}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const base = H - 24;
  const upgraded = label.includes('[upgraded]');
  const stage = /\{(\w+)\}/.exec(label)?.[1];
  const args = (x: number): DrawArgs => ({
    x,
    base,
    time: 2,
    seed: 7,
    upgraded,
    farm: type === 'farm' ? demoFarm() : undefined,
    stock: stockOf({ grain: 3, wood: 60, stone: 50, flour: 20, bread: 25 }),
  });
  ctx.fillStyle = '#7d8a4e';
  ctx.fillRect(0, base, W * 2, H - base);
  // left: procedural; right: the sprite as the game draws it (with its live details)
  forceProcedural(() => {
    if (stage) drawConstruction(ctx, type, args(W / 2), STAGE_PROGRESS[stage] ?? 0.5);
    else BUILDING_ART[type].draw(ctx, args(W / 2));
  });
  // a stage or roadside image on its own; a finished street view as the game draws it, with its live details
  if (stage || / (roadsideL|roadsideR)$/.test(label)) drawImageSet(ctx, image, W * 1.5, base);
  else drawBuilding(ctx, type, args(W * 1.5));
  if (s.night) {
    tintLand(ctx, { camX: 0, along: 0, turn: 0, width: W * 2, top: 0, bottom: H, time: 0 }, { phase: 0, sun: -1, night: 1, dusk: 0 });
    flushEmissive(ctx, 1);
  } else flushEmissive(ctx, 0);
  if (!ready(ctx, image)) {
    ctx.fillStyle = '#efe3c8';
    ctx.font = '12px Georgia';
    ctx.fillText('loading…', W * 1.5 - 20, base - 20);
  }
  if (s.marks) marks(ctx, image, W * 1.5, base);
  return canvas;
}

/** The anchor (red cross), the image's bounds and its named points. */
function marks(ctx: Ctx, img: ImageSet, x: number, base: number): void {
  const left = x - img.anchor[0];
  const top = base - img.anchor[1];
  ctx.save();
  ctx.lineWidth = 1 / ctx.getTransform().a;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.strokeRect(left, top, img.size[0], img.size[1]);
  ctx.strokeStyle = '#ff3b30';
  ctx.beginPath();
  ctx.moveTo(x - 6, base);
  ctx.lineTo(x + 6, base);
  ctx.moveTo(x, base - 6);
  ctx.lineTo(x, base + 6);
  ctx.stroke();
  ctx.fillStyle = '#4cd964';
  ctx.font = '7px sans-serif';
  for (const [name, [px, py]] of Object.entries(img.points ?? {})) {
    ctx.beginPath();
    ctx.arc(left + px, top + py, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(name, left + px + 3, top + py - 2);
  }
  ctx.restore();
}

/** Every layer of the image at its largest tier. */
function layerStrip(img: ImageSet): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'layers';
  const tier = Math.max(...img.tiers) as 1 | 2 | 4;
  for (const [layer, path] of Object.entries(img.layers) as Array<[LayerName, string]>) {
    const fig = document.createElement('figure');
    const el = document.createElement('img');
    el.src = artRoot() + tierPath(path, tier);
    if (layer === 'emissive') el.className = 'dark';
    if (layer === 'shadow') el.className = 'light';
    const cap = document.createElement('figcaption');
    cap.textContent = `${layer} @${tier}x`;
    fig.append(el, cap);
    strip.appendChild(fig);
  }
  return strip;
}
