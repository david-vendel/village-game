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
import { installVersionsPanel, requestedVersion, showVersion } from './app/versions';
import { update, type World } from './game/world';
import { sizePanelButtons } from './app/panel';
import { type ArtMode, cameraX, HUD_BUTTON, loadArt, renderFrame, showArtPreview, showGallery3d, type Toast, viewY } from './render';
import { yAt } from './game/layout';

// ?art=procedural ignores sprite assets; ?art=preview shows the asset contact sheet instead of the game
const artParam = new URLSearchParams(location.search).get('art');
const art: ArtMode = artParam === 'procedural' || artParam === 'preview' ? artParam : 'auto';
await loadArt({ mode: art, approvedOnly: import.meta.env.PROD });
// ?v=<commit>: the game as it was at a major graphics commit (the Versions panel, bottom left)
const version = requestedVersion();
if (version) showVersion(version);
else if (art === 'preview') showArtPreview();
// ?view=3d: the 3D buildings on their own (render/gallery3d.ts)
else if (new URLSearchParams(location.search).get('view') === '3d') showGallery3d();
else await play();

async function play(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;

  // dev only: ?scenario=<name> starts from tests/scenarios/<name>.scn instead of the save, and saves nothing
  const scenario = import.meta.env.DEV ? new URLSearchParams(location.search).get('scenario') : null;
  const saves = scenario ? null : await openSaveStore();
  const { world, restored } = scenario ? await scenarioWorld(scenario) : await loadGame(saves);
  const autosave = installAutosave(world, saves);
  const screen = createScreen(canvas);
  const toasts: Toast[] = [];
  const notify = (text: string) => {
    toasts.push({ text, at: world.time });
    while (toasts.length > 4) toasts.shift();
  };
  const sound = createSound();
  const actions = createActions(world, notify, () => screen.touch, sound);
  // the game autosaves; the New village button by the zoom keys is the way back to a fresh start
  const controls = installControls(world, screen, actions, () => {
    if (window.confirm('Start a new village? Your saved village will be lost.')) void autosave.newGame();
  });
  const display = installTuning(world, sound, screen);
  installWorkersPanel(world);
  installVersionsPanel(null);
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

    // the panel's "screen bottom" ground (by default the near edge of the fields in front of the
    // road and their fence) at the bottom of the screen, wherever the drawing camera puts it
    screen.frameTo(viewY(yAt(-display.viewBottom)));

    // smooth camera follow
    const vp = screen.vp;
    const target = cameraX(world, vp.viewW);
    camX += (target - camX) * Math.min(1, dt * 4);
    if (Math.abs(target - camX) > vp.viewW) camX = target;

    sizePanelButtons((HUD_BUTTON * vp.uiScale) / screen.dpr);

    const held = controls.touchHeld();
    renderFrame(ctx, world, { ...vp, camX, touch: screen.touch, leftHeld: held.left, rightHeld: held.right, toasts, showGrid: display.grid, topView: controls.topView(), topZoom: controls.topZoom(), hover: controls.hover(), view3d: art === 'auto' && controls.view3d(), fps: display.fps ? fps : undefined });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/** A world played from a scenario file (dev builds only; see tools/sim.ts). */
async function scenarioWorld(name: string): Promise<{ world: World; restored: boolean }> {
  const files = import.meta.glob('../tests/scenarios/*.scn', { query: '?raw', import: 'default' });
  const load = files[`../tests/scenarios/${name}.scn`];
  if (!load) throw new Error(`no scenario ${name} (${Object.keys(files).join(', ')})`);
  const { runScenario } = await import('./sim/scenario');
  const r = runScenario((await load()) as string);
  if (r.failures.length) console.warn('scenario failures', r.failures);
  return { world: r.world, restored: false };
}
