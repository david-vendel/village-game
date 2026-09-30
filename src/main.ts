import { BUILDINGS } from './game/buildings';
import {
  closeMenu,
  confirmMenu,
  createWorld,
  getBuilding,
  moveMenu,
  openMenu,
  selectMenu,
  setConstructionEnabled,
  update,
} from './game/world';
import { cameraX, drawScene } from './render/scene';
import type { Toast } from './render/ui';
import { VIEW_H } from './render/util';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const world = createWorld();
const toasts: Toast[] = [];
const held = new Set<string>();
let camX = 0;
let viewW = 960;
let scale = 1;

function toast(text: string): void {
  toasts.push({ text, at: world.time });
  while (toasts.length > 4) toasts.shift();
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  scale = canvas.height / VIEW_H;
  viewW = canvas.width / scale;
}
window.addEventListener('resize', resize);
resize();

const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter', 'Escape']);

window.addEventListener('keydown', (e) => {
  if (GAME_KEYS.has(e.key)) e.preventDefault();
  held.add(e.key);
  if (e.repeat) return;

  if (e.key === 'c' || e.key === 'C') {
    setConstructionEnabled(world, !world.constructionEnabled);
    toast(world.constructionEnabled ? 'Construction phase ON' : 'Construction phase OFF — buildings appear instantly');
    return;
  }

  if (world.menu) {
    if (e.key === 'ArrowLeft') moveMenu(world, -1);
    else if (e.key === 'ArrowRight') moveMenu(world, 1);
    else if (e.key === 'Enter' || e.key === ' ') {
      const b = confirmMenu(world);
      if (b) toast(b.status === 'done' ? `${BUILDINGS[b.type].name} built` : `Construction of the ${BUILDINGS[b.type].name} begins`);
    } else if (e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown') closeMenu(world);
    else if (/^[1-9]$/.test(e.key)) selectMenu(world, Number(e.key) - 1);
    return;
  }

  if (e.key === 'ArrowDown' || e.key === ' ' || e.key === 'Enter' || e.key === 'b' || e.key === 'B') openMenu(world);
});
window.addEventListener('keyup', (e) => held.delete(e.key));
window.addEventListener('blur', () => held.clear());

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  update(world, dt, { left: held.has('ArrowLeft') || held.has('a'), right: held.has('ArrowRight') || held.has('d') });
  for (const ev of world.events) {
    const b = getBuilding(world, ev.buildingId);
    if (ev.kind === 'completed' && b && world.constructionEnabled) toast(`The ${BUILDINGS[b.type].name} is complete!`);
  }
  world.events.length = 0;

  // smooth camera follow
  const target = cameraX(world, viewW);
  camX += (target - camX) * Math.min(1, dt * 4);
  if (Math.abs(target - camX) > viewW) camX = target;

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawScene(ctx, world, viewW, camX, toasts);
  requestAnimationFrame(frame);
}
camX = cameraX(world, viewW);
requestAnimationFrame(frame);
