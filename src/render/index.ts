// Public entry point of the render layer. The app calls `renderFrame` once per
// frame; everything about how things look — draw order, art, HUD, menus — is
// decided in src/render. Rendering only reads game state, never changes it.

import { buildingAt, canDemolish, crossroadAt, roomToBuild, type World } from '../game/world';
import { drawScene } from './scene';
import { set3d } from './world3d';
import { drawTopView } from './topview';
import { drawBuildMenu, drawHud, drawToasts, drawTurnFade, type Toast } from './ui';

export { artMode, loadArt, type ArtMode } from './assets';
export { DEFAULT_EASE, DEFAULT_LENS, setLens, setLensEase } from './lens';
export { showArtPreview } from './preview';
export { cameraX } from './scene';
export { galloping, STRIDE as HORSE_STRIDE, strideAt } from './horse';
export { buildingMenuLayout, hit, HUD_BUTTON, hudLayout, menuLayout, type Rect, type Toast } from './ui';

/** Everything the renderer needs besides the world: where the camera is and how the screen is scaled. */
export interface FrameView {
  /** Camera left edge in world x. */
  camX: number;
  /** Canvas px per world unit, and vertical offset after scaling. */
  worldScale: number;
  offsetY: number;
  /** Visible world width, and world y at the top/bottom screen edges. */
  viewW: number;
  top: number;
  bottom: number;
  /** Canvas px per UI unit, and the UI space size. */
  uiScale: number;
  uiW: number;
  uiH: number;
  /** Show touch controls and touch wording. */
  touch: boolean;
  /** Which on-screen ride buttons are currently held (for pressed styling). */
  leftHeld: boolean;
  rightHeld: boolean;
  toasts: Toast[];
  /** Overlay the land grid. */
  showGrid: boolean;
  /** Show the village from above instead of from the street, at its own zoom. */
  topView: boolean;
  topZoom: number;
  /** Where the mouse is (canvas px), if over the canvas: the grid names the cell under it, buildings show their info box. */
  hover?: { x: number; y: number } | null;
  /** Buildings in real-time 3D (else 2D art); the HUD's 2D · 3D button shows which. */
  view3d: boolean;
  /** Frames per second and the slowest frame (ms) lately, shown when given (the panel's "frame rate"). */
  fps?: { fps: number; worstMs: number };
}

export function renderFrame(ctx: CanvasRenderingContext2D, world: World, v: FrameView): void {
  set3d(v.view3d);
  // world, zoomed and anchored near the bottom of the screen
  // start transparent: the sky is composited behind the land (see sky.ts)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (v.topView) {
    ctx.setTransform(v.uiScale, 0, 0, v.uiScale, 0, 0);
    drawTopView(ctx, world, v.uiW, v.uiH, v.topZoom, v.showGrid, v.hover ? { x: v.hover.x / v.uiScale, y: v.hover.y / v.uiScale } : null);
  } else {
  ctx.setTransform(v.worldScale, 0, 0, v.worldScale, 0, v.offsetY);
  drawScene(ctx, world, {
    camX: v.camX,
    width: v.viewW,
    top: v.top,
    bottom: v.bottom,
    labelScale: Math.max(1, Math.min(3, v.uiScale / v.worldScale)),
    promptLabel: v.touch ? 'Tap the hammer to build' : 'Press ↓ or Space to build',
    upgradeLabel: v.touch ? 'Tap the hammer to upgrade or destroy' : 'Press ↓ or Space to upgrade or destroy',
    destroyLabel: v.touch ? 'Tap the hammer to destroy' : 'Press ↓ or Space to destroy',
    turnLabel: v.touch ? 'Tap ▲ or ▼ to turn onto the crossing street' : 'Press W / ↑ or S / ↓ to turn onto the crossing street',
    showGrid: v.showGrid,
    // touch screens have no hover: undefined shows the info box of the building at the rider instead
    hover: v.touch ? undefined : v.hover ? { x: v.hover.x / v.worldScale, y: (v.hover.y - v.offsetY) / v.worldScale } : null,
  });
  }

  // screen UI, unaffected by zoom
  ctx.setTransform(v.uiScale, 0, 0, v.uiScale, 0, 0);
  // from above a turn is just a turn: the map doesn't change, so no fade
  if (!v.topView) drawTurnFade(ctx, world, v.uiW, v.uiH);
  const here = buildingAt(world, world.rider.x);
  drawHud(ctx, world, v.uiW, v.uiH, {
    touch: v.touch,
    leftHeld: v.leftHeld,
    rightHeld: v.rightHeld,
    canBuild: here ? canDemolish(here) : roomToBuild(world, world.rider.x),
    canTurn: !world.menu && !!crossroadAt(world),
    topView: v.topView,
    view3d: v.view3d,
  });
  drawToasts(ctx, v.toasts, world.time, v.uiW);
  drawBuildMenu(ctx, world, v.uiW, v.uiH);
  if (v.fps) drawFps(ctx, v.fps, v.uiH);
}

/** The frame-rate readout, bottom left. */
function drawFps(ctx: CanvasRenderingContext2D, f: { fps: number; worstMs: number }, uiH: number): void {
  ctx.save();
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(8, uiH - 30, 230, 22);
  ctx.fillStyle = f.fps >= 55 ? '#9be37a' : f.fps >= 30 ? '#f3d36b' : '#f07a6b';
  ctx.fillText(`${f.fps.toFixed(0)} fps · worst ${f.worstMs.toFixed(0)} ms`, 14, uiH - 14);
  ctx.restore();
}
