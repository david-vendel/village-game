// Tuning panel: DOM sliders on the right edge that edit world.params (and the
// sound volume) live. Each knob writes its value into the URL (replaceState),
// so a setting survives a reload and can be sent as a link. Same pattern as
// ../hollow.

import { BACKDROP_BEHIND, GAME_EYE_HEIGHT, setBackdropBehind, setCameraDistance, setCameraHeight, setMountainLift } from '../render';
import { EYE_DIST } from '../game/layout';
import { dayMinutes } from '../game/daynight';
import { DEFAULT_PARAMS, type World, type WorldParams } from '../game/world';
import { makeCollapsible } from './panel';
import type { Screen } from './screen';
import type { Sound } from './sound';
import { DEFAULT_ZOOM, ZOOM_MAX } from './viewport';

interface Knob {
  /** URL query name. */
  param: string;
  min: number;
  max: number;
  step: number;
  def: number;
  get: () => number;
  set: (v: number) => void;
  render: (v: number) => string;
}

type WorldKnob = Pick<Knob, 'param' | 'min' | 'max' | 'step' | 'render'> & { key: keyof WorldParams; def?: number };

const WORLD_KNOBS: WorldKnob[] = [
  { key: 'riderMaxSpeed', param: 'hspeed', min: 60, max: 600, step: 10, render: (v) => `horse speed ${v} px/s` },
  { key: 'riderAccel', param: 'haccel', min: 100, max: 2000, step: 20, render: (v) => `horse accel ${v} px/s²` },
  { key: 'riderDecel', param: 'hbrake', min: 100, max: 2000, step: 20, render: (v) => `horse braking ${v} px/s²` },
  { key: 'buildSpeed', param: 'build', min: 0.25, max: 10, step: 0.25, render: (v) => `build speed ${v}×` },
  { key: 'builderWalk', param: 'bwalk', min: 0.25, max: 6, step: 0.25, render: (v) => `builder walk ${v}×` },
  {
    key: 'timeSpeed',
    param: 'tspeed',
    min: 0.25,
    max: 20,
    step: 0.25,
    // when playing, days pass faster than the simulation's own default (tests and scenarios keep 1)
    def: 2.25,
    // night runs NIGHT_SPEED times faster (daynight.ts): a whole day with the default night
    render: (v) => `time speed ${v}× (day ${+dayMinutes(v, DEFAULT_PARAMS.nightHours).toFixed(1)} min)`,
  },
  { key: 'nightHours', param: 'night', min: 0, max: 12, step: 0.5, render: (v) => `night ${v} h` },
  // work time scales with plot width; the label shows a typical 3-cell plot
  { key: 'sowPerCell', param: 'sow', min: 0.25, max: 10, step: 0.25, render: (v) => `sowing ${v} s/cell (plot ${+(v * 3).toFixed(2)} s)` },
  { key: 'harvestPerCell', param: 'reap', min: 0.25, max: 10, step: 0.25, render: (v) => `harvest ${v} s/cell (plot ${+(v * 3).toFixed(2)} s)` },
];

function setUrlParam(name: string, v: number | null): void {
  const u = new URL(window.location.href);
  if (v === null) u.searchParams.delete(name);
  else u.searchParams.set(name, String(v));
  window.history.replaceState(null, '', u);
}

/** Display toggles from the panel, read by the frame loop each frame. */
export interface DisplayOptions {
  /** Overlay the land grid (URL: grid=1). */
  grid: boolean;
  /** Show the frame rate (on unless URL: fps=0). */
  fps: boolean;
  /** How far in front of the middle of the road (map px) the ground at the bottom of the screen lies (main.ts frames to it). */
  viewBottom: number;
}

/** The drawing camera's distance to start with (render/ground.ts): the game's own. */
const CAMERA_DEFAULT = EYE_DIST;
/** The drawing camera's height to start with (world units; render/ground.ts): lower than the game's own, looking along the street more. */
const HEIGHT_DEFAULT = 177;
/** Ground at the bottom of the screen to start with: a little past the fence along the near edge of the fields in front of the road. */
const VIEW_BOTTOM_DEFAULT = 100;

export function installTuning(world: World, sound: Sound, screen: Screen): DisplayOptions {
  let cameraNow = CAMERA_DEFAULT;
  let heightNow = HEIGHT_DEFAULT;
  let horizonNow = BACKDROP_BEHIND;
  let mountainsNow = 0;
  const params = new URLSearchParams(window.location.search);
  const display: DisplayOptions = { grid: params.get('grid') === '1', fps: params.get('fps') !== '0', viewBottom: VIEW_BOTTOM_DEFAULT };
  const knobs: Knob[] = [
    ...WORLD_KNOBS.map(({ key, def, ...k }) => ({
      ...k,
      def: def ?? DEFAULT_PARAMS[key],
      get: () => world.params[key],
      set: (v: number) => {
        world.params[key] = v;
      },
    })),
    {
      // how far back the drawing camera stands (render/ground.ts): further back is a longer lens and
      // less stretched depth; EYE_DIST is the game's own. Closer than it, the fields in front of the
      // road reach down to the bottom of the screen. Drawing only: the game's distances don't change
      param: 'cam',
      min: Math.round(EYE_DIST * 0.625),
      max: EYE_DIST * 4,
      step: 25,
      def: CAMERA_DEFAULT,
      get: () => cameraNow,
      set: (v) => {
        cameraNow = v;
        setCameraDistance(v);
      },
      render: (v) => `camera ${v} px back`,
    },
    {
      // how high the drawing camera stands (render/ground.ts): higher looks down more steeply, the
      // horizon moves up and the street you ride along is drawn wider. Drawing only
      param: 'camh',
      min: Math.round(GAME_EYE_HEIGHT * 0.5),
      max: Math.round(GAME_EYE_HEIGHT * 3),
      step: 1,
      def: HEIGHT_DEFAULT,
      get: () => heightNow,
      set: (v) => {
        heightNow = v;
        setCameraHeight(v);
      },
      render: (v) => `camera height ${(v / 20).toFixed(1)} m`,
    },
    {
      // not the camera moving: which ground is framed at the bottom of the screen, the picture scaled
      // to fit it (zoom 1) with the depth unchanged. The fields in front of the road end at 87.5
      param: 'vbot',
      min: 40,
      max: 160,
      step: 2,
      def: VIEW_BOTTOM_DEFAULT,
      get: () => display.viewBottom,
      set: (v) => {
        display.viewBottom = v;
      },
      render: (v) => `screen bottom ${(v / 20).toFixed(1)} m before road`,
    },
    {
      // where the hills, the castle and the sky meet the land (render/ground.ts backdropShift):
      // nearer brings them down the screen; the land beyond is hidden behind them. Drawing only
      param: 'horizon',
      min: 300,
      max: 4000,
      step: 25,
      def: BACKDROP_BEHIND,
      get: () => horizonNow,
      set: (v) => {
        horizonNow = v;
        setBackdropBehind(v);
      },
      render: (v) => `horizon ${(v / 20).toFixed(0)} m behind road`,
    },
    {
      // the far blue mountains behind the castle's hills (render/background.ts): up or down
      param: 'hills',
      min: -120,
      max: 120,
      step: 2,
      def: 0,
      get: () => mountainsNow,
      set: (v) => {
        mountainsNow = v;
        setMountainLift(v);
      },
      render: (v) => `blue hills ${v > 0 ? '+' : ''}${v}`,
    },
    {
      // the street view's zoom (also - + keys, the wheel, pinching; 0 goes back to the default).
      // Narrow screens start further out (viewport.ts) and clamp to what fits
      param: 'zoom',
      min: 0.3,
      max: ZOOM_MAX,
      step: 0.01,
      def: DEFAULT_ZOOM,
      get: () => +screen.vp.zoom.toFixed(2),
      set: (v) => {
        if (v === DEFAULT_ZOOM) screen.resetZoom();
        else screen.setZoom(v);
      },
      render: (v) => `zoom ${v.toFixed(2)}×  (- + keys, 0 resets)`,
    },
    {
      param: 'vol',
      min: 0,
      max: 100,
      step: 5,
      def: 60,
      get: () => Math.round(sound.volume * 100),
      set: (v) => {
        sound.volume = v / 100;
      },
      render: (v) => `volume ${v}%  (M mutes)`,
    },
  ];

  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;right:12px;top:50%;transform:translateY(-50%);color:#f3ead8;' +
    'font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'background:rgba(20,14,8,0.78);border:1px solid rgba(232,200,114,0.25);' +
    'border-radius:8px;padding:8px 12px 10px;user-select:none;text-align:right';

  const content = document.createElement('div');
  for (const k of knobs) {
    k.set(k.def);
    const fromUrl = Number(params.get(k.param) ?? NaN);
    if (Number.isFinite(fromUrl)) k.set(Math.min(k.max, Math.max(k.min, fromUrl)));

    const label = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(k.min);
    input.max = String(k.max);
    input.step = String(k.step);
    input.value = String(k.get());
    input.style.cssText = 'display:block;width:160px;margin-left:auto;accent-color:#e8c872';
    label.textContent = k.render(k.get());
    input.addEventListener('input', () => {
      const v = Number(input.value);
      k.set(v);
      label.textContent = k.render(v);
      // keep the URL clean: only values that differ from the default
      setUrlParam(k.param, v === k.def ? null : v);
    });
    // hand the arrow keys back to the horse once the drag ends
    input.addEventListener('change', () => input.blur());
    content.append(label, input);
    if (k.param === 'zoom') {
      // zooming from the keys, wheel, pinch or buttons moves the slider and the URL too
      // (the URL a moment after the last step: browsers limit how often it may change)
      let urlTimer = 0;
      screen.onZoom = (z, chosen) => {
        const v = +z.toFixed(2);
        input.value = String(v);
        label.textContent = k.render(v);
        clearTimeout(urlTimer);
        urlTimer = window.setTimeout(() => setUrlParam('zoom', chosen ? v : null), 250);
      };
    }
  }

  const toggle = document.createElement('label');
  toggle.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;align-items:center;margin-top:6px;cursor:pointer';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = display.grid;
  box.style.cssText = 'accent-color:#e8c872;margin:0';
  box.addEventListener('change', () => {
    display.grid = box.checked;
    setUrlParam('grid', box.checked ? 1 : null);
    box.blur();
  });
  // G flips it too, through the checkbox so the box and the URL keep up
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'g' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) box.click();
  });
  toggle.append('land grid (G)', box);
  content.append(toggle);

  const fpsToggle = document.createElement('label');
  fpsToggle.style.cssText = toggle.style.cssText;
  const fpsBox = document.createElement('input');
  fpsBox.type = 'checkbox';
  fpsBox.checked = display.fps;
  fpsBox.style.cssText = box.style.cssText;
  fpsBox.addEventListener('change', () => {
    display.fps = fpsBox.checked;
    setUrlParam('fps', fpsBox.checked ? null : 0);
    fpsBox.blur();
  });
  fpsToggle.append('frame rate', fpsBox);
  content.append(fpsToggle);

  makeCollapsible(root, content, 'right', 'village-game:tuning-open', true, 'Settings');
  document.body.appendChild(root);
  return display;
}
