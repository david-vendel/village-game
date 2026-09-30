// Bootstrap and main loop: wires the game (src/game), the renderer
// (src/render) and input/screen handling (src/app) together.

import { announceEvents, createActions } from './app/actions';
import { installControls } from './app/controls';
import { createScreen } from './app/screen';
import { installTuning } from './app/tuning';
import { createWorld, update } from './game/world';
import { cameraX, renderFrame, type Toast } from './render';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const world = createWorld();
const screen = createScreen(canvas);
const toasts: Toast[] = [];
const notify = (text: string) => {
  toasts.push({ text, at: world.time });
  while (toasts.length > 4) toasts.shift();
};
const actions = createActions(world, notify, () => screen.touch);
const controls = installControls(world, screen, actions);
installTuning(world);

let camX = cameraX(world, screen.vp.viewW);
let last = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  update(world, dt, controls.move());
  announceEvents(world, notify);

  // smooth camera follow
  const vp = screen.vp;
  const target = cameraX(world, vp.viewW);
  camX += (target - camX) * Math.min(1, dt * 4);
  if (Math.abs(target - camX) > vp.viewW) camX = target;

  const held = controls.touchHeld();
  renderFrame(ctx, world, { ...vp, camX, touch: screen.touch, leftHeld: held.left, rightHeld: held.right, toasts });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
