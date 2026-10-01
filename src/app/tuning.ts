// Tuning panel: DOM sliders on the right edge that edit world.params (and the
// sound volume) live. Each knob writes its value into the URL (replaceState),
// so a setting survives a reload and can be sent as a link. Same pattern as
// ../hollow.

import { DAY_LENGTH } from '../game/daynight';
import { DEFAULT_PARAMS, type World, type WorldParams } from '../game/world';
import { makeCollapsible } from './panel';
import type { Sound } from './sound';

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

type WorldKnob = Pick<Knob, 'param' | 'min' | 'max' | 'step' | 'render'> & { key: keyof WorldParams };

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
    render: (v) => `time speed ${v}× (day ${+(DAY_LENGTH / v / 60).toFixed(1)} min)`,
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
}

export function installTuning(world: World, sound: Sound, opts: { onNewVillage: () => void }): DisplayOptions {
  const knobs: Knob[] = [
    ...WORLD_KNOBS.map(({ key, ...k }) => ({
      ...k,
      def: DEFAULT_PARAMS[key],
      get: () => world.params[key],
      set: (v: number) => {
        world.params[key] = v;
      },
    })),
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

  const params = new URLSearchParams(window.location.search);
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
  }

  const display: DisplayOptions = { grid: params.get('grid') === '1', fps: params.get('fps') !== '0' };
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

  // the game autosaves; this is the way back to a fresh start
  const reset = document.createElement('button');
  reset.textContent = 'new village';
  reset.style.cssText =
    'margin-top:8px;font:inherit;color:#f3ead8;background:rgba(232,200,114,0.12);' +
    'border:1px solid rgba(232,200,114,0.45);border-radius:6px;padding:2px 10px;cursor:pointer';
  reset.addEventListener('click', () => {
    reset.blur();
    if (window.confirm('Start a new village? Your saved village will be lost.')) opts.onNewVillage();
  });
  content.append(reset);

  makeCollapsible(root, content, 'right', 'village-game:tuning-open');
  document.body.appendChild(root);
  return display;
}
