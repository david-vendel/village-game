// Bootstrap and main loop: wires the game (src/game), the renderer
// (src/render) and input/screen handling (src/app) together. The world comes
// from the save in IndexedDB when there is one, and is autosaved from then on.

import { announceEvents, createActions } from './app/actions';
import { installControls } from './app/controls';
import { installAutosave, loadGame, openSaveStore } from './app/persistence';
import { createScreen } from './app/screen';
import { createSound } from './app/sound';
import { installTuning } from './app/tuning';
import { installWorkersPanel } from './app/workers';
import { update } from './game/world';
import { sizePanelButtons } from './app/panel';
import { cameraX, HUD_BUTTON, renderFrame, type Toast } from './render';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const saves = await openSaveStore();
const { world, restored } = await loadGame(saves);
const autosave = installAutosave(world, saves);
const screen = createScreen(canvas);
const toasts: Toast[] = [];
const notify = (text: string) => {
  toasts.push({ text, at: world.time });
  while (toasts.length > 4) toasts.shift();
};
const sound = createSound();
const actions = createActions(world, notify, () => screen.touch, sound);
const controls = installControls(world, screen, actions);
const display = installTuning(world, sound, { onNewVillage: () => void autosave.newGame() });
installWorkersPanel(world);
if (restored) notify('Welcome back to your village');

let camX = cameraX(world, screen.vp.viewW);
let last = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  update(world, dt, controls.move());
  sound.frame(world, dt);
  autosave.tick(); // every half hour of game time
  if (world.events.length) autosave.requestSave(); // something was built or finished
  announceEvents(world, notify);

  // smooth camera follow
  const vp = screen.vp;
  const target = cameraX(world, vp.viewW);
  camX += (target - camX) * Math.min(1, dt * 4);
  if (Math.abs(target - camX) > vp.viewW) camX = target;

  sizePanelButtons((HUD_BUTTON * vp.uiScale) / screen.dpr);

  const held = controls.touchHeld();
  renderFrame(ctx, world, { ...vp, camX, touch: screen.touch, leftHeld: held.left, rightHeld: held.right, toasts, showGrid: display.grid });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
