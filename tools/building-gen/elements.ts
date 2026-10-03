// npx tsx tools/building-gen/elements.ts <type> [seed] [size]: print a
// building's construction elements, named points and moving parts as JSON,
// from the game's own generators (src/render/build3d). The Blender scene
// builders read this, so the architecture rules live in one place (the game)
// and the offline sprite renders match the real-time 3D.

import type { BuildingType } from '../../src/game/buildings';
import { modelOf, modelTypes } from '../../src/render/build3d/index';

const type = process.argv[2] as BuildingType;
const seed = Number(process.argv[3] ?? 7);
const size = Number(process.argv[4] ?? 1) as 1 | 2 | 3;
if (!modelTypes().includes(type)) {
  console.error(`usage: elements.ts <${modelTypes().join('|')}> [seed] [size]`);
  process.exit(2);
}
const m = modelOf(type, seed, size);
process.stdout.write(JSON.stringify({ elements: m.elements, points: m.points, anims: m.anims }));
