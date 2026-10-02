// Screen state: canvas size, device pixel ratio, zoom and touch mode, and the
// derived viewport. The maths lives in viewport.ts; this holds the mutable bits.

import { VIEW_H } from '../game/layout';
import { clampZoom, computeViewport, defaultZoom, type Viewport } from './viewport';

export interface Screen {
  readonly canvas: HTMLCanvasElement;
  /** Current viewport (recomputed on resize, zoom or touch-mode change). */
  vp: Viewport;
  dpr: number;
  touch: boolean;
  setZoom(z: number): void;
  zoomBy(factor: number): void;
  /** Back to the screen-dependent default zoom. */
  resetZoom(): void;
  enableTouch(): void;
  resize(): void;
  /** Keep world y `y` at the bottom of the scene (computeViewport's frameBottom); cheap when unchanged. */
  frameTo(y: number): void;
}

export function createScreen(canvas: HTMLCanvasElement): Screen {
  /** User-chosen zoom; null follows the screen-dependent default. */
  let userZoom: number | null = null;
  let frameBottom = VIEW_H;

  const s: Screen = {
    canvas,
    vp: computeViewport(960, 540, 1),
    dpr: 1,
    touch: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    setZoom(z) {
      userZoom = clampZoom(z, canvas.width, canvas.height, s.touch, frameBottom);
      refresh();
    },
    zoomBy(factor) {
      s.setZoom(s.vp.zoom * factor);
    },
    resetZoom() {
      userZoom = null;
      refresh();
    },
    enableTouch() {
      if (s.touch) return;
      s.touch = true;
      refresh();
    },
    resize() {
      s.dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * s.dpr);
      canvas.height = Math.round(window.innerHeight * s.dpr);
      if (userZoom !== null) userZoom = clampZoom(userZoom, canvas.width, canvas.height, s.touch, frameBottom);
      refresh();
    },
    frameTo(y) {
      if (Math.abs(y - frameBottom) < 0.01) return;
      frameBottom = y;
      refresh();
    },
  };

  function refresh(): void {
    const z = userZoom ?? defaultZoom(canvas.width, canvas.height, s.touch, frameBottom);
    s.vp = computeViewport(canvas.width, canvas.height, z, s.touch, frameBottom);
  }

  window.addEventListener('resize', () => s.resize());
  s.resize();
  return s;
}
