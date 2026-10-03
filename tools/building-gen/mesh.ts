// npx tsx tools/building-gen/mesh.ts <type> [seed] [size] [style]: a building as
// triangle meshes, exactly as the game's real-time 3D draws it (geometry.ts),
// grouped by the render harness's collections (stage:<stage> / tags) and
// material, in model space (metres, +Z up, front towards −Y), with each
// material's base colour in a style (build3d/style.ts). The Blender scene
// (scenes/building.py) builds these as they are, so the offline renders that
// get painted over are the same buildings, stage by stage.
//
// Tags: until:<stage> (stakes, trench, scaffolding) → scaffold; decorations
// (flowers, ivy) are always shown; moving parts are rendered shut.

import type { BuildingType } from '../../src/game/buildings';
import { type Element, untilOf } from '../../src/render/build3d/elements';
import { mergeByMaterial } from '../../src/render/build3d/geometry';
import { modelOf, modelTypes } from '../../src/render/build3d/index';
import { MATERIALS } from '../../src/render/build3d/materials';
import { paletteOf, STYLES } from '../../src/render/build3d/style';

const [type, seedArg, sizeArg, styleArg] = process.argv.slice(2) as [BuildingType, string?, string?, string?];
if (!modelTypes().includes(type)) {
  console.error(`usage: mesh.ts <${modelTypes().join('|')}> [seed] [size] [style]`);
  process.exit(2);
}
const seed = Number(seedArg ?? 7);
const size = Number(sizeArg ?? 1) as 1 | 2 | 3;
const style = STYLES[styleArg ?? 'painterly'];
const model = modelOf(type, seed, size);

/** The harness collection path of an element. */
function pathOf(e: Element): string[] {
  const tags = new Set<string>();
  if (untilOf(e)) tags.add('scaffold');
  for (const t of e.tags) if (t.startsWith('variant:') || t.startsWith('novariant:')) tags.add(t);
  return [`stage:${e.stage}`, ...[...tags].sort()];
}

/** A material's base colour in the style, a building's own from its palette. */
function colourOf(name: string): string {
  const pal = paletteOf(style, name);
  if (pal) return pal[(seed * 7 + name.length) % pal.length];
  return style.colors[name] ?? MATERIALS[name]?.color ?? '#808080';
}

const groups = new Map<string, Element[]>();
for (const e of model.elements) {
  const key = pathOf(e).join('/');
  (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
}
const out: Array<{ path: string[]; material: string; color: string; rough: number; metal: number; glow: string | null; pos: number[]; nor: number[]; col: number[] }> = [];
const round = (v: number) => Math.round(v * 1e4) / 1e4;
for (const [key, els] of groups) {
  for (const [name, m] of mergeByMaterial(els)) {
    const pos: number[] = [];
    const nor: number[] = [];
    // three.js axes (x, z, −y) back to model space (x, y, z)
    for (let i = 0; i < m.pos.length; i += 3) {
      pos.push(round(m.pos[i]), round(-m.pos[i + 2]), round(m.pos[i + 1]));
      nor.push(round(m.nor[i]), round(-m.nor[i + 2]), round(m.nor[i + 1]));
    }
    const def = MATERIALS[name];
    out.push({ path: key.split('/'), material: name, color: colourOf(name), rough: def?.rough ?? 0.8, metal: def?.metal ?? 0, glow: def?.glow?.color ?? null, pos, nor, col: Array.from(m.col, round) });
  }
}
process.stdout.write(JSON.stringify({ type, seed, size, style: style.name, points: model.points, groups: out }));
