// stages.html: every building, stage by stage, in 2D and in 3D (dev tool for graphics work).
// Pick a building on the left, a stage along the top (or play it going up), and look at it as
// the game's 2D art, as its 3D model, or both side by side. Drag the 3D view to turn it.
// The choices are kept in the address (?type=farm&stage=frame&t=1&mode=both&rot=30&hour=10),
// so a link opens the same view.
//
// Its own page, apart from the game: it changes no game file (CLAUDE.md, graphics work).

import { BUILDING_TYPES, BUILDINGS, type BuildingType } from './game/buildings';
import { STAGE_BOUNDS } from './game/world';
import { loadArt } from './render/assets';
import { BUILDING_ART } from './render/buildings';
import { modelTypes } from './render/build3d/index';
import { plotOf } from './render/build3d/plot';
import { drawConstruction } from './render/construction';
import { setCameraDistance, setCameraHeight, viewHorizon } from './render/ground';
import { drawBuilding } from './render/sprites';
import { type Building3d, draw3d, set3d, type View3d } from './render/world3d';

const STAGES = [...STAGE_BOUNDS.map(([s]) => s), 'done', 'large'] as const;
type Stage = (typeof STAGES)[number];
type Mode = '2d' | '3d' | 'both';

const q = new URLSearchParams(location.search);
const with3d = new Set(modelTypes());
const types = BUILDING_TYPES.filter((t) => with3d.has(t) || BUILDING_ART[t]);
const state = {
  type: (types.includes(q.get('type') as BuildingType) ? q.get('type') : 'farm') as BuildingType,
  stage: (STAGES.includes(q.get('stage') as Stage) ? q.get('stage') : 'done') as Stage,
  /** How far through the stage (0..1). */
  t: Number(q.get('t') ?? 1),
  mode: (['2d', '3d', 'both'].includes(q.get('mode') ?? '') ? q.get('mode') : 'both') as Mode,
  /** The 3D model turned about its middle (degrees; + shows its right side). */
  rot: Number(q.get('rot') ?? 25),
  hour: Number(q.get('hour') ?? 10),
  size: Number(q.get('size') ?? 1) as 1 | 2 | 3,
  seed: Number(q.get('seed') ?? 4242),
  playing: false,
};

function save(): void {
  const u = new URL(location.href);
  for (const k of ['type', 'stage', 't', 'mode', 'rot', 'hour', 'size', 'seed'] as const) u.searchParams.set(k, String(state[k]));
  history.replaceState(null, '', u);
}

/** The game's build progress (0..1) for a stage and how far through it. */
function progressOf(stage: Stage, t: number): number {
  if (stage === 'done' || stage === 'large') return 1;
  const i = STAGE_BOUNDS.findIndex(([s]) => s === stage);
  const start = i > 0 ? STAGE_BOUNDS[i - 1][1] : 0;
  // never quite the stage's end, which is the next stage's start
  return start + (STAGE_BOUNDS[i][1] - start) * Math.min(0.999, Math.max(0.001, t));
}

// --- the page --------------------------------------------------------------------------

document.body.innerHTML = '';
const css = (el: HTMLElement, s: string) => ((el.style.cssText = s), el);
const root = css(document.createElement('div'), 'display:flex;height:100vh');
const side = css(document.createElement('div'), 'width:170px;overflow:auto;padding:10px;background:#140f0a;border-right:1px solid #3a2e22;flex:none');
const main = css(document.createElement('div'), 'flex:1;display:flex;flex-direction:column;min-width:0');
const bar = css(document.createElement('div'), 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 10px;border-bottom:1px solid #3a2e22');
const bar2 = css(document.createElement('div'), 'display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding:6px 10px;border-bottom:1px solid #3a2e22;color:#cdbf9f');
const canvas = css(document.createElement('canvas'), 'flex:1;width:100%;min-height:0;cursor:grab') as HTMLCanvasElement;
main.append(bar, bar2, canvas);
root.append(side, main);
document.body.append(root);

const BTN = 'font:inherit;color:#f3ead8;background:#2b2118;border:1px solid #4a3a2a;border-radius:5px;padding:4px 10px;cursor:pointer';
const ON = 'background:#e8c872;color:#1b1612;border-color:#e8c872';
const button = (label: string, on: () => boolean, click: () => void, extra = '') => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => {
    click();
    save();
    render();
  });
  const paint = () => (b.style.cssText = BTN + extra + (on() ? ';' + ON : ''));
  paint();
  return Object.assign(b, { paint });
};
const buttons: Array<HTMLButtonElement & { paint: () => void }> = [];

const title = css(document.createElement('div'), 'color:#e8c872;margin-bottom:8px');
title.textContent = 'Buildings';
side.append(title);
for (const t of types) {
  const b = button(`${BUILDINGS[t].name}${with3d.has(t) ? '' : ' (2D)'}`, () => state.type === t, () => (state.type = t), ';display:block;width:100%;text-align:left;margin-bottom:4px');
  buttons.push(b);
  side.append(b);
}

const LABEL: Record<Stage, string> = { staking: '1 Staking', foundation: '2 Foundation', frame: '3 Frame', walls: '4 Walls', roof: '5 Roof', done: '6 Finished', large: '7 Large look' };
for (const s of STAGES) {
  const b = button(LABEL[s], () => state.stage === s, () => {
    state.stage = s;
    state.t = 1;
    state.playing = false;
  });
  buttons.push(b);
  bar.append(b);
}
const play = button('▶ Watch it go up', () => state.playing, () => {
  state.playing = !state.playing;
  if (state.playing) {
    state.stage = 'staking';
    state.t = 0;
  }
});
buttons.push(play);
bar.append(css(document.createElement('span'), 'flex:1'), play);
for (const [m, label] of [['2d', '2D'], ['3d', '3D'], ['both', 'Both']] as const) {
  const b = button(label, () => state.mode === m, () => (state.mode = m));
  buttons.push(b);
  bar.append(b);
}

const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, show: (v: number) => string) => {
  const wrap = document.createElement('label');
  const text = document.createElement('span');
  const input = document.createElement('input');
  Object.assign(input, { type: 'range', min, max, step, value: String(get()) });
  input.style.cssText = 'vertical-align:middle;accent-color:#e8c872;width:130px;margin-left:6px';
  const sync = () => {
    input.value = String(get());
    text.textContent = `${label} ${show(get())}`;
  };
  input.addEventListener('input', () => {
    set(Number(input.value));
    sync();
    save();
  });
  wrap.append(text, input);
  bar2.append(wrap);
  sync();
  return sync;
};
const syncs = [
  slider('through the stage', 0, 1, 0.01, () => state.t, (v) => ((state.t = v), (state.playing = false)), (v) => `${Math.round(v * 100)}%`),
  slider('turn', -180, 180, 1, () => state.rot, (v) => (state.rot = v), (v) => `${v}°`),
  slider('hour', 0, 24, 0.25, () => state.hour, (v) => (state.hour = v), (v) => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`),
  slider('size', 1, 3, 1, () => state.size, (v) => (state.size = v as 1 | 2 | 3), (v) => String(v)),
  slider('seed', 1, 9999, 1, () => state.seed, (v) => (state.seed = v), (v) => String(v)),
];
const info = css(document.createElement('span'), 'margin-left:auto;color:#8f8268');
bar2.append(info);

function render(): void {
  for (const b of buttons) b.paint();
  for (const s of syncs) s();
}

// drag the picture sideways to turn the 3D model
let drag: { x: number; rot: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, rot: state.rot };
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = 'grabbing';
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  state.rot = Math.round(((drag.rot + (e.clientX - drag.x) * 0.5 + 540) % 360) - 180);
  syncs[1]();
});
canvas.addEventListener('pointerup', () => {
  drag = null;
  canvas.style.cursor = 'grab';
  save();
});

// --- drawing ---------------------------------------------------------------------------

const BASE = 436;
// a camera a little higher and further back than the game's, to see the whole building and into its stages
setCameraDistance(700);
setCameraHeight(330);
set3d(true);
await loadArt({ mode: 'auto' });

const ctx = canvas.getContext('2d')!;
let time = 0;
let last = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;
  if (state.playing) {
    // about 2.5 s a stage, then a pause on the finished building
    state.t += dt / 2.5;
    if (state.t >= 1) {
      const i = STAGES.indexOf(state.stage);
      if (state.stage === 'done') state.playing = false;
      else {
        state.stage = STAGES[i + 1];
        state.t = state.stage === 'done' ? 1 : 0;
      }
      render();
    }
    syncs[0]();
  }

  const dpr = Math.min(2, devicePixelRatio || 1);
  const cw = Math.round(canvas.clientWidth * dpr);
  const ch = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== cw || canvas.height !== ch) Object.assign(canvas, { width: cw, height: ch });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1b1612';
  ctx.fillRect(0, 0, cw, ch);

  const panels: Mode[] = state.mode === 'both' ? ['2d', '3d'] : [state.mode];
  const pw = cw / panels.length;
  const progress = progressOf(state.stage, state.t);
  const phase = state.hour / 24;
  const sunHeight = -Math.cos(phase * Math.PI * 2);
  const night = Math.max(0, Math.min(1, (0.1 - sunHeight) / 0.3));
  const day = Math.max(0, Math.min(1, sunHeight * 2 + 0.3));
  const plot = plotOf(state.type, state.size);
  // world units across the panel: the plot and some room around it
  const viewW = Math.max(plot.W * 20 * 1.9, 340);
  const k = pw / viewW;
  const viewH = ch / k;
  const top = BASE + 70 - viewH;
  panels.forEach((p, i) => {
    const ox = i * pw;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, 0, pw, ch);
    ctx.clip();
    ctx.setTransform(k, 0, 0, k, ox, -top * k);
    // sky, land and the road, so it stands on something
    const horizon = p === '3d' ? viewHorizon() : 300;
    ctx.fillStyle = `rgb(${40 + 120 * day},${55 + 130 * day},${80 + 150 * day})`;
    ctx.fillRect(0, top, viewW, horizon - top);
    ctx.fillStyle = `rgb(${50 + 70 * day},${60 + 80 * day},${35 + 30 * day})`;
    ctx.fillRect(0, horizon, viewW, top + viewH - horizon);
    ctx.fillStyle = 'rgba(150,120,80,0.6)';
    ctx.fillRect(0, BASE + 3, viewW, 30);
    const cx = viewW / 2;
    if (p === '2d') {
      const a = { x: cx, base: BASE, time, seed: state.seed, upgraded: state.stage === 'large', vpX: cx };
      if (progress >= 1) drawBuilding(ctx, state.type, a);
      else drawConstruction(ctx, state.type, a, progress);
      if (night > 0) {
        ctx.fillStyle = `rgba(10,14,40,${night * 0.55})`;
        ctx.fillRect(0, top, viewW, viewH);
      }
    } else if (with3d.has(state.type)) {
      // turned about the middle of its plot
      const rot = (state.rot * Math.PI) / 180;
      const mid = (plot.y0 + plot.D / 2) * 20;
      const b: Building3d = {
        id: 1,
        type: state.type,
        seed: state.seed,
        x: 0,
        size: state.size,
        sides: { left: false, right: false },
        upgraded: state.stage === 'large',
        build: progress >= 1 || state.stage === 'done' || state.stage === 'large' ? undefined : { stage: state.stage, t: state.t },
        age: 0.3,
        door: night > 0.5 ? 0 : 0.6,
        shutters: night > 0.5 ? 0 : 1,
        light: night,
        fire: night,
        stock: { wood: 30, stone: 30, grain: 50, flour: 30, bread: 40 },
        at: { x: Math.sin(rot) * mid, z: -mid + Math.cos(rot) * mid, rot },
      };
      const v: View3d = { camX: -cx, viewW, top, bottom: top + viewH, pxPerU: k, phase, sunHeight, night, time };
      draw3d(ctx, [b], v);
    } else {
      ctx.fillStyle = '#cdbf9f';
      ctx.font = '14px Georgia';
      ctx.fillText('No 3D model yet', cx - 50, BASE - 80);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#e8c872';
    ctx.font = `${13 * dpr}px ui-monospace, monospace`;
    ctx.fillText(p === '2d' ? '2D art' : '3D model (drag to turn)', ox + 10 * dpr, 20 * dpr);
    ctx.restore();
  });
  info.textContent = `${BUILDINGS[state.type].name} · ${LABEL[state.stage]} · build ${Math.round(progress * 100)}%`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
