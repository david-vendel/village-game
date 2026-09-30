import { BUILDINGS } from './game/buildings';
import {
  closeMenu,
  confirmMenu,
  createWorld,
  getBuilding,
  moveMenu,
  openMenu,
  plotAt,
  selectMenu,
  setConstructionEnabled,
  update,
} from './game/world';
import { cameraX, drawScene } from './render/scene';
import { drawBuildMenu, drawHud, drawToasts, hit, hudLayout, menuLayout, type Toast } from './render/ui';
import { clampZoom, computeViewport, defaultZoom, type Viewport } from './viewport';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const world = createWorld();
const toasts: Toast[] = [];
const held = new Set<string>();
let camX = 0;
let dpr = 1;
/** User-chosen zoom; null follows the screen-dependent default. */
let userZoom: number | null = null;
let vp: Viewport = computeViewport(960, 540, 1);
let touchMode = window.matchMedia?.('(pointer: coarse)').matches ?? false;

function toast(text: string): void {
  toasts.push({ text, at: world.time });
  while (toasts.length > 4) toasts.shift();
}

function refreshViewport(): void {
  const z = userZoom ?? defaultZoom(canvas.width, canvas.height, touchMode);
  vp = computeViewport(canvas.width, canvas.height, z, touchMode);
}

function setZoom(z: number): void {
  userZoom = clampZoom(z, canvas.width, canvas.height, touchMode);
  refreshViewport();
}

function resize(): void {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  if (userZoom !== null) userZoom = clampZoom(userZoom, canvas.width, canvas.height, touchMode);
  refreshViewport();
}
window.addEventListener('resize', resize);
resize();

// --- Actions shared by keyboard and touch ------------------------------------

function toggleConstruction(): void {
  setConstructionEnabled(world, !world.constructionEnabled);
  toast(world.constructionEnabled ? 'Construction phase ON' : 'Construction phase OFF — buildings appear instantly');
}

function tryOpenMenu(): void {
  if (!openMenu(world) && touchMode) toast('Ride to a pennant to build');
}

function build(): void {
  const b = confirmMenu(world);
  if (b) toast(b.status === 'done' ? `${BUILDINGS[b.type].name} built` : `Construction of the ${BUILDINGS[b.type].name} begins`);
}

// --- Keyboard ------------------------------------------------------------------

const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter', 'Escape']);

window.addEventListener('keydown', (e) => {
  if (GAME_KEYS.has(e.key)) e.preventDefault();
  held.add(e.key);
  if (e.repeat) return;

  if (e.key === 'c' || e.key === 'C') return toggleConstruction();
  if (e.key === '-' || e.key === '_') return setZoom(vp.zoom / 1.2);
  if (e.key === '=' || e.key === '+') return setZoom(vp.zoom * 1.2);
  if (e.key === '0') {
    userZoom = null;
    return refreshViewport();
  }

  if (world.menu) {
    if (e.key === 'ArrowLeft') moveMenu(world, -1);
    else if (e.key === 'ArrowRight') moveMenu(world, 1);
    else if (e.key === 'Enter' || e.key === ' ') build();
    else if (e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown') closeMenu(world);
    else if (/^[1-9]$/.test(e.key)) selectMenu(world, Number(e.key) - 1);
    return;
  }

  if (e.key === 'ArrowDown' || e.key === ' ' || e.key === 'Enter' || e.key === 'b' || e.key === 'B') tryOpenMenu();
});
window.addEventListener('keyup', (e) => held.delete(e.key));
window.addEventListener('blur', () => {
  held.clear();
  pointers.clear();
});

// --- Pointer: touch buttons, menu taps, pinch zoom -------------------------------

type Role = 'left' | 'right' | 'pinch' | 'none';
const pointers = new Map<number, { role: Role; x: number; y: number }>();
let pinch: { dist: number; zoom: number } | null = null;

function toUi(e: PointerEvent): [number, number] {
  return [(e.clientX * dpr) / vp.uiScale, (e.clientY * dpr) / vp.uiScale];
}

function dirAt(ux: number, uy: number): Role | null {
  const L = hudLayout(vp.uiW, vp.uiH);
  if (hit(L.left, ux, uy)) return 'left';
  if (hit(L.right, ux, uy)) return 'right';
  return null;
}

function pinchPointers() {
  return [...pointers.values()].filter((p) => p.role === 'pinch');
}

function startPinchIfReady(): void {
  const ps = pinchPointers();
  pinch = ps.length === 2 ? { dist: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), zoom: vp.zoom } : null;
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' && !touchMode) {
    touchMode = true;
    refreshViewport();
  }
  canvas.setPointerCapture(e.pointerId);
  const [ux, uy] = toUi(e);
  let role: Role = 'none';

  if (world.menu) {
    const M = menuLayout(vp.uiW, vp.uiH);
    const card = M.cards.findIndex((r) => hit(r, ux, uy));
    if (card >= 0) {
      if (card === world.menu.selection) build();
      else selectMenu(world, card);
    } else if (hit(M.build, ux, uy)) build();
    else if (hit(M.cancel, ux, uy) || !hit(M.panel, ux, uy)) closeMenu(world);
  } else {
    const L = hudLayout(vp.uiW, vp.uiH);
    const dir = touchMode ? dirAt(ux, uy) : null;
    if (hit(L.construction, ux, uy)) toggleConstruction();
    else if (hit(L.zoomOut, ux, uy)) setZoom(vp.zoom / 1.2);
    else if (hit(L.zoomIn, ux, uy)) setZoom(vp.zoom * 1.2);
    else if (dir) role = dir;
    else if (touchMode && hit(L.build, ux, uy)) tryOpenMenu();
    else role = 'pinch';
  }
  pointers.set(e.pointerId, { role, x: e.clientX, y: e.clientY });
  if (role === 'pinch') startPinchIfReady();
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX;
  p.y = e.clientY;
  if (p.role === 'left' || p.role === 'right') {
    // sliding a thumb from one arrow to the other switches direction
    const [ux, uy] = toUi(e);
    p.role = dirAt(ux, uy) ?? p.role;
  } else if (p.role === 'pinch' && pinch) {
    const ps = pinchPointers();
    if (ps.length === 2 && pinch.dist > 0) setZoom(pinch.zoom * (Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) / pinch.dist));
  }
});

function endPointer(e: PointerEvent): void {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (p?.role === 'pinch') startPinchIfReady();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    setZoom(vp.zoom * Math.exp(-e.deltaY * 0.0015));
  },
  { passive: false },
);

function touchHeld(role: Role): boolean {
  for (const p of pointers.values()) if (p.role === role) return true;
  return false;
}

// --- Main loop ---------------------------------------------------------------------

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const leftTouch = touchHeld('left');
  const rightTouch = touchHeld('right');
  update(world, dt, {
    left: held.has('ArrowLeft') || held.has('a') || leftTouch,
    right: held.has('ArrowRight') || held.has('d') || rightTouch,
  });
  for (const ev of world.events) {
    const b = getBuilding(world, ev.buildingId);
    if (ev.kind === 'completed' && b && world.constructionEnabled) toast(`The ${BUILDINGS[b.type].name} is complete!`);
  }
  world.events.length = 0;

  // smooth camera follow
  const target = cameraX(world, vp.viewW);
  camX += (target - camX) * Math.min(1, dt * 4);
  if (Math.abs(target - camX) > vp.viewW) camX = target;

  // world, zoomed and anchored to the bottom of the screen
  ctx.setTransform(vp.worldScale, 0, 0, vp.worldScale, 0, vp.offsetY);
  drawScene(ctx, world, {
    camX,
    width: vp.viewW,
    top: vp.top,
    bottom: vp.bottom,
    labelScale: Math.max(1, Math.min(3, vp.uiScale / vp.worldScale)),
    promptLabel: touchMode ? 'Tap the hammer to build' : 'Press ↓ or Space to build',
  });

  // screen UI
  ctx.setTransform(vp.uiScale, 0, 0, vp.uiScale, 0, 0);
  const plot = plotAt(world, world.rider.x);
  drawHud(ctx, world, vp.uiW, vp.uiH, {
    touch: touchMode,
    leftHeld: leftTouch,
    rightHeld: rightTouch,
    canBuild: !!plot && plot.buildingId === null,
  });
  drawToasts(ctx, toasts, world.time, vp.uiW);
  drawBuildMenu(ctx, world, vp.uiW, vp.uiH);
  requestAnimationFrame(frame);
}
camX = cameraX(world, vp.viewW);
requestAnimationFrame(frame);
