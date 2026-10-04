// Screenshot the running game (or any page of it) with headless Edge or Chrome,
// driven over the DevTools protocol: no Playwright, nothing to install (Node 22
// has fetch and WebSocket built in). Starts the Vite dev server itself when
// none is up, and stops it again afterwards.
//
//   npm run shot -- "?scenario=showcase&gfx=0" --out shot.png
//   npm run shot -- "?scenario=showcase" --wait 20000 --size 1600x900 --keys d:1500
//   npm run shot -- stages.html?type=sawmill --out stages.png
//
// Options:
//   --out <file>       where the PNG goes (default: screenshot.png in the OS temp dir)
//   --wait <ms>        how long the game runs before the shot (default 6000)
//   --size <w>x<h>     window size (default 1400x800)
//   --keys <k:ms,...>  keys to hold down in turn after loading, e.g. d:1500 rides right 1.5 s
//   --port <n>         dev server port (default 5179)
//   --panels <list>    side panels to open, e.g. workers,settings,versions (all start closed)
//   --mouse <x>,<y>    move the mouse there (CSS px) before the shot: a building's info box shows under it
// Page errors and console warnings are printed, so a blank shot says why.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const out = resolve(opt('out', join(tmpdir(), 'screenshot.png')));
const wait = Number(opt('wait', '6000'));
const [w, h] = opt('size', '1400x800').split('x').map(Number);
const keys = opt('keys', '');
const mouse = opt('mouse', '');
const port = Number(opt('port', '5179'));
const panels = opt('panels', '').split(',').filter(Boolean);
const page = args[0] ?? '';
const url = /^https?:/.test(page) ? page : `http://localhost:${port}/${page.replace(/^\//, '')}`;

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
const browserPath = process.env.BROWSER_PATH ?? BROWSERS.find(existsSync);
if (!browserPath) throw new Error('no Edge or Chrome found: set BROWSER_PATH');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const up = async (u: string) => {
  try {
    return (await fetch(u)).ok;
  } catch {
    return false;
  }
};

const children: ChildProcess[] = [];
const cleanup = () => {
  for (const c of children) if (!c.killed) c.kill();
};
process.on('exit', cleanup);

// the dev server, unless one is already running there
if (!/^https?:/.test(page) && !(await up(`http://localhost:${port}/`))) {
  const vite = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { stdio: 'ignore' });
  children.push(vite);
  for (let i = 0; i < 150 && !(await up(`http://localhost:${port}/`)); i++) await sleep(200);
}

const debugPort = 9300 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(tmpdir(), 'shot-'));
const browser = spawn(browserPath, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, `--window-size=${w},${h}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
children.push(browser);

let targets: Array<{ type: string; webSocketDebuggerUrl: string }> = [];
for (let i = 0; i < 100 && !targets.length; i++) {
  try {
    targets = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()) as typeof targets;
  } catch {
    await sleep(200);
  }
}
const target = targets.find((t) => t.type === 'page');
if (!target) throw new Error('the browser did not open a page');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 0;
const pending = new Map<number, (m: { result?: Record<string, unknown> }) => void>();
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)!(m);
    pending.delete(m.id);
  } else if (m.method === 'Runtime.exceptionThrown') {
    console.log('page error:', m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  } else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    console.log(`console.${m.params.type}:`, m.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(' '));
  }
};
const send = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<{ result?: Record<string, unknown> }>((r) => {
    const id = ++nextId;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
// the side panels asked for start open (app/panel.ts keeps whether each is open in localStorage)
const PANEL_KEY: Record<string, string> = { workers: 'workers-open', settings: 'tuning-open', versions: 'versions-open' };
const opened = panels.map((p) => `localStorage.setItem('village-game:${PANEL_KEY[p] ?? p}', '1');`).join('');
if (opened) await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { ${opened} } catch {}` });
await send('Page.navigate', { url });
await sleep(Math.min(wait, 3000));

// keys held down in turn (the game reads keydown/keyup), e.g. d:1500
for (const step of keys ? keys.split(',') : []) {
  const [key, ms] = step.split(':');
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code });
  await sleep(Number(ms ?? 100));
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
}
await sleep(Math.max(0, wait - 3000));
if (mouse) {
  const [mx, my] = mouse.split(',').map(Number);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my });
  await sleep(300);
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(String(shot.result!.data), 'base64'));
console.log(out);
ws.close();
cleanup();
process.exit(0);
