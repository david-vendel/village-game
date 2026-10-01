// Maps the canvas to world and UI coordinates.
//
// Zoom 1 fits the designed 540-unit-tall scene to the screen height. Zooming
// out shows more street horizontally and more sky above; the ground stays
// anchored near the bottom of the screen. On portrait touch screens the street
// is lifted by `bottomPad` so the on-screen buttons sit on meadow, not on the
// rider. Screen UI uses its own scale so buttons and text keep a usable size
// whatever the zoom.

import { VIEW_H } from '../game/layout';

/** How far in the street view can zoom: past 1 it closes in on the street, the ground kept at the bottom of the screen. */
export const ZOOM_MAX = 1.6;
/** Narrow (portrait) screens start zoomed out until this much street is visible. */
const MIN_DEFAULT_VIEW_W = 460;
/** UI is laid out for at least this many UI units across / down. */
const MIN_UI_W = 440;
const MIN_UI_H = 540;
/** Space kept under the street for touch buttons on portrait screens (UI units). */
const TOUCH_PAD_UI = 118;

export interface Viewport {
  zoom: number;
  /** Canvas px per world unit. */
  worldScale: number;
  /** Canvas px offset applied after scaling. */
  offsetY: number;
  /** Visible world width, and world y of the top and bottom screen edges. */
  viewW: number;
  top: number;
  bottom: number;
  /** Canvas px per UI unit, and the UI space size. */
  uiScale: number;
  uiW: number;
  uiH: number;
}

function uiScaleFor(cw: number, ch: number): number {
  return Math.min(ch / MIN_UI_H, cw / MIN_UI_W);
}

/** Canvas px under the street reserved for touch controls. */
export function bottomPad(cw: number, ch: number, touch: boolean): number {
  return touch && ch > cw * 1.1 ? TOUCH_PAD_UI * uiScaleFor(cw, ch) : 0;
}

export function defaultZoom(cw: number, ch: number, touch = false): number {
  const sceneH = ch - bottomPad(cw, ch, touch);
  return Math.min(1, cw / (sceneH / VIEW_H) / MIN_DEFAULT_VIEW_W);
}

export function zoomRange(cw: number, ch: number, touch = false): [number, number] {
  return [Math.min(0.45, defaultZoom(cw, ch, touch) * 0.6), ZOOM_MAX];
}

export function clampZoom(z: number, cw: number, ch: number, touch = false): number {
  const [lo, hi] = zoomRange(cw, ch, touch);
  return Math.max(lo, Math.min(hi, z));
}

export function computeViewport(cw: number, ch: number, zoom: number, touch = false): Viewport {
  const z = clampZoom(zoom, cw, ch, touch);
  const pad = bottomPad(cw, ch, touch);
  const sceneH = ch - pad;
  const worldScale = (sceneH / VIEW_H) * z;
  const offsetY = sceneH - VIEW_H * worldScale;
  const uiScale = uiScaleFor(cw, ch);
  return {
    zoom: z,
    worldScale,
    offsetY,
    viewW: cw / worldScale,
    top: -offsetY / worldScale,
    bottom: (ch - offsetY) / worldScale,
    uiScale,
    uiW: cw / uiScale,
    uiH: ch / uiScale,
  };
}
