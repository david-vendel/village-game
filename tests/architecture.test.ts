// Guards the layer boundaries so graphics and game logic can be worked on
// independently (see ARCHITECTURE.md):
//
//   src/game    rules, state, simulation — imports only src/game
//   src/render  all visuals — imports src/game (read-only) and src/render
//   src/app     input, screen, wiring — uses src/render only via its index
//
// Lives outside src so the browser typecheck doesn't need Node types.
// If one of these fails, the fix is almost always to move code to the right
// layer, not to loosen the rule.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

interface Import {
  file: string;
  /** Resolved target relative to src, e.g. "game/world". */
  target: string;
  names: string[];
}

function importsOf(file: string): Import[] {
  const text = readFileSync(file, 'utf8');
  const out: Import[] = [];
  const re = /(?:import|export)\s+(?:type\s+)?(?:\{([^}]*)\}|[\w*\s,]+)?\s*from\s+'(\.[^']*)'/g;
  for (const m of text.matchAll(re)) {
    const target = relative(SRC, resolve(dirname(file), m[2]));
    const names = (m[1] ?? '')
      .split(',')
      .map((n) => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
      .filter(Boolean);
    out.push({ file: relative(SRC, file), target, names });
  }
  return out;
}

const layer = (path: string) => path.split('/')[0];
const all = sources(SRC).flatMap(importsOf);

/** Game functions that change state; the renderer must never call them. */
const MUTATORS = [
  'update',
  'placeBuilding',
  'setConstructionEnabled',
  'openMenu',
  'closeMenu',
  'confirmMenu',
  'moveMenu',
  'selectMenu',
  'turnAtCrossroads',
  'layStreet',
  'branchStreet',
  'clearRoad',
  'updateFarm', // (gone; kept so it can't come back into render)
  'setFieldSpots',
  'syncFarmFields',
  'updateCrops',
  'repairFarm',
  'updateWorker',
  'retarget',
  'staffBuildings',
  'updateStrolls',
  'collectGoods',
  'payForBuilding',
  'pay',
  'rand',
];

describe('layer boundaries', () => {
  it('game imports nothing outside src/game', () => {
    const bad = all.filter((i) => layer(i.file) === 'game' && layer(i.target) !== 'game');
    expect(bad).toEqual([]);
  });

  it('game code uses no browser or canvas APIs', () => {
    const bad = sources(join(SRC, 'game')).filter((f) =>
      /\b(window|document|CanvasRenderingContext2D|HTMLCanvasElement|requestAnimationFrame|localStorage)\b/.test(readFileSync(f, 'utf8')),
    );
    expect(bad.map((f) => relative(SRC, f))).toEqual([]);
  });

  it('render imports only src/render and src/game', () => {
    const bad = all.filter((i) => layer(i.file) === 'render' && !['render', 'game'].includes(layer(i.target)));
    expect(bad).toEqual([]);
  });

  it('render never calls game functions that change state', () => {
    const bad = all.filter((i) => layer(i.file) === 'render' && layer(i.target) === 'game' && i.names.some((n) => MUTATORS.includes(n)));
    expect(bad).toEqual([]);
  });

  it('app and main use the renderer only through its public index', () => {
    const bad = all.filter((i) => layer(i.file) !== 'render' && i.target.startsWith('render/') && i.target !== 'render/index');
    expect(bad).toEqual([]);
  });

  it('the checker actually sees imports', () => {
    expect(all.some((i) => i.file === 'render/scene.ts' && i.target === 'game/world')).toBe(true);
  });
});
