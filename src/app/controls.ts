// Input: keyboard, mouse wheel and touch/pointer. Maps raw events onto
// `Actions` (game verbs) and screen zoom, and exposes the current ride input.
// Tap targets come from the render layer's layout functions, so what you tap
// is exactly what is drawn.

import type { MoveInput, World } from '../game/world';
import { hit, hudLayout, menuLayout } from '../render';
import type { Actions } from './actions';
import type { Screen } from './screen';

export interface Controls {
  /** Current ride input from keys and held touch buttons. */
  move(): MoveInput;
  /** Which on-screen ride buttons are held (for pressed styling). */
  touchHeld(): { left: boolean; right: boolean };
}

const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter', 'Escape']);
const ZOOM_STEP = 1.2;

type Role = 'left' | 'right' | 'pinch' | 'none';

export function installControls(world: World, screen: Screen, actions: Actions): Controls {
  const canvas = screen.canvas;
  const keys = new Set<string>();
  const pointers = new Map<number, { role: Role; x: number; y: number }>();
  let pinch: { dist: number; zoom: number } | null = null;

  // --- Keyboard -----------------------------------------------------------------

  window.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.key)) e.preventDefault();
    keys.add(e.key);
    if (e.repeat) return;

    if (e.key === 'c' || e.key === 'C') return actions.toggleConstruction();
    if (e.key === '-' || e.key === '_') return screen.zoomBy(1 / ZOOM_STEP);
    if (e.key === '=' || e.key === '+') return screen.zoomBy(ZOOM_STEP);
    if (e.key === '0') return screen.resetZoom();

    if (world.menu) {
      if (e.key === 'ArrowLeft') actions.moveSelection(-1);
      else if (e.key === 'ArrowRight') actions.moveSelection(1);
      else if (e.key === 'Enter' || e.key === ' ') actions.build();
      else if (e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown') actions.closeBuildMenu();
      else if (/^[1-9]$/.test(e.key)) actions.select(Number(e.key) - 1);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === ' ' || e.key === 'Enter' || e.key === 'b' || e.key === 'B') actions.openBuildMenu();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key));
  window.addEventListener('blur', () => {
    keys.clear();
    pointers.clear();
  });

  // --- Pointer: touch buttons, menu taps, pinch zoom ------------------------------

  const toUi = (e: PointerEvent): [number, number] => [(e.clientX * screen.dpr) / screen.vp.uiScale, (e.clientY * screen.dpr) / screen.vp.uiScale];

  function dirAt(ux: number, uy: number): Role | null {
    const L = hudLayout(screen.vp.uiW, screen.vp.uiH);
    if (hit(L.left, ux, uy)) return 'left';
    if (hit(L.right, ux, uy)) return 'right';
    return null;
  }

  const pinchPointers = () => [...pointers.values()].filter((p) => p.role === 'pinch');

  function startPinchIfReady(): void {
    const ps = pinchPointers();
    pinch = ps.length === 2 ? { dist: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), zoom: screen.vp.zoom } : null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') screen.enableTouch();
    canvas.setPointerCapture(e.pointerId);
    const [ux, uy] = toUi(e);
    const { uiW, uiH } = screen.vp;
    let role: Role = 'none';

    if (world.menu) {
      const M = menuLayout(uiW, uiH);
      const card = M.cards.findIndex((r) => hit(r, ux, uy));
      if (card >= 0) {
        if (card === world.menu.selection) actions.build();
        else actions.select(card);
      } else if (hit(M.build, ux, uy)) actions.build();
      else if (hit(M.cancel, ux, uy) || !hit(M.panel, ux, uy)) actions.closeBuildMenu();
    } else {
      const L = hudLayout(uiW, uiH);
      const dir = screen.touch ? dirAt(ux, uy) : null;
      if (hit(L.construction, ux, uy)) actions.toggleConstruction();
      else if (hit(L.zoomOut, ux, uy)) screen.zoomBy(1 / ZOOM_STEP);
      else if (hit(L.zoomIn, ux, uy)) screen.zoomBy(ZOOM_STEP);
      else if (dir) role = dir;
      else if (screen.touch && hit(L.build, ux, uy)) actions.openBuildMenu();
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
      if (ps.length === 2 && pinch.dist > 0) screen.setZoom(pinch.zoom * (Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) / pinch.dist));
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
      screen.zoomBy(Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );

  const held = (role: Role) => [...pointers.values()].some((p) => p.role === role);

  return {
    move: () => ({
      left: keys.has('ArrowLeft') || keys.has('a') || held('left'),
      right: keys.has('ArrowRight') || keys.has('d') || held('right'),
    }),
    touchHeld: () => ({ left: held('left'), right: held('right') }),
  };
}
