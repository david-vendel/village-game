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
import { type ArtMode, cameraX, HUD_BUTTON, loadArt, renderFrame, set3d, showArtPreview, type Toast } from './render';

// ?art=procedural ignores sprite assets; ?art=preview shows the asset contact sheet instead of the game
const artParam = new URLSearchParams(location.search).get('art');
const art: ArtMode = artParam === 'procedural' || artParam === 'preview' ? artParam : 'auto';
await loadArt({ mode: art, approvedOnly: import.meta.env.PROD });
// buildings with a 3D model are drawn in real-time 3D (?3d=0 keeps them 2D)
set3d(art === 'auto' && new URLSearchParams(location.search).get('3d') !== '0');
if (art === 'preview') showArtPreview();
else await play();

async function play(): Promise<void> {
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
  // frame rate over the last second, and the slowest frame in it (the panel's "frame rate" toggle)
  const frameTimes: number[] = [];
  let fps: { fps: number; worstMs: number } | undefined;
  let last = performance.now();

  function frame(now: number): void {
    if (display.fps) {
      frameTimes.push(now - last);
      let sum = frameTimes.reduce((s, t) => s + t, 0);
      while (sum > 1000 && frameTimes.length > 1) sum -= frameTimes.shift()!;
      fps = { fps: (frameTimes.length * 1000) / sum, worstMs: Math.max(...frameTimes) };
    }
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
    renderFrame(ctx, world, { ...vp, camX, touch: screen.touch, leftHeld: held.left, rightHeld: held.right, toasts, showGrid: display.grid, topView: controls.topView(), topZoom: controls.topZoom(), hover: controls.hover(), fps: display.fps ? fps : undefined });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
