// Public entry point of the render layer. The app calls `renderFrame` once per
// frame; everything about how things look — draw order, art, HUD, menus — is
// decided in src/render. Rendering only reads game state, never changes it.

import { canUpgrade, crossroadAt, getBuilding, plotAt, type World } from '../game/world';
import { drawScene } from './scene';
import { drawTopView } from './topview';
import { drawBuildMenu, drawHud, drawToasts, drawTurnFade, type Toast } from './ui';

export { cameraX } from './scene';
export { STRIDE as HORSE_STRIDE } from './horse';
export { hit, HUD_BUTTON, hudLayout, menuLayout, type Rect, type Toast } from './ui';

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
  /** Show the village from above instead of from the street; `zoom` scales it. */
  topView: boolean;
  zoom: number;
}

export function renderFrame(ctx: CanvasRenderingContext2D, world: World, v: FrameView): void {
  // world, zoomed and anchored near the bottom of the screen
  // start transparent: the sky is composited behind the land (see sky.ts)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (v.topView) {
    ctx.setTransform(v.uiScale, 0, 0, v.uiScale, 0, 0);
    drawTopView(ctx, world, v.uiW, v.uiH, v.zoom);
  } else {
  ctx.setTransform(v.worldScale, 0, 0, v.worldScale, 0, v.offsetY);
  drawScene(ctx, world, {
    camX: v.camX,
    width: v.viewW,
    top: v.top,
    bottom: v.bottom,
    labelScale: Math.max(1, Math.min(3, v.uiScale / v.worldScale)),
    promptLabel: v.touch ? 'Tap the hammer to build' : 'Press ↓ or Space to build',
    upgradeLabel: v.touch ? 'Tap the hammer to upgrade' : 'Press ↓ or Space to upgrade',
    turnLabel: v.touch ? 'Tap ▲ or ▼ to turn onto the crossing street' : 'Press W / ↑ or S / ↓ to turn onto the crossing street',
    showGrid: v.showGrid,
  });
  }

  // screen UI, unaffected by zoom
  ctx.setTransform(v.uiScale, 0, 0, v.uiScale, 0, 0);
  drawTurnFade(ctx, world, v.uiW, v.uiH);
  const plot = plotAt(world, world.rider.x);
  const here = getBuilding(world, plot?.buildingId ?? null);
  drawHud(ctx, world, v.uiW, v.uiH, {
    touch: v.touch,
    leftHeld: v.leftHeld,
    rightHeld: v.rightHeld,
    canBuild: (!!plot && plot.buildingId === null) || (!!here && canUpgrade(here)),
    canTurn: !world.menu && !!crossroadAt(world),
    topView: v.topView,
  });
  drawToasts(ctx, v.toasts, world.time, v.uiW);
  drawBuildMenu(ctx, world, v.uiW, v.uiH);
}
