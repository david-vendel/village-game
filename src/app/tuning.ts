// Tuning panel: DOM sliders on the right edge that edit world.params live.
// Each knob writes its value into the URL (replaceState), so a setting
// survives a reload and can be sent as a link. Same pattern as ../hollow.

import { DEFAULT_PARAMS, type World, type WorldParams } from '../game/world';

interface Knob {
  key: keyof WorldParams;
  /** URL query name. */
  param: string;
  min: number;
  max: number;
  step: number;
  render: (v: number) => string;
}

const KNOBS: Knob[] = [
  { key: 'riderMaxSpeed', param: 'hspeed', min: 60, max: 600, step: 10, render: (v) => `horse speed ${v} px/s` },
  { key: 'riderAccel', param: 'haccel', min: 100, max: 2000, step: 20, render: (v) => `horse accel ${v} px/s²` },
  { key: 'riderDecel', param: 'hbrake', min: 100, max: 2000, step: 20, render: (v) => `horse braking ${v} px/s²` },
  { key: 'buildSpeed', param: 'build', min: 0.25, max: 10, step: 0.25, render: (v) => `build speed ${v}×` },
];

function setUrlParam(name: string, v: number | null): void {
  const u = new URL(window.location.href);
  if (v === null) u.searchParams.delete(name);
  else u.searchParams.set(name, String(v));
  window.history.replaceState(null, '', u);
}

export function installTuning(world: World): HTMLElement {
  const params = new URLSearchParams(window.location.search);
  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;right:12px;top:50%;transform:translateY(-50%);color:#f3ead8;' +
    'font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'background:rgba(20,14,8,0.78);border:1px solid rgba(232,200,114,0.25);' +
    'border-radius:8px;padding:8px 12px 10px;user-select:none;text-align:right';

  for (const k of KNOBS) {
    const fromUrl = Number(params.get(k.param) ?? NaN);
    if (Number.isFinite(fromUrl)) world.params[k.key] = Math.min(k.max, Math.max(k.min, fromUrl));

    const label = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(k.min);
    input.max = String(k.max);
    input.step = String(k.step);
    input.value = String(world.params[k.key]);
    input.style.cssText = 'display:block;width:160px;margin-left:auto;accent-color:#e8c872';
    label.textContent = k.render(world.params[k.key]);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      world.params[k.key] = v;
      label.textContent = k.render(v);
      // keep the URL clean: only values that differ from the default
      setUrlParam(k.param, v === DEFAULT_PARAMS[k.key] ? null : v);
    });
    // hand the arrow keys back to the horse once the drag ends
    input.addEventListener('change', () => input.blur());
    root.append(label, input);
  }

  document.body.appendChild(root);
  return root;
}
