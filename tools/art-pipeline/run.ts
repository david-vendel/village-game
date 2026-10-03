// npm run art:render -- <scene.blend|builder.py> <job.json> [--assets <folder>] [--raw <folder>]
//
// Renders a scene with the Blender harness (render.py), packs the raw passes
// into assets (pack.ts) and validates them (tools/assets/validate.ts).
// Blender: $BLENDER, else the usual install place for the OS. On a machine
// without a GPU set ART_DEVICE=CPU (e.g. the vmsj13 fallback).

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatReport, validateAssets } from '../assets/validate';
import { packRender } from './pack';

function blenderPath(): string {
  const candidates = [
    process.env.BLENDER,
    'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe',
    '/Applications/Blender.app/Contents/MacOS/Blender',
    '/usr/bin/blender',
    '/snap/bin/blender',
    '/opt/blender/blender',
  ].filter((p): p is string => !!p);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`Blender not found; set BLENDER to its path (tried ${candidates.join(', ')})`);
  return found;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const [scene, jobFile] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
if (!scene || !jobFile) {
  console.error('usage: npm run art:render -- <scene.blend|builder.py> <job.json> [--assets <folder>] [--raw <folder>] [--no-pack]');
  process.exit(2);
}
const job = JSON.parse(readFileSync(jobFile, 'utf8')) as { id: string };
const raw = resolve(arg('--raw') ?? join('.art-raw', job.id));
const assets = resolve(arg('--assets') ?? 'public/assets');
rmSync(raw, { recursive: true, force: true });

const started = Date.now();
const code = await new Promise<number>((done) => {
  const p = spawn(blenderPath(), ['-b', '--python-exit-code', '1', '-P', resolve('tools/art-pipeline/render.py'), '--', '--scene', resolve(scene), '--job', resolve(jobFile), '--out', raw], { stdio: ['ignore', 'pipe', 'pipe'] });
  // Blender is chatty: pass on our own lines, errors and tracebacks
  const relay = (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) if (/art-pipeline|Error|Traceback|File "|^\s{4}/.test(line)) console.log(line);
  };
  p.stdout.on('data', relay);
  p.stderr.on('data', relay);
  p.on('close', (c) => done(c ?? 1));
});
if (code !== 0) {
  console.error(`Blender failed (exit ${code})`);
  process.exit(1);
}
// --no-pack: just the renders (tools/asset looks at them; they are not game sprites)
if (process.argv.includes('--no-pack')) {
  console.log(`rendered in ${((Date.now() - started) / 1000).toFixed(0)} s into ${raw}`);
  process.exit(0);
}
console.log(`rendered in ${((Date.now() - started) / 1000).toFixed(0)} s; packing into ${assets}`);
await packRender(raw, assets, { log: console.log });
const report = await validateAssets(assets);
console.log(formatReport(report));
process.exit(report.errors.length ? 1 : 0);
